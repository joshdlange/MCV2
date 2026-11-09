/** Explicit bounded audit only. No DB imports/writes, no automatic retry. */
import fs from "node:fs";
import {SoldgraphClient} from "../server/pricing/soldgraph-client";
import {analyzeSoldRows} from "../server/pricing/soldgraph-matching";
const root="generated-artifacts/soldgraph-audit";
const replay=JSON.parse(fs.readFileSync(`${root}/narrow-replay.json`,"utf8"));
// One zero-row insert, one zero-row prefixed insert, one literal-name failure.
const ids=[18139,61761,26956];
const client=new SoldgraphClient();
const usage:any=await client.usage();
if(!Number.isSafeInteger(usage.remaining)||usage.remaining<103) throw new Error("Insufficient verified safety reserve");
for(const id of ids){
  const out=`${root}/fallback-${id}.json`;
  if(fs.existsSync(out)) continue;
  const r=replay.find((r:any)=>r.card.id===id);
  if(r.after.acceptedCount || !r.queries[1]) throw new Error("Ineligible fallback");
  fs.writeFileSync(out,JSON.stringify({id,query:r.queries[1],status:"reserved"}));
  try {
    const page=await client.search(r.queries[1]);
    const result=analyzeSoldRows(r.card,page.data);
    fs.writeFileSync(out,JSON.stringify({id,query:r.queries[1],page,result},null,2));
    console.log(JSON.stringify({id,upstream:result.upstreamCount,usable:result.usableCount}));
  } catch(e) {
    console.log(JSON.stringify({id,error:"provider_failure_no_retry"}));
    break;
  }
}
