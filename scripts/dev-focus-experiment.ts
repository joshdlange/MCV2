import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { FROZEN_DETAIL_POLICY,raster,referenceFeatures,alignAndCompare } from './dev-detail-vision';
import { embedCatalogVisualImage,normalizeVisualVector,visualCosine } from '../server/services/catalogVisualModel';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
const dir='.local/parallel-focus',bounded='.local/bounded-dino',detail='.local/detail-experiment';
const resume=process.argv.includes('--resume');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=async(name:string,value:any)=>fs.writeFile(`${dir}/${name}.json`,JSON.stringify(value,null,2));
if(process.env.NODE_ENV==='production')throw Error('DEV only');
process.env.CATALOG_VISUAL_OFFLINE='true';
const freeze=await read(`${dir}/baseline-freeze.json`);
for(const f of freeze.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Baseline changed: ${f.path}`);
const policy={
  createdBeforeFreshInference:new Date().toISOString(),
  experiment:'2 inputs × 2 breadths × 2 scoring methods; no policy revisions after outcomes',
  inputs:['raw','frozen accepted ORB crop otherwise byte-identical raw'],breadths:[10,20],
  base:FROZEN_DETAIL_POLICY,
  parallelSignal:{name:'Robust peripheral chroma correspondence',maximumAdjustment:.08,chromaScale:25,minValidPeripheralCells:6,
    formula:'newScore = unchangedBaseScore + 0.08*(2*exp(-medianPeripheralLabABDistance/25)-1); adjustment=0 on unreliable geometry or color',
    alignment:'ORB3000, ratio0.75, unique query matches, RANSAC3px,>=20inliers, ratio>=0.5, reference hull>=0.25, spans>=0.5, median<=3px,p95<=6px, convex in-bounds reference face',
    regions:'4x6 grid on inner90% of reference, peripheral16cells only; intersect low-gradient60th-percentile pixels; reject bright low-chroma/clipped glare and L<12 shadows; >=25pixels and>=12% percell; >=6cells',
    physicalReferenceExtent:'Only unchanged34 references already independently verified in prior ORB experiment; all other images abstain. No additional per-image annotations.',
    interpretation:'One bounded generic residual signal, not a foil detector or probability. No metadata, correct IDs, candidate ranks or retrieval-label boosts.'},
  ambiguityMargin:.03,ambiguityMeaning:'Top1-top2 margin below0.03 is a descriptive ambiguity flag, not a calibrated rejection threshold.',
  crop:'Reuse saved5 automatic accepted ORB crops and4 raw fallbacks unchanged; no new crop search/acceptance tuning.',
  sourceHashes:Object.fromEntries(await Promise.all(['scripts/dev-focus-color.py','scripts/dev-focus-experiment.ts','scripts/dev-detail-vision.ts'].map(async p=>[p,hash(await fs.readFile(p))]))),
};
if(!resume)await fs.writeFile(`${dir}/policy.json`,JSON.stringify(policy,null,2),{flag:'wx'});
else{
  const frozenPolicy=await read(`${dir}/policy.json`);
  assert.deepEqual(policy.parallelSignal,frozenPolicy.parallelSignal);
  assert.deepEqual(policy.base,frozenPolicy.base);
  assert.equal(policy.ambiguityMargin,frozenPolicy.ambiguityMargin);
  await save('implementation-fix',{reason:'OpenCV contourArea rejected an empty RANSAC inlier set on the initial pass. Existing minimum20-inlier/0.5-ratio rejection moved before convexHull; no scoring, thresholds, crops or references changed. Resume uses already freshly computed query embeddings.',
    originalSourceHashes:frozenPolicy.sourceHashes,currentSourceHashes:policy.sourceHashes,parameterPolicyUnchanged:true});
}
await fs.mkdir(`${dir}/images`,{recursive:true});await fs.mkdir(`${dir}/references`,{recursive:true});
const [frozen,manifest,prior,newVectors,orb,oldRaw,oldC2]=await Promise.all([
  read(`${bounded}/frozen-selection.json`),read(`${bounded}/manifest.json`),read('.local/image-experiment/snapshot.json'),
  read(`${bounded}/temporary-vectors.json`),read('.local/detail-orb/orb-results.json'),read(`${detail}/stage1.json`),read('.local/detail-orb/c2-stage1.json')]);
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
assert.equal(refs.size,823);assert.equal([...refs.values()].reduce((s,r)=>s+r.cards.length,0),1023);
const queries:any[]=resume?await read(`${dir}/queries.json`):[];
if(!resume)for(const c of frozen.eligible)for(const input of ['raw','crop']){
  const accepted=orb.results.find((r:any)=>r.scanId===c.scanId).automaticAccepted;
  const path=input==='crop'&&accepted?`.local/detail-orb/${c.scanId}-orb-crop.jpg`:`.local/scan-review/${c.originalPhotoFile}`;
  const bytes=await fs.readFile(path);
  const t=performance.now(),vector=await embedCatalogVisualImage(bytes),embeddingMs=performance.now()-t,s=performance.now();
  const ranked=[...refs.values()].flatMap(r=>{const similarity=visualCosine(vector,r.vector);return r.cards.map((c:any)=>({...c,digest:r.digest,similarity}));}).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
  const searchMs=performance.now()-s;
  const expected=input==='raw'?oldRaw.find((r:any)=>r.scanId===c.scanId).raw:oldC2.find((r:any)=>r.scanId===c.scanId).top10;
  assert.deepEqual(ranked.slice(0,10).map(r=>r.cardId),expected.slice(0,10).map((r:any)=>r.cardId));
  const file=`${dir}/images/${c.scanId}-${input}.png`;
  await sharp(bytes).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toFile(file);
  queries.push({scanId:c.scanId,input,acceptedCrop:input==='crop'&&accepted,sourcePath:path,inputHash:hash(bytes),embeddingMs,searchMs,vector,stage1Rank:ranked.findIndex(r=>r.cardId===c.cardId)+1,top20:ranked.slice(0,20),file});
  console.log('FRESH QUERY',c.scanId,input,'embeddingMs',embeddingMs.toFixed(2));
}
await save('queries',queries);
const descriptors=new Map<string,any>(),references=[],featureQA=[];
for(const digest of new Set<string>(queries.flatMap(q=>q.top20.map((r:any)=>r.digest)))){
  const ref=refs.get(digest),t=performance.now();let bytes:Buffer;
  if(ref.file)bytes=await fs.readFile(ref.file);
  else{
    const oldPath=`${detail}/references/${digest}.image`;
    try{bytes=await fs.readFile(oldPath);}catch(e:any){
      if(e.code!=='ENOENT')throw e;
      try{bytes=await fs.readFile(`${dir}/references/${digest}.image`);}catch(error:any){
        if(error.code!=='ENOENT')throw error;
        bytes=await downloadCatalogReference(ref.url);
        await fs.writeFile(`${dir}/references/${digest}.image`,bytes);
      }
    }
  }
  assert.equal(hash(bytes),digest,'New reference content drift');
  const fetchMs=performance.now()-t,f=performance.now(),features=referenceFeatures(await raster(bytes)),computeMs=performance.now()-f;
  descriptors.set(digest,features);
  const file=`${dir}/images/ref-${digest}.png`;
  await sharp(bytes).rotate().resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(file);
  references.push({digest,file});featureQA.push({digest,fetchMs,computeMs});
}
await save('feature-qa',featureQA);
await save('job',{queries:queries.map(({scanId,input,file,top20})=>({scanId,input,file,top20})),references});
const pythonStart=performance.now();execFileSync('python',['scripts/dev-focus-color.py'],{stdio:'inherit'});const pythonMs=performance.now()-pythonStart;
const colors=await read(`${dir}/color-evidence.json`);
const runs:any[]=[];
for(const q of queries){
  const c=frozen.eligible.find((c:any)=>c.scanId===q.scanId),bytes=await fs.readFile(q.sourcePath),ft=performance.now(),rasterQuery=await raster(bytes),queryFeaturesMs=performance.now()-ft;
  const evaluations:any[]=[],start=performance.now();let base10Ms=0;
  for(const candidate of q.top20){
    const evidence=alignAndCompare(rasterQuery,descriptors.get(candidate.digest));
    const baseScore=FROZEN_DETAIL_POLICY.dinoWeight*candidate.similarity+FROZEN_DETAIL_POLICY.detailWeight*(evidence.reliable?evidence.detailScore:candidate.similarity);
    const color=colors.rows.find((r:any)=>r.scanId===q.scanId&&r.input===q.input).items.find((r:any)=>r.cardId===candidate.cardId);
    evaluations.push({...candidate,evidence,baseScore,color,newScore:baseScore+color.adjustment});
    if(evaluations.length===10)base10Ms=performance.now()-start;
  }
  const base20Ms=performance.now()-start;
  for(const k of [10,20])for(const method of ['base','chroma']){
    const field=method==='base'?'baseScore':'newScore';
    const ranked=evaluations.slice(0,k).map(x=>({...x,score:x[field]})).sort((a,b)=>b.score-a.score||a.cardId-b.cardId);
    const index=ranked.findIndex(x=>x.cardId===c.cardId),margin=ranked[0].score-ranked[1].score;
    runs.push({scanId:q.scanId,cardId:c.cardId,input:q.input,acceptedCrop:q.acceptedCrop,k,method,arm:`${q.input}-${k}-${method}`,stage1Rank:q.stage1Rank,rank:index<0?null:index+1,
      topMargin:margin,ambiguous:margin<policy.ambiguityMargin,correctScore:index<0?null:ranked[index].score,correctGapToTop:index<0?null:ranked[0].score-ranked[index].score,
      ranked,timing:{embeddingMs:q.embeddingMs,searchMs:q.searchMs,queryFeaturesMs,baseRerankMs:k===10?base10Ms:base20Ms,
        chromaTop20Ms:colors.rows.find((r:any)=>r.scanId===q.scanId&&r.input===q.input).ms}});
  }
}
await save('runs',runs);
const summaries=[...new Set<string>(runs.map(r=>r.arm))].map(arm=>{
  const rows=runs.filter(r=>r.arm===arm);return{arm,n:rows.length,top1:rows.filter(r=>r.rank===1).length,top3:rows.filter(r=>r.rank&&r.rank<=3).length,top10:rows.filter(r=>r.rank&&r.rank<=10).length,
    inPool:rows.filter(r=>r.rank).length,ambiguous:rows.filter(r=>r.ambiguous).length};
});
const oldRuns=await read(`${detail}/runs.json`),oldOrbRuns=await read('.local/detail-orb/c2-runs.json');
for(const row of runs.filter(r=>r.k===10&&r.method==='base')){
  const expected=row.input==='raw'?oldRuns.find((r:any)=>r.scanId===row.scanId).B:oldOrbRuns.find((r:any)=>r.scanId===row.scanId);
  assert.equal(row.rank,expected.rank);assert.deepEqual(row.ranked.map((r:any)=>r.cardId),expected.top10.map((r:any)=>r.cardId));
  row.ranked.forEach((r:any,i:number)=>assert.ok(Math.abs(r.score-expected.top10[i].rerankScore)<1e-6,'Baseline score mismatch'));
}
for(const f of freeze.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Prior artifact mutated: ${f.path}`);
await save('summary',{summaries,pythonMs,referenceFeatureCount:references.length,referenceFeatureComputeMs:featureQA.reduce((s,r)=>s+r.computeMs,0),baselineFrozenFiles:freeze.files.length,baselineHashChecksPassed:true,
  oldBase10RanksAndScoresReproduced:true,stage1InputsUnchanged:true,policyHash:hash(await fs.readFile(`${dir}/policy.json`))});
console.log('FOCUSED RESULTS',JSON.stringify(summaries));