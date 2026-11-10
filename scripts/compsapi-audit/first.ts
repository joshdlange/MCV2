import fs from "node:fs";
import {request,search,directory} from "./client";
const usage=await request("/v1/usage");
fs.writeFileSync(`${directory}/usage-before.json`,JSON.stringify(usage,null,2));
const remaining=Number(usage.headers["x-quota-monthly"])-Number(usage.headers["x-quota-used"]);
if(!Number.isFinite(remaining)||remaining<100)throw new Error("Quota cannot support full bounded audit; stop before searches");
const first=await search(15585,"primary","1990 Marvel Universe Wolverine 23");
console.log(JSON.stringify({keys:Object.keys(first),days:first.days,plan_limit:first.plan_limit,window:first.window,count:first.count,items:first.items?.slice(0,2)},null,2));
