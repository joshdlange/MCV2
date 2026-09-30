import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {embedCatalogVisualImage,visualCosine,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {downloadCatalogReference} from '../server/services/catalogVisualFetch';
import {assertAuthorizedMixedIsolationAudit} from './dev-dino-next-evaluation.mjs';
process.umask(0o077);process.env.CATALOG_VISUAL_OFFLINE='true';
const root=process.argv[2],mode=process.argv[3];
assert(/^\/tmp\/mcv-strong41-[A-Za-z0-9]+$/.test(root));
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=(p:string,v:any)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2),{mode:0o600});
const old=await read('attached_assets/dev-broad-readonly-production-results.json');
if(mode==='qa'){
 const p=await read(`${root}/prepared.json`),d=await read(`${root}/detections.json`);
 const strata:any={
 'clean/simple':[2790,2813,2835,2901,3012],
 'background/hand':[2866,2869,2871,2981,2983,2984,3169],
 'glare':[2823,2824,2825,2899,2900,2902,2903,2906,2909,2910,2965,2969,3056,3086,3090,3173],
 'binder/neighbors':[3014,3056,3078,3086,3087,3090,3097,3098,3100,3104,3108,3173],
 'sleeve/toploader':[2823,2824,2825,2826,2836,2838,2939,2950,3014,3056,3078,3086,3087,3090,3097,3098,3100,3104,3108,3173],
 'rotation/perspective':[2866,2869,2981,3014,3056,3086,3090,3104,3108]};
 const notes:any={
 2835:'Complete physical card retained; corners slightly outside top/left boundary retain a narrow surround. No visible artwork/text cutoff; approximate, not tight pixel-accurate corners.',
 2899:'Physical card isolated with complete figure and both bottom labels; tight approximate edge fit. Glare remains in the crop; no significant visible content loss.',
 2900:'Correct physical card, but top-right boundary crosses slightly inside the actual edge and trims a thin artwork band. Conservatively counted as a cutoff and excluded from strict full-card success; not a wrong-object detection.',
 2906:'Corners track outer card boundary and preserve top logo, artwork and bottom labels. No visible content cutoff.',
 2910:'Corners track physical card; title and artist label retained. Glare remains; no meaningful visible artwork/text cutoff.',
 3012:'Outer card rectangle retained including logo and bottom labels; right artwork/name reaches original card edge and is not newly clipped. No visible content cutoff.'};
 const qa=p.cases.map((c:any)=>{const x=d.results.find((r:any)=>r.input===c.file);return{scanId:c.scanId,accepted:x.accepted,fullCard:x.accepted&&c.scanId!==2900,falseDetection:false,cutoff:c.scanId===2900,
 cornerQuality:x.accepted?(c.scanId===2900?'poor':[2835,2899].includes(c.scanId)?'approximate':'good'):'not-emitted',
 strata:Object.keys(strata).filter(k=>strata[k].includes(c.scanId)),positiveReverified:c.scanId!==2939,
 difficulty:[2866,2869,2871,2950,2981,2983,2984,3014,3056,3078,3086,3087,3090,3098,3108,3169,3173].includes(c.scanId)?'difficult':[2790,2813,2835,2901,3012].includes(c.scanId)?'easy':'moderate',
 notes:notes[c.scanId]??'Explicit abstention: no crop or physical-card corners emitted. Original front reviewed; no emitted detection to score for clipping.'};});
 await save('qa',qa);console.log({reviewed:qa.length,emitted:qa.filter((x:any)=>x.accepted).length,fullCard:qa.filter((x:any)=>x.fullCard).length,cutoffs:1});
}
if(mode==='prepare'){
 const response=await read(`${root}/extract-response.json`);
 const cases=response.output.trim().split('\n').slice(1).filter((l:string)=>/^\d+,/.test(l)).map((l:string)=>{const [id,url,card]=l.split(',');return{scanId:+id,url,cardId:+card,file:`${root}/query-${id}.image`};});
 assert.equal(cases.length,41);
 assertAuthorizedMixedIsolationAudit(cases.map((c:any)=>c.scanId),old.perCase.map((c:any)=>c.scanId));
 for(const c of cases){assert.equal(c.cardId,old.perCase.find((x:any)=>x.scanId===c.scanId)?.confirmedCardId);const r=await fetch(c.url);assert(r.ok);await fs.writeFile(c.file,Buffer.from(await r.arrayBuffer()),{mode:0o600});}
 const dev=await read('.local/broad-validation/dev-catalog-snapshot.json'),manifest=await read('.local/broad-validation/reference-manifest.json');
 const selected=new Map<number,any>(manifest.rows.filter((r:any)=>!r.error).map((r:any)=>[r.id,r]));
 // Deliberately reproduce last experiment's3045 recipe, not the deleted3046 index.
 const usable=(r:any)=>r.url?.startsWith('https://res.cloudinary.com/')&&!r.url.includes('/scan_uploads/')&&!r.archived_at&&r.set_active&&!r.set_archived;
 for(const c of old.perCase){const p=dev.find((r:any)=>r.id===c.confirmedCardId);if(!p||!usable(p))continue;const extra=[p,...dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.main_set_id===p.main_set_id&&r.card_number===p.card_number).sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,4),...dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.name.toLowerCase()===p.name.toLowerCase()).sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,2)];for(const r of extra)if(!selected.has(r.id)){const bytes=await downloadCatalogReference(r.url),file=`${root}/ref-${r.id}.image`;await fs.writeFile(file,bytes,{mode:0o600});selected.set(r.id,{...r,file,digest:hash(bytes)});}}
 const refs=[...selected.values()],vectors=new Map();
 for(const r of refs){if(vectors.has(r.digest))continue;let v;try{v=await read(`.local/broad-validation/vectors/${r.digest}.json`);assert.equal(v.model,MODEL_VERSION);}catch{v={vector:await embedCatalogVisualImage(await fs.readFile(r.file))};}vectors.set(r.digest,v.vector);}
 const missing=cases.filter((c:any)=>!selected.has(c.cardId)).map((c:any)=>({scanId:c.scanId,cardId:c.cardId}));
 await save('prepared',{cases,refs,vectors:[...vectors],missing,model:MODEL_VERSION,indexHash:hash(JSON.stringify(refs.map(r=>({id:r.id,digest:r.digest}))))});
 await save('catalog-relationship',dev.filter((r:any)=>[20279,530526,20280,530527].includes(r.id)));
 console.log({cases:cases.length,indexIds:refs.length,missing});
}
if(mode==='sheets'){
 const p=await read(`${root}/prepared.json`);let detections:any;try{detections=await read(`${root}/detections.json`);}catch{}
 for(let group=0;group<Math.ceil(p.cases.length/5);group++){
 const rows=p.cases.slice(group*5,group*5+5),tiles=[];
 for(let j=0;j<rows.length;j++){const c=rows[j],ref=p.refs.find((r:any)=>r.id===c.cardId),d=detections?.results.find((r:any)=>r.input===c.file);
 const show=[{file:c.file,label:`Query ${c.scanId}`},{file:ref?.file,label:`Positive ${c.cardId}`},{file:d?.accepted?d.cropFile:c.file,label:d?`${d.accepted?'CROP':'ABSTAIN'} ${c.scanId}`:'Not yet detected'}];
 for(let col=0;col<3;col++){if(show[col].file)tiles.push({input:await sharp(show[col].file).rotate().resize(280,310,{fit:'contain',background:'#eeeeee'}).png().toBuffer(),left:col*280,top:j*340+30});tiles.push({input:Buffer.from(`<svg width="280" height="30"><text x="4" y="20" font-size="16">${show[col].label}</text></svg>`),left:col*280,top:j*340});}}
 await sharp({create:{width:840,height:340*rows.length,channels:3,background:'white'}}).composite(tiles).png().toFile(`${root}/sheet-${group}.png`);
 }
}
if(mode==='infer'){
 const p=await read(`${root}/prepared.json`),d=await read(`${root}/detections.json`),v=new Map<string,number[]>(p.vectors),qa=await read(`${root}/qa.json`),out=[];
 assert.equal(qa.length,41); // Manual detection review precedes recognition.
 for(const c of p.cases){const det=d.results.find((r:any)=>r.input===c.file);assert(det);const arms:any={};
 for(const arm of ['raw','isolated']){const input=arm==='isolated'&&det.accepted?det.cropFile:c.file,t=performance.now(),vector=await embedCatalogVisualImage(await fs.readFile(input));
 const ranked=p.refs.map((r:any)=>({cardId:r.id,similarity:visualCosine(vector,v.get(r.digest)!)})).sort((a:any,b:any)=>b.similarity-a.similarity||a.cardId-b.cardId);
 const rank=ranked.findIndex((r:any)=>r.cardId===c.cardId)+1;arms[arm]={rank:rank||null,ms:performance.now()-t,top10:ranked.slice(0,10).map((r:any)=>r.cardId)};}
 out.push({scanId:c.scanId,cardId:c.cardId,accepted:det.accepted,...arms});}
 await save('recognition',out);console.log({done:out.length});
}