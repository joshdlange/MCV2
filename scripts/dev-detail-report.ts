import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Pool } from 'pg';
const dir='.local/detail-experiment',bounded='.local/bounded-dino';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const [policy,runs,summary,stage1,crops,proposals,featureQA,unitQA,prior,frozen,manifest]=await Promise.all([
  ...['policy','runs','summary','stage1','crop-review','proposals','feature-qa','unit-qa'].map(p=>read(`${dir}/${p}.json`)),
  read('.local/image-experiment/snapshot.json'),read(`${bounded}/frozen-selection.json`),read(`${bounded}/manifest.json`)]);
assert.equal(hash(await fs.readFile('.local/scan-review/decisions.json')),prior.decisionsHash);
assert.equal(hash(await fs.readFile('scripts/dev-detail-vision.ts')),policy.visionSourceHash);
assert.equal(hash(await fs.readFile(`${bounded}/frozen-selection.json`)),policy.boundedSelectionHash);
assert.deepEqual(runs.map((r:any)=>r.scanId),frozen.eligible.map((c:any)=>c.scanId));
await fs.mkdir(`${dir}/cases`,{recursive:true});
for(const r of runs)await fs.writeFile(`${dir}/cases/${r.scanId}.json`,JSON.stringify({
  ...r,cropReview:crops.find((c:any)=>c.scanId===r.scanId),
  originalHash:frozen.eligible.find((c:any)=>c.scanId===r.scanId).imageHash,policyHash:hash(await fs.readFile(`${dir}/policy.json`)),
},null,2));
for(const c of frozen.eligible)assert.equal(hash(await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`)),c.imageHash);
for(const r of stage1)if(!r.cropAccepted){assert.equal(r.cropHash,r.imageHash);assert.deepEqual(r.rawVector,r.cropVector);}
for(const r of runs) {
  assert.deepEqual(r.A.top10.map((c:any)=>c.cardId).sort((a:number,b:number)=>a-b),r.B.top10.map((c:any)=>c.cardId).sort((a:number,b:number)=>a-b));
  const c=stage1.find((s:any)=>s.scanId===r.scanId);
  assert.deepEqual(c.crop.slice(0,10).map((c:any)=>c.cardId).sort((a:number,b:number)=>a-b),r.C.top10.map((c:any)=>c.cardId).sort((a:number,b:number)=>a-b));
}
if(process.env.NODE_ENV==='production')throw Error('DEV only');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await client.query('SELECT key,reference_url AS url,embedding,content_digest FROM catalog_visual_references WHERE key=ANY($1::text[]) ORDER BY key',[prior.refs.map((r:any)=>r.key)])).rows;
  assert.equal(hash(JSON.stringify(rows)),prior.referencesHash);
  await client.query('COMMIT');
}finally{client.release();await pool.end();}
const integrity={same9Cohort:true,sameFrozenBSelection:true,originalsUnchanged:9,decisionsUnchanged:true,permanent958ReferenceVectorsUnchanged:true,permanentReferenceHash:prior.referencesHash,
  primaryTop10MembershipPreserved:true,fallbackOriginalBytesAndFreshVectorsIdentical:8,policyHash:hash(await fs.readFile(`${dir}/policy.json`)),visionSourceHash:policy.visionSourceHash,
  boundedTemporaryVectorsHash:hash(await fs.readFile(`${bounded}/temporary-vectors.json`)),noMetadataOrOCR:true,noNewDependencies:true};
await fs.writeFile(`${dir}/integrity.json`,JSON.stringify(integrity,null,2));
const esc=(x:any)=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const n=(x:number)=>x.toFixed(2);
const img=async(p:string)=>'data:image/jpeg;base64,'+(await sharp(await fs.readFile(p)).rotate().resize({width:180,height:240,fit:'inside'}).jpeg({quality:75}).toBuffer()).toString('base64');
const imageBytes=async(b:Buffer)=>'data:image/jpeg;base64,'+(await sharp(b).resize({width:180,height:240,fit:'inside'}).jpeg({quality:75}).toBuffer()).toString('base64');
const rate=(s:any)=>[s.top1,s.top3,s.top10].map(x=>`${x}/${s.n} (${(100*x/s.n).toFixed(1)}%)`).join(' · ');
const mean=(key:string,rows=runs)=>rows.reduce((s:number,r:any)=>s+r.timing[key],0)/rows.length;
const ablations=Object.keys(runs[0].B.ablation).map(key=>({signal:key,Btop1:runs.filter((r:any)=>r.B.ablation[key][0]===r.cardId).length,Ctop1:runs.filter((r:any)=>r.C.ablation[key][0]===r.cardId).length}));
const descriptions:Record<number,string>={
  3032:'Base Black Widow now #1. Correct template NCC 0.834; holographic candidate alignment rejected (NCC0.458). Border/region and structure evidence promote base. This is one useful case, not proof of calibrated parallel identification.',
  3088:'Gold stays rank4; Rainbow remains #1, Silver #3. Gold/Rainbow/Silver alignments all fail the reliability gate. No contaminated color evidence is forced into those candidates; original DINO ordering remains. Needs better alignment/discrimination.',
  3093:'Iceman improves rank2→1. Correct aligned layout NCC0.655; Onslaught alignment0.436 is gated out. This fixes the narrow DINO-only loss.',
  3095:'Vulture remains stage1 rank15, outside the fixed top10; B/C cannot recover it. After-rerank rank is unavailable, not a claimed new full-index rank. Primary shortlist was NOT silently expanded to20.',
};
const rows=[];
for(const r of runs){
  const c=frozen.eligible.find((c:any)=>c.scanId===r.scanId),p=manifest.positives.find((p:any)=>p.scanId===r.scanId),crop=crops.find((c:any)=>c.scanId===r.scanId);
  const raw=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`),base=await sharp(raw).rotate().resize({width:240,height:240,fit:'inside'}).jpeg().toBuffer(),meta=await sharp(base).metadata();
  const top=r.B.top10[0],box=top.evidence.box;
  let aligned=base;
  if(box)aligned=await sharp(base).composite([{input:Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="${top.evidence.reliable?'lime':'orange'}" stroke-width="2"/></svg>`)}]).jpeg().toBuffer();
  await fs.writeFile(`${dir}/${r.scanId}-alignment.jpg`,aligned);
  const brief=(k:string)=>{const x=r[k],top=x.top10[0];return`<b>${x.rank??'Outside top10'}</b><br>Top #${top.cardId} ${esc(top.name)}<br><small>${k==='A'?'cosine':'score'} ${n(top.rerankScore??top.similarity)}</small>`;};
  const details=(k:string)=>`<ol>${r[k].top10.map((t:any)=>`<li>#${t.cardId} ${esc(t.name)}<br>DINO ${t.similarity.toFixed(6)}${t.rerankScore!=null?` · final ${t.rerankScore.toFixed(6)}<br>${t.evidence.reliable?'Detail enabled':'Detail abstained'} · NCC ${n(t.evidence.alignmentNCC??0)}${t.evidence.signals?`<br>${Object.entries(t.evidence.signals).map(([k,v]:any)=>`${k} ${n(v)}`).join(' · ')}`:''}`:''}</li>`).join('')}</ol>`;
  rows.push(`<tr><td><b>${r.scanId}</b><br>#${r.cardId} ${esc(p.name)}<br><small>${esc(p.set_name)}</small></td>
  <td><img src="${await img(`.local/scan-review/${c.originalPhotoFile}`)}"><br>Original</td>
  <td><img src="${await img(`${dir}/${r.scanId}-outline.jpg`)}"><br><b class="${crop.accepted?'ok':'warn'}">${crop.accepted?'Accepted':'Rejected / failed'}</b><details><summary>Visual crop QA</summary>${esc(crop.reason)}</details></td>
  <td><img src="${await img(crop.accepted?`${dir}/${r.scanId}-proposal.jpg`:`.local/scan-review/${c.originalPhotoFile}`)}"><br>${crop.accepted?'C uses crop':'C uses exact raw fallback'}</td>
  <td>${brief('A')}<details><summary>Top10 A</summary>${details('A')}</details></td>
  <td>${brief('B')}<details><summary>Top10 B + evidence</summary>${details('B')}</details></td>
  <td>${brief('C')}<br><small>C stage1 rank ${r.C.stage1Rank}</small><details><summary>Top10 C + evidence</summary>${details('C')}</details></td>
  <td>${esc(descriptions[r.scanId]??'Exact #1 retained.')}<br><small>B ${n(r.timing.BtotalMs)}ms · C ${n(r.timing.CtotalMs)}ms</small><details><summary>B top-candidate alignment</summary><img src="${await imageBytes(aligned)}"><p>${top.evidence.reliable?'Green: heuristic alignment gate passed; not semantic proof of correct card boundary.':'Orange: alignment rejected, no detail evidence used.'}</p></details></td></tr>`);
}
const selectedKnown=runs.filter((r:any)=>[3032,3088].includes(r.scanId));
const parallelA=selectedKnown.filter((r:any)=>r.A.rank===1).length,parallelB=selectedKnown.filter((r:any)=>r.B.rank===1).length;
const evidence={summary,policy,integrity,cropReview:crops,cropProposals:proposals,featureQA,unitQA,ablations,runs,
  limitations:['Nine-case development evaluation; no held-out validation; no trained/calibrated confidence','Hough did not improve safe crop success; six wrong proposals rejected by offline visual QA','Crop acceptance uses human QA, not a deployable automatic success detector','No OCR/text decoding; number/logo evidence limited to low-resolution placement/appearance','Stage2 top10 cannot recover Vulture at rank15','No optical model of angle-dependent foil/refraction; color measures affected by lighting','Mean opposing edges approximates aspect; no guarantee of exact physical proportions or semantic upright']};
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exact-card reranker and isolation experiment</title>
<style>body{font:15px/1.5 system-ui;background:#f2f4f8;color:#18233a;margin:0}main{max-width:1650px;margin:auto;padding:26px}h1{font-size:30px;margin-bottom:6px}h2{font-size:21px}.panel{padding:20px;margin:18px 0;background:white;border:1px solid #dce2eb;border-radius:12px}.metrics{display:flex;flex-wrap:wrap;gap:14px}.metrics>div{background:#edf2fb;padding:14px;border-radius:8px}.warn{color:#a25000}.ok{color:#236e4a}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #dce2eb;text-align:left;vertical-align:top}th{background:#eaf0f8}td img{width:120px;height:160px;object-fit:contain;background:#e0e4eb}small{color:#64718b}details{margin-top:8px}td details{max-width:280px}.scroll{overflow:auto}p{max-width:1160px}code{overflow-wrap:anywhere}ol{padding-left:18px}button{padding:10px 14px;background:#244370;color:white;border:0;border-radius:6px;margin-right:8px;cursor:pointer}</style><main>
<h1>Exact-card reranker: measured gain, isolation still unresolved</h1><p>Same9 verified original scans · same frozen TestB index (1023 catalog IDs / 823 unique byte vectors) · unchanged canonical DINO · no OCR, model/dependency changes or production integration.</p>
<button onclick="downloadJSON()">Download full results JSON</button><button onclick="downloadHTML()">Save self-contained HTML</button>
<section class="panel"><h2>Exact-card Top-1 improved from 5/9 to 7/9</h2><div class="metrics"><div><b>A · Original DINO only</b><br>${rate(summary.A)}<br><small>Top1 · Top3 · Top10</small></div><div><b>B · Original DINO + detail rerank</b><br>${rate(summary.B)}</div><div><b>C · QA-accepted crop / raw fallback + rerank</b><br>${rate(summary.C)}</div></div>
<p><b>Black Widow base is now chosen; Iceman improves to #1.</b> Random Gold remains behind Rainbow/Silver. Vulture stays outside the stage1 top10 at rank15, so this primary reranker cannot rescue it. No previously correct top1 became wrong in these nine cases. Two-stage candidate retrieval plus detail comparison is worth continuing as development work, <b>not ready for auto-acceptance or deployment</b>.</p>
<p>All nine cases remain in every denominator. Exact-card correctness means the confirmed catalog ID, not same artwork or character. On the two explicitly targeted parallel-failure cases (Black Widow and Random), exact-parallel Top1 is A ${parallelA}/2 → B/C ${parallelB}/2; that tiny subset does not establish a general parallel accuracy rate.</p></section>
<section class="panel"><h2 class="warn">Isolation: stronger proposals did not mean better card crops</h2><p>The partial-edge Hough extension considered rectangles with incomplete edges rather than demanding all four perfect edges. It produced <b>six invalid new proposals</b>: interior artwork lines, clipped names/borders, or binder-pocket rectangles. Two scans produced no candidate. The existing conservative contour path supplied the only valid crop, Electro3113: <b>1/9 visually accepted (11.1%)</b>, <b>no improvement over the prior method on this cohort</b>.</p>
<p>Every proposed crop was visually inspected before any evaluation scores. Six wrong proposals were rejected, two failed, and all eight use their <b>byte-identical raw images</b> in C. The first Hough-only visual-QA pass was archived; the existing conservative detector was retained ahead of Hough before inference. No retrieval-label tuning or score-based crop selection occurred. The reranker weights stayed fixed.</p>
<p><b>This is an offline human QA gate, not a proven automatic confidence system.</b> Geometry scores alone would have accepted bad crops. The experiment therefore cannot claim reliable automatic isolation. Existing manual crop remains necessary for these failures; no new manual UI was built. 180° semantic upright is unproven; perspective aspect is estimated from opposite edges and uniformly padded to2:3 rather than forced artwork stretch. Sleeve/hand/glare/hidden-edge reliability is not established.</p></section>
<section class="panel"><h2>Actual cases</h2><p>Ranks after reranking refer strictly to the same stage1 top10. “Outside top10” means the correct card cannot enter stage2, not a fabricated full-index rank. Green outline proposals are not automatically accepted: read the explicit visual QA status.</p><div class="scroll"><table><tr><th>Scan / correct card</th><th>Original</th><th>Proposed outline</th><th>C actual input</th><th>A rank</th><th>B rank</th><th>C rank</th><th>Outcome / timing</th></tr>${rows.join('')}</table></div></section>
<section class="panel"><h2>Stage2: fixed, label-free detail evidence</h2><p>Only each query's DINO top10 is evaluated. A coarse-to-fine 16×24 local spatial descriptor searches grayscale normalized cross-correlation across scale, translation and reference rotations0/90/180/270. Reliable alignment requires NCC≥0.48 and best-versus-coarse-runner-up gap≥0.012. Reference/query RGB regions are compared only after that gate. This is not a full invariant local-feature matcher; severe perspective, glare and low resolution defeat it.</p>
<p>Final score = <b>0.65×DINO cosine +0.35×detail</b>. Detail combines <b>35% border color, 25% spatial color regions, 25% edge/layout and 15% luminance structure</b>. If alignment fails, detail contribution equals the DINO score, preserving that candidate's original score instead of injecting unaligned color. Scores are <b>not probabilities</b>. No OCR, decoded card number, character identity, year/set/number metadata, paid model or external AI call is used.</p>
<p>Candidate-specific scores can still be affected by mismatched lighting, background and spurious alignment; an NCC gate is not proof of semantic correspondence. Numeric thresholds/weights were frozen before label scoring and used identically on every case, with no per-card exceptions. Reference features are cached; originals/catalog references are never overwritten.</p>
<h2>Feature ablation — diagnostic, not used to retune</h2><table><tr><th>DINO + one detail signal (same0.65/0.35 mix and gate)</th><th>B Top1</th><th>C Top1</th></tr>${ablations.map((a:any)=>`<tr><td>${esc(a.signal)}</td><td>${a.Btop1}/9</td><td>${a.Ctop1}/9</td></tr>`).join('')}</table><p>Border color, regional color and luminance structure each reached7/9 in this small sample; edge-only reached5/9. This supports investigating alignment plus color/structure, but <b>does not establish one uniquely useful causal signal</b>: alignment reliability/gating is shared by all ablations. The combined weights were not revised after seeing these results.</p></section>
<section class="panel"><h2>Known failure outcomes</h2><ul><li><b>Black Widow3032:</b> correct base2→1; holographic candidate fails alignment gate. Strong matching grayscale layout and color evidence favors base.</li><li><b>Random3088:</b> Gold4→4; Rainbow #1 and Silver #3 unchanged. All three relevant alignments are weak, so no unreliable border/foil comparison is applied. Need improved alignment and finish evidence.</li><li><b>Iceman3093:</b> 2→1. Layout alignment promotes the correct Iceman above narrowly winning Onslaught.</li><li><b>Vulture3095:</b> stage1 rank15, never enters the fixed primary10. No top20 result has been substituted; shortlist recall, not stage2 selection, is the immediate blocker.</li></ul></section>
<section class="panel"><h2>Latency — reference preparation separated from warm query path</h2><table><tr><th>Measured operation</th><th>Milliseconds</th></tr>
<tr><td>First original DINO embedding, including cold model initialization</td><td>${n(summary.firstColdRawEmbeddingMs)}</td></tr>
<tr><td>Warm original DINO embeddings (remaining8)</td><td>${n(summary.warmRawEmbeddingMs)}</td></tr>
<tr><td>Mean crop/fallback DINO embedding (model already warm)</td><td>${n(summary.meanTiming.cropEmbeddingMs)}</td></tr>
<tr><td>Mean exact search: raw / C</td><td>${n(summary.meanTiming.rawSearchMs)} / ${n(summary.meanTiming.cropSearchMs)}</td></tr>
<tr><td>Mean query feature extraction: B / C</td><td>${n(summary.meanTiming.rawFeatureMs)} / ${n(summary.meanTiming.cropFeatureMs)}</td></tr>
<tr><td>Mean cached-reference stage2 top10: B / C</td><td>${n(runs.reduce((s:number,r:any)=>s+r.B.ms,0)/9)} / ${n(runs.reduce((s:number,r:any)=>s+r.C.ms,0)/9)}</td></tr>
<tr><td>Mean attempted isolation (includes rejected proposals)</td><td>${n(summary.meanTiming.cropMs)}</td></tr>
<tr><td>B measured total, including one cold query / warm mean remaining8</td><td>${n(summary.meanTiming.BtotalMs)} / ${n(mean('BtotalMs',runs.slice(1)))}</td></tr>
<tr><td>C mean total, model already warm</td><td>${n(summary.meanTiming.CtotalMs)}</td></tr>
<tr><td>One-time reference descriptor compute for64 unique referenced images (accumulated across4 preparation workers)</td><td>${n(summary.referenceFeatureComputeMs)}</td></tr></table>
<p>Cached stage2 is well under1second for top10 in this run. B: ${runs.filter((r:any)=>r.timing.BtotalMs<1000).length}/9 under1second; cold first query exceeds3seconds. C: ${runs.filter((r:any)=>r.timing.CtotalMs<1000).length}/9 under1second,9/9 under2seconds. C was run with an already-warm model, so do not compare its startup to B's cold first call. Network reference fetch, disk writes, database reads, offline visual QA, and report generation are excluded from query totals. This is CPU experiment timing, not a production SLA. The cached-reference workload included diagnostic ablations;64 reference feature preparations had0 errors.</p>
<p>C's 894ms mean includes attempted geometry but <b>does not price a human's manual-crop or visual-QA time</b>. Therefore it is not evidence of an end-to-end autonomous card-isolation product under1–3seconds. The reliable result here is a fast cached reranker with two additional exact top1 successes.</p></section>
<section class="panel"><h2>QA, limits and next conclusion</h2><p>Uniform-image geometry failure preserves exact raw bytes; blank image detail matching abstains; synthetic identical-image detail comparison passes. All9 original hashes and manual decisions are unchanged. All8 raw fallbacks produce identical fresh DINO embeddings across B/C paths. Stage2 preserves exact top10 candidate membership. Frozen B remains1023 IDs/823 vectors, including every original958 ID. A fresh read-only DEV verification confirms the original958 permanent vector/reference rows still hash to <code>${prior.referencesHash}</code>. Policy hash: <code>${integrity.policyHash}</code>.</p>
<p><b>Continue the two-stage development approach, but do not deploy this prototype.</b> Validate on independent held-out cases; improve actual card alignment before trusting finish-sensitive color; investigate shortlist recall for Vulture separately. Isolation remains an unresolved failure, not a delivered improvement. No labels were changed and no additional labels were requested.</p>
<p>No production access, permanent indexing, full indexing, model changes, new dependencies, schema/catalog/image changes, Cloudinary writes, collection updates, publishing or app/UI edits. Explicit collector confirmation and existing manual crop are preserved; full indexing remains paused.</p></section>
<script id="evidence" type="application/json">${JSON.stringify(evidence).replace(/</g,'\\u003c')}</script><script>function saveBlob(b,n){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function downloadJSON(){saveBlob(new Blob([JSON.stringify(JSON.parse(document.getElementById('evidence').textContent),null,2)],{type:'application/json'}),'detail-reranker-results.json')}function downloadHTML(){saveBlob(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}),'detail-reranker-report.html')}</script></main></html>`;
await fs.writeFile('attached_assets/detail-reranker-report.html',html);
console.log('REPORT attached_assets/detail-reranker-report.html',Buffer.byteLength(html),'bytes',integrity);