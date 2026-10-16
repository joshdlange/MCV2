import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { analyzeSoldRows, type PricingCard } from "../pricing/soldgraph-matching";
import { migrationPrice, publicPrice } from "../pricing/soldgraph-cache";
import type { SoldRow } from "../pricing/soldgraph-client";

const card: PricingCard={id:1,name:"Nick Fury",cardNumber:"52",year:2020,
  parent:"2020 SkyBox Marvel Masterpieces",subset:"2020 SkyBox Marvel Masterpieces - What If",
  variation:null,siblings:[]};
const row=(title:string):SoldRow=>({id:title,title,link:"https://www.ebay.com/itm/test",
  displayed_price:{amount:3.13,currency:"USD"},displayed_price_range:null,
  best_offer_accepted:false,displayed_shipping:null,shipping_text:null,sold_date:"2026-10-02",condition:"Used"});
test("verified family alias and Level 2 serial do not relax other identities",()=>{
  const good="2020 Upper Deck Marvel Masterpieces What If Nick Fury #52 626/999";
  assert.equal(analyzeSoldRows(card,[row(good)]).usableCount,1);
  for(const title of [good+" PSA 9",good.replace("/999","/99"),good+" Artist Auto",
    good.replace("What If","Base"),good.replace("2020","2024")]) {
    const guarded={...card,siblings:["What If Artist Auto"]};
    assert.equal(analyzeSoldRows(guarded,[row(title)]).usableCount,0,title);
  }
  const base={...card,name:"Krakoa",cardNumber:"37",subset:"Base"};
  assert.equal(analyzeSoldRows(base,[row("2020 Upper Deck Marvel Masterpieces Krakoa #37")]).usableCount,1);
  assert.equal(analyzeSoldRows(base,[row("2020 Upper Deck Marvel Masterpieces Krakoa #37 /999")]).usableCount,0);
  const parallel={...base,subset:"Epic Purple Foil /199"};
  assert.equal(analyzeSoldRows(parallel,[row("2020 Upper Deck Marvel Masterpieces Krakoa #37 Epic Purple Foil /199")]).usableCount,1);
  assert.equal(analyzeSoldRows(parallel,[row("2020 Upper Deck Marvel Masterpieces Krakoa #37 Epic Purple Foil /99")]).usableCount,0);
  const other={...base,parent:"2020 SkyBox Marvel Metal"};
  assert.equal(analyzeSoldRows(other,[row("2020 Upper Deck Marvel Metal Krakoa #37")]).usableCount,0);
});
test("replay saved real provider results without calls or catalog/cache edits",
 {skip:process.env.NODE_ENV!=="development"},async()=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {
    for(const id of [215355,58680,557056]){
      const c=(await pool.query(`SELECT c.id,c.name,c.card_number AS "cardNumber",c.variation,s.year,
        s.name AS subset,m.name AS parent,
        ARRAY(SELECT DISTINCT s2.name FROM cards c2 JOIN card_sets s2 ON s2.id=c2.set_id
        WHERE s2.main_set_id=s.main_set_id AND c2.card_number=c.card_number AND c2.name=c.name
        AND c2.id<>c.id AND c2.archived_at IS NULL) AS siblings
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id WHERE c.id=$1`,[id])).rows[0];
      const saved=(await pool.query("SELECT result FROM soldgraph_price_cache WHERE card_id=$1",[id])).rows[0].result;
      const rows=saved.decisions.map((d:any)=>({...row(d.title),id:d.id,link:d.link,
        displayed_price:d.displayedPrice,best_offer_accepted:d.bestOfferAccepted,sold_date:d.soldDate}));
      const result=analyzeSoldRows(c,rows);
      assert.equal(result.usableCount,id===215355?1:id===58680?0:7);
      if(id===215355) assert.equal(result.median,3.13);
      const price=migrationPrice(publicPrice(result,new Date(),new Date(Date.now()+86400000)),{avg_price:id===215355?425:id===58680?462.68:0});
      console.log(JSON.stringify({id,upstream:result.upstreamCount,accepted:result.acceptedCount,
        rejected:result.rejectedCount,bestOfferExcluded:result.bestOfferCount,usable:result.usableCount,
        titles:result.decisions.filter(d=>d.usable).map(d=>d.title),median:result.median,source:price.source}));
    }
  } finally {await pool.end();}
});
