import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.argv[2];
assert(/^\/tmp\/mcv-failure12-[A-Za-z0-9]+$/.test(root));
assert.equal(fs.realpathSync(root),root);
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const p=read(root+'/prepared.json'),raw=read(root+'/raw-results.json'),crop=read(root+'/crop-results.json'),timing=read(root+'/detector-timing.json'),freeze=read(root+'/detector-freeze.json');
const baseline=read('.local/broad-validation/baseline-freeze.json');
for(const f of baseline.files)assert.equal(hash(f.path),f.sha256);
const previous=read('.local/broad-validation/readonly-production-sanitized-evidence.json');
for(const [file,h]of Object.entries({...previous.sourceHashes,...previous.runSourceHashes}))assert.equal(hash(file),h);
assert.equal(hash('scripts/dev-independent-card-detector.py'),freeze.sha256);
assert.equal(freeze.sha256,freeze.marker.sourceHash);
assert.equal(raw.length,12);assert.equal(crop.length,12);
const notes={
  2866:['hand / background / obstruction','Card is held at an angle over a hand and cluttered room background. Top1 and other nearby references also include substantial scene backgrounds; correct artwork is clearly present at rank4.','Mild perspective is secondary; background-driven ranking is a plausible explanation, not a controlled causal proof.'],
  2899:['glare / lighting','Bright reflected hotspots and broad gold/green foil illumination differ strongly from the dark red/green positive reference. Top1 is another dark red symbiote image; exact artwork remains rank5.','Reflective insert appearance is observed; this does not establish a different parallel or wrong label.'],
  2981:['hand / background / obstruction','Large hand and surrounding scene remain; the right card edge approaches/is clipped by the source boundary. Top1 depicts different art with a hand/background, while Top2 depicts the same beach artwork in a wider reference photograph.','Same-art catalog-ID ambiguity is secondary. A detector cannot recover content outside the source photo.'],
  2983:['similar artwork','Actual Top1 and the positive reference depict the same Rogue artwork. DEV metadata gives both card number146 and the same year/family in separate catalog entries; exact positive is rank2.','Possible duplicate/alias catalog entries, not a proven parallel distinction. No IDs or labels were remapped.'],
  2984:['similar artwork','Top1 depicts the same Scott-and-Jean beach artwork as the positive, but inside a wider background photograph. DEV metadata gives both card number147 in the same year/family; positive is rank3.','Possible duplicate/alias catalog entries, not a proven parallel. Query also contains hand/background.'],
  3056:['hand / background / obstruction','Target sits in a binder/photo containing part of another card and plastic borders/reflections. Top candidates emphasize slabs and multi-card/comic arrangements rather than the correct isolated figure.','Lighting and target framing are secondary; the positive reference itself visibly matches the target.'],
  3086:['hand / background / obstruction','Binder pocket, neighboring cards and room/chair background surround the target; query is visibly washed compared with the saturated isolated reference. Top candidates are other encased cards.','Lighting through plastic is secondary. Cannot prove whether scene removal alone would correct retrieval.'],
  3087:['hand / background / obstruction','Target is photographed within a binder page with adjacent cards and room background. Actual Top1 is an unrelated encased-card scene; Top2 and positive share the target artwork.','Secondary same-art catalog ambiguity: Top2 and positive have the same DEV card number56/year/family in separate entries.'],
  3090:['glare / lighting','Plastic/sleeve reflection and washed contrast obscure the dark-background figure relative to the clean positive. Nearby results are other reflective/encased card photographs with different artwork.','Visible background and mild perspective also remain. Visual observation cannot isolate a model-only deficit.'],
  3098:['hand / background / obstruction','Target is surrounded by overlapping neighboring cards and binder/photo borders. Top1 is a multi-image comic/card scene rather than the isolated target reference.','Target artwork matches the reference; clutter is the dominant observed mismatch, not a proven counterfactual explanation.'],
  3169:['hand / background / obstruction','Large illustrated mat/background surrounds the card above and below; the target occupies only part of the tall image. Top1 is another card with a wide surround, while the positive is tightly cropped.','Reduced effective target resolution is secondary. Card is still visibly readable, so not asserted to be intrinsically too small.'],
  3173:['glare / lighting','Strong white glare crosses the central blue figure and plastic-pocket reflections obscure much of the artwork. Nearby matches include reflective holders/slabbed cards rather than the clean positive.','Binder edges and color shift are secondary; severe glare is directly visible.'],
};
const perCase=raw.map(r=>{
 const c=crop.find(x=>x.scanId===r.scanId);
 assert.equal(c.detection.accepted,false);assert.equal(c.detection.corners.length,0);
 assert(c.rawFallback);assert.equal(hash(r.input),hash(c.input));assert.equal(c.rank,r.rank);
 const [primaryCause,observation,secondary]=notes[r.scanId];
 return{scanId:r.scanId,confirmedCardId:r.cardId,primaryCause,observation,secondary,
   assessment:'Evidence-based visual attribution; observed symptoms are verified, dominant causal contribution is not experimentally isolated.',
   historicalDinoRank:r.historicalRank,pairedIndexRawRank:r.rank,pairedIndexIsolatedOrFallbackRank:c.rank,
   actualRawTop1CardId:r.top10[0].cardId,actualRawTop10CardIds:r.top10.map(x=>x.cardId),
   visualComparison:'Query, exact positive and actual recomputed top4 references reviewed together before deletion.',
   detectorAccepted:false,detectorReason:c.detection.reason,manualFullCardDetection:false,
   manualFalseDetection:false,manualCropCutoff:false,
   manualReview:'Explicit abstention: no corners or rectified crop emitted. Original photograph and unchanged fallback reviewed; no proposed boundary to approve.',
 };
});
const counts=Object.fromEntries(['similar artwork','parallel / variant ambiguity','glare / lighting','perspective / rotation','card too small in frame','hand / background / obstruction','wrong or poor catalog reference','genuinely poor visual retrieval','other','cannot determine'].map(k=>[k,perCase.filter(c=>c.primaryCause===k).length]));
const metrics=rows=>({n:rows.length,top1:rows.filter(r=>r.rank===1).length,top3:rows.filter(r=>r.rank<=3).length,top10:rows.filter(r=>r.rank<=10).length});
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const report={
 title:'Executed twelve-scan visual failure audit and independent detector / DINO-only paired test',
 status:'completed',productionAccess:{selectCalls:1,scanRecords:12,exportedFields:['scan_id','image_url','confirmed_card_id'],accountData:false,otherProductionRecords:false,writes:0},
 sample:'Explicitly failure-selected12 scans; not representative recognition accuracy. No additional examples or query images.',
 primaryVisualCauseCounts:counts,
 causeInterpretation:'Ten cases have dominant visible acquisition/scene issues; two have same-art catalog-entry competition. These are reviewer attributions, not causal intervention proofs. Zero assigned pure model failures does not establish model adequacy. Exact parallel discrimination remains unmeasured.',
 index:{cardIds:p.refs.length,uniqueEmbeddings:p.vectors.length,previousCardIds:3046,
   provenance:p.indexDescription,
   differences:'3045 rather than3046 IDs: DEV snapshot lacks the reference URL for historical positive533958 (not one of these12). Old references are reused, added references come only from DEV snapshot. Same total-minus-one does NOT certify identical ID/digest sets. Eleven raw ranks reproduce exactly; scan3056 is401 versus historical400.',
   historicalRankMatches:perCase.filter(c=>c.historicalDinoRank===c.pairedIndexRawRank).length,
   allTwelvePositiveReferencesPresent:true,pairedSameIndex:true,fullOrPermanentIndexWrites:false},
 detector:{policy:freeze.marker.policyVersion,sourceSha256:freeze.sha256,frozenBeforeEvaluation:true,photoOnly:true,
   accepted:0,n:12,successfulFullCardDetections:0,successRate:0,abstentions:12,abstentionRate:1,
   falseDetections:0,falseDetectionRateAcrossAttempts:0,falseDetectionRateAmongAccepted:null,
   cropsCuttingContent:0,cropCutoffRateAmongAccepted:null,
   interpretation:'All12 abstained. Zero false detections/cutoffs is vacuous with no crops, not evidence of good cropping precision. No successful isolation generalization demonstrated.',
   reasonCounts:crop.reduce((o,c)=>{o[c.detection.reason]=(o[c.detection.reason]??0)+1;return o;},{}),
   padding:'Unchanged canonical DINO .rotate().resize(224,224,{fit:contain,background:#777777}); no stretching or new2:3 transform. Detector emitted no rectified input on these cases.',
 },
 recognition:{raw:metrics(raw),isolatedWithRawFallback:metrics(crop),acceptedCropSubgroup:{n:0,top1:null,top3:null,top10:null},rawFallbackBytesIdentical:true,rerankerUsed:false,materialImprovement:false},
 latency:{units:'ms',detectorSingleProcessPerImageMean:mean(crop.map(c=>c.detection.detectorMs)),
   detectorBatchMean:mean(timing[0].results.map(r=>r.detectorMs)),
   detectorRepeatedBatchMean:mean(timing[1].results.map(r=>r.detectorMs)),
   firstImageProcessingMs:timing[0].results[0].detectorMs,
   warmWithinRepeatedBatchMean:mean(timing[1].results.slice(1).map(r=>r.detectorMs)),
   batchWallMsIncludingInterpreter:timing.map(t=>t.wallMs),
   rawDinoFirstCaseColdMs:raw[0].times[0],rawDinoWarmRepeatMeanMs:mean(raw.map(r=>r.times[1])),
   fallbackDinoWarmRepeatMeanMs:mean(crop.map(r=>r.times[1])),
   scope:'Detector processing includes read/decode/detect/rectify, excludes crop write and interpreter/import startup. Each batch launches a fresh process; within-batch subsequent11 images are warm, not12 independent cold starts. DINO figures include embedding+exact in-memory search, exclude index loading/reference preparation; second inference per image is warm.'},
 perCase,
 conclusion:'Independent detector failed to emit any usable crops. Raw-fallback recognition is unchanged, not improved. Visible input-quality/scene mismatches and same-art catalog entries dominate this selected sample, but no successful isolation intervention exists to distinguish residual model weakness from input effects.',
 integrity:{model:p.model,modelSourceSha256:hash('server/services/catalogVisualModel.ts'),dinoUnchanged:true,
   baselineFilesUnchanged:baseline.files.length,historicalSourcesUnchanged:true,nothingPublished:true,noProductionBehaviorChange:true},
 cleanup:{status:'pending',retained:'Sanitized aggregate metrics, technical IDs/ranks, visual summaries and hashes only; no photographs, actual URLs, account data, vectors or source extraction.'},
};
const jp='attached_assets/dev-failure12-executed-results.json',hp='attached_assets/dev-failure12-executed-report.html';
function persist(){
 const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Executed12-case DINO audit</title><style>body{font:16px/1.5 system-ui;margin:auto;max-width:1150px;padding:28px}table{border-collapse:collapse}th,td{border:1px solid #aaa;padding:9px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.notice{background:#fff1ce;padding:20px}</style><h1>Executed12-case failure audit</h1><p class="notice">Actual photo review and paired DINO-only execution completed. Detector success0/12; abstention12/12. Raw and fallback both top1=0/12, top3=3/12, top10=6/12. No material improvement; no accepted crops.</p><p>${esc(report.causeInterpretation)}</p><h2>Visual cause counts</h2><pre>${esc(JSON.stringify(counts,null,2))}</pre><h2>Per-scan evidence</h2><table><tr><th>Scan / positive / actual top1</th><th>Raw / fallback rank</th><th>Primary cause and observed evidence</th></tr>${perCase.map(c=>`<tr><td>${c.scanId} / ${c.confirmedCardId} / ${c.actualRawTop1CardId}</td><td>${c.pairedIndexRawRank} / ${c.pairedIndexIsolatedOrFallbackRank}</td><td><b>${esc(c.primaryCause)}</b><br>${esc(c.observation)}<br>${esc(c.secondary)}</td></tr>`).join('')}</table><h2>Detector and latency</h2><p>No corners/crops emitted: no false detections or crop cutoffs, but accepted-crop precision is undefined. Mean batch detector processing${report.latency.detectorBatchMean.toFixed(2)}ms; repeated batch${report.latency.detectorRepeatedBatchMean.toFixed(2)}ms, launch excluded. Photos and candidate comparisons were visually reviewed before deletion.</p><h2>Limitations and cleanup</h2><p>${esc(report.index.differences)} This is a paired comparison on the same reconstructed bounded index, not a claim of exact historical index identity. Failure-selected sample only.</p><p>${esc(report.conclusion)}</p><p>Cleanup: ${esc(report.cleanup.status)}. DINO unchanged; production read-only; no reranker, tuning, full/permanent indexing or publication.</p><details><summary>Complete sanitized results</summary><pre>${esc(JSON.stringify(report,null,2))}</pre></details></html>`;
 for(const s of [html,JSON.stringify(report)])assert(!/https?:\/\/|data:image|<img\b/.test(s));
 fs.writeFileSync(jp,JSON.stringify(report,null,2),{mode:0o600});fs.writeFileSync(hp,html,{mode:0o600});
 assert.equal(read(jp).perCase.length,12);
}
persist();
let files=0,bytes=0;
function audit(dir){const st=fs.lstatSync(dir);assert(!st.isSymbolicLink());if(st.isDirectory()){assert.equal(st.mode&0o777,0o700);for(const f of fs.readdirSync(dir))audit(dir+'/'+f);}else{assert.equal(st.mode&0o777,0o600);files++;bytes+=st.size;}}
audit(root);fs.rmSync(root,{recursive:true});assert(!fs.existsSync(root));
for(const f of baseline.files)assert.equal(hash(f.path),f.sha256);
report.cleanup={...report.cleanup,status:'verified-deleted',removedFiles:files,removedBytes:bytes,workspaceExists:false};
persist();
console.log(JSON.stringify({counts,metrics:report.recognition,latency:report.latency,cleanup:report.cleanup},null,2));