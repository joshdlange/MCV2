import fs from "node:fs";
import {request,search,directory} from "./client";
import {queries,analyze} from "./evaluate";
const baseline=JSON.parse(fs.readFileSync("generated-artifacts/soldgraph-audit/baseline.json","utf8"));
if(baseline.length!==50||new Set(baseline.map((r:any)=>r.card.id)).size!==50)throw new Error("Invalid cohort");
for(const {card} of baseline){
  const q=queries(card);
  const primary=await search(card.id,"primary",q[0]);
  if(!Array.isArray(primary.items))throw new Error("Unexpected response schema");
  const result=analyze(card,primary.items);
  if(!result.identityMatches&&q[1]!==q[0])await search(card.id,"fallback",q[1]);
  console.log(JSON.stringify({id:card.id,primary:result.usableCount}));
}
fs.writeFileSync(`${directory}/usage-after.json`,JSON.stringify(await request("/v1/usage"),null,2));
