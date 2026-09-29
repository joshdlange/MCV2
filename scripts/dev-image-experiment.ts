import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { embedCatalogVisualImage, MODEL_VERSION, normalizeVisualVector, visualCosine, visualTopK } from '../server/services/catalogVisualModel';

const dir = '.local/image-experiment';
const review = '.local/scan-review';
const hash = (x: Buffer | string) => createHash('sha256').update(x).digest('hex');
const json = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const save = async (p: string, v: unknown) => fs.writeFile(`${dir}/${p}`, JSON.stringify(v, null, 2));
await fs.mkdir(dir, { recursive: true });
process.env.CATALOG_VISUAL_OFFLINE = 'true';
if (process.env.NODE_ENV === 'production') throw Error('DEV only');
const mode = process.argv[2] ?? 'raw';
const classifications = await json(`${review}/classifications.json`);
const historical = await json(`${review}/historical-labels-report.json`);
function labelExclusion(scanId:number,d:any,origin:any) {
  if(d.status!=='confirmed') return 'not confirmed';
  const prior=historical.records.find((r:any)=>r.scanId===scanId&&r.sourceStatus==='explicit-confirmation');
  // ID equality is the only established equivalence here. Similar artwork,
  // matching names, and shared URLs do not prove physical-card equivalence.
  if(prior?.candidateHistoricalCardId&&prior.candidateHistoricalCardId!==d.cardId) return 'unresolved historical/manual identity conflict';
  if(classifications.classifications[scanId]?.side==='back'||/\bback\b/i.test(d.note)) return 'confirmed back';
  if(origin.rows.some((r:any)=>r.scanId===scanId&&/^exact/.test(r.overlap))) return 'known reference leakage';
  return null;
}
let snapshot: any;
if (mode === 'raw') {
  const decisionsBytes = await fs.readFile(`${review}/decisions.json`);
  const decisions = JSON.parse(decisionsBytes.toString());
  const provenance = await json(`${review}/provenance.json`);
  const origin = await json(`${review}/photo-origin-audit.json`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const catalog = `FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id`;
    const eligible = `c.archived_at IS NULL AND s.is_active AND s.archived_at IS NULL AND (m.id IS NULL OR (m.is_active AND m.archived_at IS NULL)) AND c.front_image_url ~ '^https?://' AND c.front_image_url !~* '^https?://([^/]*\\.)?(drive\\.google\\.com|docs\\.google\\.com|googleusercontent\\.com)(/|:)'`;
    const refs = (await client.query(`SELECT r.key,r.reference_url AS url,r.embedding,r.content_digest FROM catalog_visual_references r WHERE r.model_version=$1 AND r.status='ready' AND EXISTS (SELECT 1 ${catalog} WHERE ${eligible} AND c.front_image_url=r.reference_url) ORDER BY r.key LIMIT 100000`, [MODEL_VERSION])).rows;
    const cards = (await client.query(`SELECT c.id,c.name,c.front_image_url AS url ${catalog} WHERE ${eligible} ORDER BY c.id`)).rows;
    const labels = (await client.query('SELECT id,name,front_image_url AS url FROM cards WHERE id=ANY($1::int[])', [Object.values(decisions.decisions).map((d: any) => d.cardId).filter(Boolean)])).rows;
    await client.query('COMMIT');
    const cases: any[] = [];
    for (const [id, d] of Object.entries(decisions.decisions) as any) {
      const scanId = Number(id);
      const p = provenance.selected.find((p: any) => p.scanId === scanId);
      let reason = labelExclusion(scanId,d,origin);
      const bytes = await fs.readFile(`${review}/${p.originalPhotoFile}`);
      if (hash(bytes) !== p.imageHash) throw Error(`Original integrity failed ${scanId}`);
      if (!reason && refs.some((r: any) => r.content_digest === p.imageHash)) reason = 'exact indexed-reference bytes';
      cases.push({ scanId, cardId: d.cardId, ...p, reason, covered: cards.some((c: any) => c.id === d.cardId && refs.some((r: any) => r.url === c.url)), label: labels.find((c: any) => c.id === d.cardId) });
    }
    snapshot = { createdAt: new Date().toISOString(), model: MODEL_VERSION, decisionsHash: hash(decisionsBytes), referencesHash: hash(JSON.stringify(refs)), refs, cards, cases };
    await save('snapshot.json', snapshot);
    console.log('ELIGIBILITY BEFORE INFERENCE', JSON.stringify(cases.map(({scanId,cardId,reason,covered})=>({scanId,cardId,reason,covered})),null,2));
    console.log('COUNTS', { confirmed: cases.filter(c=>c.cardId).length, eligible: cases.filter(c=>!c.reason).length, references: refs.length, indexedCards: cards.filter((c:any)=>refs.some((r:any)=>r.url===c.url)).length });
  } finally { client.release(); await pool.end(); }
} else snapshot = await json(`${dir}/snapshot.json`);
const currentDecisions=await json(`${review}/decisions.json`);
const currentOrigin=await json(`${review}/photo-origin-audit.json`);
for(const c of snapshot.cases) {
  let reason=labelExclusion(c.scanId,currentDecisions.decisions[c.scanId],currentOrigin);
  if(!reason&&snapshot.refs.some((r:any)=>r.content_digest===c.imageHash)) reason='exact indexed-reference bytes';
  if(reason!==c.reason||currentDecisions.decisions[c.scanId].cardId!==c.cardId) throw Error(`Frozen cohort no longer agrees with current evidence: ${c.scanId}`);
}
if(hash(JSON.stringify(snapshot.refs))!==snapshot.referencesHash) throw Error('Frozen references hash mismatch');
await save('eligibility-validation.json',{checkedAt:new Date().toISOString(),sameFrozenCohort:true,eligible:snapshot.cases.filter((c:any)=>!c.reason).length,
  classificationsHash:hash(await fs.readFile(`${review}/classifications.json`)),historicalHash:hash(await fs.readFile(`${review}/historical-labels-report.json`)),
  equivalencePolicy:'Only same exact ID established. No independent duplicate equivalence verified; do not infer it from names/artwork.',
  conflicts:historical.records.filter((r:any)=>currentDecisions.decisions[r.scanId]?.status==='confirmed'&&r.sourceStatus==='explicit-confirmation'&&r.candidateHistoricalCardId&&r.candidateHistoricalCardId!==currentDecisions.decisions[r.scanId].cardId).map((r:any)=>({scanId:r.scanId,historicalId:r.candidateHistoricalCardId,manualId:currentDecisions.decisions[r.scanId].cardId,feedbackIds:r.feedbackIds}))});
const refs = snapshot.refs.map((r:any)=>({...r,vector:new Float32Array(normalizeVisualVector(r.embedding))}));
const cardsByUrl = new Map<string, any[]>();
for(const c of snapshot.cards) cardsByUrl.set(c.url,[...(cardsByUrl.get(c.url)??[]),c]);
const runs:any[]=[];
for(const c of snapshot.cases.filter((c:any)=>!c.reason)) {
  const original = await fs.readFile(`${review}/${c.originalPhotoFile}`);
  if(hash(original)!==c.imageHash) throw Error('Original changed');
  let bytes=original, normalization:any=null;
  if(mode==='normalized') {
    const { normalizeCard }=await import('./dev-card-normalization');
    const start=performance.now();
    const n=await normalizeCard(original);
    bytes=n.bytes;
    normalization={...n,bytes:undefined,outline:undefined,ms:performance.now()-start};
    await fs.writeFile(`${dir}/${c.scanId}-outline.jpg`,n.outline);
    await fs.writeFile(`${dir}/${c.scanId}-normalized.jpg`,bytes);
  }
  const start=performance.now();
  const vector=await embedCatalogVisualImage(bytes);
  const embeddingMs=performance.now()-start;
  const searchStart=performance.now();
  const topRefs=visualTopK(refs,vector,10);
  const full=refs.map((r:any)=>({url:r.url,similarity:visualCosine(vector,r.vector)})).sort((a:any,b:any)=>b.similarity-a.similarity||a.url.localeCompare(b.url));
  const ranked=full.flatMap((r:any)=>(cardsByUrl.get(r.url)??[]).map(card=>({cardId:card.id,name:card.name,similarity:r.similarity}))).sort((a:any,b:any)=>b.similarity-a.similarity||a.cardId-b.cardId);
  const index=ranked.findIndex((r:any)=>r.cardId===c.cardId);
  const searchMs=performance.now()-searchStart;
  const run={scanId:c.scanId,cardId:c.cardId,covered:c.covered,rank:index<0?null:index+1,correctScore:index<0?null:ranked[index].similarity,top10:ranked.slice(0,10),topReferences:topRefs,margin:ranked[0].similarity-ranked[1].similarity,embeddingMs,searchMs,totalMs:embeddingMs+searchMs+(normalization?.ms??0),normalization,queryHash:hash(bytes),vector};
  runs.push(run); await save(`${mode}.json`,runs);
  console.log('RESULT',JSON.stringify({...run,vector:undefined,topReferences:undefined,top10:run.top10.slice(0,1)}));
}
const mean=(key:string)=>runs.reduce((s,r)=>s+r[key],0)/runs.length;
const summary={n:runs.length,top1:runs.filter(r=>r.rank===1).length,top3:runs.filter(r=>r.rank&&r.rank<=3).length,top10:runs.filter(r=>r.rank&&r.rank<=10).length,outsideCoverage:runs.filter(r=>!r.covered).length,falseHighExploratory:runs.filter(r=>r.rank!==1&&r.top10[0].similarity>=.8&&r.margin>=.05).length,threshold:'exploratory only: cosine >=0.8 AND top1-runnerup >=0.05; not calibrated confidence',embeddingMs:mean('embeddingMs'),searchMs:mean('searchMs'),totalMs:mean('totalMs'),under1s:runs.filter(r=>r.totalMs<1000).length,under2s:runs.filter(r=>r.totalMs<2000).length,under3s:runs.filter(r=>r.totalMs<3000).length};
await save(`${mode}-summary.json`,summary);
if(hash(await fs.readFile(`${review}/decisions.json`))!==snapshot.decisionsHash) throw Error('Decisions changed during experiment');
console.log('SUMMARY',JSON.stringify(summary));