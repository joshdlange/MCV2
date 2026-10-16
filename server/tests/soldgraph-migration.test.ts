import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { SoldgraphCache, migrationPrice, publicPrice } from "../pricing/soldgraph-cache";
import { SoldgraphBulk, parseUsage, safeSearchCount } from "../pricing/soldgraph-bulk";
import { SoldgraphError, type SoldgraphClient } from "../pricing/soldgraph-client";
import { reserveBrowseRequest, ebayRequestContext } from "../pricing/ebay-budget";

test("source selection preserves legacy before refresh and on empty results without inventing sold comps", () => {
  const legacy = { avg_price: "42.50", sales_count: 5, last_fetched: new Date() };
  const empty = publicPrice(null,null,null);
  assert.equal(migrationPrice(empty,legacy).source, "LEGACY_ACTIVE_ESTIMATE");
  assert.equal(migrationPrice(empty,legacy).avgPrice, 42.5);
  assert.equal(migrationPrice(publicPrice({usableCount:0},new Date(),new Date()),legacy).source,"LEGACY_ACTIVE_ESTIMATE");
  assert.equal(migrationPrice(empty,undefined).source,"SOLDGRAPH_NO_COMPS");
  assert.equal(migrationPrice(empty,undefined).avgPrice,null);
  for (const count of [1,2,3,7]) {
    const sold = publicPrice({usableCount:count,median:60},new Date(),new Date());
    assert.equal(migrationPrice(sold,legacy).source,count<3 ? "SOLDGRAPH_LIMITED_DATA" : "SOLDGRAPH_SOLD_COMPS");
    assert.equal(migrationPrice(sold,legacy).avgPrice,60);
  }
});
test("quota math uses per-search credits, preserves reserve and fails closed on unknown usage", () => {
  assert.equal(safeSearchCount(102,100,50,20,80),2);
  assert.equal(safeSearchCount(93,100,50,20,80),0);
  assert.equal(safeSearchCount(1993,100,100,200000,11),11);
  assert.throws(() => parseUsage({plan:"lite",remaining:null}));
  // Documented batch example: two completed items (including cache hit) cost two, not one.
  const items = [{status:"complete",credits:1},{status:"complete",credits:1},{status:"rejected",credits:0}];
  assert.equal(items.reduce((n,item) => n+item.credits,0),2);
});
test("refresh eligibility does not expire display preference until fourteen days", () => {
  const legacy={avg_price:20,sales_count:3,last_fetched:new Date()};
  for (const days of [2,13,15]) {
    const sold=publicPrice({usableCount:4,median:60},new Date(Date.now()-days*86400000),new Date(0));
    assert.equal(sold.stale,true);
    assert.equal(migrationPrice(sold,legacy).avgPrice,days<14 ? 60 : 20);
  }
});
test("representative production baselines survive empty sold comparisons", () => {
  for (const value of [462.68,425]) {
    const price=migrationPrice(publicPrice({usableCount:0},new Date(),new Date()),{
      avg_price:value,sales_count:1,last_fetched:new Date()
    });
    assert.equal(price.avgPrice,value);
    assert.equal(price.source,"LEGACY_ACTIVE_ESTIMATE");
  }
  const missing=migrationPrice(publicPrice({usableCount:0},new Date(),new Date()),{avg_price:0});
  assert.equal(missing.avgPrice,null);
  assert.equal(missing.confidence,"unavailable");
});
test("isolated PostgreSQL migration, dry run, reserve, resumability and cross-instance locking",
  { skip: process.env.NODE_ENV !== "development" }, async () => {
  const schema = `sg_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`,max:10});
  let searches=0, usageCalls=0, remaining=102;
  const fake = {
    usage:async()=>{usageCalls++;return {plan:"lite",limit:2000,used:2000-remaining,remaining,window:"rolling_30_days"};},
    search:async()=>{searches++;await new Promise(r=>setTimeout(r,30));return {
      data:[{id:"1",title:"2026 Topps Chrome Marvel Knull FF-23 Fanfare",link:"https://www.ebay.com/itm/1",
        displayed_price:{amount:60,currency:"USD"},displayed_price_range:null,best_offer_accepted:false,
        sold_date:"2026-09-01",condition:"Used"}]
    };}
  } as unknown as SoldgraphClient;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE users(id integer PRIMARY KEY,plan text,is_admin boolean DEFAULT false);
      INSERT INTO users VALUES(1,'SIDE_KICK',false),(2,'SUPER_HERO',false),(3,'SIDE_KICK',true);
      CREATE TABLE main_sets(id integer PRIMARY KEY,name text);
      CREATE TABLE card_sets(id integer PRIMARY KEY,main_set_id integer,year integer,name text);
      CREATE TABLE cards(id integer PRIMARY KEY,set_id integer,name text,card_number text,variation text,
        archived_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE card_price_cache(id serial,card_id integer,avg_price numeric,sales_count integer,last_fetched timestamptz DEFAULT now());
      CREATE TABLE user_collections(card_id integer,quantity integer);
      CREATE TABLE pc_binder_cards(card_id integer);
      INSERT INTO main_sets VALUES(1,'2026 Topps Chrome Marvel');
      INSERT INTO card_sets VALUES(1,1,2026,'Fanfare');
      INSERT INTO cards(id,set_id,name,card_number) SELECT id,1,'Knull','FF-23' FROM generate_series(1,5) id;
      INSERT INTO card_price_cache(card_id,avg_price,sales_count) VALUES(1,42.50,5),(3,25,2);
      INSERT INTO user_collections VALUES(2,1);
      INSERT INTO pc_binder_cards VALUES(4);`);
    const cache = new SoldgraphCache(pool,fake), bulk = new SoldgraphBulk(pool,cache,fake);
    const attempts = await ebayRequestContext.run({cardId:1,runId:"test",limit:2},
      ()=>Promise.allSettled(Array.from({length:5},()=>reserveBrowseRequest(pool,
        async()=>({remaining:5000,reset:new Date(Date.now()+86400000).toISOString()})))));
    assert.equal(attempts.filter(a=>a.status==="fulfilled").length,2,"per-run guard enforced inside concurrent multi-query card");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM ebay_browse_reservations")).rows[0].n,2);
    assert.equal((await cache.read(1)).source,"LEGACY_ACTIVE_ESTIMATE");
    await cache.recordDemand(1);
    const candidates = await bulk.candidates(10);
    assert.deepEqual(candidates.map(c=>c.id),[1,2,4,3,5]);
    const dry = await bulk.run({maxCards:10},()=>{});
    assert.equal(dry.eligibleCards,5);assert.equal(dry.estimatedSearches,2);
    assert.equal(searches,0);assert.equal(usageCalls,1);
    const completed = await bulk.run({execute:true,maxCards:10},()=>{});
    assert.equal(searches,2);assert.equal(usageCalls,2);
    assert.equal((await cache.read(1)).source,"SOLDGRAPH_LIMITED_DATA");
    assert.equal((await cache.read(1)).avgPrice,60);
    assert.equal((await bulk.candidates(10)).length,3);
    await cache.refresh(1);assert.equal(searches,2,"fresh card uses cache");
    await assert.rejects(cache.refresh(3),/safety reserve/);assert.equal(searches,2);
    assert.ok("jobId" in completed);
    await pool.query("UPDATE soldgraph_bulk_items SET status='running' WHERE job_id=$1 AND card_id=3",[(completed as any).jobId]);
    remaining=101;
    await bulk.run({execute:true,resume:(completed as any).jobId},()=>{});
    assert.equal(searches,3,"resume only processes one additional pending card");
    assert.equal((await pool.query("SELECT status FROM soldgraph_bulk_items WHERE job_id=$1 AND card_id=3",
      [(completed as any).jobId])).rows[0].status,"uncertain","interrupted requests are not automatically reissued");
    // Remove isolated guard, then verify per-card lock across two service instances.
    await pool.query("DELETE FROM soldgraph_quota_snapshot");
    remaining=2000;
    await Promise.all([cache.refresh(5),new SoldgraphCache(pool,fake).refresh(5)]);
    assert.equal(searches,4,"only one search for concurrent card refresh");
    const held = await pool.connect();
    try {
      await held.query("SELECT pg_advisory_lock(78438,0)");
      await assert.rejects(bulk.run({},()=>{}),/Another bulk operator/);
    } finally {await held.query("SELECT pg_advisory_unlock(78438,0)");held.release();}
    const empty = new SoldgraphCache(pool,{search:async()=>({data:[]})} as unknown as SoldgraphClient);
    await empty.refresh(3);
    assert.equal((await empty.read(3)).source,"LEGACY_ACTIVE_ESTIMATE");
    assert.equal((await empty.read(3)).avgPrice,25);
    const failure = new SoldgraphCache(pool,{search:async()=>{throw new Error("failed");}} as unknown as SoldgraphClient);
    await pool.query("UPDATE soldgraph_price_cache SET expires_at=now()-interval '1 second' WHERE card_id=1");
    await assert.rejects(failure.refresh(1));
    assert.equal((await cache.read(1)).avgPrice,60,"failure must preserve sold value");
    await pool.query("DELETE FROM soldgraph_request_budget");
    await pool.query(`INSERT INTO cards(id,set_id,name,card_number)
      SELECT id,1,'Knull','FF-23' FROM generate_series(10,30) id`);
    const used=async()=>(await pool.query("SELECT consumed FROM market_refresh_usage WHERE user_id=1")).rows[0]?.consumed??0;
    await cache.refresh(10,1);assert.equal(await used(),1);
    await cache.refresh(10,1);assert.equal(await used(),1,"cache hits not charged");
    await pool.query("UPDATE market_refresh_usage SET consumed=19 WHERE user_id=1");
    const concurrent=await Promise.all([cache.refresh(11,1),cache.refresh(12,1)]);
    assert.equal(await used(),20);
    assert.equal(concurrent.filter(p=>"upgradeRequired" in p&&p.upgradeRequired).length,1);
    const cached=await cache.refresh(10,1);
    assert.equal("upgradeRequired" in cached,false,"cache remains accessible at limit");
    assert.equal((await cache.read(10)).avgPrice,60,"ordinary views remain available");
    const callsBefore=searches;
    const gated=await cache.refresh(13,1);
    assert.equal("upgradeRequired" in gated&&gated.upgradeRequired,true);
    assert.equal(searches,callsBefore);
    await pool.query("INSERT INTO market_refresh_usage(user_id,consumed) VALUES(2,25)");
    await cache.refresh(14,2);assert.equal(searches,callsBefore+1,"SUPER_HERO bypasses lifetime cap");
    await cache.refresh(15,3);assert.equal(searches,callsBefore+2,"admin bypasses cap");
    await pool.query("UPDATE market_refresh_usage SET consumed=0 WHERE user_id=1");
    await Promise.all([cache.refresh(16,1),new SoldgraphCache(pool,fake).refresh(16,1)]);
    assert.equal(await used(),1,"deduplicated requests only charge the initiating user once");
    const rejected=new SoldgraphCache(pool,{search:async()=>{throw new SoldgraphError("quota_or_rate_limit");}} as unknown as SoldgraphClient);
    await assert.rejects(rejected.refresh(17,1));
    assert.equal(await used(),1,"explicit pre-credit rejection refunds allowance");
    const ambiguous=new SoldgraphCache(pool,{search:async()=>{throw new SoldgraphError("timeout");}} as unknown as SoldgraphClient);
    await assert.rejects(ambiguous.refresh(18,1));
    assert.equal(await used(),2,"ambiguous timeout conservatively retains reservation");
    await pool.query("UPDATE soldgraph_quota_snapshot SET remaining=100,reserve=100,baseline=999999,captured_at=now()");
    await assert.rejects(cache.refresh(19,2),/safety reserve/);
    await pool.query("UPDATE soldgraph_price_cache SET expires_at=now()-interval '1 second',retry_after=NULL WHERE card_id=3");
    const protectedFallback=await cache.refreshWithFallback(3,2);
    assert.equal(protectedFallback.avgPrice,25);
    assert.equal(protectedFallback.source,"LEGACY_ACTIVE_ESTIMATE");
    assert.equal("refreshStatus" in protectedFallback && protectedFallback.refreshStatus,"unavailable");
    assert.equal("upgradeRequired" in protectedFallback,false);
    const callsAtReserve=searches;
    remaining=99;
    await pool.query("UPDATE soldgraph_quota_snapshot SET captured_at=now()-interval '6 minutes'");
    await assert.rejects(cache.refresh(20,2),/safety reserve/);
    assert.equal(searches,callsAtReserve,"stale account quota is refreshed before search");
    await pool.query("DELETE FROM soldgraph_quota_snapshot");
    const unknownQuota=new SoldgraphCache(pool,{
      usage:async()=>({remaining:null}),
      search:async()=>{throw new Error("must not search");}
    } as unknown as SoldgraphClient);
    await assert.rejects(unknownQuota.refresh(21,2),/quota unavailable/);
    assert.equal((await cache.read(3)).avgPrice,25,"quota blocks preserve eBay baseline");
  } finally {
    await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
