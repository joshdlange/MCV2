import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { SoldgraphCache, soldgraphEnabled } from "../server/pricing/soldgraph-cache";
import type { SoldgraphClient } from "../server/pricing/soldgraph-client";

if (process.env.NODE_ENV !== "development") throw new Error("Development only");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pages = await Promise.all((await readdir("/tmp/mcv-soldgraph-pilot"))
  .filter(f => f.endsWith(".json")).map(async f => JSON.parse(await readFile(`/tmp/mcv-soldgraph-pilot/${f}`, "utf8")).page));
let calls = 0;
const fake = { search: async (q: string) => {
  calls++;
  const page = pages.find(p => p.query.toLowerCase() === q.toLowerCase());
  assert.ok(page, "Missing saved live pilot response");
  await new Promise(resolve => setTimeout(resolve, 50));
  return page;
} } as unknown as SoldgraphClient;
const service = new SoldgraphCache(pool, fake);
const ids = [557056,533899,543094,557156,557106,557356,557954];
try {
  assert.equal(soldgraphEnabled(), false, "Default source must remain old provider");
  await service.read(ids[0]); // initialize additive tables
  // Only isolate the new pilot cache entries; no existing price/catalog records touched.
  await pool.query("DELETE FROM soldgraph_price_cache WHERE card_id=ANY($1::int[])", [ids]);
  for (const id of ids) {
    const before = calls;
    const result = await service.refresh(id);
    assert.equal(calls - before, 1);
    const again = await new SoldgraphCache(pool, fake).refresh(id);
    assert.equal(calls - before, 1, "fresh refresh must reuse shared cache");
    assert.deepEqual(again, await service.read(id));
    assert.equal(result.confidence, result.salesCount >= 3 ? "normal" : result.salesCount ? "limited" : "unavailable");
    if (!result.salesCount) assert.equal(result.avgPrice, null);
    console.log(JSON.stringify({ id, ...result, externalCalls: 0, replayedResponses: 1 }));
  }
  assert.equal((await service.read(557056)).avgPrice, 60);
  await pool.query("UPDATE soldgraph_price_cache SET expires_at=now()-interval '1 second' WHERE card_id=$1", [557056]);
  const before = calls;
  await Promise.all([service.refresh(557056), new SoldgraphCache(pool, fake).refresh(557056)]);
  assert.equal(calls - before, 1, "cross-connection lock must prevent duplicate refresh");
  assert.equal((await service.read(557056)).stale, false);
  await pool.query("UPDATE soldgraph_price_cache SET expires_at=now()-interval '1 second' WHERE card_id=$1", [557056]);
  const failing = new SoldgraphCache(pool, { search: async () => { throw new Error("failure"); } } as unknown as SoldgraphClient);
  await assert.rejects(failing.refresh(557056));
  assert.equal((await service.read(557056)).avgPrice, 60, "failure preserves stale cache");
  await assert.rejects(service.refresh(557056), /temporarily unavailable/);
  await pool.query("UPDATE soldgraph_price_cache SET retry_after=NULL,expires_at=now()+interval '24 hours' WHERE card_id=$1", [557056]);
  process.env.SOLDGRAPH_DAILY_BUDGET = "1";
  await pool.query("UPDATE soldgraph_price_cache SET expires_at=now()-interval '1 second' WHERE card_id=$1", [557954]);
  await assert.rejects(service.refresh(557954), /budget reached/);
  console.log("PASS: all confidence states, shared cache, stale refresh, cross-instance lock, failure preservation, cooldown, budget and old-provider default. Zero external calls.");
} finally { await pool.end(); }
