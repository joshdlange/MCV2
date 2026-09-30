import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {downloadCatalogReference} from '../server/services/catalogVisualFetch';
import {assertAuthorizedFailureAudit} from './dev-dino-next-evaluation.mjs';
process.umask(0o077);process.env.CATALOG_VISUAL_OFFLINE='true';
const root=process.argv[2],mode=process.argv[3]||'prepare';
assert(/^\/tmp\/mcv-failure12-[A-Za-z0-9]+$/.test(root));
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const save=async(p:string,v:any)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2),{mode:0o600});
const old=await read('attached_assets/dev-broad-readonly-production-results.json');
if(mode==='prepare'){
 const response=await read(`${root}/extract-response.json`);
 const rows=response.output.trim().split('\n').slice(1).filter((l:string)=>/^\d+,/.test(l)).map((l:string)=>{const [id,url,card]=l.split(',');return{scanId:Number(id),url,cardId:Number(card)};});
 assert.equal(rows.length,12);
 const allowed=[3173,3169,3090,3086,3056,2981,3098,3087,2984,2983,2899,2866];
 for(const c of rows){assert(allowed.includes(c.scanId));assert.equal(c.cardId,old.perCase.find((x:any)=>x.scanId===c.scanId).confirmedCardId);const res=await fetch(c.url);assert(res.ok);c.file=`${root}/query-${c.scanId}.image`;await fs.writeFile(c.file,Buffer.from(await res.arrayBuffer()),{mode:0o600});}
 const dev=await read('.local/broad-validation/dev-catalog-snapshot.json'),manifest=await read('.local/broad-validation/reference-manifest.json');
 const selected=new Map<number,any>(manifest.rows.filter((r:any)=>!r.error).map((r:any)=>[r.id,r]));
 const usable=(r:any)=>r.url?.startsWith('https://res.cloudinary.com/')&&!r.url.includes('/scan_uploads/')&&!r.archived_at&&r.set_active&&!r.set_archived;
 for(const c of old.perCase){const p=dev.find((r:any)=>r.id===c.confirmedCardId);if(!p||!usable(p)){assert(!rows.some((r:any)=>r.cardId===c.confirmedCardId));continue;}const extra=[p,...dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.main_set_id===p.main_set_id&&r.card_number===p.card_number).sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,4),...dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.name.toLowerCase()===p.name.toLowerCase()).sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,2)];for(const r of extra)if(!selected.has(r.id)){const bytes=await downloadCatalogReference(r.url),file=`${root}/ref-${r.id}.image`;await fs.writeFile(file,bytes,{mode:0o600});selected.set(r.id,{...r,file,digest:hash(bytes)});}}
 const refs=[...selected.values()],vectors=new Map<string,number[]>();
 for(const r of refs){if(vectors.has(r.digest))continue;const cache=`.local/broad-validation/vectors/${r.digest}.json`;let v;try{v=await read(cache);assert.equal(v.model,MODEL_VERSION);}catch{v={vector:await embedCatalogVisualImage(await fs.readFile(r.file))};}vectors.set(r.digest,v.vector);}
 await save('prepared',{cases:rows,refs,vectors:[...vectors],model:MODEL_VERSION,indexDescription:'Reconstructed bounded index from old2938 cached IDs plus41 historical positive IDs and the same bounded metadata recipe using DEV snapshot only; byte-for-byte identity to deleted3046 index is NOT asserted.'});
 console.log(JSON.stringify({queries:rows.length,indexIds:refs.length,embeddings:vectors.size}));
}
if(mode==='raw'||mode==='crop'){
 const p=await read(`${root}/prepared.json`),vectors=new Map<string,number[]>(p.vectors),outputs=[];
 assertAuthorizedFailureAudit(p.cases.map((c:any)=>c.scanId));
 if(mode==='crop'){const marker=await read('.local/independent-card-detector-ready.json');assert.equal(marker.sourceHash,hash(await fs.readFile('scripts/dev-independent-card-detector.py')));await save('detector-freeze',{marker,sha256:hash(await fs.readFile('scripts/dev-independent-card-detector.py'))});}
 for(const c of p.cases){
  let input=c.file,detection=null;
  if(mode==='crop'){const output=`${root}/crop-${c.scanId}.png`;const stdout=execFileSync('.pythonlibs/bin/python3',['scripts/dev-independent-card-detector.py','--input',c.file,'--output',output],{encoding:'utf8'});detection=JSON.parse(stdout);try{await fs.access(output);input=output;}catch{}}
  const b=await fs.readFile(input),times=[],rankings=[];
  for(let pass=0;pass<2;pass++){const t=performance.now(),v=await embedCatalogVisualImage(b);const ranked=p.refs.map((r:any)=>({cardId:r.id,score:visualCosine(v,vectors.get(r.digest)!)})).sort((a:any,b:any)=>b.score-a.score||a.cardId-b.cardId);times.push(performance.now()-t);rankings.push(ranked);}
  const rank=rankings[0].findIndex((r:any)=>r.cardId===c.cardId)+1;assert.equal(rank,rankings[1].findIndex((r:any)=>r.cardId===c.cardId)+1);
  outputs.push({scanId:c.scanId,cardId:c.cardId,rank,top10:rankings[0].slice(0,10),times,detection,input,rawFallback:input===c.file,historicalRank:old.perCase.find((r:any)=>r.scanId===c.scanId).rawDinoRank});
  const show=[{file:c.file,label:`Query ${c.scanId}`},...(mode==='crop'?[{file:input,label:'Detector output/fallback'}]:[]),{file:p.refs.find((r:any)=>r.id===c.cardId).file,label:`Positive ${c.cardId}`},...rankings[0].slice(0,4).map((r:any,i:number)=>({file:p.refs.find((x:any)=>x.id===r.cardId).file,label:`Top${i+1} ${r.cardId}`}))];
  const tiles=[];for(let i=0;i<show.length;i++){tiles.push({input:await sharp(show[i].file).rotate().resize(260,340,{fit:'contain',background:'#eeeeee'}).png().toBuffer(),left:i*260,top:30});tiles.push({input:Buffer.from(`<svg width="260" height="30"><text x="4" y="20" font-size="16">${show[i].label}</text></svg>`),left:i*260,top:0});}
  await sharp({create:{width:260*show.length,height:370,channels:3,background:'white'}}).composite(tiles).png().toFile(`${root}/${mode}-sheet-${c.scanId}.png`);
 }
 await save(`${mode}-results`,outputs);console.log(JSON.stringify(outputs.map(({scanId,rank,historicalRank,rawFallback})=>({scanId,rank,historicalRank,rawFallback}))));
}