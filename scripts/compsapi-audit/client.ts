import fs from "node:fs";
export const directory="generated-artifacts/compsapi-audit";
fs.mkdirSync(directory,{recursive:true});
export async function request(path:string,params:Record<string,string>={}){
  if(!process.env.COMPS_API_KEY)throw new Error("Missing server-side CompsAPI key");
  const url=new URL(path,"https://api.compsapi.com");
  url.search=new URLSearchParams(params).toString();
  const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.COMPS_API_KEY}`,
    "User-Agent":"MCV-Controlled-Audit/1.0"},redirect:"error",signal:AbortSignal.timeout(120000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(`CompsAPI HTTP ${response.status}; stopped without retry`);
  return {data,headers:Object.fromEntries([...response.headers].filter(([k])=>/^x-(quota|ratelimit)/.test(k)))};
}
export async function search(id:number,kind:string,q:string){
  const file=`${directory}/${id}-${kind}.json`;
  if(fs.existsSync(file)){
    const saved=JSON.parse(fs.readFileSync(file,"utf8"));
    if(!saved.response)throw new Error("Unresolved search reservation; no automatic retry");
    return saved.response.data;
  }
  const count=fs.readdirSync(directory).filter(f=>/^\d+-(primary|fallback)\.json$/.test(f)).length;
  if(count>=100)throw new Error("100-search hard cap");
  fs.writeFileSync(file,JSON.stringify({id,kind,q,reservedAt:new Date().toISOString()}));
  const response=await request("/v1/sold",{q,days:"1095",size:"200",page:"1",cards:"1",best_offer:"1",print_run:"any"});
  fs.writeFileSync(file,JSON.stringify({id,kind,q,response},null,2));
  await new Promise(r=>setTimeout(r,6500));
  return response.data;
}
