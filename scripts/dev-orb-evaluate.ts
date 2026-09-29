import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { FROZEN_DETAIL_POLICY,raster,referenceFeatures,alignAndCompare } from './dev-detail-vision';
import { embedCatalogVisualImage,normalizeVisualVector,visualCosine } from '../server/services/catalogVisualModel';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
const dir='.local/detail-orb',detail='.local/detail-experiment',bounded='.local/bounded-dino';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=async(p:string,v:any)=>fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
if(process.env.NODE_ENV==='production')throw Error('DEV only');
process.env.CATALOG_VISUAL_OFFLINE='true';
const [frozen,manifest,prior,newVectors,oldStage1,oldPolicy,job]=await Promise.all([
  read(`${bounded}/frozen-selection.json`),read(`${bounded}/manifest.json`),read('.local/image-experiment/snapshot.json'),
  read(`${bounded}/temporary-vectors.json`),read(`${detail}/stage1.json`),read(`${detail}/policy.json`),read(`${dir}/job.json`)]);
if(hash(await fs.readFile('scripts/dev-detail-vision.ts'))!==oldPolicy.visionSourceHash)throw Error('Reranker changed');
const refs=new Map<string,any>();
for(const r of prior.refs){
  const ids=prior.cards.filter((c:any)=>c.url===r.url).map((c:any)=>({cardId:c.id,name:c.name}));
  const existing=refs.get(r.content_digest);
  if(existing)existing.cards.push(...ids);else refs.set(r.content_digest,{digest:r.content_digest,url:r.url,vector:new Float32Array(normalizeVisualVector(r.embedding)),cards:ids});
}
for(const r of manifest.references.filter((r:any)=>frozen.referenceIds.includes(r.id))){
  let row=refs.get(r.digest);if(!row){row={digest:r.digest,url:r.url,file:`${bounded}/${r.file}`,vector:new Float32Array(newVectors[r.digest]),cards:[]};refs.set(r.digest,row);}
  if(!row.cards.some((c:any)=>c.cardId===r.id))row.cards.push({cardId:r.id,name:r.name});
}
if([...refs.values()].reduce((s,r)=>s+r.cards.length,0)!==1023||refs.size!==823)throw Error('Index mismatch');
function search(v:number[]){
  const t=performance.now(),ranked=[...refs.values()].flatMap(r=>{const similarity=visualCosine(v,r.vector);return r.cards.map((c:any)=>({...c,digest:r.digest,similarity}));}).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
  return{ranked,ms:performance.now()-t};
}
const firstPass:any[]=[];
for(const c of frozen.eligible){
  const b=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`);if(hash(b)!==c.imageHash)throw Error('Original changed');
  const t=performance.now(),v=await embedCatalogVisualImage(b),embeddingMs=performance.now()-t,s=search(v);
  const expected=oldStage1.find((r:any)=>r.scanId===c.scanId);
  if(JSON.stringify(s.ranked.slice(0,10).map(r=>r.cardId))!==JSON.stringify(expected.raw.slice(0,10).map((r:any)=>r.cardId)))throw Error('Fresh firstpass shortlist drift');
  firstPass.push({scanId:c.scanId,embeddingMs,searchMs:s.ms,vector:v,top10:s.ranked.slice(0,10)});
}
await save('fresh-first-pass',firstPass);
const processStart=performance.now();
execFileSync('python',['scripts/dev-orb-isolation.py'],{stdio:'inherit'});
const orbProcessMs=performance.now()-processStart;
const orb=await read(`${dir}/orb-results.json`);
const stage1:any[]=[];
for(const c of frozen.eligible){
  const detection=orb.results.find((r:any)=>r.scanId===c.scanId);
  const b=await fs.readFile(detection.automaticAccepted?`${dir}/${c.scanId}-orb-crop.jpg`:`.local/scan-review/${c.originalPhotoFile}`);
  const t=performance.now(),v=await embedCatalogVisualImage(b),embeddingMs=performance.now()-t,s=search(v);
  stage1.push({scanId:c.scanId,cardId:c.cardId,inputHash:hash(b),cropAccepted:detection.automaticAccepted,embeddingMs,searchMs:s.ms,vector:v,rank:s.ranked.findIndex(r=>r.cardId===c.cardId)+1,top10:s.ranked.slice(0,10)});
  console.log('C2 STAGE1',c.scanId,stage1.at(-1).rank);
}
await save('c2-stage1',stage1);
const cache=await read(`${detail}/reference-feature-cache.json`),features=new Map<string,any>();
for(const [digest,value] of Object.entries(cache) as any)features.set(digest,value.map((r:any)=>({...r,features:{...r.features,rgb:Float32Array.from(r.features.rgb),gray:Float32Array.from(r.features.gray)}})));
const featureQA:any[]=[];
for(const r of stage1)for(const c of r.top10){
  if(features.has(c.digest))continue;
  const ref=refs.get(c.digest);let bytes:Buffer;const fetchStart=performance.now();
  try{
    if(ref.file)bytes=await fs.readFile(ref.file);
    else{const p=`${detail}/references/${c.digest}.image`;try{bytes=await fs.readFile(p);}catch(e:any){if(e.code!=='ENOENT')throw e;bytes=await downloadCatalogReference(ref.url);await fs.writeFile(p,bytes);}}
    if(hash(bytes)!==c.digest)throw Error('Reference digest changed');
    const fetchMs=performance.now()-fetchStart,t=performance.now(),f=referenceFeatures(await raster(bytes)),computeMs=performance.now()-t;
    features.set(c.digest,f);featureQA.push({digest:c.digest,fetchMs,computeMs,ok:true});
  }catch(e:any){featureQA.push({digest:c.digest,ok:false,error:e.message});}
}
await save('additional-reference-features',featureQA);
const runs=[];
for(const row of stage1){
  const c=frozen.eligible.find((c:any)=>c.scanId===row.scanId),detection=orb.results.find((r:any)=>r.scanId===row.scanId),first=firstPass.find((r:any)=>r.scanId===row.scanId);
  const bytes=await fs.readFile(row.cropAccepted?`${dir}/${row.scanId}-orb-crop.jpg`:`.local/scan-review/${c.originalPhotoFile}`);
  const ft=performance.now(),q=await raster(bytes),queryFeatureMs=performance.now()-ft;
  const rt=performance.now();
  const reranked=row.top10.map((candidate:any)=>{
    const f=features.get(candidate.digest),evidence=f?alignAndCompare(q,f):{reliable:false,reason:'Reference features unavailable',detailScore:0};
    return{...candidate,evidence,rerankScore:FROZEN_DETAIL_POLICY.dinoWeight*candidate.similarity+FROZEN_DETAIL_POLICY.detailWeight*(evidence.reliable?evidence.detailScore:candidate.similarity)};
  }).sort((a:any,b:any)=>b.rerankScore-a.rerankScore||a.cardId-b.cardId);
  const rerankMs=performance.now()-rt,index=reranked.findIndex((r:any)=>r.cardId===row.cardId);
  const timing={firstDinoMs:first.embeddingMs,firstSearchMs:first.searchMs,guidedIsolationMs:detection.guidedIsolationMs,secondDinoMs:row.embeddingMs,secondSearchMs:row.searchMs,queryFeatureMs,rerankMs,
    totalMs:first.embeddingMs+first.searchMs+detection.guidedIsolationMs+row.embeddingMs+row.searchMs+queryFeatureMs+rerankMs};
  runs.push({scanId:row.scanId,cardId:row.cardId,cropAccepted:row.cropAccepted,stage1Rank:row.rank,rank:index<0?null:index+1,top10:reranked,timing});
  console.log('C2 RESULT',row.scanId,'rank',index<0?null:index+1,'ms',timing.totalMs);
}
await save('c2-runs',runs);
const summary={n:9,top1:runs.filter(r=>r.rank===1).length,top3:runs.filter(r=>r.rank&&r.rank<=3).length,top10:runs.filter(r=>r.rank&&r.rank<=10).length,
  automaticCrops:orb.automaticAccepted,meanTiming:Object.fromEntries(Object.keys(runs[0].timing).map(k=>[k,runs.reduce((s,r)=>s+r.timing[k],0)/9])),
  warmMeanTotalMs:runs.slice(1).reduce((s,r)=>s+r.timing.totalMs,0)/8,firstColdDinoMs:firstPass[0].embeddingMs,orbProcessMs,orbReferencePrecomputeMs:orb.referencePrecomputeMs,orbReferences:orb.referenceCount,
  additionalReferenceFeatureComputeMs:featureQA.reduce((s,r)=>s+(r.computeMs??0),0),featureErrors:featureQA.filter(r=>!r.ok),
  firstPassCandidatesIdentical:true,rerankerSourceUnchanged:true};
await save('c2-summary',summary);
console.log('C2 SUMMARY',JSON.stringify(summary));