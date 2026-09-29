import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const dir='.local/detail-orb',detail='.local/detail-experiment',bounded='.local/bounded-dino';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(`${dir}/images`,{recursive:true});
const [stage1,frozen,manifest,prior]=await Promise.all([read(`${detail}/stage1.json`),read(`${bounded}/frozen-selection.json`),read(`${bounded}/manifest.json`),read('.local/image-experiment/snapshot.json')]);
const refMap=new Map<string,any>();
const cases=[];
for(const c of frozen.eligible){
  const raw=stage1.find((r:any)=>r.scanId===c.scanId),file=`${dir}/images/query-${c.scanId}.png`;
  const original=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`);
  if(hash(original)!==c.imageHash)throw Error('Original changed');
  await sharp(original).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).png().toFile(file);
  const candidates=[];
  for(const r of raw.raw.slice(0,10)){
    if(!refMap.has(r.digest)){
      const rr=manifest.references.find((ref:any)=>ref.digest===r.digest&&ref.file);
      const input=rr?`${bounded}/${rr.file}`:`${detail}/references/${r.digest}.image`;
      const bytes=await fs.readFile(input);if(hash(bytes)!==r.digest)throw Error('Reference changed');
      const out=`${dir}/images/ref-${r.digest}.png`;
      const meta=await sharp(bytes).rotate().resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).png().toFile(out);
      refMap.set(r.digest,{digest:r.digest,file:out,cardIds:[],width:meta.width,height:meta.height,ratio:meta.width/meta.height});
    }
    const ref=refMap.get(r.digest);if(!ref.cardIds.includes(r.cardId))ref.cardIds.push(r.cardId);
    candidates.push({cardId:r.cardId,digest:r.digest});
  }
  cases.push({scanId:c.scanId,file,originalHash:c.imageHash,candidates});
}
const refs=[...refMap.values()];
for(let offset=0;offset<refs.length;offset+=16){
  const tiles=[];
  for(let i=offset;i<Math.min(offset+16,refs.length);i++){
    const r=refs[i],im=await sharp(await fs.readFile(r.file)).resize(160,220,{fit:'contain',background:'#ccc'}).jpeg().toBuffer();
    const text=Buffer.from(`<svg width="180" height="40"><rect width="180" height="40" fill="white"/><text x="4" y="14" font-size="12">R${i} #${r.cardIds.join(',')}</text><text x="4" y="31" font-size="11">ratio ${r.ratio.toFixed(3)}</text></svg>`);
    tiles.push(await sharp({create:{width:180,height:260,channels:3,background:'white'}}).composite([{input:im,left:10,top:0},{input:text,left:0,top:220}]).jpeg().toBuffer());
    r.reviewIndex=i;
  }
  await sharp({create:{width:720,height:Math.ceil(tiles.length/4)*260,channels:3,background:'white'}}).composite(tiles.map((input,i)=>({input,left:i%4*180,top:Math.floor(i/4)*260}))).jpeg({quality:92}).toFile(`${dir}/reference-sheet-${offset/16+1}.jpg`);
}
const job={createdAt:new Date().toISOString(),cases,refs,original958Hash:prior.referencesHash,frozenSelectionHash:hash(await fs.readFile(`${bounded}/frozen-selection.json`)),
  policy:{orbFeatures:3000,ratioTest:.75,ransacPixels:3,minInliers:20,minInlierRatio:.5,minReferenceHullCoverage:.25,minInlierSpan:.5,maxMedianError:3,maxP95Error:6,minQueryArea:.15,maxQueryArea:.9,maxOppositeSideRatio:1.6,ambiguitySupportFraction:.75,maxAmbiguousCornerDistance:.04,
    referenceBoundary:'Only independently visually verified tight complete card-face rasters; no automatic assumption that a slab, watermark or photographed scene extent equals card boundary.',
    ranking:'Geometry quality only (inliers*inlierRatio*sourceHullCoverage/(1+medianError)); no labels, card metadata or DINO scores choose homography. Candidate pool strictly frozen original stage1top10.'}};
await fs.writeFile(`${dir}/job.json`,JSON.stringify(job,null,2),{flag:'wx'});
console.log('ORB JOB',cases.length,'queries',refs.length,'unique raw top10 references');