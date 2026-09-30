import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const dir='.local/broad-validation';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const [plan,manifest,runs,integrity,availability,index,priorReport]=await Promise.all([
  read(`${dir}/frozen-plan.json`),read(`${dir}/reference-manifest.json`),read(`${dir}/query-runs.json`),
  read(`${dir}/final-integrity.json`),read(`${dir}/continuation-availability.json`),
  read(`${dir}/index-summary.json`),read(`${dir}/results.json`)]);
const cold=runs.filter((r:any)=>r.repeat===0),warm=runs.filter((r:any)=>r.repeat>0);
const mean=(values:number[])=>values.reduce((s,v)=>s+v,0)/values.length;
const summaries=[];
for(const input of ['raw','optionalCrop'])for(const breadth of [10,20]){
  const rows=cold.map((r:any)=>r[input].arms.find((a:any)=>a.breadth===breadth));
  const runtime=(r:any)=>r[input].arms.find((a:any)=>a.breadth===breadth).totalMs;
  const offline=(r:any)=>runtime(r)+(input==='optionalCrop'?r.preparation.cropPrepMs+r.preparation.orbProcessWallMs-r.optionalCrop.detection.guidedIsolationMs:0);
  summaries.push({input,breadth,n:cold.length,top1:rows.filter((a:any)=>a.rank===1).length,
    top3:rows.filter((a:any)=>a.rank&&a.rank<=3).length,top10:rows.filter((a:any)=>a.rank&&a.rank<=10).length,
    coldProcessingMs:mean(cold.map(runtime)),warmProcessingMeanMs:mean(warm.map(runtime)),
    coldOfflineHarnessMs:mean(cold.map(offline)),warmOfflineHarnessMeanMs:mean(warm.map(offline))});
}
const valid=manifest.rows.filter((r:any)=>!r.error);
const group=(rows:any[],key:(r:any)=>string)=>rows.reduce((o:any,r:any)=>{const k=key(r);o[k]=(o[k]??0)+1;return o;},{});
let embeddingComputeMs=0;
for(const digest of new Set<string>(valid.map((r:any)=>r.digest))){
  const v=await read(`${dir}/vectors/${digest}.json`);embeddingComputeMs+=v.embeddingMs;
}
const origin=await read('.local/scan-review/photo-origin-audit.json');
const selectedAudit=origin.rows.find((r:any)=>r.scanId===2837);
const verification=plan.verification.map((v:any)=>({...v,
  secondaryNotes:v.scanId===3029?'Existing photo-origin audit flags exact self-reference leakage in historical candidate URL, independent of absent current catalog reference. Excluded.'
   :v.scanId===3047?'Visible query is red/checkered Throg while historical selection says Black: additional parallel concern; no label changed.':null}));
const report={
  title:'Frozen DINO + base reranker: bounded broader-index validation',
  status:'COMPLETED_BOUNDED_RUN_BUT_BROAD_COHORT_UNAVAILABLE',createdAt:new Date().toISOString(),
  supersedes:'Initial zero-DEV-query blocker report. Parent subsequently authorized already-local historical source evidence and clarified review-only exposure is not experiment-query exposure. DEV remains empty; one eligible unused historical query survived independent verification.',
  model:plan.model,basePolicy:plan.basePolicy,newChroma:false,
  funnel:{currentDevScanRows:0,currentDevFeedbackRows:0,localPreparedSourceRecords:72,
    preparedLocalPhotos:60,historicalExtractRows:60,historicalExplicitSelections:16,
    explicitSelectionsPreviouslyQueried:4,explicitSelectionsManualConflict:3,unusedHistoricalCandidates:9,
    candidateBacks:1,candidateFrontImages:8,wrongHistoricalIdentity:2,exactParallelUnresolved:2,
    missingCurrentIndependentReferences:3,knownSelfReferenceLeakageAmongMissing:1,eligibleIndependentExactFronts:1,
    priorActualExperimentQueriesExcluded:16,earlierTunedSubsetExcluded:9,reviewOnlyPreparedExposureNotAutomaticExclusion:true,
    indexTargetCardIds:3000,indexSuccessfullyPreparedCardIds:valid.length,uniqueReferenceEmbeddings:index.uniqueReferenceEmbeddings,
    downloadOrDecodeFailures:manifest.rows.filter((r:any)=>r.error).length,actualAccuracyCases:cold.length,warmRepeatPasses:warm.length},
  funnelNotes:'Mutually exclusive primary candidate exclusions: 1 back + 2 wrong historical identities + 2 unresolved exact parallels + 3 missing references + 1 eligible = 9. Known self-reference and red/black discrepancy are additional overlapping warnings. Of16 explicit histories,4 were in prior16 queried IDs,3 conflict with saved manual labels. Source72 has no selected-card feedback fields; its12 records outside historical60 cannot acquire labels from prediction/candidate IDs. None were promoted.',
  selection:{policy:plan.policy,availableActivePublicReferenceCards:plan.availableActivePublicReferenceCards,
    queryExposure:plan.queryExposure,priorActualQueryIds:availability.actualQueryIds,
    preparedOnlyVsUntouched:'Previously prepared for human review / exposed to historical matcher, but first DINO/base-reranker experimental inference for scan2837. Not newly collected DEV data or an entirely unseen holdout.',
    hardNegativePlan:plan.hardNegatives,successfulRoles:group(valid,r=>r.role),
    successfulDecades:group(valid,r=>`${Math.floor(r.year/10)*10}s`),
    successfulMetadataStrata:group(valid,r=>r.stratum??'forced-positive-or-hard-negative'),
    distinctMainFamilies:new Set(valid.map((r:any)=>r.main_set_id)).size,
    distinctSubsets:new Set(valid.map((r:any)=>r.set_id)).size,
    queryFailureReplacement:false,indexFailureReplacement:false},
  sourceTrace:priorReport.trace,
  sourceAvailability:availability.appDatabase,
  sourceAudit:{historicalRows:60,source72WithoutFeedback:12,manualDecisionsUnchanged:true,
    note:'App server/db.ts uses DATABASE_URL. Connection was explicitly restricted to local helium/localhost/127.0.0.1, NODE_ENV nonproduction, repeatable-read READ ONLY transaction. Both built-in DEV and actual local app database have zero scans/feedback. No production connection opened.'},
  verification,cases:cold.map((r:any)=>({scanId:r.scanId,cardId:r.cardId,name:'Deadpool',cardNumber:'43',
    exactSet:'1992 X-Men Series 1',parallel:false,queryHash:r.raw.queryHash,
    referenceDigest:valid.find((v:any)=>v.id===r.cardId).digest,
    independentReferenceVerified:true,visibleCaptureContext:'Physical top-loader, surrounding surface and perspective; not a catalog-raster copy. Device/photographer identity not independently proven.',
    rawDinoRank:r.raw.rank,optionalCropDinoRank:r.optionalCrop.rank,
    optionalCropAccepted:r.optionalCrop.automaticAccepted,
    arms:summaries.map(s=>({input:s.input,breadth:s.breadth,rank:r[s.input].arms.find((a:any)=>a.breadth===s.breadth).rank,
      top10:r[s.input].arms.find((a:any)=>a.breadth===s.breadth).top10})),
    historicalFeedbackIds:plan.cases.find((c:any)=>c.scanId===r.scanId).feedbackIds})),
  exactMetrics:summaries,
  parallelSubgroup:{n:0,top1:null,top3:null,top10:null,note:'No exact parallel survived independent verification. No parallel-recognition conclusion.'},
  optionalCrop:{accepted:0,n:1,rate:0,verifiedReferenceCandidates:0,
    limitation:plan.optionalCropBoundaryLimitation,
    note:'All Stage1top10 reference digests were outside the prior verified boundary whitelist. ORB abstained and raw bytes were reused. No evidence that cropping generalizes; frozen safety gate worked as fallback.'},
  timing:{protocol:'One cold model pass and two warm repetitions of the SAME single query. Accuracy denominator remains1. Exact in-memory all-card search. Index load and reference download/feature preparation excluded from processing. Optional kernel timing includes guided isolation but excludes PNG staging/subprocess startup; separate offline-harness totals include those measured costs. Offline harness includes disk staging and is not a production latency claim.',
    indexLoadMs:(await read(`${dir}/run-integrity.json`)).indexIOMs,
    referenceDownloadWallMs:manifest.downloadWallMs,referenceEmbeddingComputeMs:embeddingComputeMs,
    referenceEmbeddingExecution:'Sequential canonical single-image calls. First bounded shell run timed out after1652 saved embeddings; resumed1026 remaining without changing sample or recomputing saved vectors. Summed per-reference compute time supplied, not an invented uninterrupted wall time.',
    referenceFeatureComputeMs:(await read(`${dir}/run-integrity.json`)).referenceFeaturesComputeMs,
    rawDinoColdMs:cold[0].raw.embeddingMs,rawDinoWarmMeanMs:mean(warm.map((r:any)=>r.raw.embeddingMs)),
    optionalPreparation:runs.map((r:any)=>({repeat:r.repeat,...r.preparation,guidedIsolationMs:r.optionalCrop.detection.guidedIsolationMs}))},
  leakage:{exactQueryHashMatches:0,queryVsOtherPreparedMinimumRotationDhashDistance:Math.min(...plan.leakage.map((r:any)=>r.dhashDistance)),
    minimumSampledReferenceToQueryDhashDistance:Math.min(...valid.map((r:any)=>r.queryDhashDistance)),
    policy:'Query SHA256 against all60 saved originals; rotation-aware256-bit dHash versus59 other originals, reject<=12. Reference byte hashes screened against all60 originals, references with dHash<=12 quarantined. Independent positive visually checked: different capture, not query upload. No automatic perceptual score treated as proof of exact identity.',
    limitations:'Whole-image dHash is a narrow near-duplicate screen, not proof against arbitrary crops or edits. Only one admitted query; no within-new-cohort capture leakage possible. Capture session metadata unavailable; no timestamp-based independence claim.',
    previousPhotoOriginAudit:selectedAudit},
  referencePreparation:{verifiedPositiveCount:1,blanketExactReferenceQAPassed:false,
    note:'All2938 downloads decoded and were byte-hashed; only the positive was independently exact-card/printing verified. Distractors are metadata-stratified catalog records, not individually visually audited. Wrong distractor images and duplicate shared-reference parallel IDs can distort retrieval; no catalog repairs made.',
    sharedDigestCardSurplus:valid.length-index.uniqueReferenceEmbeddings,
    failures:manifest.rows.filter((r:any)=>r.error).map((r:any)=>({cardId:r.id,error:r.error}))},
  integrity,hashes:{plan:hash(await fs.readFile(`${dir}/frozen-plan.json`)),catalogSnapshot:plan.snapshotHash,
    referenceManifest:hash(await fs.readFile(`${dir}/reference-manifest.json`)),baselineFreeze:hash(await fs.readFile(`${dir}/baseline-freeze.json`)),
    runFreeze:hash(await fs.readFile(`${dir}/query-run-freeze.json`)),queryResults:hash(await fs.readFile(`${dir}/query-runs.json`))},
  limitations:['Only1 eligible exact front: cannot satisfy50–100 or estimate representative accuracy.',
    'One base card, zero verified exact parallels; 1/1 is descriptive only, not evidence that recognition is fixed.',
    'Historic labels include demonstrably wrong selections; unverified selections were not used as truth.',
    'Metadata-stratified temporary index across catalog families is broader than the old index, but enriched with positive and45 hard negatives, not a deployment-distribution sample.',
    'No new human annotations, threshold tuning, chroma, metadata retrieval filters, batches, quantization/pooling changes, full-index writes, UI changes, production reads or publish.'],
  readiness:'Insufficient evidence for general recognition or production readiness; real exact-parallel performance remains unmeasured.',
};
assert.equal(report.funnel.eligibleIndependentExactFronts,report.cases.length);
assert.equal(valid.length,2938);assert.equal(index.uniqueReferenceEmbeddings,2678);
await fs.writeFile(`${dir}/results.json`,JSON.stringify(report,null,2));
await fs.writeFile('attached_assets/dev-broad-validation-results.json',JSON.stringify(report,null,2));
const escape=(v:unknown)=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const image=async(p:string)=>`data:image/jpeg;base64,${(await sharp(await fs.readFile(p)).resize({width:960,withoutEnlargement:true}).jpeg({quality:82}).toBuffer()).toString('base64')}`;
const pictures=new Map<number,string>();
for(const v of verification)pictures.set(v.scanId,await image(`${dir}/positive-${v.scanId}.jpg`));
const metricRows=summaries.map(s=>`<tr><td>${s.input==='raw'?'Raw':'Optional crop → raw fallback'}</td><td>${s.breadth}</td><td>${s.top1}/${s.n}</td><td>${s.top3}/${s.n}</td><td>${s.top10}/${s.n}</td><td>${s.coldProcessingMs.toFixed(0)} / ${s.warmProcessingMeanMs.toFixed(0)} ms</td><td>${s.coldOfflineHarnessMs.toFixed(0)} / ${s.warmOfflineHarnessMeanMs.toFixed(0)} ms</td></tr>`).join('');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Frozen DINO — actual bounded broader-index validation</title><style>body{font:16px/1.55 system-ui;margin:0;background:#f5f7fb;color:#182735}main{max-width:1160px;margin:auto;padding:32px}h1{font-size:34px;line-height:1.2}h2{margin-top:36px}small{color:#536577}.notice{padding:20px;background:#fff1ce;border-left:5px solid #c88714;border-radius:6px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.card{background:white;padding:18px;flex:1;min-width:160px;border:1px solid #dbe1eb;border-radius:10px}.card b{display:block;font-size:30px}table{border-collapse:collapse;width:100%;background:white;margin:16px 0;font-size:14px}td,th{border:1px solid #dbe1eb;padding:10px;vertical-align:top;text-align:left}th{background:#e8edf4}img{max-width:100%;height:auto;border-radius:6px}details{background:white;border:1px solid #dbe1eb;padding:14px;margin:14px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.scroll{overflow-x:auto}.pass{color:#227041}.fail{color:#a14d12}code{overflow-wrap:anywhere}</style><main>
<small>DEVELOPMENT-ONLY EXPERIMENT · NO PRODUCTION ACCESS OR PUBLICATION</small><h1>Actual run: frozen DINO + base reranker</h1>
<p class="notice"><b>2,938 catalog cards tested against one eligible previously unqueried scan.</b> The correct card ranked first in every frozen arm. This is <b>not</b> the requested50–100-photo validation and cannot establish general accuracy or production readiness. Eight other unused historical candidates failed front, exact-identity/parallel or independent-reference checks.</p>
<div class="cards"><div class="card"><b>1</b>eligible exact-front case</div><div class="card"><b>2,938</b>indexed card IDs</div><div class="card"><b>2,678</b>single-image embeddings</div><div class="card"><b>0</b>verified parallel cases</div></div>
<h2>What actually ran</h2><p>Unchanged pinned DINO q8/CLS single-image embedding, exact all-index search, and frozen base detail reranker at top10 and top20 breadths. No new chroma. Optional ORB isolation retained its original gates and prior physical-boundary whitelist. It abstained for this case, so crop-arm input stayed byte-identical to raw.</p>
<div class="scroll"><table><tr><th>Input</th><th>Rerank breadth</th><th>Exact top1</th><th>Top3</th><th>Top10</th><th>Kernel cold / warm mean</th><th>Offline harness cold / warm</th></tr>${metricRows}</table></div>
<p><b>Timing:</b> one cold pass, two warm repetitions of the same case—not three independent cases. Index I/O, model-reference preparation and downloads excluded. Kernel optional-crop time excludes PNG staging/subprocess startup; offline-harness time includes their measured cost. Both are experimental execution timings, not production SLA estimates. Raw DINO alone: ${report.timing.rawDinoColdMs.toFixed(0)} ms cold, ${report.timing.rawDinoWarmMeanMs.toFixed(0)} ms warm mean.</p>
<h2>Per-case measured result</h2><table><tr><th>Scan / exact label</th><th>Independent evidence</th><th>Outcome</th></tr><tr><td>2837 · Deadpool #43<br>1992 X-Men Series1<br>active catalog16946</td><td>Matching red border, SUPER-VILLAINS header, moon, pose, skyline and X logo. Query has physical top-loader; clean catalog image is an independent raster.</td><td>DINO rank1; all four reranker arms rank1.<br>Crop accepted0/1; fallback confirmed byte-identical.</td></tr></table><img alt="Actual Deadpool scan on left and independent catalog reference on right" src="${pictures.get(2837)}">
<h2>Why only one query?</h2><p>Actual app connection and built-in DEV both contain zero scan uploads and feedback. Parent clarified that previously <em>prepared for review</em> photos may be used if never experimentally queried. The already-local historical export has16 explicit selections;4 were previously queried and3 conflict with saved manual decisions. The remaining9 received visual/reference verification below. No production connection or fresh production export was used.</p>
<table><tr><th>Funnel</th><th>Count</th></tr>${Object.entries(report.funnel).map(([k,v])=>`<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join('')}</table><p>${escape(report.funnelNotes)}</p>
<h2>All nine unused historical candidates</h2>${verification.map((v:any)=>`<details ${v.accepted?'open':''}><summary class="${v.accepted?'pass':'fail'}">Scan${v.scanId} — ${escape(v.category)}${v.accepted?' · INCLUDED':' · EXCLUDED'}</summary><p>${escape(v.note)}</p>${v.secondaryNotes?`<p>${escape(v.secondaryNotes)}</p>`:''}<img alt="Original query and available independent reference for scan${v.scanId}" loading="lazy" src="${pictures.get(v.scanId)}"></details>`).join('')}
<h2>Temporary-index breadth and limitations</h2><p>${escape(plan.policy)}</p><p>${report.selection.distinctMainFamilies} main families; ${report.selection.distinctSubsets} subsets. ${manifest.rows.filter((r:any)=>r.error).length} failures (61 HTTP404/unsupported-type responses;1 corrupt JPEG); no outcome-based replacements. ${report.referencePreparation.sharedDigestCardSurplus} card IDs share reference digests beyond the unique count. The positive was exact-card visually verified; thousands of distractors were not individually manually audited.</p><table><tr><th>Decade</th><th>Successfully indexed IDs</th></tr>${Object.entries(report.selection.successfulDecades).sort().map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
<h2>Integrity, provenance and leakage</h2><ul>${report.sourceTrace.map((s:string)=>`<li>${escape(s)}</li>`).join('')}<li>All735 prior baseline source/data/result files remained SHA256-identical.</li><li>All2678 vectors finite, dimension384, unit length. Independent fresh-process single-image parity: four reference checks, cosine1, maximum component difference0.</li><li>Eligible query versus59 other prepared originals: minimum rotation-aware dHash distance${report.leakage.queryVsOtherPreparedMinimumRotationDhashDistance}/256; no exact query-byte overlaps. This narrow screen is not proof against arbitrary edited/cropped copies.</li><li>Historical source72 predictions are not labels; only linked explicit feedback plus independent verification was eligible. Saved manual decisions were not changed.</li></ul>
<h2>Readiness conclusion</h2><p class="notice">${escape(report.readiness)} One base-card success does not establish exact-parallel recognition, calibration, false-high-confidence rates or performance on a representative collector population. More legitimate, previously unqueried, independently verifiable scans are still required.</p>
<details><summary>Full self-contained JSON result</summary><pre>${escape(JSON.stringify(report,null,2))}</pre></details>
<small>Plan SHA256: <code>${report.hashes.plan}</code><br>Catalog snapshot SHA256: <code>${report.hashes.catalogSnapshot}</code></small></main></html>`;
await fs.writeFile('attached_assets/dev-broad-validation-report.html',html);
await fs.writeFile(`${dir}/final-report-integrity.json`,JSON.stringify({htmlSha256:hash(html),jsonSha256:hash(JSON.stringify(report,null,2)),generatedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({status:report.status,funnel:report.funnel,metrics:summaries,roles:report.selection.successfulRoles,decades:report.selection.successfulDecades},null,2));