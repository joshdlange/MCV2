import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';

const dir = '.local/broad-validation';
const hash = (b: Buffer|string) => createHash('sha256').update(b).digest('hex');
const read = async (p: string) => JSON.parse(await fs.readFile(p,'utf8'));
const save = async (p: string,v: any) => fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
if(process.env.NODE_ENV === 'production') throw Error('DEV only');
const url = new URL(process.env.DATABASE_URL!);
if(!['helium','127.0.0.1','localhost'].includes(url.hostname)) throw Error('Only confirmed local DEV database allowed');
const pool = new Pool({connectionString:process.env.DATABASE_URL,max:1});
const client=await pool.connect();
let catalog:any[],counts:any;
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  counts=(await client.query(`SELECT (SELECT count(*) FROM scan_uploads) AS scans,(SELECT count(*) FROM scan_feedback) AS feedback`)).rows[0];
  catalog=(await client.query(`SELECT c.id,c.name,c.card_number,c.variation,c.set_id,c.front_image_url AS url,c.archived_at,s.name AS set_name,s.year,s.main_set_id,s.is_active AS set_active,s.archived_at AS set_archived,m.name AS main_name FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id ORDER BY c.id`)).rows;
  await client.query('COMMIT');
}finally{client.release();await pool.end();}
await save('dev-catalog-snapshot',catalog);
const prior=await read('.local/image-experiment/snapshot.json');
const historical=await read('.local/scan-review/historical-labels-report.json');
const decisions=await read('.local/scan-review/decisions.json');
const provenance=await read('.local/scan-review/provenance.json');
const actualIds=new Set<number>();
const evidence:any[]=[];
for(const folder of ['image-experiment','bounded-dino','detail-experiment','detail-orb','parallel-focus']){
  for(const name of await fs.readdir(`.local/${folder}`)){
    if(!name.endsWith('.json') || /snapshot|manifest|freeze|selection|policy|verification|review|qa|proposals|plan|job|source|references|vectors/.test(name))continue;
    const p=`.local/${folder}/${name}`,j=await read(p);
    function visit(x:any){
      if(!x||typeof x!=='object')return;
      if(Number.isInteger(x.scanId) && (x.vector || x.rawVector || x.top10 || x.ranked || x.embeddingMs!=null || x.rawEmbeddingMs!=null || x.stage1Rank!=null)){
        actualIds.add(x.scanId);evidence.push({path:p,scanId:x.scanId});
      }
      for(const v of Object.values(x))if(typeof v==='object')visit(v);
    }
    visit(j);
  }
}
// The original run script admits !reason and inference-results files support these IDs.
for(const c of prior.cases.filter((c:any)=>!c.reason))actualIds.add(c.scanId);
const candidates=historical.records.filter((r:any)=>r.sourceStatus==='explicit-confirmation')
 .map((r:any)=>{
   const manual=decisions.decisions[r.scanId],p=provenance.selected.find((p:any)=>p.scanId===r.scanId);
   const reason=actualIds.has(r.scanId)?'previous actual inference'
     :manual && (manual.status!=='confirmed'||manual.cardId!==r.candidateHistoricalCardId)?'manual decision conflict or unresolved'
     :!p?'missing saved original':null;
   return {...r,...p,cardId:r.candidateHistoricalCardId,reason,reference:catalog.find(c=>c.id===r.candidateHistoricalCardId)};
 });
await save('continuation-availability',{createdAt:new Date().toISOString(),appDatabase:{target:'local DEV hostname allowlist; no credentials logged',counts},supersedes:'Earlier prepared60 exposure exclusion, explicitly relaxed by parent to actual experiment queries only. Built-in and app local DEV both empty; existing authorized local historic export reused without production contact.',actualQueryIds:[...actualIds].sort((a,b)=>a-b),evidence,candidates:candidates.map(c=>({scanId:c.scanId,cardId:c.cardId,reason:c.reason})),catalogSnapshotHash:hash(await fs.readFile(`${dir}/dev-catalog-snapshot.json`))});
await fs.mkdir(`${dir}/positives`,{recursive:true});
const eligible=candidates.filter(c=>!c.reason);
for(const c of eligible){
  const q=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`);
  if(hash(q)!==c.imageHash)throw Error('Original hash mismatch');
  try{
    if(!c.reference?.url || c.reference.url.includes('/scan_uploads/'))throw Error('Missing or scan-upload reference');
    const bytes=await downloadCatalogReference(c.reference.url);
    if(hash(bytes)===c.imageHash)throw Error('Exact query/reference leakage');
    c.reference.file=`${dir}/positives/${c.cardId}.jpg`;
    c.reference.digest=hash(bytes);
    await fs.writeFile(c.reference.file,bytes);
  }catch(e){c.referenceError=String(e);}
}
await save('positive-candidates',eligible);
for(let i=0;i<eligible.length;i++){
  const c=eligible[i],tiles=[];
  for(const p of [`.local/scan-review/${c.originalPhotoFile}`,c.reference?.file].filter(Boolean)){
    tiles.push(await sharp(await fs.readFile(p)).rotate().resize(480,640,{fit:'contain',background:'#ddd'}).jpeg().toBuffer());
  }
  const label=`Scan ${c.scanId} - ${c.cardId} - ${c.reference?.name} - ${c.reference?.card_number} - ${c.reference?.set_name}`;
  const svg=Buffer.from(`<svg width="960" height="50"><rect width="960" height="50" fill="white"/><text x="8" y="25" font-size="14">${label.replace(/[&<>]/g,' ')}</text></svg>`);
  await sharp({create:{width:960,height:690,channels:3,background:'#ddd'}}).composite([...tiles.map((input,j)=>({input,left:j*480,top:50})),{input:svg,left:0,top:0}]).jpeg({quality:92}).toFile(`${dir}/positive-${c.scanId}.jpg`);
}
console.log(JSON.stringify({counts,actualQueryIds:[...actualIds],candidates:eligible.map(c=>({scanId:c.scanId,cardId:c.cardId,reference:c.reference,error:c.referenceError}))},null,2));