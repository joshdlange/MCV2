import fs from 'node:fs/promises';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
const dir='.local/parallel-focus';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const [runs,summary,queries,policy,freeze,colors,fix,frozen,manifest,prior]=await Promise.all([
  ...['runs','summary','queries','policy','baseline-freeze','color-evidence','implementation-fix'].map(p=>read(`${dir}/${p}.json`)),
  read('.local/bounded-dino/frozen-selection.json'),read('.local/bounded-dino/manifest.json'),read('.local/image-experiment/snapshot.json')]);
for(const f of freeze.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Baseline changed: ${f.path}`);
assert.equal(hash(await fs.readFile(`${dir}/policy.json`)),summary.policyHash);
for(const [p,h] of Object.entries(fix.currentSourceHashes))assert.equal(hash(await fs.readFile(p)),h);
assert.equal(runs.length,72);
for(const r of runs){
  const q=queries.find((q:any)=>q.scanId===r.scanId&&q.input===r.input);
  assert.deepEqual(r.ranked.map((x:any)=>x.cardId).sort((a:number,b:number)=>a-b),q.top20.slice(0,r.k).map((x:any)=>x.cardId).sort((a:number,b:number)=>a-b));
  for(const c of r.ranked){
    assert.ok(Math.abs(c.color.adjustment)<=policy.parallelSignal.maximumAdjustment+1e-10);
    if(!c.color.reliable)assert.equal(c.color.adjustment,0);
    assert.ok(Number.isFinite(c.score));
  }
}
for(const c of frozen.eligible){
  const pair=queries.filter((q:any)=>q.scanId===c.scanId);
  if(!pair[1].acceptedCrop){assert.equal(pair[0].inputHash,pair[1].inputHash);assert.deepEqual(pair[0].vector,pair[1].vector);}
  const preserved=JSON.parse((await fs.readFile('attached_assets/detail-reranker-report.html','utf8')).match(/<script id="evidence" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  assert.equal(runs.find((r:any)=>r.scanId===c.scanId&&r.arm==='raw-10-base').rank,preserved.runs.find((r:any)=>r.scanId===c.scanId).B.rank);
}
if(process.env.NODE_ENV==='production')throw Error('DEV only');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await client.query('SELECT key,reference_url AS url,embedding,content_digest FROM catalog_visual_references WHERE key=ANY($1::text[]) ORDER BY key',[prior.refs.map((r:any)=>r.key)])).rows;
  assert.equal(hash(JSON.stringify(rows)),prior.referencesHash);
  await client.query('COMMIT');
}finally{client.release();await pool.end();}
const integrity={baselineFilesFrozenAndUnchanged:freeze.files.length,baselineBytesFrozen:freeze.files.reduce((s:number,f:any)=>s+f.bytes,0),
  same9:true,same1023Ids823Vectors:true,permanent958RowsUnchanged:true,permanentReferenceHash:prior.referencesHash,
  originalModelAndRerankerUnchanged:true,baselineTop10RankScoresReproduced:true,all72ArmsCandidateMembershipVerified:true,
  fourFallbackByteAndVectorEqual:true,allColorAdjustmentsBoundedAndUnreliableAbstain:true,policyHash:summary.policyHash,
  implementationOnlyEmptyInlierGuardFix:true,thresholdOrWeightRetuning:false};
await fs.writeFile(`${dir}/integrity.json`,JSON.stringify(integrity,null,2));
const arms=summary.summaries.map((s:any)=>s.arm);
const row=(id:number,arm:string)=>runs.find((r:any)=>r.scanId===id&&r.arm===arm);
const esc=(x:any)=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const n=(x:number,d=5)=>x.toFixed(d);
const pct=(x:number)=>`${x}/9 (${(100*x/9).toFixed(1)}%)`;
const img=async(path:string)=>'data:image/jpeg;base64,'+(await sharp(await fs.readFile(path)).rotate().resize({width:165,height:220,fit:'inside'}).jpeg({quality:74}).toBuffer()).toString('base64');
const explanations:Record<number,string>={
  3032:'Black Widow remains exact#1 in all8 arms. Raw chroma increases the correct score and margin; no added win because the baseline already solved it.',
  3077:'Captain America stays#1, but raw chroma narrows the lead from0.05472 to0.02399. The signal penalizes a true match; it crosses the descriptive ambiguity threshold.',
  3088:'Random Gold raw4→2 with chroma, but Rainbow remains#1. Gold/Silver receive distributed-alignment color evidence; Rainbow does not. Cropped Gold stays#2; color signal abstains on all cropped candidates.',
  3093:'REGRESSION: Iceman raw1→2; wrong Onslaught wins after the true match receives a−0.01762 chroma adjustment. Existing lead was only0.01163. Cropped result remains correct#1.',
  3095:'Top20 admits Vulture (raw DINO15) but it finishes12, still outside Top10. Its own score is unchanged; three higher-DINO IDs sharing one reference are demoted below it by the existing reranker.',
  3110:'Magneto remains#1. Frozen crop branch is exact raw fallback; new signal abstains. Margin0.01958 stays ambiguous in every arm.',
  3113:'Electro remains#1. Raw chroma reduces the lead0.11541→0.07332 without changing the winner. Crop branch stays unchanged.',
  3126:'Phoenix remains#1. Frozen crop fallback and unverified slab boundaries cause no new color evidence; preserved result.',
  3127:'Phoenix remains#1. Frozen crop is raw fallback; projected bounds fail the new signal gate; preserved result.',
};
const rows=[];
await fs.mkdir(`${dir}/cases`,{recursive:true});
for(const c of frozen.eligible){
  const p=manifest.positives.find((p:any)=>p.scanId===c.scanId),qs=queries.filter((q:any)=>q.scanId===c.scanId);
  const caseRuns=runs.filter((r:any)=>r.scanId===c.scanId);
  await fs.writeFile(`${dir}/cases/${c.scanId}.json`,JSON.stringify({scanId:c.scanId,cardId:c.cardId,runs:caseRuns},null,2));
  rows.push(`<tr><td><b>${c.scanId}</b><br>#${c.cardId} ${esc(p.name)}<br><small>${esc(explanations[c.scanId])}</small></td><td><img src="${await img(qs[0].sourcePath)}"><br>Original</td><td><img src="${await img(qs[1].sourcePath)}"><br>${qs[1].acceptedCrop?'Frozen accepted crop':'Exact raw fallback'}</td>${arms.map((arm:string)=>{
    const r=row(c.scanId,arm);
    return`<td><b>Rank ${r.rank??`outside${r.k}`}</b><br>#${r.ranked[0].cardId} wins<br><small>top ${n(r.ranked[0].score)}<br>correct ${r.correctScore==null?'out of pool':n(r.correctScore)}<br>top1–2 margin ${n(r.topMargin)}<br>${r.ambiguous?'AMBIGUOUS':'Above heuristic margin'}</small><details><summary>All${r.k} scores</summary><ol>${r.ranked.map((x:any)=>`<li>#${x.cardId} ${esc(x.name)}<br>DINO ${n(x.similarity)} · base ${n(x.baseScore)}<br>color Δ ${n(x.color.adjustment)} · final ${n(x.score)}<br><small>${esc(x.color.reliable?`Color enabled: chroma distance ${n(x.color.medianChromaDelta,2)}`:x.color.reason)}</small></li>`).join('')}</ol></details></td>`;
  }).join('')}</tr>`);
}
const randomRows=[];
for(const input of ['raw','crop'])for(const method of ['base','chroma']){
  const r=row(3088,`${input}-20-${method}`);
  for(const [id,name] of [[20611,'Gold'],[20602,'Rainbow'],[336818,'Silver']] as const){
    const c=r.ranked.find((c:any)=>c.cardId===id);
    randomRows.push(`<tr><td>${input} / ${method}</td><td>${name} #${id}</td><td>${r.ranked.indexOf(c)+1}</td><td>${n(c.similarity)}</td><td>${n(c.baseScore)}</td><td>${n(method==='chroma'?c.color.adjustment:0)}</td><td>${n(c.score)}</td><td>${esc(c.color.reliable?`Enabled; peripheral chroma distance ${n(c.color.medianChromaDelta,2)}, similarity ${n(c.color.similarity,3)}`:c.color.reason)}</td></tr>`);
  }
}
const mean=(values:number[])=>values.reduce((s,x)=>s+x,0)/values.length;
const timings=['raw','crop'].map(input=>{
  const qs=queries.filter((q:any)=>q.input===input),ten=runs.filter((r:any)=>r.input===input&&r.k===10&&r.method==='base'),twenty=runs.filter((r:any)=>r.input===input&&r.k===20&&r.method==='base');
  return{input,embeddingMeanMs:mean(qs.map((q:any)=>q.embeddingMs)),warmEmbeddingMeanMs:mean(qs.filter((q:any)=>!(q.scanId===3032&&input==='raw')).map((q:any)=>q.embeddingMs)),
    base10Ms:mean(ten.map((r:any)=>r.timing.baseRerankMs)),base20Ms:mean(twenty.map((r:any)=>r.timing.baseRerankMs)),
    chroma20Ms:mean(colors.rows.filter((r:any)=>r.input===input).map((r:any)=>r.ms))};
});
const comparisonDiffs=[];
for(const c of frozen.eligible)for(const input of ['raw','crop'])for(const k of [10,20]){
  const b=row(c.scanId,`${input}-${k}-base`),p=row(c.scanId,`${input}-${k}-chroma`);
  if(b.rank!==p.rank)comparisonDiffs.push({scanId:c.scanId,input,k,before:b.rank,after:p.rank,correctBefore:b.correctScore,correctAfter:p.correctScore});
}
const evidence={summary,policy,integrity,timings,comparisonDiffs,baselineFreeze:freeze,colorQA:colors.unitQA,colorEvidence:colors,implementationFix:fix,runs,
  limitations:['Nine repeatedly inspected development cases, not held-out validation','Top20 increases candidate coverage, not observed Top1/3/10 accuracy','New chroma regresses raw Iceman and does not solve Gold/Rainbow','New signal abstains on all cropped-input candidates; no cropped discriminator improvement established','Previously verified34 reference extents only; arbitrary catalog slabs/margins unsupported','Margins and bounded residual scores are not probabilities','Frozen crops reused: these timings do not measure fresh detection or interactive optional-crop workflow']};
await fs.writeFile('attached_assets/focused-breadth-parallel-results.json',JSON.stringify(evidence,null,2));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Focused top10/top20 and parallel discrimination experiment</title><style>body{font:15px/1.5 system-ui;background:#f2f5fa;color:#17243b;margin:0}main{max-width:1700px;margin:auto;padding:25px}h1{font-size:29px}h2{font-size:21px}.panel{background:white;border:1px solid #dce3ed;border-radius:12px;padding:20px;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px;border-bottom:1px solid #dce3ed;text-align:left;vertical-align:top}th{background:#eaf0fa}.scroll{overflow:auto}td img{width:125px;height:165px;object-fit:contain;background:#ddd}small{color:#607087}details{min-width:145px;max-width:260px;margin-top:8px}ol{padding-left:18px}p{max-width:1200px}.warn{color:#a24600}button{background:#244370;color:white;padding:10px 14px;border:0;border-radius:6px;margin-right:8px;cursor:pointer}code{overflow-wrap:anywhere}</style><main>
<h1>Top20 adds coverage, not wins; new chroma signal regresses one case</h1><p>Completed fixed-policy factorial experiment: same9 verified scans · same frozen1023-ID /823-vector TestB · fresh raw and optional frozen-crop query embeddings · eight arms · all prior artifacts preserved.</p><button onclick="downloadJSON()">Download complete results JSON</button><button onclick="downloadHTML()">Save self-contained report</button>
<section class="panel"><h2>Actual results: breadth isolated from discriminator change</h2><table><tr><th>Arm</th><th>Exact Top1</th><th>Top3</th><th>Top10</th><th>Correct ID in evaluated pool</th><th>Top1–2 margin&lt;0.03</th></tr>${summary.summaries.map((s:any)=>`<tr><td><b>${s.arm}</b></td><td>${pct(s.top1)}</td><td>${pct(s.top3)}</td><td>${pct(s.top10)}</td><td>${s.inPool}/9</td><td>${s.ambiguous}/9</td></tr>`).join('')}</table>
<p><b>Breadth-only:</b> increasing10→20 admits Vulture, raising candidate coverage8/9→9/9, but Top1/3/10 accuracy does not improve in either input branch. <b>Discriminator-only:</b> new raw chroma improves Random Gold4→2 but regresses Iceman1→2, taking Top1 from7/9 to6/9. Top3 becomes8/9. Cropped-input scores are unchanged because the new signal abstains for every candidate there.</p>
<p><b>Best retained outcome remains frozen optional cropping + unchanged reranker:7/9 Top1,8/9 Top3,8/9 Top10.</b> This matches the preserved prior ORB report. New raw color is not an improvement suitable for adoption. All9 remain in every denominator; no best-arm selection per case is reported as a deployable system.</p></section>
<section class="panel"><h2>Frozen design, no retrospective tuning</h2><p>Before inference,432 existing baseline files totaling214,241,316bytes were SHA-256 frozen: previous reports/results, ORB crop assets, policies/scripts, bounded index and originals/manual decisions. Every hash matched again after the experiment. Original A/B/C/C2 files were never overwritten. All18 raw/crop embeddings were freshly computed with the unchanged canonical model, and previous top10 base rankings/scores were reproduced.</p>
<p>For each input, one fresh full-index search supplies exact top10 and top20 pools. The original fixed detail score is unchanged:0.65DINO+0.35detail, with original alignment abstention. Each pool is separately evaluated with that score and with ONE new generic signal. No correct-card labels, card IDs, metadata or rank bonuses enter the signal. Labels are used only to score outcomes.</p>
<p>The optional crop branch reuses exactly the prior5 automatically accepted ORB crops and4 raw fallbacks. No new crop proposals, corner edits, manual acceptance overrides or reference-extent annotations were made. Crop files themselves are hash-frozen. Existing residual background margins remain.</p>
<h2>One added signal: robust peripheral chroma correspondence</h2><p>ORB/RANSAC first aligns each reference independently to the query. It uses only the prior34 verified complete-face reference extents; other references abstain. At least20 inliers,50% inlier ratio,25% reference hull coverage,50% span in each axis, low reprojection error and convex fully in-bounds projected corners are required. No alignment means zero added adjustment.</p>
<p>After warping query pixels into reference coordinates, compare the16 peripheral cells of a4×6 grid inside a5% edge guard. Intersect low-gradient pixels, exclude bright low-chroma/clipped highlights and deep shadows, then compare median Lab a/b chroma in each usable cell. At least6 cells must survive. Cell-distance median resists isolated glare/print outliers. <b>New score = original score +0.08×(2×exp(−median chroma distance/25)−1)</b>; unreliable evidence adds0. Parameters were frozen once before evaluation and not adjusted after seeing any outcome.</p>
<p class="warn">This is chromatic correspondence, NOT an angle-invariant foil model. Camera color balance, printing and residual framing can still alter chroma. Scores/margins are heuristics, not probabilities. Glare filtering can also remove useful finish evidence. Mixed evidence availability can penalize a matched true card while leaving an unverified distractor untouched; that exact failure occurs below.</p>
<p>One implementation-only repair was necessary: an empty RANSAC inlier set reached OpenCV convexHull/contourArea. The already specified minimum20-inlier gate was moved before that operation. The initial policy remains intact; an implementation-fix record preserves original/final source hashes. Previously fresh embeddings were resumed; no thresholds, weights, references or crops were changed.</p></section>
<section class="panel"><h2>All9 cases: ranks, winners, scores and margins for every arm</h2><p>“Outside10” means not available to that reranker. Top20 ranks are ranks within the explicitly evaluated20. A margin below0.03 is an uncalibrated ambiguity flag, not a promised confidence/rejection threshold. Above0.03 does not prove correctness (Random Rainbow still wins incorrectly).</p><div class="scroll"><table><tr><th>Case / evidence</th><th>Raw</th><th>Optional input</th>${arms.map((a:string)=>`<th>${a}</th>`).join('')}</tr>${rows.join('')}</table></div></section>
<section class="panel"><h2>Random: Gold vs Rainbow vs Silver</h2><p>Shown with top20; top10 yields the same ranks and scores for these three. The new raw signal sees a smaller median chroma discrepancy for Gold11.67 than Silver19.56. Gold gains0.02031; Silver loses0.00682. Gold moves4→2, but Rainbow's unmodified0.78627 still beats Gold0.72666 by0.05961. Rainbow ORB inlier hull covers only9.33% of its reference, below the frozen25% requirement, so untrustworthy border color is not forced into its score.</p><div class="scroll"><table><tr><th>Input / scoring</th><th>Parallel</th><th>Rank</th><th>DINO</th><th>Original score</th><th>Applied new Δ</th><th>Final</th><th>New evidence availability</th></tr>${randomRows.join('')}</table></div>
<p>In the crop branch, Rainbow remains#1 and Gold#2 with margin0.01952. Rainbow's coverage is11.15%; Gold/Silver freshly fitted projected boundaries fail strict image containment. The new signal therefore makes no cropped change. This is an observed alignment/bounds abstention, not evidence that aligned robust color helped a cropped query. No post-result relaxation was applied.</p></section>
<section class="panel"><h2>Regression and Vulture: evidence, not guessed causes</h2><p><b>Iceman3093 regresses on raw:</b> correct original score0.61894 beats Onslaught0.60732 by0.01163. New peripheral chroma distance23.55 gives−0.01762, reducing Iceman to0.60132. Onslaught has an unverified reference extent and receives0 adjustment, so it wins by0.00600. This directly demonstrates an unsafe residual-color/missing-evidence interaction. The measurement does not establish whether lighting, print finish or framing caused the chroma mismatch. We do not invent that diagnosis. The optional cropped Iceman remains#1 unchanged.</p>
<p><b>Vulture3095:</b> stage1 rank15 enters top20 but finishes12 with score0.63334. Its original detail NCC0.40185 fails the0.48 gate; new reference extent is outside the frozen verified set, so its own score does not change. Three higher-DINO IDs (#11867 Spider-Man, #11878 Hulk, #11879 Thanos) share one reference vector at0.64986; the original detail reranker lowers each to0.62555, moving Vulture above those three. This is why15→12 occurs, not a successful Vulture-specific match. Wrong top candidate remains#12048 at0.72535. Breadth improves availability, but neither scorer uses that availability to recover an exact result.</p>
<p>Black Widow remains#1; no top10→20 Top1 regression is observed. Captain America and Electro stay#1 but raw color narrows their margins, reinforcing that a generic color residual is not reliably beneficial. All observed rank changes and scores are included in the JSON.</p></section>
<section class="panel"><h2>Measured compute and scope</h2><table><tr><th>Input</th><th>Warm DINO mean</th><th>Original top10 rerank</th><th>Original top20 rerank</th><th>New ORB/chroma top20 superset</th></tr>${timings.map(t=>`<tr><td>${t.input}</td><td>${n(t.warmEmbeddingMeanMs,2)}ms</td><td>${n(t.base10Ms,2)}ms</td><td>${n(t.base20Ms,2)}ms</td><td>${n(t.chroma20Ms,2)}ms</td></tr>`).join('')}</table>
<p>First raw DINO cold call:${n(queries[0].embeddingMs,2)}ms. Detail-reference preparation for144 unique images:${n(summary.referenceFeatureComputeMs,2)}ms accumulated; ORB reference preparation:${n(colors.referencePrecomputeMs,2)}ms; Python batch elapsed:${n(summary.pythonMs,2)}ms. New color was measured on the top20 superset and reused by the top10 arm, so no separate top10 chroma latency is claimed. Query rasterization/search are separately recorded in JSON. Reference fetch, report generation and DB reads are not warm query inference.</p>
<p>These are fresh embedding/reranking timings on saved raw/cropped inputs, <b>not a new end-to-end optional-crop latency test</b>. Fresh isolation and any collector interaction were deliberately not rerun. No speed or production-confidence claim is inferred from the eight-arm batch.</p></section>
<section class="panel"><h2>QA and next decision: untouched larger test, not more optimization on nine</h2><p>All432 prior-file hashes unchanged; same9 originals/decisions; same1023 IDs/823 vectors;4 raw fallback byte/vector equalities; all72 scored-arm pool memberships checked; new residuals bounded±0.08 and exactly0 on abstention. Synthetic all-glare image abstains, identical chroma similarity1.0, different-color similarity0.00793. Prior top10 ranks/scores match. A fresh read-only DEV transaction confirms original958 permanent reference/vector rows unchanged: <code>${prior.referencesHash}</code>. Policy hash:<code>${summary.policyHash}</code>.</p>
<p><b>Ready for a larger representative untouched evaluation of the preserved pipeline, not ready for deployment.</b> Carry unchanged base reranking and frozen optional cropping forward; test top20 explicitly as a recall diagnostic. Do NOT promote the new chroma branch: it lost an exact Top1 and did not solve Gold/Rainbow. Freeze the next test specification before seeing new labels, include real parallel finishes, sleeves, binders, glare and slab/reference framing, and report exact-card accuracy, fallback coverage, regressions, margins and timing separately. This repeatedly inspected nine-case development set cannot estimate generalization. Stop further tuning on these nine.</p>
<p>No publication, production access, full/permanent indexing, model/schema/catalog/label/image changes, collection/ownership writes, app/UI changes, dependency changes or new crop behavior. Existing manual crop and collector confirmation remain untouched; full indexing stays paused. New downloaded reference bytes/descriptors live only under the focused development experiment directory.</p></section>
<script id="evidence" type="application/json">${JSON.stringify(evidence).replace(/</g,'\\u003c')}</script><script>function saveBlob(b,n){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function downloadJSON(){saveBlob(new Blob([JSON.stringify(JSON.parse(document.getElementById('evidence').textContent),null,2)],{type:'application/json'}),'focused-breadth-parallel-results.json')}function downloadHTML(){saveBlob(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}),'focused-breadth-parallel-report.html')}</script></main></html>`;
await fs.writeFile('attached_assets/focused-breadth-parallel-report.html',html);
console.log('REPORT attached_assets/focused-breadth-parallel-report.html',Buffer.byteLength(html),'bytes');
console.log('QA',integrity,'TIMING',timings);