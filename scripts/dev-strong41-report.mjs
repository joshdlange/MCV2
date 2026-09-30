import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.argv[2];assert(/^\/tmp\/mcv-strong41-[A-Za-z0-9]+$/.test(root));
const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const p=read(root+'/prepared.json'),d=read(root+'/detections.json'),qa=read(root+'/qa.json'),r=read(root+'/recognition.json'),freeze=read(root+'/freeze.json'),dev=read(root+'/dev-relationship.json');
const referenceDigests=new Set(p.refs.map(x=>x.digest));
for(const c of p.cases)assert(!referenceDigests.has(hash(c.file)),'Query/reference byte leakage');
assert.equal(qa.length,41);assert.equal(r.length,41);
const baseline=read('.local/broad-validation/baseline-freeze.json');
for(const f of baseline.files)assert.equal(hash(f.path),f.sha256);
const old=read('.local/broad-validation/readonly-production-sanitized-evidence.json');
for(const [f,h]of Object.entries({...old.sourceHashes,...old.runSourceHashes}))assert.equal(hash(f),h);
assert.equal(hash('scripts/dev-segment-card-detector.py'),freeze.detectorHash);
assert.equal(hash('scripts/dev-segment-card-detector.config.json'),freeze.configHash);
assert.equal(hash('.local/strong-card-model/sam_vit_b_01ec64.pth'),freeze.weightsHash);
const metrics=(rows,arm)=>({n:rows.length,top1:rows.filter(x=>x[arm].rank===1).length,top3:rows.filter(x=>x[arm].rank&&x[arm].rank<=3).length,top10:rows.filter(x=>x[arm].rank&&x[arm].rank<=10).length});
const comparison=rows=>({raw:metrics(rows,'raw'),isolated:metrics(rows,'isolated'),
 improved:rows.filter(x=>x.isolated.rank&&x.raw.rank&&x.isolated.rank<x.raw.rank).length,
 unchanged:rows.filter(x=>x.isolated.rank===x.raw.rank).length,
 worsened:rows.filter(x=>x.isolated.rank&&x.raw.rank&&x.isolated.rank>x.raw.rank).length,
 top1Gains:rows.filter(x=>x.isolated.rank===1&&x.raw.rank!==1).length,
 top1Losses:rows.filter(x=>x.raw.rank===1&&x.isolated.rank!==1).length});
const detection=rows=>({n:rows.length,fullCard:rows.filter(x=>x.fullCard).length,fullCardRate:rows.filter(x=>x.fullCard).length/rows.length,abstentions:rows.filter(x=>!x.accepted).length,
 falseDetections:rows.filter(x=>x.falseDetection).length,cutoffs:rows.filter(x=>x.cutoff).length,
 unsafeEmittedCrops:rows.filter(x=>x.accepted&&!x.fullCard).length,
 goodCorners:rows.filter(x=>x.cornerQuality==='good').length,approximateCorners:rows.filter(x=>x.cornerQuality==='approximate').length});
const covered=r.filter(x=>!p.missing.some(m=>m.scanId===x.scanId));
const emitted=covered.filter(x=>x.accepted),valid=emitted.filter(x=>qa.find(q=>q.scanId===x.scanId).fullCard);
const report={
 title:'Executed learned photo-only isolation / frozen DINO experiment',
 sample:{photos:41,independentlyReverifiedPositiveFronts:40,missingPositiveReferences:p.missing,
   selection:'Reused prior41 verified fronts including29 prior DINO successes and12 failures; bounded convenience sample, not population representative. Scan2939 has no currently available independent positive reference in DEV and is excluded from covered recognition metrics, not from detector evaluation.'},
 production:{selectAttempts:2,firstAttempt:'tool server disconnected; no returned records',successfulExports:1,exportedRows:41,fields:['scan_id','image_url','confirmed_card_id'],accountData:false,writes:0},
 detector:{freeze,overall:detection(qa),byStratum:Object.fromEntries(['clean/simple','background/hand','glare','binder/neighbors','sleeve/toploader','rotation/perspective'].map(t=>[t,detection(qa.filter(q=>q.strata.includes(t)))])),
   byDifficulty:Object.fromEntries(['easy','moderate','difficult'].map(t=>[t,detection(qa.filter(q=>q.difficulty===t))])),
   strataNote:'Visually assigned overlapping scene labels; denominators are per stratum and cannot be summed. QA compared query and emitted crop before DINO, without feeding labels/references to detector.',
   latency:{modelInitializationMsTotal:d.modelInitializationMs,completedBatchCount:d.batchCount,meanModelInitializationMs:d.modelInitializationMs/d.batchCount,batchProcessWallMsTotal:d.processWallMs,meanDetectorMs:d.results.reduce((s,x)=>s+x.detectorMs,0)/41,scope:'Detection includes read/decode, learned mask inference, mask selection and rectification; excludes crop disk writes and model initialization. Summed process wall excludes interpreter startup. Eleven serial batches of at most4 photos, required by tool process lifetime limits, with unchanged frozen settings. Background launch attempts did not survive the tool session and yielded no retained results. One completed frozen pass across41 photos, not a warm-repeated latency benchmark.'},
   safetyDefinitions:'False detection means wrong object/internal panel/pocket/slab rather than the physical card. Cutoff is counted separately even for correct-object detection. One unsafe emitted crop trims a thin top-right artwork band; no claim of zero unsafe cropping.',
   cornerQuality:'Human approximate visual inspection, not ground-truth annotated corner pixel error. False detections and cutoffs may overlap; no QA failures hidden.'},
 index:{ids:p.refs.length,embeddings:p.vectors.length,hash:p.indexHash,queryReferenceByteCollisions:0,description:'3045 bounded index reconstructed by same recipe as prior12-case experiment; cannot certify byte-identical to deleted3046 historical index. Positive533958 unavailable; no full/permanent writes. Both arms share one frozen index.'},
 recognition:{allEmittedCropsWithAvailablePositive:comparison(emitted),qaValidCrops:comparison(valid),allCoveredWithAbstentionFallback:comparison(covered),all41IncludingMissingReference:comparison(r),
   definition:'Rank improvement means smaller exact-card rank, unchanged means equal, worsened means larger. Top1 gains/losses separately counted. Every emitted crop is evaluated, even manually judged false or clipped. Missing-reference null ranks are not counted as successes.'},
 catalogRelationships:[
   {scanId:2983,ids:[20279,530526],classification:'apparent duplicate base-card records; not proven formal aliases',evidence:'Same Rogue artwork, card number146, year1995, main family480, null variation. Both active non-insert canonical base sets;7292 source csv_master versus12179 auto_base_creation. No matching DEV migration mapping. No evidence here of alternate printing or parallel.'},
   {scanId:2984,ids:[20280,530527],classification:'apparent duplicate base-card records; not proven formal aliases',evidence:'Same Scott-and-Jean artwork, number147, year1995, main family480, null variation. Same two active base-set records and sources. Candidate photograph has different framing, not demonstrated print difference. No matching DEV migration mapping.'},
 ],
 perCase:r.map(x=>({...x,qa:qa.find(q=>q.scanId===x.scanId)})),
 integrity:{baselineUnchanged:baseline.files.length,dinoUnchanged:true,model:p.model,modelHash:hash('server/services/catalogVisualModel.ts'),reranker:false,tuning:false,published:false,catalogWrites:false},
 conclusion:'No demonstrated material recognition improvement: one crop fixes an exact top1 miss, one previously correct result regresses, and most photographs abstain. Learned segmentation yields some usable physical-card crops but this frozen acceptance policy still fails on all reviewed hand/clutter and binder cases. Do not infer readiness from the small emitted-crop subgroup.',
 limitations:['Convenience sample with repeated card families, not population accuracy.','Reviewer detection judgments are approximate and unblinded to appearance, but recorded before recognition.','Catalog duplicate evidence suggests redundant entries, not authority to merge records.','All accepted bad crops retained in primary emitted-crop comparison.'],
 cleanup:{status:'pending'},
};
const paths=['attached_assets/dev-strong41-results.json','attached_assets/dev-strong41-report.html'];
function persist(){const s=JSON.stringify(report,null,2);assert(!/https?:\/\/|data:image|<img\b/.test(s));const escape=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));fs.writeFileSync(paths[0],s,{mode:0o600});fs.writeFileSync(paths[1],`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Learned isolation experiment</title><style>body{font:16px/1.5 system-ui;max-width:1150px;margin:auto;padding:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{border:1px solid #bbb;padding:10px}table{border-collapse:collapse}</style><h1>Executed learned card-isolation experiment</h1><p>41 real photographs;40 currently covered exact positives. Independent photo-only detector frozen before testing; DINO unchanged; no reranker.</p><h2>Detector results</h2><pre>${escape(JSON.stringify(report.detector,null,2))}</pre><h2>Paired DINO results</h2><pre>${escape(JSON.stringify(report.recognition,null,2))}</pre><h2>Same-art catalog investigation</h2><pre>${escape(JSON.stringify(report.catalogRelationships,null,2))}</pre><h2>Per-case outcomes</h2><table><tr><th>Scan</th><th>Raw / isolated rank</th><th>Manual detector QA</th></tr>${report.perCase.map(c=>`<tr><td>${c.scanId}</td><td>${c.raw.rank??'missing reference'} / ${c.isolated.rank??'missing reference'}</td><td>${escape(c.qa.notes)}</td></tr>`).join('')}</table><h2>Cleanup</h2><p>${report.cleanup.status}</p><details><summary>Complete sanitized evidence</summary><pre>${escape(s)}</pre></details></html>`,{mode:0o600});assert.equal(read(paths[0]).perCase.length,41);}
persist();
let files=0,bytes=0;
function audit(p){const s=fs.lstatSync(p);assert(!s.isSymbolicLink());assert.equal(s.mode&0o777,s.isDirectory()?0o700:0o600);if(s.isDirectory())for(const n of fs.readdirSync(p))audit(p+'/'+n);else{files++;bytes+=s.size;}}
audit(root);fs.rmSync(root,{recursive:true});assert(!fs.existsSync(root));for(const f of baseline.files)assert.equal(hash(f.path),f.sha256);
report.cleanup={status:'verified-deleted',removedFiles:files,removedBytes:bytes,privateWorkspaceExists:false};persist();
console.log(JSON.stringify({detection:report.detector,recognition:report.recognition,cleanup:report.cleanup},null,2));