import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {downloadCatalogReference} from '../server/services/catalogVisualFetch';
process.umask(0o077);
const root=process.argv[2];
assert(/^\/tmp\/mcv-private-validation-[A-Za-z0-9]+$/.test(root),'Owned private root required');
assert.equal(await fs.realpath(root),root);
await fs.chmod(root,0o700);
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2),{mode:0o600});
const raw=await read(`${root}/reference-tool-output.json`);
const refs=JSON.parse(Buffer.from(raw.output.trim().split('\n').slice(1).join('').replace(/^"|"$/g,''),'base64').toString('utf8'));
await save('catalog-positives',refs);
const extract=await read(`${root}/extract.json`),dev=await read('.local/broad-validation/dev-catalog-snapshot.json');
assert(extract.rows.length<=100);
await fs.mkdir(`${root}/queries`,{mode:0o700});
await fs.mkdir(`${root}/references`,{mode:0o700});
await fs.mkdir(`${root}/sheets`,{mode:0o700});
const actualIds=(await read('.local/broad-validation/continuation-availability.json')).actualQueryIds.concat(2837);
const provenance=await read('.local/scan-review/provenance.json');
const prior=[];
async function dhash(b:Buffer,rotation=0){
  const data=await sharp(b).rotate(rotation).resize(17,16,{fit:'fill'}).grayscale().raw().toBuffer();
  return Array.from({length:256},(_,i)=>data[Math.floor(i/16)*17+i%16]>data[Math.floor(i/16)*17+i%16+1]?'1':'0').join('');
}
const distance=(a:string,b:string)=>[...a].reduce((s,v,i)=>s+(v!==b[i]?1:0),0);
for(const p of provenance.selected.filter((p:any)=>actualIds.includes(p.scanId))){
  const b=await fs.readFile(`.local/scan-review/${p.originalPhotoFile}`);
  prior.push({scanId:p.scanId,digest:hash(b),dhash:await dhash(b)});
}
const cases:any[]=extract.rows.map((r:any)=>({scanId:r.scan_id,cardId:r.confirmed_card_id,
  queryUrl:r.image_url,technical:{scanAt:r.scan_created_at,selectionAt:r.selection_at,feedbackTypes:r.feedback_types,sameOwner:r.same_owner},
  reference:refs.find((p:any)=>p.id===r.confirmed_card_id)??dev.find((p:any)=>p.id===r.confirmed_card_id)}));
let cursor=0,done=0;
async function worker(){
  while(cursor<cases.length){
    const c=cases[cursor++];
    try{
      const b=await downloadCatalogReference(c.queryUrl);
      c.queryFile=`${root}/queries/${c.scanId}.image`;
      c.queryDigest=hash(b);c.queryDhash=await Promise.all([0,90,180,270].map(r=>dhash(b,r)));
      await fs.writeFile(c.queryFile,b,{mode:0o600});
      c.priorDuplicate=prior.find(p=>p.digest===c.queryDigest||Math.min(...c.queryDhash.map((h:string)=>distance(h,p.dhash)))<=12)?.scanId??null;
    }catch(e){c.queryError='download-or-decode-failed';}
    try{
      const r=c.reference;
      if(!r?.url)throw Error('missing-url');
      if(r.archived_at||!r.set_active||r.set_archived)throw Error('inactive-identity');
      if(!r.url.startsWith('https://res.cloudinary.com/'))throw Error('unsupported-reference-host');
      if(r.url.includes('/scan_uploads/'))throw Error('scan-upload-reference');
      const file=`${root}/references/${r.id}.image`;
      let b:Buffer;try{b=await fs.readFile(file);}catch{b=await downloadCatalogReference(r.url);await fs.writeFile(file,b,{mode:0o600});}
      const meta=await sharp(b).metadata();if(!meta.width||!meta.height||meta.width<80||meta.height<80)throw Error('reference-too-small');
      c.referenceFile=file;c.referenceDigest=hash(b);c.referenceDhash=await dhash(b);
    }catch(e){const msg=(e as Error).message;c.referenceError=['missing-url','inactive-identity','unsupported-reference-host','scan-upload-reference','reference-too-small'].includes(msg)?msg:'download-or-decode-failed';}
    done++;if(done%20===0)console.log('PRIVATE PREPARED',done);
  }
}
await Promise.all(Array.from({length:6},worker));
for(let i=0;i<cases.length;i++){
  const c=cases[i];if(c.queryError)continue;
  const other=cases.slice(0,i).find((o:any)=>!o.queryError&&(o.queryDigest===c.queryDigest||Math.min(...c.queryDhash.map((h:string)=>distance(h,o.queryDhash[0])))<=12));
  c.cohortDuplicate=other?.scanId??null;
  c.referenceCopy=!!c.referenceDigest&&cases.some((o:any)=>o.queryDigest===c.referenceDigest||
    (o.queryDhash&&Math.min(...o.queryDhash.map((h:string)=>distance(h,c.referenceDhash)))<=12));
}
await save('cases-prepared',cases);
const esc=(s:any)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
for(let offset=0;offset<cases.length;offset+=4){
  const tiles=[];
  for(const c of cases.slice(offset,offset+4)){
    const pair=[];
    for(const p of [c.queryFile,c.referenceFile]){
      if(p)pair.push(await sharp(await fs.readFile(p)).rotate().resize(350,430,{fit:'contain',background:'#ddd'}).jpeg().toBuffer());
      else pair.push(await sharp({create:{width:350,height:430,channels:3,background:'#ddd'}}).jpeg().toBuffer());
    }
    const r=c.reference;
    const svg=Buffer.from(`<svg width="700" height="65"><rect width="700" height="65" fill="white"/><text x="5" y="17" font-size="13">Scan ${c.scanId} → card ${c.cardId} ${esc(r?.name).slice(0,65)} #${esc(r?.card_number)}</text><text x="5" y="35" font-size="12">${esc(r?.set_name).slice(0,95)}</text><text x="5" y="53" font-size="11">Ref: ${esc(c.referenceError??'available')} priorDuplicate:${c.priorDuplicate??'no'} cohortDuplicate:${c.cohortDuplicate??'no'} copy:${c.referenceCopy??false}</text></svg>`);
    tiles.push(await sharp({create:{width:700,height:495,channels:3,background:'#ddd'}}).composite([{input:svg,left:0,top:0},{input:pair[0],left:0,top:65},{input:pair[1],left:350,top:65}]).jpeg().toBuffer());
  }
  await sharp({create:{width:700,height:tiles.length*495,channels:3,background:'#ddd'}}).composite(tiles.map((input,i)=>({input,left:0,top:i*495}))).jpeg({quality:87}).toFile(`${root}/sheets/batch-${String(offset/4+1).padStart(2,'0')}.jpg`);
}
await save('preparation-summary',{exported:cases.length,queriesAvailable:cases.filter(c=>!c.queryError).length,
  positiveReferenceAvailable:cases.filter(c=>!c.referenceError).length,priorDuplicates:cases.filter(c=>c.priorDuplicate).length,
  cohortDuplicates:cases.filter(c=>c.cohortDuplicate).length,referenceCopies:cases.filter(c=>c.referenceCopy).length,
  referenceFailures:cases.reduce((o:any,c:any)=>{if(c.referenceError)o[c.referenceError]=(o[c.referenceError]??0)+1;return o;},{})});
console.log(JSON.stringify(await read(`${root}/preparation-summary.json`)));