import fs from "node:fs";
import {directory} from "./client";
import {analyze,serial} from "./evaluate";
const baseline=JSON.parse(fs.readFileSync("generated-artifacts/soldgraph-audit/narrow-final.json","utf8"));
const review=JSON.parse(fs.readFileSync("scripts/compsapi-audit/review-notes.json","utf8"));
const cards=baseline.cards.map((b:any)=>{
  const file=`${directory}/${b.card.id}-primary.json`;
  if(!fs.existsSync(file))throw new Error("Cohort collection incomplete");
  const primary=JSON.parse(fs.readFileSync(file,"utf8"));
  const fallbackFile=`${directory}/${b.card.id}-fallback.json`;
  const fallback=fs.existsSync(fallbackFile)?JSON.parse(fs.readFileSync(fallbackFile,"utf8")):null;
  if(!primary.response||fallback&&!fallback.response)throw new Error("Unresolved provider request");
  const rows=[...new Map([...primary.response.data.items,...fallback?.response?.data.items||[]].map((r:any)=>[r.item_id,r])).values()];
  const result=analyze(b.card,rows),first=analyze(b.card,primary.response.data.items);
  const s=b.final;
  let outcome=!s.usableCount&&!result.usableCount?"NEITHER USEFUL":
    result.usableCount>s.usableCount?"COMPSAPI BETTER":result.usableCount<s.usableCount?"SOLDGRAPH BETTER":"EQUIVALENT";
  let outcomeReason=!s.usableCount&&!result.usableCount?"Neither produced usable exact raw-card comps.":
    `CompsAPI ${result.usableCount} versus SoldGraph ${s.usableCount} usable listing rows; different history windows and capture dates.`;
  const override=review.comparisonOverrides?.find((r:any)=>r.cardId===b.card.id);
  if(override){outcome=override.outcome;outcomeReason=override.reason;}
  return {card:b.card,serial:serial(b.card),primary:primary.q,fallback:fallback?.q??null,calls:fallback?2:1,
    primaryUsable:first.usableCount,recovered:!first.usableCount&&!!result.usableCount,
    soldgraph:{upstream:s.upstreamCount,usable:s.usableCount,median:s.median},compsapi:result,outcome,
    outcomeReason,
    medianDifference:s.median&&result.median?Math.abs(result.median-s.median)/s.median:null};
});
const successful=cards.filter((r:any)=>r.compsapi.usableCount),counts=successful.map((r:any)=>r.compsapi.usableCount).sort((a:number,b:number)=>a-b);
const calls=cards.reduce((n:number,r:any)=>n+r.calls,0),usable=cards.reduce((n:number,r:any)=>n+r.compsapi.usableCount,0);
const metrics={cards:cards.length,calls,three:cards.filter((r:any)=>r.compsapi.usableCount>=3).length,
 limited:cards.filter((r:any)=>r.compsapi.usableCount>0&&r.compsapi.usableCount<3).length,
 zero:cards.length-successful.length,successful:successful.length,usable,
 bestOffers:cards.reduce((n:number,r:any)=>n+r.compsapi.bestOfferCount,0),
 fallbacks:cards.filter((r:any)=>r.fallback).length,recovered:cards.filter((r:any)=>r.recovered).length,
 searchesPerCard:calls/cards.length,compsPerSearch:usable/calls,
 medianCompsPerSuccessful:counts.length?(counts[Math.floor(counts.length/2)]+counts[Math.floor((counts.length-1)/2)])/2:null,
 wins:Object.fromEntries(["COMPSAPI BETTER","SOLDGRAPH BETTER","EQUIVALENT","NEITHER USEFUL"].map(o=>[o,cards.filter((r:any)=>r.outcome===o).length]))};
fs.writeFileSync(`${directory}/comparison.json`,JSON.stringify({metrics,cards},null,2));
const fields=["id","name","year","parent","subset","number","variation","serial","primary","fallback","calls","upstream","identityMatches","usable","rejected","bestOffers","median","low","high","oldest","newest","state","soldgraphUpstream","soldgraphUsable","soldgraphMedian","outcome","medianDifference","outcomeReason","rejectionReasons"];
const csv=(v:any)=>'"'+String(v??"").replace(/"/g,'""')+'"';
const lines=cards.map((r:any)=>[r.card.id,r.card.name,r.card.year,r.card.parent,r.card.subset,r.card.cardNumber,r.card.variation,r.serial,
 r.primary,r.fallback,r.calls,r.compsapi.upstreamCount,r.compsapi.identityMatches,r.compsapi.usableCount,r.compsapi.rejected,r.compsapi.bestOfferCount,
 r.compsapi.median,r.compsapi.low,r.compsapi.high,r.compsapi.oldest,r.compsapi.newest,r.compsapi.state,r.soldgraph.upstream,r.soldgraph.usable,r.soldgraph.median,r.outcome,r.medianDifference,r.outcomeReason,
 JSON.stringify(r.compsapi.decisions.reduce((acc:any,d:any)=>{if(d.rejection)acc[d.rejection]=(acc[d.rejection]||0)+1;return acc;},{}))]);
fs.writeFileSync(`${directory}/comparison.csv`,[fields,...lines].map(r=>r.map(csv).join(",")).join("\n"));
console.log(JSON.stringify(metrics,null,2));
