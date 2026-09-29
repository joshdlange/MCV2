import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
const dir='.local/bounded-dino';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const [m,v,qa,runs,s,frozen,prior]=await Promise.all(['manifest','verification','reference-qa','runs','summary','frozen-selection'].map(p=>read(`${dir}/${p}.json`)).concat([read('.local/image-experiment/snapshot.json')]));
assert.equal(hash(await fs.readFile('.local/scan-review/decisions.json')),prior.decisionsHash);
assert.equal(hash(JSON.stringify(prior.refs)),prior.referencesHash);
assert.equal(hash(await fs.readFile(`${dir}/manifest.json`)),frozen.manifestHash);
assert.deepEqual(runs.map((r:any)=>r.scanId),m.cases.map((c:any)=>c.scanId));
for(const c of m.cases)assert.equal(hash(await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`)),c.imageHash);
for(const r of m.references.filter((r:any)=>r.file))assert.equal(hash(await fs.readFile(`${dir}/${r.file}`)),r.digest);
if(process.env.NODE_ENV==='production')throw Error('DEV only');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const client=await pool.connect();
let liveHash='';
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=(await client.query('SELECT key,reference_url AS url,embedding,content_digest FROM catalog_visual_references WHERE key=ANY($1::text[]) ORDER BY key',[prior.refs.map((r:any)=>r.key)])).rows;
  liveHash=hash(JSON.stringify(rows));
  assert.equal(liveHash,prior.referencesHash,'Permanent 958 reference rows changed');
  await client.query('COMMIT');
}finally{client.release();await pool.end();}
const verified={originals:16,decisionsUnchanged:true,permanent958VectorsUnchanged:true,permanentReferenceHash:liveHash,manifestHash:frozen.manifestHash,
  all958DistractorIdsPreserved:s.indexA.cardIds===967&&s.indexB.cardIds===1023,oldUniqueDigests:758,newPositiveDigests:9,hardNegativeDigests:56,allFreshQueries:true,noCrop:true};
assert.ok(verified.all958DistractorIdsPreserved);
await fs.writeFile(`${dir}/integrity.json`,JSON.stringify(verified,null,2));
const esc=(x:any)=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(n:number)=>n.toFixed(3);
const image=async(p:string)=>'data:image/jpeg;base64,'+(await sharp(await fs.readFile(p)).rotate().resize({width:170,height:225,fit:'inside'}).jpeg({quality:72}).toBuffer()).toString('base64');
const metrics=(x:any)=>[x.top1,x.top3,x.top10].map(n=>`${n}/${x.n} (${(100*n/x.n).toFixed(1)}%)`).join(' · ');
const summary=(r:any)=>`<b>Rank ${r.rank??'not indexed'}</b><br>#${r.top10[0].cardId} ${esc(r.top10[0].name)}<br>correct ${r.correctScore==null?'N/A':fmt(r.correctScore)} · top ${fmt(r.top10[0].similarity)}<br>margin ${fmt(r.margin)} · search ${fmt(r.searchMs)}ms`;
const detail=(r:any)=>`<ol>${r.top10.map((t:any)=>`<li>#${t.cardId} ${esc(t.name)} · ${t.similarity.toFixed(6)}</li>`).join('')}</ol>`;
const confusion:Record<number,string>={
  3032:'Same-art parallel beats correct base: #27139 Black Widow holographic parallel is B #1; correct #27024 falls 1→2.',
  3088:'Same-art parallels: Rainbow #20602 wins B #1, Silver #336818 is #3; correct Gold #20611 falls 2→4. B #2 is unrelated Batroc.',
  3093:'Wrong family wins narrowly: Onslaught #12101 beats Iceman by ~0.002 cosine; correct remains rank2.',
  3095:'Broad miss, not merely parallel confusion: War Machine wins; correct Vulture 2099 rank14→15.',
};
const rows=[];
for(const r of runs) {
  const c=m.cases.find((c:any)=>c.scanId===r.scanId),p=m.positives.find((p:any)=>p.scanId===r.scanId),check=v.find((x:any)=>x.scanId===r.scanId);
  const plan=m.plan.find((p:any)=>p.scanId===r.scanId);
  const ids=[...new Set(Object.values(plan.categories).flat())] as number[];
  const included=ids.filter(id=>frozen.referenceIds.includes(id)&&id!==c.cardId);
  const cats=Object.entries(plan.categories).map(([k,list]:any)=>`${k}: ${list.filter((id:number)=>included.includes(id)).length}/${list.length} [${list.filter((id:number)=>included.includes(id)).join(', ')}]`).join('; ');
  rows.push(`<tr><td><b>${r.scanId}</b><br>#${c.cardId} ${esc(p.name)}<br><small>${esc(p.year+' '+p.set_name)} · #${esc(p.card_number)}</small><p class="${r.scored?'ok':'warn'}">${r.scored?'SCORED':'EXCLUDED — informational query only'}</p></td>
  <td><img src="${await image(`.local/scan-review/${c.originalPhotoFile}`)}"><br><small>Unaltered original query</small></td>
  <td>${p.file?`<img src="${await image(`${dir}/${p.file}`)}">`:'No stored catalog front'}<details><summary>Reference verification</summary>${esc(check.note)}<p>${esc(check.leakage?`Full-frame near-copy screen: MAE ${fmt(check.leakage.mae)}, corr ${fmt(check.leakage.corr)}; no flag.`:'No reference to compare.')}</p></details></td>
  <td>${summary(r.A)}<details><summary>Test A top10</summary>${detail(r.A)}</details></td><td>${summary(r.B)}<details><summary>Test B top10</summary>${detail(r.B)}</details></td>
  <td>${esc(r.scored?(confusion[r.scanId]??'Exact correct ID is Test B #1.'):'Not scored; no trustworthy correct reference inserted.')}<br><small>Warm embedding ${fmt(r.embeddingMs)}ms</small><details><summary>${included.length} included hard-negative IDs / ${ids.length} proposed</summary>${esc(cats)}<p>Counts overlap across categories. Excluded cases had no dedicated negatives inserted, although a reference may be shared with an eligible case.</p>${included.map(id=>{const rr=m.references.find((x:any)=>x.id===id);return `#${id} ${esc(rr.name)} · ${esc(rr.set_name)}<br>`;}).join('')}</details></td></tr>`);
}
const scored=runs.filter((r:any)=>r.scored);
const newRefRows=m.references.filter((r:any)=>frozen.referenceIds.includes(r.id));
const evidence={summary:s,verification:v,referenceQA:qa,integrity:verified,selection:frozen,referenceMetadata:newRefRows,runs:runs.map(({vector,...r}:any)=>r),
  recommendation:'B — DINO retrieves useful card/artwork candidates but confuses parallels; continue as candidate retrieval plus another discriminator. Not deployment-ready; only nine scored cases and bounded negatives.'};
const negativeGallery=[];
for(const p of m.plan.filter((p:any)=>scored.some((r:any)=>r.scanId===p.scanId))) {
  const ids=[...new Set(Object.values(p.categories).flat())] as number[];
  const items=[];
  for(const id of ids.filter(id=>frozen.referenceIds.includes(id))) {
    const rr=m.references.find((x:any)=>x.id===id);
    items.push(`<figure><img src="${await image(`${dir}/${rr.file}`)}"><figcaption>#${id} ${esc(rr.name)}<br>${esc(rr.set_name)} #${esc(rr.card_number)}</figcaption></figure>`);
  }
  negativeGallery.push(`<details><summary>Scan ${p.scanId}: ${items.length} selected negatives</summary><div class="gallery">${items.join('')}</div></details>`);
}
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coverage-controlled bounded DINO test</title>
<style>body{font:15px/1.5 system-ui;background:#f2f4f8;color:#19233a;margin:0}main{max-width:1600px;margin:auto;padding:28px}h1{font-size:30px;margin-bottom:6px}h2{font-size:21px}.panel{background:white;border:1px solid #dce1ea;border-radius:12px;padding:20px;margin:18px 0}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metrics>div{padding:15px;background:#eaf0fb;border-radius:8px}.warn{color:#a45b00}.ok{color:#236c4e}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #dce1ea}th{background:#e9eef7}td img{width:135px;height:180px;object-fit:contain;background:#e3e7ee}small{color:#627089}.scroll{overflow:auto}details{margin:8px 0}td details{max-width:300px}ol{padding-left:18px}button{padding:10px 14px;border:0;border-radius:6px;background:#24416d;color:white;margin-right:8px;cursor:pointer}p{max-width:1150px}code{overflow-wrap:anywhere}.gallery{display:flex;flex-wrap:wrap;gap:12px}figure{margin:10px;width:170px}figure img{width:150px;height:195px;object-fit:contain}figcaption{font-size:11px}</style><main>
<h1>Coverage-controlled DINO: original photos, bounded hard negatives</h1><p>Actual development experiment · model unchanged · fresh image-only queries · same original 16-query cohort · no automatic cropping.</p>
<button onclick="downloadJSON()">Download results JSON</button><button onclick="downloadHTML()">Save self-contained HTML</button>
<section class="panel"><h2>9 verified references; Test B exposes parallel confusion</h2><div class="metrics"><div><b>Test A Top-1 / Top-3 / Top-10</b><br>${metrics(s.A)}</div><div><b>Test B Top-1 / Top-3 / Top-10</b><br>${metrics(s.B)}</div><div><b>Scoring coverage</b><br>9/16 verified · 7 excluded</div></div>
<p><b>Recommendation B:</b> DINO retrieves useful card/artwork candidates but struggles with parallels, so continue as candidate retrieval plus another discriminator. Test B puts 8/9 correct IDs in the top10, but only 5/9 at #1. Two wrong top results are the right artwork in a different parallel; two are unrelated artwork. This is a small, curated, nine-case benchmark, not a production accuracy estimate or justification for auto-accepting matches.</p>
<p>All 16 original scans were freshly embedded and searched in both tests. Only the 9 with accepted independent catalog fronts enter accuracy denominators. Excluded cases remain visible as informational queries. No labels were changed to match image content.</p></section>
<section class="panel"><h2>What was in each temporary index</h2><table><tr><th>Index</th><th>Catalog IDs ranked</th><th>Unique image bytes / vectors</th></tr><tr><td>A: old958 +9 verified positive IDs</td><td>${s.indexA.cardIds}</td><td>${s.indexA.uniqueDigests}</td></tr><tr><td>B: A +56 bounded hard-negative IDs</td><td>${s.indexB.cardIds}</td><td>${s.indexB.uniqueDigests}</td></tr></table>
<p>The original 958 reference rows include <b>758 unique byte digests</b>; 200 rows share identical bytes and identical existing embeddings. They are evaluated once per digest but expanded back to <b>all 958 catalog IDs</b> before ranking, so shared-art/parallel ambiguity and deterministic tie-order are not hidden. All original distractor IDs are preserved. Nine positive and 56 hard-negative images add unique digests in this run.</p>
<p>Hard negatives were fixed from catalog structure <em>before query scores</em>: up to 3 same-character references closest in year, 3 same-set nearby numeric card numbers, 4 same-family exact-number parallel candidates, 3 same-family character references, and 3 same-URL references. Categories overlap; matching numbers across unrelated subsets are not proof of parallel identity. All fetched contact sheets were visually inspected. Clearly wrong negative images were rejected before scoring; exact negative parallel variants that need back/finish evidence remain catalog-declared, not independently certified. This is bounded rather than exhaustive hard-negative coverage.</p>
<p>Five visibly misassigned negative candidates were flagged: #183693 shows Moon Knight rather than Vulture; #17218 shows Doom rather than Hulk; #16742 shows Slug rather than Terrax; #16744 shows Crossbones rather than Slug; #16741 shows Mr. Sinister rather than Blackheart. They were not used as replacements or inserted in this test.</p></section>
<section class="panel"><h2>Actual queries, ranks and top10</h2><p>Ranks are exact full-index <b>catalog-ID</b> ranks, not a top10-only search. Similarities and margins are cosine values, not probabilities. Index-construction metadata and visual inspection were allowed; retrieval itself sees only query pixels and frozen vectors. Excluded cases are not counted as recognition failures or successes.</p><div class="scroll"><table><tr><th>Scan / confirmed card</th><th>Original</th><th>Catalog front</th><th>Test A</th><th>Test B</th><th>Interpretation / hard negatives</th></tr>${rows.join('')}</table></div></section>
<section class="panel"><h2>Excluded from scoring — 7 of 16</h2><ul>${v.filter((x:any)=>!x.accepted).map((x:any)=>`<li><b>${x.scanId}</b>: ${esc(x.note)}</li>`).join('')}</ul><p>Two references are missing, two are clearly wrong-side/wrong-card, and three are uncertain exact-variant references. Uncertain is <b>not</b> relabeled as wrong. Specifically, 3130's stored Mr. Sinister reference is visibly Hate-Monger; it is excluded, not silently replaced by the Mr. Sinister image attached to a different catalog ID.</p></section>
<section class="panel"><h2>Failure pattern</h2><ul><li><b>3032 Black Widow:</b> correct base 1→2 after holographic parallel #27139 is added. Same artwork beats exact card.</li><li><b>3088 Random Gold:</b> correct rank2→4. Rainbow #20602 wins; Silver #336818 also beats Gold. Lighting/finish-sensitive distinction is unresolved by the visual embedding.</li><li><b>3093 Iceman:</b> rank2 in both, narrowly beaten by unrelated Onslaught.</li><li><b>3095 Vulture 2099:</b> rank14→15, beaten by unrelated War Machine. Binder/background or artwork representation may contribute, but the experiment does not establish the cause.</li></ul><p>No same-art variants are counted as exact-ID successes. No false certainty is inferred from a small cosine margin. High Top10 retrieval is encouraging for candidate generation, not sufficient for exact parallel recognition.</p></section>
<section class="panel"><h2>Measured latency and methodology</h2><p>Mean <b>warm original-query embedding: ${fmt(s.meanWarmQueryEmbeddingMs)}ms</b> across all16. Mean exact full-ranking search: <b>A ${fmt(s.A.meanSearchMs)}ms; B ${fmt(s.B.meanSearchMs)}ms</b>. The model had already been initialized by reference embedding; no query is mislabeled cold. The first reference embedding in the final run took <b>${fmt(s.coldReferenceEmbeddingMs)}ms</b> including process/model initialization with cached filesystem pages. Cold startup varies; an earlier execution measured 4238.76ms, so this is not a cold-start guarantee. Reference construction, network fetch, catalog reading, file I/O and report work are excluded from query timings. A/B share one freshly generated original-image query vector for a fair comparison; no query cropping/rotation experiment was added.</p>
<p>Canonical <code>${esc(m.model)}</code>, canonical single-image CLS extraction and normalization, 384 dimensions, q8, exact canonical cosine. Positive/negative reference embeddings exist only in local temporary JSON. Existing reference vectors are not recomputed. Full-sort ties use ascending numeric card ID after all IDs sharing a byte digest are expanded. Labels/card metadata never prefilter a query's candidate set.</p>
<p>Selection froze before scores. A QA assertion caught a local draft deduplication bug that dropped duplicate-byte catalog IDs; it was corrected to merge all IDs, and the final complete fresh run was repeated with all958 distractors preserved. Only corrected final results are reported. No score-based reference selection occurred.</p></section>
<section class="panel"><h2>Hard-negative visual audit</h2><p>Per-case galleries show exactly the inserted hard negatives; all can be viewed offline.</p>${negativeGallery.join('')}</section>
<section class="panel"><h2>Leakage and preservation QA</h2><p>All16 query hashes match the preceding experiment. All fetched reference bytes match their saved digests. Exact scan-upload URLs and exact original-byte matches are blocked. Independent positive reference framing/lighting/artwork was visually inspected; full-frame 96×128 RGB near-copy screening across all16 queries found no MAE≤10 and correlation≥0.95 hits. That screen is <b>not a proof against every transformed/cropped source copy</b>. Same artwork is intentionally required and is not itself leakage. Graded-holder imagery remains unaltered.</p><p>Manual decisions unchanged. The 958 original permanent DEV reference rows were read again in a read-only transaction and their combined SHA-256 still matches the previous snapshot: <code>${liveHash}</code>. All original IDs preserved and all16 original bytes unchanged. Selection manifest SHA-256: <code>${frozen.manifestHash}</code>. Evidence, hashes, categories, reference metadata, per-case ranks and full-precision scores are embedded in the download.</p>
<p><b>No permanent indexing, full indexing, schema/catalog/image/label updates, asset uploads, publishing, model changes, app/UI changes or production access.</b> Full indexing remains paused. Only bounded temporary files were created; production was untouched.</p></section>
<script id="evidence" type="application/json">${JSON.stringify(evidence).replace(/</g,'\\u003c')}</script>
<script>function saveBlob(b,n){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function downloadJSON(){saveBlob(new Blob([JSON.stringify(JSON.parse(document.getElementById('evidence').textContent),null,2)],{type:'application/json'}),'bounded-dino-results.json')}function downloadHTML(){saveBlob(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}),'bounded-dino-report.html')}</script></main></html>`;
await fs.writeFile('attached_assets/bounded-dino-report.html',html);
console.log('REPORT attached_assets/bounded-dino-report.html',Buffer.byteLength(html),'bytes',verified);