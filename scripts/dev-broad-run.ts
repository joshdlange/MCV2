import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {FROZEN_DETAIL_POLICY,raster,referenceFeatures,alignAndCompare} from './dev-detail-vision';

const dir='.local/broad-validation';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
process.env.CATALOG_VISUAL_OFFLINE='true';
if(process.env.NODE_ENV==='production')throw Error('DEV only');
const plan=await read(`${dir}/frozen-plan.json`),manifest=await read(`${dir}/reference-manifest.json`),summary=await read(`${dir}/index-summary.json`);
const baseline=await read(`${dir}/baseline-freeze.json`);
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Baseline changed ${f.path}`);
assert.equal(manifest.planHash,hash(await fs.readFile(`${dir}/frozen-plan.json`)));
assert.equal(summary.manifestHash,hash(await fs.readFile(`${dir}/reference-manifest.json`)));
assert.deepEqual(plan.basePolicy,FROZEN_DETAIL_POLICY);
for(const [p,h] of Object.entries(plan.sourceHashes))assert.equal(hash(await fs.readFile(p)),h);
const before={createdBeforeQueryInference:new Date().toISOString(),planHash:manifest.planHash,manifestHash:summary.manifestHash,
  sources:Object.fromEntries(await Promise.all(['scripts/dev-broad-run.ts','scripts/dev-broad-orb.py'].map(async p=>[p,hash(await fs.readFile(p))]))),
  timingProtocol:'One process: first query is cold DINO; two repeated warm passes of same frozen case. In-memory exact search over all2938 IDs. Bytes/index loading excluded. Reference feature preparation, PNG preparation, ORB reference precompute and subprocess wall time reported separately. Optional arm shares raw first stage and adds guidedIsolation+secondDINO+search+queryfeatures+rerank. No warm repetitions counted as additional accuracy cases.',
};
await fs.writeFile(`${dir}/query-run-freeze.json`,JSON.stringify(before,null,2),{flag:'wx'});
const refs=new Map<string,any>(),cards=manifest.rows.filter((r:any)=>!r.error);
const ioStart=performance.now();
for(const r of cards){
  if(refs.has(r.digest)){refs.get(r.digest).cards.push(r);continue;}
  const v=await read(`${dir}/vectors/${r.digest}.json`);assert.equal(v.model,MODEL_VERSION);assert.equal(v.digest,r.digest);
  const bytes=await fs.readFile(r.file);assert.equal(hash(bytes),r.digest);
  refs.set(r.digest,{...r,cards:[r],vector:v.vector,bytes});
}
const indexIOMs=performance.now()-ioStart;
function search(vector:number[]){
  const t=performance.now(),ranked=[...refs.values()].flatMap(r=>{const similarity=visualCosine(vector,r.vector);return r.cards.map((c:any)=>({cardId:c.id,digest:r.digest,name:c.name,setName:c.set_name,similarity}));}).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
  return {ranked,ms:performance.now()-t};
}
await fs.mkdir(`${dir}/orb/images`,{recursive:true});
const featureCache=new Map<string,any>(),featurePrep:any[]=[],outputs:any[]=[];
async function rerank(bytes:Buffer,ranked:any[],correct:number){
  for(const candidate of ranked.slice(0,20)){
    if(featureCache.has(candidate.digest))continue;
    const t=performance.now(),features=referenceFeatures(await raster(refs.get(candidate.digest).bytes));
    featureCache.set(candidate.digest,features);featurePrep.push({digest:candidate.digest,ms:performance.now()-t});
  }
  const t=performance.now(),q=await raster(bytes),queryFeatureMs=performance.now()-t;
  const arms=[];
  for(const breadth of plan.breadths){
    const rt=performance.now();
    const reranked=ranked.slice(0,breadth).map(candidate=>{
      const evidence=alignAndCompare(q,featureCache.get(candidate.digest));
      return {...candidate,evidence,rerankScore:FROZEN_DETAIL_POLICY.dinoWeight*candidate.similarity+FROZEN_DETAIL_POLICY.detailWeight*(evidence.reliable?evidence.detailScore:candidate.similarity)};
    }).sort((a,b)=>b.rerankScore-a.rerankScore||a.cardId-b.cardId);
    const rerankMs=performance.now()-rt,index=reranked.findIndex(r=>r.cardId===correct);
    arms.push({breadth,rank:index<0?null:index+1,top10:reranked.slice(0,10),queryFeatureMs,rerankMs});
  }
  return arms;
}
for(let repeat=0;repeat<3;repeat++)for(const c of plan.cases){
  const original=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`);assert.equal(hash(original),c.imageHash);
  let t=performance.now();const vector=await embedCatalogVisualImage(original),embeddingMs=performance.now()-t,raw=search(vector);
  const rawArms=await rerank(original,raw.ranked,c.cardId);
  const prepStart=performance.now(),file=`${dir}/orb/images/query-${c.scanId}.png`;
  await sharp(original).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toFile(file);
  const cropRefs=new Map<string,any>();
  for(const candidate of raw.ranked.slice(0,10)){
    if(cropRefs.has(candidate.digest))continue;
    const r=refs.get(candidate.digest),out=`${dir}/orb/images/ref-${r.digest}.png`;
    const meta=await sharp(r.bytes).rotate().resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(out);
    cropRefs.set(r.digest,{digest:r.digest,file:out,cardIds:r.cards.map((c:any)=>c.id),width:meta.width,height:meta.height,ratio:meta.width/meta.height,reviewIndex:cropRefs.size+1});
  }
  const oldJob=await read('.local/detail-orb/job.json');
  await fs.writeFile(`${dir}/orb/job.json`,JSON.stringify({policy:oldJob.policy,refs:[...cropRefs.values()],cases:[{scanId:c.scanId,file,originalHash:c.imageHash,candidates:raw.ranked.slice(0,10).map(r=>({cardId:r.cardId,digest:r.digest}))}]},null,2));
  const cropPrepMs=performance.now()-prepStart;
  t=performance.now();const stdout=execFileSync('.pythonlibs/bin/python3',['scripts/dev-broad-orb.py'],{encoding:'utf8'}),orbProcessWallMs=performance.now()-t;
  console.log(stdout.trim());
  const orb=await read(`${dir}/orb/orb-results.json`),detection=orb.results[0];
  const input=detection.automaticAccepted?await fs.readFile(`${dir}/orb/${c.scanId}-orb-crop.jpg`):original;
  t=performance.now();const secondVector=await embedCatalogVisualImage(input),secondEmbeddingMs=performance.now()-t,second=search(secondVector);
  const cropArms=await rerank(input,second.ranked,c.cardId);
  const out={scanId:c.scanId,cardId:c.cardId,repeat,phase:repeat===0?'cold':'warm',raw:{queryHash:hash(original),vector,rank:raw.ranked.findIndex(r=>r.cardId===c.cardId)+1,embeddingMs,searchMs:raw.ms,arms:rawArms.map(a=>({...a,totalMs:embeddingMs+raw.ms+a.queryFeatureMs+a.rerankMs}))},
    optionalCrop:{automaticAccepted:detection.automaticAccepted,inputHash:hash(input),vector:secondVector,rank:second.ranked.findIndex(r=>r.cardId===c.cardId)+1,secondEmbeddingMs,secondSearchMs:second.ms,
      detection,arms:cropArms.map(a=>({...a,totalMs:embeddingMs+raw.ms+detection.guidedIsolationMs+secondEmbeddingMs+second.ms+a.queryFeatureMs+a.rerankMs}))},
    preparation:{cropPrepMs,orbProcessWallMs,orbReferencePrecomputeMs:orb.referencePrecomputeMs,orbVerifiedReferenceCount:orb.referenceCount}};
  outputs.push(out);await save('query-runs',outputs);
  console.log('QUERY',c.scanId,repeat,'raw',rawArms.map(a=>[a.breadth,a.rank]),'optional',cropArms.map(a=>[a.breadth,a.rank]),'cold/warm dino',embeddingMs);
}
await save('reference-feature-preparation',featurePrep);
const integrity={baselineFiles:baseline.files.length,baselineUnchanged:true,indexIOMs,queryRuns:outputs.length,uniqueCases:plan.cases.length,
  canonicalSingleImage:true,model:MODEL_VERSION,referenceFeaturesComputeMs:featurePrep.reduce((s,r)=>s+r.ms,0),
  repeats:outputs.map(o=>({scanId:o.scanId,repeat:o.repeat,rawCosineToFirst:visualCosine(o.raw.vector,outputs.find(x=>x.scanId===o.scanId).raw.vector),fallbackByteIdentical:!o.optionalCrop.automaticAccepted?o.raw.queryHash===o.optionalCrop.inputHash:null}))};
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Baseline changed ${f.path}`);
assert(integrity.repeats.every(r=>r.rawCosineToFirst>.999999));
await save('run-integrity',integrity);
console.log('COMPLETE',JSON.stringify(integrity));