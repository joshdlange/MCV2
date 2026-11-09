import fs from "node:fs";
import {analyzeSoldRows} from "../server/pricing/soldgraph-matching";
const root="generated-artifacts/soldgraph-audit";
const replay=JSON.parse(fs.readFileSync(`${root}/narrow-replay.json`,"utf8"));
const audit=JSON.parse(fs.readFileSync(`${root}/audited-results.json`,"utf8"));
let fixed=0,remaining=0,recovered=0;
for(const r of replay){
  r.final=r.after;
  const path=`${root}/fallback-${r.card.id}.json`;
  if(fs.existsSync(path)){
    const saved=JSON.parse(fs.readFileSync(path,"utf8"));
    if(saved.page){
      const result=analyzeSoldRows(r.card,saved.page.data);
      r.fallback=result;
      // All three chosen primaries have zero accepted identities.
      if(result.usableCount){r.final=result;recovered++;}
    }
  }
  for(const d of audit.find((a:any)=>a.card.id===r.card.id).result.decisions){
    if(d.auditJudgment==="FALSE REJECTION"){
      if(!r.after.decisions.find((a:any)=>a.id===d.id)?.rejection)fixed++;
      else remaining++;
    }
  }
}
const counts=(key:string)=>({
  three:replay.filter((r:any)=>r[key].usableCount>=3).length,
  limited:replay.filter((r:any)=>r[key].usableCount>0&&r[key].usableCount<3).length,
  zero:replay.filter((r:any)=>!r[key].usableCount).length,
  legacyFallback:replay.filter((r:any)=>!r[key].usableCount&&Number(r.legacy?.avg_price)>0).length,
});
const metrics={before:counts("before"),matcherOnly:counts("after"),after:counts("final"),
 improved:replay.filter((r:any)=>r.final.usableCount>r.before.usableCount).length,
 worsened:replay.filter((r:any)=>r.final.usableCount<r.before.usableCount).length,
 unchanged:replay.filter((r:any)=>r.final.usableCount===r.before.usableCount).length,
 confirmedFalseRejectionsFixed:fixed,confirmedFalseRejectionsRemaining:remaining,
 fallbackRecovered:recovered,searches:3,quotaRequests:1};
fs.writeFileSync(`${root}/narrow-final.json`,JSON.stringify({metrics,cards:replay},null,2));
console.log(JSON.stringify(metrics,null,2));
