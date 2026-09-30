import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
const dir='.local/broad-validation';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
process.env.CATALOG_VISUAL_OFFLINE='true';
const baseline=await read(`${dir}/baseline-freeze.json`),manifest=await read(`${dir}/reference-manifest.json`);
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,f.path);
const unique=[...new Map<string,any>(manifest.rows.filter((r:any)=>!r.error).map((r:any)=>[r.digest,r])).values()];
let maxNormError=0;
for(const r of unique){
  const v=await read(`${dir}/vectors/${r.digest}.json`);
  assert.equal(v.model,MODEL_VERSION);assert.equal(v.vector.length,384);
  assert(v.vector.every(Number.isFinite));assert.equal(v.digest,r.digest);
  const norm=Math.sqrt(v.vector.reduce((s:number,x:number)=>s+x*x,0));
  maxNormError=Math.max(maxNormError,Math.abs(norm-1));assert(Math.abs(norm-1)<1e-5);
}
const positive=manifest.rows.find((r:any)=>r.role==='verified-positive');
const parity=[];
for(const r of [positive,...[...unique].sort((a,b)=>a.digest.localeCompare(b.digest)).slice(0,3)]){
  const b=await fs.readFile(r.file);assert.equal(hash(b),r.digest);
  const stored=await read(`${dir}/vectors/${r.digest}.json`),fresh=await embedCatalogVisualImage(b);
  const cosine=visualCosine(stored.vector,fresh),maxAbsDifference=Math.max(...fresh.map((x,i)=>Math.abs(x-stored.vector[i])));
  assert(cosine>.999999);assert(maxAbsDifference<1e-6);
  parity.push({cardId:r.id,digest:r.digest,cosine,maxAbsDifference});
}
const result={passed:true,baselineUnchangedFiles:baseline.files.length,unitFiniteVectors:unique.length,maxNormError,singleImageIndependentProcessParity:parity};
await fs.writeFile(`${dir}/final-integrity.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));