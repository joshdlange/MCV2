import fs from "node:fs";
import {analyzeSoldRows, buildSoldQueries} from "../server/pricing/soldgraph-matching";
const root="generated-artifacts/soldgraph-audit";
const baseline=JSON.parse(fs.readFileSync(`${root}/baseline.json`,"utf8"));
const output=baseline.map((b:any)=>{
  const rows=b.result.decisions.map((d:any)=>({
    id:d.id,title:d.title,link:d.link,displayed_price:d.displayedPrice,
    displayed_shipping:d.shipping,shipping_text:d.shippingText,
    best_offer_accepted:d.bestOfferAccepted,sold_date:d.soldDate,
    condition:d.rejection==="graded"?"graded":null,
    displayed_price_range:d.exclusion==="price_range"?{}:null,
  }));
  const result=analyzeSoldRows(b.card,rows);
  return {card:b.card,before:b.result,after:result,legacy:b.legacy,
    queries:buildSoldQueries(b.card),limitation:"Diagnostic reconstruction, not lossless raw replay"};
});
fs.writeFileSync(`${root}/narrow-replay.json`,JSON.stringify(output,null,2));
const metrics=(key:string)=>({
  three:output.filter((r:any)=>r[key].usableCount>=3).length,
  limited:output.filter((r:any)=>r[key].usableCount>0&&r[key].usableCount<3).length,
  zero:output.filter((r:any)=>!r[key].usableCount).length,
  fallback:output.filter((r:any)=>!r[key].usableCount&&Number(r.legacy?.avg_price)>0).length,
});
console.log(JSON.stringify({before:metrics("before"),after:metrics("after"),
 improved:output.filter((r:any)=>r.after.usableCount>r.before.usableCount).length,
 worsened:output.filter((r:any)=>r.after.usableCount<r.before.usableCount).length,
 eligible:output.filter((r:any)=>!r.after.acceptedCount).map((r:any)=>({id:r.card.id,query:r.queries[1]}))},null,2));
