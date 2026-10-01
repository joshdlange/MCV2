import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {embedCatalogVisualImage, visualCosine, MODEL_VERSION} from '../server/services/catalogVisualModel';

process.umask(0o077);
process.env.CATALOG_VISUAL_OFFLINE='true';
assert.notEqual(process.env.NODE_ENV,'production','Development only');
const root='.local/lightglue-timing-private', dir='.local/broad-validation';
const deadline=Date.parse('2026-09-30T23:41:00Z');
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const guard=()=>assert(Date.now()<deadline,'Timing target deadline reached');
const start=performance.now();
const preservedPaths=[
  'server/services/catalogVisualModel.ts',
  `${dir}/frozen-plan.json`,`${dir}/reference-manifest.json`,
  `${dir}/index-summary.json`,`${dir}/query-runs.json`,
  'dist/models/Xenova/dinov2-small/c2bb04a51fab207c420665f1946016107bffc701/config.json',
  'dist/models/Xenova/dinov2-small/c2bb04a51fab207c420665f1946016107bffc701/preprocessor_config.json',
  'dist/models/Xenova/dinov2-small/c2bb04a51fab207c420665f1946016107bffc701/onnx/model_quantized.onnx',
];
const before=await Promise.all(preservedPaths.map(async p=>hash(await fs.readFile(p))));
const plan=await read(`${dir}/frozen-plan.json`), manifest=await read(`${dir}/reference-manifest.json`);
const summary=await read(`${dir}/index-summary.json`), historical=await read(`${dir}/query-runs.json`);
assert.equal(hash(await fs.readFile(`${dir}/reference-manifest.json`)),summary.manifestHash);
assert.equal(MODEL_VERSION,summary.model);
// First available existing frozen real case, not outcome-selected.
const c=plan.cases[0], queryPath=`.local/scan-review/${c.originalPhotoFile}`;
const original=await fs.readFile(queryPath);
assert.equal(hash(original),c.imageHash);
const io=performance.now(), refs=new Map<string,any>();
for(const r of manifest.rows.filter((r:any)=>!r.error)){
  if(refs.has(r.digest)){refs.get(r.digest).cards.push(r);continue;}
  const v=await read(`${dir}/vectors/${r.digest}.json`);
  assert.equal(v.model,MODEL_VERSION);assert.equal(v.digest,r.digest);
  refs.set(r.digest,{...r,cards:[r],vector:v.vector});
}
const indexLoadMs=performance.now()-io;
function search(vector:number[]){
  const t=performance.now();
  const ranked=[...refs.values()].flatMap(r=>{
    const similarity=visualCosine(vector,r.vector);
    return r.cards.map((c:any)=>({cardId:c.id,digest:r.digest,similarity}));
  }).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
  return{top10:ranked.slice(0,10),ms:performance.now()-t};
}
guard();
let t=performance.now();
const coldVector=await embedCatalogVisualImage(original), coldDinoMs=performance.now()-t;
const frozenVector=historical.find((r:any)=>r.scanId===c.scanId&&r.repeat===0).raw.vector;
assert(visualCosine(coldVector,frozenVector)>.999999,'Canonical DINO differs from frozen query');
const frozen=search(frozenVector).top10, fresh=search(coldVector).top10;
assert.deepEqual(fresh.map(r=>r.cardId),frozen.map(r=>r.cardId));
const job={queryFile:queryPath,queryDigest:c.imageHash,
  references:frozen.map(r=>({digest:r.digest,file:refs.get(r.digest).file})),
  weightsDirectory:path.resolve(root,'weights')};
await fs.writeFile(`${root}/job.json`,JSON.stringify(job));
const env={...process.env,PYTHONPATH:[
  `${root}/packaging/src`,`${root}/kornia`,`${root}/LightGlue`,
].map(p=>path.resolve(p)).join(':')};
const worker=spawn('.pythonlibs/bin/python3',['scripts/dev-lightglue-timing-worker.py',`${root}/job.json`],
  {env,stdio:['pipe','pipe','pipe']});
const workerStart=performance.now();
worker.stderr.pipe(process.stderr);
const lines=createInterface({input:worker.stdout});
const inbox:any[]=[],waiters:((x:any)=>void)[]=[];
lines.on('line',line=>{
  const value=JSON.parse(line);const waiter=waiters.shift();
  if(waiter)waiter(value);else inbox.push(value);
});
const next=()=>new Promise<any>((resolve,reject)=>{
  if(inbox.length){resolve(inbox.shift());return;}
  waiters.push(resolve);
  worker.once('exit',code=>reject(Error(`Worker exited before response: ${code}`)));
});
const timer=setTimeout(()=>{worker.kill('SIGKILL');process.exitCode=1;},
  Math.max(1,deadline-Date.now()));
try{
  const setup=await next(), workerSetupWallMs=performance.now()-workerStart;
  assert(setup.ready);
  const passes:any[]=[];
  for(let pass=0;pass<4;pass++){
    guard();
    const totalStart=performance.now(),dt=performance.now();
    const vector=await embedCatalogVisualImage(original),dinoMs=performance.now()-dt;
    const ranked=search(vector);
    assert.deepEqual(ranked.top10.map(r=>r.cardId),frozen.map(r=>r.cardId));
    worker.stdin.write(JSON.stringify({pass})+'\n');
    const stage2=await next();
    passes.push({pass,phase:pass===0?'excluded warmup':'warm measurement',
      dinoMs,searchMs:ranked.ms,...stage2,fullWarmPipelineMs:performance.now()-totalStart});
    console.log('TIMING_PASS',pass,JSON.stringify({
      dinoMs,queryFeatureMs:stage2.queryFeatureMs,
      stage2Ms:stage2.stage2Ms,fullWarmPipelineMs:passes.at(-1).fullWarmPipelineMs,
    }));
  }
  const after=await Promise.all(preservedPaths.map(async p=>hash(await fs.readFile(p))));
  assert.deepEqual(after,before);
  const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
  const warm=passes.slice(1), pairTimes=warm.flatMap(r=>r.pairMatchMs);
  const downloads=await read(`${root}/downloads.json`);
  const result={
    scope:'CPU timing only; no accuracy evaluation, scoring, reranking, or publication',
    completedAt:new Date().toISOString(),trialStartedAt:'2026-09-30T23:28:39Z',
    hardDeadline:'2026-09-30T23:43:39Z',
    elapsedSinceAuthorizedStartSeconds:(Date.now()-Date.parse('2026-09-30T23:28:39Z'))/1000,
    measuredProcessWallMs:performance.now()-start,
    sampleCount:1,queryType:'Existing authorized local real raw phone photograph',
    index:{cardIds:summary.cardIds,uniqueReferenceEmbeddings:refs.size,
      limitation:'Available retained frozen broad-validation index is 2938 IDs, not the later 3045-ID temporary index; no expansion performed.',
      actualFrozenDinoTop10Verified:true,indexLoadMs},
    configuration:{extractor:'ALIKED aliked-n16',maxNumKeypoints:1024,longestEdge:1024,
      lightglue:'aliked pretrained; all defaults, 9 layers, depth_confidence 0.95, width_confidence 0.99, filter_threshold 0.1; no compilation',
      geometry:'USAC_MAGSAC homography; 3px, maxIters=2000, confidence=0.995',
      queryExtractionOncePerPass:true,referenceFeaturesPrecomputedOnce:true},
    iterations:{warmupPassesExcluded:1,warmMeasuredPasses:3,pairsPerPass:10,totalMeasuredPairs:30},
    cold:{canonicalDinoFirstInferenceMs:coldDinoMs,workerSetupWallMs,
      pythonImportMs:setup.importMs,localMatcherModelInitializationMs:setup.modelInitializationMs,
      weightDownloads:downloads,referencePreparation:setup.referencePreparation,
      uniqueReferenceCount:setup.referenceCount,
      referenceFeatureTotalMs:setup.referencePreparation.reduce((s:number,r:any)=>s+r.featureMs,0),
      referenceDecodeTotalMs:setup.referencePreparation.reduce((s:number,r:any)=>s+r.decodeMs,0)},
    warmMeanMs:{dino:mean(warm.map(r=>r.dinoMs)),search:mean(warm.map(r=>r.searchMs)),
      queryDecode:mean(warm.map(r=>r.queryDecodeMs)),queryFeature:mean(warm.map(r=>r.queryFeatureMs)),
      lightgluePair:mean(pairTimes),tenPairs:mean(warm.map(r=>r.pairMatchMs.reduce((s:number,v:number)=>s+v,0))),
      geometryTop10:mean(warm.map(r=>r.geometryMs.reduce((s:number,v:number)=>s+v,0))),
      stage2Top10:mean(warm.map(r=>r.stage2Ms)),fullPipeline:mean(warm.map(r=>r.fullWarmPipelineMs))},
    passes,hardware:setup.hardware,
    integrity:{unchanged:true,sha256:{canonicalDinoSource:before[0],frozenPlan:before[1],
      frozenReferenceManifest:before[2],frozenIndexSummary:before[3],priorQueryRuns:before[4],
      dinoConfig:before[5],dinoPreprocessorConfig:before[6],dinoQuantizedWeights:before[7]}},
    sources:downloads.sources,
    limitations:['One previously used real query is timing evidence only, not an accuracy sample.',
      'No accuracy improvement claim. CPU timings do not establish GPU performance or architecture failure.',
      'Full warm wall clock includes sequential canonical DINO, exact bounded search, subprocess IPC, raw query decode, one ALIKED extraction, ten LightGlue matches and geometry. Geometry timing includes correspondence conversion and MAGSAC when at least four correspondences exist. Input bytes and frozen vectors already in memory; reference prep excluded.',
      'Dependencies loaded from isolated official source; project dependency files and app workflows unchanged.'],
    constraints:{productionUntouched:true,dinoUnchanged:true,noCropping:true,noSAM:true,noOCR:true,
      noMetadataFiltering:true,noNewQueryDownloads:true,noCatalogWrites:true,noIndexExpansion:true,
      noPreviousReranker:true,nothingPublished:true},
  };
  const text=JSON.stringify(result,null,2);
  await fs.writeFile('.local/lightglue-timing-result.json',text);
  await fs.writeFile('attached_assets/dev-lightglue-timing-results.json',text);
  await fs.writeFile('.local/lightglue-timing-status.json',JSON.stringify({
    stage:'timing complete; private working copies pending removal',
    completedAt:result.completedAt,hardDeadline:result.hardDeadline,
    sampleCount:1,warmMeasuredPasses:3,meanFullWarmPipelineMs:result.warmMeanMs.fullPipeline,
  },null,2));
}finally{
  clearTimeout(timer);
  worker.stdin.end(JSON.stringify({stop:true})+'\n');
  worker.kill('SIGTERM');
}