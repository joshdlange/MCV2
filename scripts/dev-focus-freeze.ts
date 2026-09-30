import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir='.local/parallel-focus';
await fs.mkdir(dir,{recursive:true});
const paths:string[]=[];
async function walk(p:string){
  const s=await fs.stat(p);
  if(s.isDirectory()){for(const f of (await fs.readdir(p)).sort())await walk(`${p}/${f}`);}
  else paths.push(p);
}
for(const p of ['.local/bounded-dino','.local/detail-experiment','.local/detail-orb','.local/image-experiment'])await walk(p);
for(const f of await fs.readdir('attached_assets'))if(f.endsWith('.html')&&/report/.test(f))paths.push(`attached_assets/${f}`);
for(const f of await fs.readdir('scripts'))if(/^dev-(detail|orb|bounded|card-normalization|image-experiment)/.test(f)&&f.endsWith('.ts')||f==='dev-orb-isolation.py')paths.push(`scripts/${f}`);
const selection=JSON.parse(await fs.readFile('.local/bounded-dino/frozen-selection.json','utf8'));
paths.push('.local/scan-review/decisions.json',...selection.eligible.map((c:any)=>`.local/scan-review/${c.originalPhotoFile}`));
const files=[];
for(const path of [...new Set(paths)].sort()){
  const bytes=await fs.readFile(path);files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(`${dir}/baseline-freeze.json`,JSON.stringify({createdAt:new Date().toISOString(),purpose:'Freeze all prior experiment assets before focused breadth/discriminator experiment',files},null,2),{flag:'wx'});
console.log('FROZEN',files.length,'files',files.reduce((s,f)=>s+f.bytes,0),'bytes');