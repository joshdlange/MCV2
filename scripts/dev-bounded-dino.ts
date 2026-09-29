import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
import { embedCatalogVisualImage, MODEL_VERSION, normalizeVisualVector, visualCosine } from '../server/services/catalogVisualModel';
const dir='.local/bounded-dino',prior='.local/image-experiment',review='.local/scan-review';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
const snap=await read(`${prior}/snapshot.json`);
if(process.env.NODE_ENV==='production') throw Error('Development only');
process.env.CATALOG_VISUAL_OFFLINE='true';
await fs.mkdir(`${dir}/refs`,{recursive:true});
const mode=process.argv[2]??'prepare';
const cases=snap.cases.filter((c:any)=>!c.reason);
const esc=(s:any)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
async function sheet(items:any[],out:string) {
  const tiles=[];
  for(const item of items) {
    const b=await fs.readFile(item.path);
    const im=await sharp(b).rotate().resize(200,265,{fit:'contain',background:'#eee'}).jpeg().toBuffer();
    const label=Buffer.from(`<svg width="220" height="55"><rect width="220" height="55" fill="white"/><text x="5" y="16" font-size="12">${esc(item.line1)}</text><text x="5" y="32" font-size="10">${esc(item.line2).slice(0,100)}</text><text x="5" y="47" font-size="10">${esc(item.line3).slice(0,100)}</text></svg>`);
    const tile=await sharp({create:{width:220,height:325,channels:3,background:'#fff'}}).composite([{input:im,left:10,top:0},{input:label,left:0,top:270}]).jpeg().toBuffer();tiles.push(tile);
  }
  await sharp({create:{width:880,height:Math.ceil(tiles.length/4)*325,channels:3,background:'#ccc'}}).composite(tiles.map((input,i)=>({input,left:(i%4)*220,top:Math.floor(i/4)*325}))).jpeg({quality:90}).toFile(out);
}
if(mode==='prepare') {
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const client=await pool.connect();
  let catalog:any[];
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    catalog=(await client.query(`SELECT c.id,c.name,c.card_number,c.variation,c.set_id,c.front_image_url AS url,c.archived_at,s.name AS set_name,s.year,s.main_set_id,s.is_active AS set_active,s.archived_at AS set_archived,m.name AS main_name FROM cards c JOIN card_sets s ON s.id=c.set_id LEFT JOIN main_sets m ON m.id=s.main_set_id ORDER BY c.id`)).rows;
    await client.query('COMMIT');
  } finally {client.release();await pool.end();}
  const positives=cases.map((c:any)=>({scanId:c.scanId,...catalog.find(r=>r.id===c.cardId)}));
  const selected=new Map<number,any>();
  const usable=(r:any)=>r.url&&/^https?:/.test(r.url)&&!r.archived_at&&r.set_active&&!r.set_archived&&!r.url.includes('/scan_uploads/');
  const plan:any[]=[];
  for(const p of positives) {
    const groups:Record<string,any[]>={
      'same-character':catalog.filter(r=>r.id!==p.id&&usable(r)&&r.name.toLowerCase()===p.name.toLowerCase()).sort((a,b)=>Math.abs(a.year-p.year)-Math.abs(b.year-p.year)||a.id-b.id).slice(0,3),
      'same-set-near-number':catalog.filter(r=>r.id!==p.id&&usable(r)&&r.set_id===p.set_id).sort((a,b)=>Math.abs(parseInt(a.card_number)-parseInt(p.card_number))-Math.abs(parseInt(b.card_number)-parseInt(p.card_number))||a.id-b.id).slice(0,3),
      'family-parallel-same-number':catalog.filter(r=>r.id!==p.id&&usable(r)&&r.main_set_id===p.main_set_id&&r.card_number===p.card_number&&r.set_id!==p.set_id).slice(0,4),
      'family-same-character':catalog.filter(r=>r.id!==p.id&&usable(r)&&r.main_set_id===p.main_set_id&&r.name.toLowerCase()===p.name.toLowerCase()).slice(0,3),
      'same-url-artwork':catalog.filter(r=>r.id!==p.id&&usable(r)&&r.url===p.url).slice(0,3),
    };
    plan.push({scanId:p.scanId,cardId:p.id,categories:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.map(r=>r.id)]))});
    for(const group of Object.values(groups)) for(const r of group) selected.set(r.id,r);
  }
  const all=[...new Map([...positives,...selected.values()].map(r=>[r.id,r])).values()];
  for(const r of all) {
    try {
      if(!r.url) throw Error('No catalog front URL');
      if(r.url.includes('/scan_uploads/')) throw Error('Catalog URL points at scan upload: leakage');
      const b=await downloadCatalogReference(r.url);
      r.digest=hash(b);
      if(snap.cases.some((c:any)=>c.imageHash===r.digest)) throw Error('Exact original scan bytes: leakage');
      r.file=`refs/${r.digest}.image`;
      await fs.writeFile(`${dir}/${r.file}`,b);
      const m=await sharp(b).metadata();r.dimensions=[m.width,m.height];
    } catch(e:any) {r.error=e.message;}
    console.log('FETCH',r.id,r.error??r.dimensions);
  }
  const manifest={createdAt:new Date().toISOString(),model:MODEL_VERSION,priorReferencesHash:snap.referencesHash,decisionsHash:snap.decisionsHash,cases,positives:positives.map(p=>all.find(r=>r.id===p.id)),references:all,plan,
    selectionPolicy:'Before query scoring: max3 same-character closest year; max3 same-set nearby numeric number; max4 same-family exact-number parallel; max3 same-family character; max3 sharedURL. Stable ID tie breaks. Metadata ONLY constructs index, never filters query retrieval.'};
  await save('manifest',manifest);
  for(let offset=0;offset<positives.length;offset+=4) {
    const items=[];
    for(const p of manifest.positives.slice(offset,offset+4)) {
      const c=cases.find((c:any)=>c.scanId===p.scanId);
      items.push({path:`${review}/${c.originalPhotoFile}`,line1:`SCAN ${p.scanId} → #${p.id}`,line2:p.name,line3:`${p.year} ${p.set_name}`});
      if(p.file) items.push({path:`${dir}/${p.file}`,line1:`REFERENCE #${p.id}`,line2:`${p.name} #${p.card_number} ${p.variation??''}`,line3:`${p.year} ${p.set_name}`});
    }
    await sheet(items,`${dir}/positive-sheet-${offset/4+1}.jpg`);
  }
  const negatives=all.filter(r=>!positives.some(p=>p.id===r.id)&&r.file);
  for(let offset=0;offset<negatives.length;offset+=16) await sheet(negatives.slice(offset,offset+16).map(r=>({path:`${dir}/${r.file}`,line1:`#${r.id} ${r.name}`,line2:`${r.card_number} ${r.variation??''}`,line3:`${r.year} ${r.set_name}`})),`${dir}/negative-sheet-${offset/16+1}.jpg`);
  console.log('PREPARED',all.length,'positives',manifest.positives.map(p=>({scan:p.scanId,id:p.id,error:p.error})));
}
if(mode==='run') {
  const m=await read(`${dir}/manifest.json`),verification=await read(`${dir}/verification.json`),referenceQA=await read(`${dir}/reference-qa.json`);
  const eligible=verification.filter((v:any)=>v.accepted).map((v:any)=>cases.find((c:any)=>c.scanId===v.scanId));
  const positiveIds=new Set(eligible.map((c:any)=>c.cardId));
  const negativeIds=new Set(m.plan.filter((p:any)=>eligible.some((c:any)=>c.scanId===p.scanId)).flatMap((p:any)=>Object.values(p.categories).flat()));
  const rejectIds=new Set(verification.filter((v:any)=>!v.accepted).map((v:any)=>cases.find((c:any)=>c.scanId===v.scanId).cardId));
  for(const r of referenceQA.rejectedNegatives)rejectIds.add(r.cardId);
  for(const r of referenceQA.leakageScreen.filter((r:any)=>r.flag))rejectIds.add(r.cardId);
  const refs=m.references.filter((r:any)=>r.file&&!r.error&&!rejectIds.has(r.id)&&(positiveIds.has(r.id)||negativeIds.has(r.id)));
  const frozen={createdAt:new Date().toISOString(),eligible,verification,referenceIds:refs.map((r:any)=>r.id),plan:m.plan,manifestHash:hash(await fs.readFile(`${dir}/manifest.json`)),priorReferencesHash:snap.referencesHash};
  await save('frozen-selection',frozen);
  console.log('FROZEN BEFORE INFERENCE',JSON.stringify({eligible:eligible.map((c:any)=>c.scanId),referenceIds:frozen.referenceIds}));
  const vectors=new Map<string,number[]>(),embeddingTimes:any[]=[];
  for(const r of refs) {
    if(vectors.has(r.digest)) continue;
    const b=await fs.readFile(`${dir}/${r.file}`);if(hash(b)!==r.digest) throw Error('Reference changed');
    const t=performance.now();vectors.set(r.digest,await embedCatalogVisualImage(b));embeddingTimes.push({cardId:r.id,ms:performance.now()-t});
  }
  await save('temporary-vectors',Object.fromEntries(vectors));
  const old=snap.refs.map((r:any)=>({key:r.content_digest??r.url,vector:new Float32Array(normalizeVisualVector(r.embedding)),cards:snap.cards.filter((c:any)=>c.url===r.url).map((c:any)=>({cardId:c.id,name:c.name}))}));
  function index(withNegatives:boolean) {
    const out=new Map<string,any>();
    for(const r of old) {
      const existing=out.get(r.key);
      if(!existing)out.set(r.key,{...r,cards:[...r.cards]});
      else {
        if(existing.vector.some((v:number,i:number)=>v!==r.vector[i]))throw Error('Same-byte frozen references have inconsistent vectors');
        for(const c of r.cards)if(!existing.cards.some((x:any)=>x.cardId===c.cardId))existing.cards.push(c);
      }
    }
    for(const r of refs.filter((r:any)=>withNegatives||positiveIds.has(r.id))) {
      let row:any=out.get(r.digest);
      if(!row) {row={key:r.digest,vector:new Float32Array(vectors.get(r.digest)!),cards:[]};out.set(r.digest,row);}
      if(!row.cards.some((c:any)=>c.cardId===r.id))row.cards.push({cardId:r.id,name:r.name});
    }
    return [...out.values()];
  }
  const a=index(false),b=index(true),runs=[];
  for(const c of snap.cards.filter((c:any)=>snap.refs.some((r:any)=>r.url===c.url))) {
    if(!a.some(r=>r.cards.some((x:any)=>x.cardId===c.id))||!b.some(r=>r.cards.some((x:any)=>x.cardId===c.id)))throw Error(`Lost frozen distractor ID ${c.id}`);
  }
  for(const c of cases) {
    const original=await fs.readFile(`${review}/${c.originalPhotoFile}`);
    if(hash(original)!==c.imageHash)throw Error('Original changed');
    const start=performance.now(),v=await embedCatalogVisualImage(original),embeddingMs=performance.now()-start;
    const search=(index:any[])=>{
      const t=performance.now();
      const ranked=index.flatMap(r=>{const similarity=visualCosine(v,r.vector);return r.cards.map((card:any)=>({...card,similarity,digest:r.key}));}).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
      const rank=ranked.findIndex(r=>r.cardId===c.cardId)+1;
      return {rank:rank||null,correctScore:rank?ranked[rank-1].similarity:null,top10:ranked.slice(0,10),margin:ranked[0].similarity-ranked[1].similarity,searchMs:performance.now()-t,aboveCorrect:rank?ranked.slice(0,rank-1):[]};
    };
    const run={scanId:c.scanId,cardId:c.cardId,scored:positiveIds.has(c.cardId),imageHash:c.imageHash,embeddingMs,A:search(a),B:search(b),vector:v};runs.push(run);
    await save('runs',runs);console.log('RESULT',JSON.stringify({...run,vector:undefined}));
  }
  const scored=runs.filter(r=>r.scored);
  const summary=(test:string)=>({n:scored.length,top1:scored.filter(r=>r[test].rank===1).length,top3:scored.filter(r=>r[test].rank&&r[test].rank<=3).length,top10:scored.filter(r=>r[test].rank&&r[test].rank<=10).length,meanSearchMs:runs.reduce((s,r)=>s+r[test].searchMs,0)/runs.length});
  await save('summary',{A:summary('A'),B:summary('B'),indexA:{uniqueDigests:a.length,cardIds:a.flatMap(r=>r.cards).length},indexB:{uniqueDigests:b.length,cardIds:b.flatMap(r=>r.cards).length},meanWarmQueryEmbeddingMs:runs.reduce((s,r)=>s+r.embeddingMs,0)/runs.length,referenceEmbeddingTimes:embeddingTimes,coldReferenceEmbeddingMs:embeddingTimes[0]?.ms});
  if(hash(await fs.readFile(`${review}/decisions.json`))!==snap.decisionsHash)throw Error('Decisions changed');
  if(hash(JSON.stringify(snap.refs))!==snap.referencesHash)throw Error('Old index changed');
  console.log('DONE',await read(`${dir}/summary.json`));
}