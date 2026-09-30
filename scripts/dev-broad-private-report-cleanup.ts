import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
process.umask(0o077);process.env.CATALOG_VISUAL_OFFLINE='true';
const root=process.argv[2];
assert(/^\/tmp\/mcv-private-validation-[A-Za-z0-9]+$/.test(root));
assert.equal(await fs.realpath(root),root);
assert((await fs.stat(root)).isDirectory());
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const [extraction,queryTemplate,referenceQueryTemplate,prepared,feasibility,frozen,vectors,runs,prep,integrity,policy,runFreeze]=await Promise.all([
  read(`${root}/extract.json`),read(`${root}/extraction-query.json`),read(`${root}/reference-query.json`),
  read(`${root}/preparation-summary.json`),read(`${root}/feasibility.json`),read(`${root}/frozen-index.json`),
  read(`${root}/vector-index.json`),read(`${root}/query-runs.json`),read(`${root}/orb-preparation.json`),
  read(`${root}/run-integrity.json`),read(`${root}/preinference-selection.json`),read(`${root}/run-freeze.json`)]);
assert.equal(extraction.rows.length,100);assert.equal(frozen.cases.length,41);
const first=runs.filter((r:any)=>r.pass===0),warm=runs.filter((r:any)=>r.pass===1);
assert.equal(first.length,41);assert.equal(warm.length,41);
const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
const percentile=(a:number[],p:number)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.ceil(a.length*p)-1)];
const summarize=(rows:any[])=>({n:rows.length,top1:rows.filter(r=>r.rank===1).length,
  top3:rows.filter(r=>r.rank!==null&&r.rank>0&&r.rank<=3).length,
  top10:rows.filter(r=>r.rank!==null&&r.rank>0&&r.rank<=10).length});
const arms:any[]=[];
for(const input of ['raw','optionalCrop'])for(const breadth of [10,20]){
  const get=(r:any)=>r[input].arms.find((a:any)=>a.breadth===breadth);
  const rows=first.map(get),warmTimes=warm.map((r:any)=>get(r).totalMs);
  const wrong=first.filter((r:any)=>get(r).rank!==1);
  arms.push({input,breadth,...summarize(rows),
    wrongTop1:wrong.length,wrongTop1WithMarginAtLeast003:wrong.filter((r:any)=>get(r).top10[0].rerankScore-get(r).top10[1].rerankScore>=.03).length,
    timing:{coldFirstCaseMs:get(first[0]).totalMs,coldCaseScanId:first[0].scanId,warmMeanMs:mean(warmTimes),
      warmMedianMs:percentile(warmTimes,.5),warmP95Ms:percentile(warmTimes,.95),warmN:warm.length}});
}
const insertIds=new Set(frozen.qa.filter((q:any)=>q.accepted&&q.printedInsert).map((q:any)=>q.scanId));
const insertMetrics=arms.map(a=>({input:a.input,breadth:a.breadth,...summarize(first.filter((r:any)=>insertIds.has(r.scanId)).map((r:any)=>r[a.input].arms.find((x:any)=>x.breadth===a.breadth)))}));
const perCase=first.map((r:any)=>{
  const w=warm.find((x:any)=>x.scanId===r.scanId);
  return{scanId:r.scanId,confirmedCardId:r.cardId,verifiedFront:true,independentExactReferencePresent:true,parallel:false,printedInsert:insertIds.has(r.scanId),
    rawDinoRank:r.raw.rank,optionalCropDinoRank:r.optionalCrop.rank,cropAccepted:r.optionalCrop.automaticAccepted,
    arms:arms.map(a=>{
      const x=r[a.input].arms.find((v:any)=>v.breadth===a.breadth),wx=w[a.input].arms.find((v:any)=>v.breadth===a.breadth);
      return{input:a.input,breadth:a.breadth,rank:x.rank,top1CardId:x.top10[0].cardId,
        top1Score:x.top10[0].rerankScore,margin:x.top10[0].rerankScore-x.top10[1].rerankScore,
        warmProcessingMs:wx.totalMs,top10CardIds:x.top10.map((c:any)=>c.cardId)};
    })};
});
const baseline=await read('.local/broad-validation/baseline-freeze.json');
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256);
const vectorChecks=[];
for(const r of vectors.references){
  const v=await read(r.vectorFile);assert.equal(v.model,MODEL_VERSION);assert.equal(v.vector.length,384);
  assert(v.vector.every(Number.isFinite));assert(Math.abs(Math.sqrt(v.vector.reduce((s:number,x:number)=>s+x*x,0))-1)<1e-5);
}
for(const c of frozen.cases.slice(0,3)){
  const ref=frozen.index.find((r:any)=>r.id===c.cardId);
  assert.equal(ref.digest,c.referenceDigest);
  const entry=vectors.references.find((r:any)=>r.digest===ref.digest),v=await read(entry.vectorFile),b=await fs.readFile(ref.file);
  assert.equal(hash(b),ref.digest);
  const fresh=await embedCatalogVisualImage(b),cosine=visualCosine(fresh,v.vector);
  const maxAbsDifference=Math.max(...fresh.map((n,i)=>Math.abs(n-v.vector[i])));
  assert(cosine>.999999&&maxAbsDifference<1e-6);
  vectorChecks.push({cardId:c.cardId,cosine,maxAbsDifference});
}
const fileStats={files:0,directories:0,bytes:0,permissionsCorrect:true};
async function audit(path:string){
  const stat=await fs.lstat(path);assert(!stat.isSymbolicLink(),'No private symlinks permitted');
  if(stat.isDirectory()){
    fileStats.directories++;if((stat.mode&0o777)!==0o700)await fs.chmod(path,0o700);
    for(const f of await fs.readdir(path))await audit(`${path}/${f}`);
  }else{
    fileStats.files++;fileStats.bytes+=stat.size;
    // Callback-created extraction files are explicitly tightened before deletion as well.
    if((stat.mode&0o777)!==0o600)await fs.chmod(path,0o600);
  }
}
await audit(root);
const artifacts={
  json:'attached_assets/dev-broad-readonly-production-results.json',
  html:'attached_assets/dev-broad-readonly-production-report.html',
  evidence:'.local/broad-validation/readonly-production-sanitized-evidence.json',
};
const frozenHashes={extraction:hash(await fs.readFile(`${root}/extract.json`)),positiveCatalogSnapshot:policy.positiveMetadataHash,
  selection:frozen.selectionHash,index:vectors.indexHash,runFreeze:hash(await fs.readFile(`${root}/run-freeze.json`)),
  results:hash(await fs.readFile(`${root}/query-runs.json`)),baseline:hash(await fs.readFile('.local/broad-validation/baseline-freeze.json'))};
const qa=frozen.qa.map((q:any)=>({scanId:q.scanId,confirmedCardId:q.cardId,accepted:q.accepted,reason:q.reason,side:q.side,printedInsert:q.printedInsert,parallel:q.parallel}));
const report:any={
  title:'Read-only historical-scan validation of frozen DINO + base reranker',status:'COMPLETED_WITH_41_ELIGIBLE_CASES',
  createdAt:new Date().toISOString(),source:'One authorized READ ONLY production-replica SELECT export, capped at100 historical scans; all inference and temporary indexing local development only.',
  productionAccess:{scanExportCalls:1,scanRecordsExported:100,catalogMetadataReadCalls:1,distinctSelectedCatalogIds:referenceQueryTemplate.cardIds.length,
    productionWrites:0,accountIdentifiersExported:0,accountNamesEmailsFreeTextOCRExported:0,replacementPagination:false,
    filtering:'Same-owner equality and conflicting selected IDs handled inside SQL; null-after-selection and invalid flow excluded. Matcher predictions are never labels. Explicit selected_card_id only. No successful-ownership claim.'},
  sourceFunnel:extraction.funnel,
  evaluationFunnel:{exported:100,downloadedQueries:prepared.queriesAvailable,
    independentReferenceCandidatesAvailable:prepared.positiveReferenceAvailable,
    initialReferenceUnavailability:prepared.referenceFailures,
    exactOrNearPriorQueryDuplicates:prepared.priorDuplicates,initialWithinExportNearDuplicateFlags:prepared.cohortDuplicates,
    queryReferenceByteOrNarrowNearCopyFlags:prepared.referenceCopies,
    primaryVisualAndReferenceOutcomes:feasibility.qaCounts,
    visibleFrontCandidates:qa.filter((q:any)=>q.side==='front').length,
    eligiblePreviouslyUnqueriedVerifiedExactFronts:41,correctIndependentReferencesPresentInIndex:41,
    strictParallelCases:0,printedInsertCases:insertIds.size,uniqueAccuracyCases:41,warmRepeatCases:41},
  index:{targetReusedCardIds:2938,actualCardIds:frozen.index.length,uniqueReferenceEmbeddings:vectors.references.length,
    reusedEmbeddings:vectors.reused,newTemporaryEmbeddings:vectors.created,additionalReferencePlanIds:policy.additionalReferenceIds.length,
    additionalReferenceFailures:frozen.extraFailures.length,referenceLeakageRemovals:frozen.leakageExclusions.length,
    correctReferenceCoverage:'41/41 eligible cases,100%; eligibility is conditional on independent exact reference availability, not all100 exported scans.',
    selectionPolicy:policy.policy,permanentIndexWrites:0,fullIndexRun:false,
    referenceQALimit:'All positive fronts verified visually/structurally before inference; the several-thousand distractors are metadata-stratified catalog images, not individually exact-card visually audited. Shared images across multiple catalog IDs remain potential ambiguity.'},
  frozenPipeline:{model:MODEL_VERSION,basePolicy:policy.basePolicy,rerankBreadths:[10,20],newChroma:false,modelPoolingQuantizationChanged:false,canonicalSingleImage:true,
    optionalCrop:'Original ORB/RANSAC gates and existing34-reference physical-boundary whitelist unchanged. No newly inferred card boundaries or per-query corners.'},
  dinoOnly:summarize(first.map((r:any)=>({rank:r.raw.rank}))),metrics:arms,
  strictParallelSubgroup:{n:0,top1:null,top3:null,top10:null,note:'Five candidate exact printings were unresolved and excluded; accepted distinct printed inserts are NOT counted as exact parallels.'},
  printedInsertSubgroup:insertMetrics,
  optionalCrop:{accepted:0,n:41,acceptanceRate:0,verifiedBoundaryCandidates:prep[0].orbVerifiedReferences,
    fallbackBytesIdentical:first.every((r:any)=>r.raw.queryHash===r.optionalCrop.inputHash),
    limitation:'No Stage1top10 reference belonged to the frozen verified-boundary whitelist. All41 abstained to raw; this measures fallback, not successful crop generalization. Optional arm therefore adds overhead without new image evidence.'},
  timing:{units:'milliseconds',accuracyPasses:1,warmRepetitionPasses:1,
    interpretation:'Cold column is the FIRST query only, not41 independent cold starts. Warm mean/median/p95 use one repeated pass of the same41 cases. Processing is DINO+in-memory exact search+query raster+reranker, plus isolation/second embedding for optional crop. Index I/O and reference preparation excluded. Model-only and harness preparation costs separately reported.',
    indexLoadMs:integrity.indexIOMs,referenceFeaturePreparationMs:integrity.featurePreparationMs,
    firstRawDinoColdMs:first[0].raw.embeddingMs,warmRawDinoMeanMs:mean(warm.map((r:any)=>r.raw.embeddingMs)),
    optionalHarnessPreparation:prep,
    optionalWarmHarnessAmortizedExtraMsPerQuery:(prep[1].pngPrepWallMs+prep[1].orbProcessWallMs-prep[1].guidedIsolationSumMs)/41,
    warning:'Offline batch harness startup and PNG staging are NOT included in kernel processing figures; extra measured costs above prevent implying those figures are deployment end-to-end latency.'},
  ambiguity:{marginThreshold:.03,meaning:'Frozen descriptive score-margin flag only, not calibrated confidence or an automatic acceptance threshold. Wrong clear-margin counts are not a validated false-high-confidence probability.'},
  perCase,eligibilityDecisions:qa,
  integrity:{baselineFilesUnchanged:baseline.files.length,allVectorsFiniteUnit384:vectors.references.length,
    freshProcessReferenceParity:vectorChecks,warmRankStability:integrity.repeats.every((r:any)=>r.identicalRawRanking),
    sourceHashes:policy.sourceHashes,runSourceHashes:runFreeze.sources,frozenHashes},
  limitations:[
    '41 cases, below requested50–100; no additional scans exported to replace rejects.',
    'Newest reliably linked historical selections, conditioned on reference availability and visual verifiability; not representative population sampling or an unseen-by-humans holdout.',
    'Historical collector selections can be wrong: explicit feedback was not treated as sufficient exact-card truth.',
    'All17 prior experimentally queried scans excluded, plus known local conflicts. Narrow byte/dHash screens and visual same-card capture-cluster exclusions applied; arbitrary crop/edit or same-session independence cannot be proven from available metadata.',
    '22 archived identities were excluded without guessing active aliases or changing saved historical/manual labels.',
    'No independently verified exact parallel survived. Printed insert performance must not be presented as parallel-discrimination accuracy.',
    'No thresholds, model, pooling, chroma, reranker or candidate filtering were tuned after outcomes.'
  ],
  readiness:'Insufficient for production readiness. Base reranker reduced top1 versus the same frozen DINO first stage; broader20 breadth did not improve top1 and reduced top10. Further exact-parallel and representative validation still required.',
  cleanup:{status:'pending',privateWorkspaceOwned:true,preDeletion:fileStats,retained:'Only sanitized aggregate metrics, scan/card IDs, ranks, technical SQL templates and hashes; no photographs, image URLs, account data, timestamps, feature vectors or free-form source records.'},
};
const evidence={productionScanSqlTemplate:queryTemplate.sql,excludedScanIds:queryTemplate.excludedIds,
  productionReferenceSqlTemplate:referenceQueryTemplate.sql,selectedCardIds:referenceQueryTemplate.cardIds,
  environment:'production-readonly-replica',scanExportLimit:100,scanRecordsExported:100,
  frozenHashes,sourceHashes:report.integrity.sourceHashes,runSourceHashes:report.integrity.runSourceHashes};
const sensitiveStrings=extraction.rows.map((r:any)=>r.image_url).concat(frozen.cases.map((c:any)=>c.reference?.url).filter(Boolean));
function sanitizeAssert(text:string){
  assert(!text.includes('data:image/'));assert(!text.includes('base64,'));
  for(const value of sensitiveStrings)assert(!text.includes(value),'Sensitive URL in durable report');
  assert(!/"(?:queryUrl|image_url|referenceFile|queryFile|vector|scan_created_at|selection_at)"\s*:/.test(text));
}
function html(r:any){
  const escape=(v:unknown)=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
  const pct=(n:number,d:number)=>`${n}/${d} (${(100*n/d).toFixed(1)}%)`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Frozen recognition validation — sanitized results</title><style>body{font:16px/1.5 system-ui;color:#1d2d3c;background:#f5f7fa;margin:0}main{max-width:1180px;margin:auto;padding:32px}h1{font-size:34px;line-height:1.15}.notice{padding:20px;background:#fff0cd;border-left:5px solid #be8115}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.card{background:#fff;border:1px solid #d9e0e8;border-radius:8px;padding:18px;min-width:160px;flex:1}.card b{display:block;font-size:30px}table{width:100%;border-collapse:collapse;background:white;font-size:14px;margin:18px 0}th,td{border:1px solid #d9e0e8;text-align:left;padding:9px}th{background:#e7edf3}.scroll{overflow:auto}small{color:#51667a}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{background:white;border:1px solid #d9e0e8;padding:15px;margin:18px 0}</style><main>
  <small>READ-ONLY PRODUCTION EXTRACTION · DEVELOPMENT-ONLY INFERENCE · NO PHOTOGRAPHS OR IMAGE URLS RETAINED IN THIS REPORT</small>
  <h1>Frozen DINO + base reranker:<br>actual100-record validation</h1>
  <p class="notice"><b>41 independently verified fronts survived the100-record cap.</b> Against3,046 temporary catalog IDs, raw+base top10 breadth achieved28/41 exact top1,29/41 top3 and35/41 top10. No independently verified exact parallel survived. This is not production-readiness evidence.</p>
  <div class="cards"><div class="card"><b>100</b>exported scans; no replacements</div><div class="card"><b>41</b>eligible exact fronts</div><div class="card"><b>3,046</b>temporary indexed card IDs</div><div class="card"><b>0</b>exact parallel cases</div></div>
  <h2>Measured exact-card results</h2><p>DINO-only first stage: top1 ${pct(r.dinoOnly.top1,41)}, top3 ${pct(r.dinoOnly.top3,41)}, top10 ${pct(r.dinoOnly.top10,41)}. The base reranker did not improve top1.</p>
  <div class="scroll"><table><tr><th>Input / breadth</th><th>Top1</th><th>Top3</th><th>Top10</th><th>First cold case</th><th>Warm mean / p95</th><th>Wrong clear-margin top1</th></tr>${arms.map(a=>`<tr><td>${a.input} / ${a.breadth}</td><td>${pct(a.top1,a.n)}</td><td>${pct(a.top3,a.n)}</td><td>${pct(a.top10,a.n)}</td><td>${a.timing.coldFirstCaseMs.toFixed(0)} ms</td><td>${a.timing.warmMeanMs.toFixed(0)} / ${a.timing.warmP95Ms.toFixed(0)} ms</td><td>${a.wrongTop1WithMarginAtLeast003}/${a.n}</td></tr>`).join('')}</table></div>
  <p>Cold = first query only. Warm = repeated pass of41 cases, not41 extra independent labels. Index I/O and reference preparation excluded. Optional processing includes isolation plus a second embedding; PNG staging/Python process startup are separately disclosed. Margin≥0.03 is descriptive, not calibrated confidence.</p>
  <h2>Availability and exclusions</h2><p>One SELECT against the production read-only replica exported at most100 scans after same-owner explicit-choice, conflict, known-exposure and URL-duplicate checks. User/account IDs were compared only inside SQL, never exported. A separate SELECT read93 selected catalog IDs, not more scans. No replacements or further scan pages.</p>
  <table><tr><th>Primary outcome (mutually exclusive)</th><th>Count</th></tr>${Object.entries(feasibility.qaCounts).map(([k,v])=>`<tr><td>${escape(k)}</td><td>${v}</td></tr>`).join('')}</table>
  <p>100/100 original images available;74 current active independent-reference candidates available before visual identity checks. All41 admitted positives were in the index. The22 archived identities were not silently remapped. Back, blank, wrong-printing and same-card capture-cluster cases remained excluded.</p>
  <h2>Optional crop and parallel limitations</h2><p>Crop accepted0/41. None of the Stage1top10 reference images was in the existing34-reference verified-boundary whitelist; the frozen algorithm safely used byte-identical raw input. This does not validate successful cropping. Exact parallel n=0; the${insertIds.size} verified printed inserts are reported separately and are not called parallels.</p>
  <h2>Per-case table</h2><p>Only technical IDs/ranks are retained. A dash means the correct ID was outside that reranker candidate pool. Optional-crop ranks matched raw because every crop abstained.</p>
  <div class="scroll"><table><tr><th>Scan ID</th><th>Confirmed card ID</th><th>DINO rank</th><th>Base10 rank</th><th>Base20 rank</th><th>Base10 top1 ID</th><th>Warm base10 ms</th></tr>${perCase.map(c=>`<tr><td>${c.scanId}</td><td>${c.confirmedCardId}</td><td>${c.rawDinoRank}</td><td>${c.arms[0].rank??'—'}</td><td>${c.arms[1].rank??'—'}</td><td>${c.arms[0].top1CardId}</td><td>${c.arms[0].warmProcessingMs.toFixed(0)}</td></tr>`).join('')}</table></div>
  <h2>Index preparation and integrity</h2><p>Reused2,678 frozen reference embeddings and computed107 additional single-image embeddings, totaling2,785 distinct rasters /3,046 IDs. Added verified positives and bounded metadata hard negatives to the unchanged stratified index. No permanent/full index writes. All735 earlier baseline files stayed unchanged. All2,785 vectors passed dimension/unit/finite checks; three newly verified positives reproduced exactly in a fresh process. Frozen warm rankings were stable.</p>
  <p>Timing exclusions: index loading${(integrity.indexIOMs/1000).toFixed(2)}s; reference-feature preparation${(integrity.featurePreparationMs/1000).toFixed(2)}s. Warm optional harness staging/startup adds approximately${r.timing.optionalWarmHarnessAmortizedExtraMsPerQuery.toFixed(0)}ms/query when amortized across this offline batch. These are not production end-to-end latency promises.</p>
  <h2>Privacy and cleanup</h2><p>${r.cleanup.status==='verified-deleted'?'Verified: the entire newly owned private workspace was recursively removed after metric/report validation.':'Cleanup pending verification.'} ${fileStats.files} private files (${fileStats.bytes.toLocaleString()} bytes) were inventoried before deletion. Prior existing datasets/results were preserved. This report contains no images, image URLs, account identifiers, timestamps or query vectors.</p>
  <h2>Readiness conclusion</h2><p class="notice">${escape(r.readiness)}</p><ul>${r.limitations.map((s:string)=>`<li>${escape(s)}</li>`).join('')}</ul>
  <details><summary>Self-contained sanitized JSON</summary><pre>${escape(JSON.stringify(r,null,2))}</pre></details></main></html>`;
}
const initialJson=JSON.stringify(report,null,2),initialHtml=html(report);
sanitizeAssert(initialJson);sanitizeAssert(initialHtml);sanitizeAssert(JSON.stringify(evidence));
assert(!/<img\b|https?:\/\/[^<\s"]+\/image\/upload\//i.test(initialHtml));
await fs.writeFile(artifacts.json,initialJson,{mode:0o600});
await fs.writeFile(artifacts.html,initialHtml,{mode:0o600});
await fs.writeFile(artifacts.evidence,JSON.stringify(evidence,null,2),{mode:0o600});
// Verify durable metrics before deleting the sole owned private tree.
const persisted=await read(artifacts.json);
assert.equal(persisted.perCase.length,41);assert.equal(persisted.metrics[0].top1,28);
assert.equal(persisted.metrics[0].top10,35);assert.equal(persisted.metrics[1].top10,33);
assert.equal(persisted.index.actualCardIds,3046);
for(const c of frozen.cases)assert(frozen.index.some((r:any)=>r.id===c.cardId&&r.digest===c.referenceDigest));
await fs.rm(root,{recursive:true,force:false});
let exists=true;try{await fs.stat(root);}catch(e:any){if(e.code==='ENOENT')exists=false;else throw e;}
assert(!exists,'Private workspace removal failed');
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256);
report.cleanup={...report.cleanup,status:'verified-deleted',workspaceExistsAfter:false,
  deletionVerifiedAt:new Date().toISOString(),priorBaselineFilesStillUnchanged:baseline.files.length,
  newImagesUrlsVectorsRetainedInDeliverables:false};
const finalJson=JSON.stringify(report,null,2),finalHtml=html(report);
sanitizeAssert(finalJson);sanitizeAssert(finalHtml);
await fs.writeFile(artifacts.json,finalJson,{mode:0o600});
await fs.writeFile(artifacts.html,finalHtml,{mode:0o600});
const proof={status:'verified',exportedScanRecords:100,evaluatedCases:41,removedPrivateFiles:fileStats.files,
  removedPrivateBytes:fileStats.bytes,privateWorkspaceExists:false,baselineUnchanged:735,
  reportJsonSha256:hash(finalJson),reportHtmlSha256:hash(finalHtml),containsImages:false,containsImageUrls:false};
await fs.writeFile('.local/broad-validation/readonly-production-cleanup-verification.json',JSON.stringify(proof,null,2),{mode:0o600});
console.log(JSON.stringify({metrics:arms,dinoOnly:report.dinoOnly,parallelN:0,printedInsertN:insertIds.size,cleanup:proof},null,2));