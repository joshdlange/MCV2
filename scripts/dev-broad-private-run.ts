import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {FROZEN_DETAIL_POLICY,raster,referenceFeatures,alignAndCompare} from './dev-detail-vision';
process.umask(0o077);process.env.CATALOG_VISUAL_OFFLINE='true';
const root=process.argv[2];
assert(/^\/tmp\/mcv-private-validation-[A-Za-z0-9]+$/.test(root));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2),{mode:0o600});
const frozen=await read(`${root}/frozen-index.json`),vindex=await read(`${root}/vector-index.json`),policy=await read(`${root}/preinference-selection.json`);
assert.equal(hash(await fs.readFile(`${root}/frozen-index.json`)),vindex.indexHash);
assert.equal(hash(await fs.readFile(`${root}/preinference-selection.json`)),frozen.selectionHash);
for(const [p,h] of Object.entries(policy.sourceHashes))assert.equal(hash(await fs.readFile(p)),h);
assert.deepEqual(policy.basePolicy,FROZEN_DETAIL_POLICY);
const runFreeze={createdBeforeFreshQueryInference:new Date().toISOString(),indexHash:vindex.indexHash,selectionHash:frozen.selectionHash,
  sources:Object.fromEntries(await Promise.all(['scripts/dev-broad-private-run.ts','scripts/dev-broad-private-orb.py'].map(async p=>[p,hash(await fs.readFile(p))]))),
  schedule:'Two passes of all frozen41 queries in descending scanID order. Pass0 is accuracy pass; first raw query cold-model; pass1 is warm repetition, not extra independent data. Raw and optionalcrop at10/20 breadths; exact all-index search, no metadata filter. Reference preparation and index loading measured separately.'};
await fs.writeFile(`${root}/run-freeze.json`,JSON.stringify(runFreeze,null,2),{flag:'wx',mode:0o600});
const refs=new Map<string,any>(),vectorPaths=new Map(vindex.references.map((r:any)=>[r.digest,r.vectorFile]));
const ioStart=performance.now();
for(const r of frozen.index){
  if(refs.has(r.digest)){refs.get(r.digest).cards.push(r);continue;}
  const v=await read(vectorPaths.get(r.digest) as string),bytes=await fs.readFile(r.file);
  assert.equal(v.model,MODEL_VERSION);assert.equal(v.digest,r.digest);assert.equal(hash(bytes),r.digest);
  refs.set(r.digest,{...r,cards:[r],vector:v.vector,bytes});
}
const indexIOMs=performance.now()-ioStart;
function search(v:number[]){
  const t=performance.now(),ranked=[...refs.values()].flatMap(r=>{
    const similarity=visualCosine(v,r.vector);
    return r.cards.map((c:any)=>({cardId:c.id,digest:r.digest,similarity}));
  }).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
  return{ranked,ms:performance.now()-t};
}
const cache=new Map<string,any>(),featurePrep:any[]=[];
async function rerank(bytes:Buffer,ranked:any[],correct:number){
  for(const c of ranked.slice(0,20))if(!cache.has(c.digest)){
    const t=performance.now();cache.set(c.digest,referenceFeatures(await raster(refs.get(c.digest).bytes)));
    featurePrep.push({digest:c.digest,ms:performance.now()-t});
  }
  const t=performance.now(),q=await raster(bytes),queryFeatureMs=performance.now()-t;
  return [10,20].map(breadth=>{
    const rt=performance.now(),rows=ranked.slice(0,breadth).map(c=>{
      const evidence=alignAndCompare(q,cache.get(c.digest));
      return{...c,evidence,rerankScore:FROZEN_DETAIL_POLICY.dinoWeight*c.similarity+FROZEN_DETAIL_POLICY.detailWeight*(evidence.reliable?evidence.detailScore:c.similarity)};
    }).sort((a,b)=>b.rerankScore-a.rerankScore||a.cardId-b.cardId);
    const rerankMs=performance.now()-rt,index=rows.findIndex(c=>c.cardId===correct);
    return{breadth,rank:index<0?null:index+1,top10:rows.slice(0,10),queryFeatureMs,rerankMs};
  });
}
await fs.mkdir(`${root}/orb/images`,{recursive:true,mode:0o700});
const outputs:any[]=[],prep:any[]=[];
for(let pass=0;pass<2;pass++){
  const rawRows:any[]=[];
  for(const c of frozen.cases){
    const original=await fs.readFile(c.queryFile);assert.equal(hash(original),c.queryDigest);
    const t=performance.now(),vector=await embedCatalogVisualImage(original),embeddingMs=performance.now()-t,s=search(vector);
    const arms=await rerank(original,s.ranked,c.cardId);
    rawRows.push({scanId:c.scanId,cardId:c.cardId,queryHash:c.queryDigest,vector,rank:s.ranked.findIndex(r=>r.cardId===c.cardId)+1,
      top20:s.ranked.slice(0,20),embeddingMs,searchMs:s.ms,arms:arms.map(a=>({...a,totalMs:embeddingMs+s.ms+a.queryFeatureMs+a.rerankMs}))});
    if(rawRows.length%10===0)console.log('PRIVATE RAW PASS',pass,'completed',rawRows.length);
    await save(`raw-pass-${pass}`,rawRows);
  }
  const prepStart=performance.now(),orbRefs=new Map<string,any>(),orbCases=[];
  let queryPngPrepMs=0,referencePngPrepMs=0;
  for(const c of frozen.cases){
    const t=performance.now(),file=`${root}/orb/images/query-${c.scanId}.png`;
    await sharp(await fs.readFile(c.queryFile)).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toFile(file);
    queryPngPrepMs+=performance.now()-t;
    const raw=rawRows.find(r=>r.scanId===c.scanId);
    for(const candidate of raw.top20.slice(0,10)){
      if(orbRefs.has(candidate.digest))continue;
      const ref=refs.get(candidate.digest),rt=performance.now(),out=`${root}/orb/images/ref-${ref.digest}.png`;
      const meta=await sharp(ref.bytes).rotate().resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(out);
      referencePngPrepMs+=performance.now()-rt;
      orbRefs.set(ref.digest,{digest:ref.digest,file:out,cardIds:ref.cards.map((c:any)=>c.id),width:meta.width,height:meta.height,ratio:meta.width/meta.height,reviewIndex:orbRefs.size+1});
    }
    orbCases.push({scanId:c.scanId,file,originalHash:c.queryDigest,candidates:raw.top20.slice(0,10).map((r:any)=>({cardId:r.cardId,digest:r.digest}))});
  }
  const oldJob=await read('.local/detail-orb/job.json');
  await fs.writeFile(`${root}/orb/job.json`,JSON.stringify({policy:oldJob.policy,refs:[...orbRefs.values()],cases:orbCases}),{mode:0o600});
  const pngPrepWallMs=performance.now()-prepStart,t=performance.now();
  execFileSync('.pythonlibs/bin/python3',['scripts/dev-broad-private-orb.py',root],{stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
  const orbProcessWallMs=performance.now()-t,orb=await read(`${root}/orb/orb-results.json`);
  const orbTiming={pass,pngPrepWallMs,queryPngPrepMs,referencePngPrepMs,orbProcessWallMs,
    orbReferencePrecomputeMs:orb.referencePrecomputeMs,orbVerifiedReferences:orb.referenceCount,
    guidedIsolationSumMs:orb.results.reduce((s:number,r:any)=>s+r.guidedIsolationMs,0)};
  prep.push(orbTiming);await save('orb-preparation',prep);await save(`orb-pass-${pass}`,orb);
  for(const c of frozen.cases){
    const raw=rawRows.find(r=>r.scanId===c.scanId),detection=orb.results.find((r:any)=>r.scanId===c.scanId);
    const input=await fs.readFile(detection.automaticAccepted?`${root}/orb/${c.scanId}-orb-crop.jpg`:c.queryFile);
    const t=performance.now(),vector=await embedCatalogVisualImage(input),embeddingMs=performance.now()-t,s=search(vector);
    const arms=await rerank(input,s.ranked,c.cardId);
    const result={scanId:c.scanId,cardId:c.cardId,pass,raw,
      optionalCrop:{automaticAccepted:detection.automaticAccepted,inputHash:hash(input),vector,rank:s.ranked.findIndex(r=>r.cardId===c.cardId)+1,
        embeddingMs,searchMs:s.ms,guidedIsolationMs:detection.guidedIsolationMs,
        arms:arms.map(a=>({...a,totalMs:raw.embeddingMs+raw.searchMs+detection.guidedIsolationMs+embeddingMs+s.ms+a.queryFeatureMs+a.rerankMs}))}};
    outputs.push(result);await save('query-runs',outputs);
  }
  console.log('PRIVATE PASS COMPLETE',pass,'cases',rawRows.length,'crops',orb.automaticAccepted);
}
await save('feature-preparation',featurePrep);
const repeats=outputs.filter(r=>r.pass===1).map(r=>{
  const first=outputs.find(o=>o.scanId===r.scanId&&o.pass===0);
  assert.equal(r.raw.rank,first.raw.rank);assert.equal(r.optionalCrop.automaticAccepted,first.optionalCrop.automaticAccepted);
  assert(visualCosine(r.raw.vector,first.raw.vector)>.999999);
  return{scanId:r.scanId,cosine:visualCosine(r.raw.vector,first.raw.vector),identicalRawRanking:JSON.stringify(r.raw.top20)===JSON.stringify(first.raw.top20)};
});
const baseline=await read('.local/broad-validation/baseline-freeze.json');
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256);
await save('run-integrity',{baselineFilesUnchanged:baseline.files.length,indexIOMs,featurePreparationMs:featurePrep.reduce((s,r)=>s+r.ms,0),repeats,canonicalSingleImage:true});
console.log('PRIVATE RUN COMPLETE',frozen.cases.length,'unique cases',outputs.length,'passes');