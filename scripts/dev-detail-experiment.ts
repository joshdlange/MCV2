import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { FROZEN_DETAIL_POLICY,isolateCard,raster,referenceFeatures,alignAndCompare } from './dev-detail-vision';
import { embedCatalogVisualImage,normalizeVisualVector,visualCosine,MODEL_VERSION } from '../server/services/catalogVisualModel';
import { downloadCatalogReference } from '../server/services/catalogVisualFetch';
const dir='.local/detail-experiment',bounded='.local/bounded-dino',review='.local/scan-review';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const save=async(p:string,v:any)=>fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
await fs.mkdir(`${dir}/references`,{recursive:true});
if(process.env.NODE_ENV==='production')throw Error('DEV only');
process.env.CATALOG_VISUAL_OFFLINE='true';
const frozen=await read(`${bounded}/frozen-selection.json`),manifest=await read(`${bounded}/manifest.json`),prior=await read('.local/image-experiment/snapshot.json');
const cases=frozen.eligible;
const mode=process.argv[2]??'prepare';
if(mode==='prepare'){
  // Archive the first geometry-only proposal run. No query scores existed when
  // visual QA rejected clipped Hough rectangles; weights are not changed.
  try{await fs.copyFile(`${dir}/policy.json`,`${dir}/policy-v1-before-visual-qa.json`);await fs.unlink(`${dir}/policy.json`);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const policy={createdAt:new Date().toISOString(),...FROZEN_DETAIL_POLICY,primaryCandidateCount:10,model:MODEL_VERSION,visionSourceHash:hash(await fs.readFile('scripts/dev-detail-vision.ts')),boundedSelectionHash:hash(await fs.readFile(`${bounded}/frozen-selection.json`)),cohort:cases.map((c:any)=>({scanId:c.scanId,cardId:c.cardId})),note:'Weights, alignment gates and geometry source frozen before crop inspection or inference. Crop review accepts/rejects geometry only; never changes corners or uses retrieval scores.'};
  await fs.writeFile(`${dir}/policy.json`,JSON.stringify(policy,null,2),{flag:'wx'});
  const proposals=[];
  for(const c of cases){
    const bytes=await fs.readFile(`${review}/${c.originalPhotoFile}`),r=await isolateCard(bytes);
    await fs.writeFile(`${dir}/${c.scanId}-proposal.jpg`,r.bytes);
    await fs.writeFile(`${dir}/${c.scanId}-outline.jpg`,r.outline);
    proposals.push({scanId:c.scanId,...r,bytes:undefined,outline:undefined});
    console.log('GEOMETRY',JSON.stringify(proposals.at(-1)));
  }
  await save('proposals',proposals);
  for(let offset=0;offset<cases.length;offset+=3){
    const tiles=[];
    for(const c of cases.slice(offset,offset+3))for(const [label,file] of [['Original',`${review}/${c.originalPhotoFile}`],['Outline',`${dir}/${c.scanId}-outline.jpg`],['Proposal',`${dir}/${c.scanId}-proposal.jpg`]]){
      const im=await sharp(await fs.readFile(file)).rotate().resize(220,290,{fit:'contain',background:'#eee'}).jpeg().toBuffer();
      const text=Buffer.from(`<svg width="220" height="30"><rect width="220" height="30" fill="white"/><text x="6" y="20" font-size="14">${c.scanId} ${label}</text></svg>`);
      tiles.push(await sharp({create:{width:220,height:320,channels:3,background:'white'}}).composite([{input:im,left:0,top:0},{input:text,left:0,top:290}]).jpeg().toBuffer());
    }
    await sharp({create:{width:660,height:960,channels:3,background:'white'}}).composite(tiles.map((input,i)=>({input,left:(i%3)*220,top:Math.floor(i/3)*320}))).jpeg({quality:92}).toFile(`${dir}/crop-sheet-${offset/3+1}.jpg`);
  }
}
if(mode==='run'){
  const policy=await read(`${dir}/policy.json`),cropReview=await read(`${dir}/crop-review.json`),proposals=await read(`${dir}/proposals.json`);
  if(hash(await fs.readFile('scripts/dev-detail-vision.ts'))!==policy.visionSourceHash)throw Error('Frozen vision policy source changed');
  if(hash(await fs.readFile(`${bounded}/frozen-selection.json`))!==policy.boundedSelectionHash)throw Error('Frozen B selection changed');
  const newVectors=await read(`${bounded}/temporary-vectors.json`),refs=new Map<string,any>(),byId=new Map<number,any>();
  for(const r of prior.refs){
    const ids=prior.cards.filter((c:any)=>c.url===r.url).map((c:any)=>({cardId:c.id,name:c.name}));
    const existing=refs.get(r.content_digest);
    if(existing)existing.cards.push(...ids);else refs.set(r.content_digest,{digest:r.content_digest,url:r.url,vector:new Float32Array(normalizeVisualVector(r.embedding)),cards:ids});
  }
  for(const r of manifest.references.filter((r:any)=>frozen.referenceIds.includes(r.id))){
    let ref=refs.get(r.digest);
    if(!ref){ref={digest:r.digest,url:r.url,file:`${bounded}/${r.file}`,vector:new Float32Array(newVectors[r.digest]),cards:[]};refs.set(r.digest,ref);}
    if(!ref.cards.some((c:any)=>c.cardId===r.id))ref.cards.push({cardId:r.id,name:r.name});
  }
  for(const r of refs.values())for(const c of r.cards)byId.set(c.cardId,r);
  if(byId.size!==1023||refs.size!==823)throw Error('Frozen B index cardinality mismatch');
  function search(v:number[]){
    const start=performance.now();
    const ranked=[...refs.values()].flatMap(r=>{const similarity=visualCosine(v,r.vector);return r.cards.map((c:any)=>({...c,similarity,digest:r.digest}));}).sort((a,b)=>b.similarity-a.similarity||a.cardId-b.cardId);
    return{ranked,ms:performance.now()-start};
  }
  const stage1:any[]=[];
  for(const c of cases){
    const original=await fs.readFile(`${review}/${c.originalPhotoFile}`);
    if(hash(original)!==c.imageHash)throw Error('Original changed');
    const accepted=cropReview.find((r:any)=>r.scanId===c.scanId)?.accepted===true;
    const cropped=accepted?await fs.readFile(`${dir}/${c.scanId}-proposal.jpg`):original;
    const start=performance.now(),rawVector=await embedCatalogVisualImage(original),rawEmbeddingMs=performance.now()-start;
    const ct=performance.now(),cropVector=await embedCatalogVisualImage(cropped),cropEmbeddingMs=performance.now()-ct;
    const raw=search(rawVector),crop=search(cropVector);
    stage1.push({scanId:c.scanId,cardId:c.cardId,cropAccepted:accepted,imageHash:c.imageHash,cropHash:hash(cropped),rawVector,cropVector,rawEmbeddingMs,cropEmbeddingMs,rawSearchMs:raw.ms,cropSearchMs:crop.ms,raw:raw.ranked,crop:crop.ranked});
    console.log('STAGE1',c.scanId,'rawRank',raw.ranked.findIndex(r=>r.cardId===c.cardId)+1,'cropRank',crop.ranked.findIndex(r=>r.cardId===c.cardId)+1);
  }
  await save('stage1',stage1);
  const needed=new Map<string,any>();
  for(const r of stage1)for(const candidate of [...r.raw.slice(0,10),...r.crop.slice(0,10)])needed.set(candidate.digest,byId.get(candidate.cardId));
  const features=new Map<string,any>(),featureQA:any[]=[];
  const all=[...needed.values()];
  let at=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(at<all.length){
      const r=all[at++];let bytes:Buffer;
      const fetchStart=performance.now();
      try{
        if(r.file)bytes=await fs.readFile(r.file);
        else{
          const file=`${dir}/references/${r.digest}.image`;
          try{bytes=await fs.readFile(file);}catch(e:any){if(e.code!=='ENOENT')throw e;bytes=await downloadCatalogReference(r.url);await fs.writeFile(file,bytes);}
        }
        if(hash(bytes)!==r.digest)throw Error('Downloaded reference differs from frozen indexed bytes');
        const fetchMs=performance.now()-fetchStart,t=performance.now(),f=referenceFeatures(await raster(bytes)),featureMs=performance.now()-t;
        features.set(r.digest,f);
        featureQA.push({digest:r.digest,cardIds:r.cards.map((c:any)=>c.cardId),fetchMs,featureMs,ok:true});
      }catch(e:any){featureQA.push({digest:r.digest,cardIds:r.cards.map((c:any)=>c.cardId),ok:false,error:e.message});}
    }
  }));
  await save('reference-feature-cache',Object.fromEntries([...features].map(([key,values])=>[key,values.map((v:any)=>({...v,features:{...v.features,rgb:Array.from(v.features.rgb),gray:Array.from(v.features.gray)}}))])));
  await save('feature-qa',featureQA);
  function rerank(top:any[],query:any){
    const start=performance.now();
    const scored=top.map(candidate=>{
      const f=features.get(candidate.digest);
      const evidence=f?alignAndCompare(query,f):{reliable:false,reason:'Reference features unavailable',detailScore:0};
      const detail=evidence.reliable?evidence.detailScore:candidate.similarity;
      const score=policy.dinoWeight*candidate.similarity+policy.detailWeight*detail;
      return{...candidate,rerankScore:score,evidence};
    });
    const sorted=[...scored].sort((a,b)=>b.rerankScore-a.rerankScore||a.cardId-b.cardId);
    // Ablations reuse exactly the same alignment, no refitting or weight tuning.
    const ablation:any={};
    for(const key of ['borderColor','regionalColor','edgeLayout','luminanceStructure']){
      ablation[key]=[...scored].map(c=>({...c,score:policy.dinoWeight*c.similarity+policy.detailWeight*(c.evidence.reliable?c.evidence.signals[key]:c.similarity)})).sort((a,b)=>b.score-a.score||a.cardId-b.cardId).map(c=>c.cardId);
    }
    return{top10:sorted,ms:performance.now()-start,ablation};
  }
  const runs=[];
  for(const r of stage1){
    const c=cases.find((c:any)=>c.scanId===r.scanId),original=await fs.readFile(`${review}/${c.originalPhotoFile}`),crop=r.cropAccepted?await fs.readFile(`${dir}/${r.scanId}-proposal.jpg`):original;
    const qt=performance.now(),qraw=await raster(original),rawFeatureMs=performance.now()-qt;
    const ct=performance.now(),qcrop=await raster(crop),cropFeatureMs=performance.now()-ct;
    const B=rerank(r.raw.slice(0,10),qraw),C=rerank(r.crop.slice(0,10),qcrop);
    const rank=(top:any[])=>{const i=top.findIndex(c=>c.cardId===r.cardId);return i<0?null:i+1;};
    const A={rank:rank(r.raw),top10:r.raw.slice(0,10)};
    const result={scanId:r.scanId,cardId:r.cardId,cropAccepted:r.cropAccepted,A,B:{...B,rank:rank(B.top10)},C:{...C,rank:rank(C.top10),stage1Rank:rank(r.crop)},
      timing:{rawEmbeddingMs:r.rawEmbeddingMs,cropEmbeddingMs:r.cropEmbeddingMs,rawSearchMs:r.rawSearchMs,cropSearchMs:r.cropSearchMs,rawFeatureMs,cropFeatureMs,cropMs:proposals.find((p:any)=>p.scanId===r.scanId).ms,
        BtotalMs:r.rawEmbeddingMs+r.rawSearchMs+rawFeatureMs+B.ms,CtotalMs:proposals.find((p:any)=>p.scanId===r.scanId).ms+r.cropEmbeddingMs+r.cropSearchMs+cropFeatureMs+C.ms}};
    runs.push(result);await save('runs',runs);
    console.log('RESULT',r.scanId,'A',A.rank,'B',result.B.rank,'C',result.C.rank,'Bms',B.ms,'Cms',C.ms);
  }
  const stats=(k:string)=>({n:runs.length,top1:runs.filter(r=>r[k].rank===1).length,top3:runs.filter(r=>r[k].rank&&r[k].rank<=3).length,top10:runs.filter(r=>r[k].rank&&r[k].rank<=10).length});
  const summary={A:stats('A'),B:stats('B'),C:stats('C'),acceptedCrops:runs.filter(r=>r.cropAccepted).length,meanTiming:Object.fromEntries(Object.keys(runs[0].timing).map(k=>[k,runs.reduce((s,r)=>s+r.timing[k],0)/runs.length])),warmRawEmbeddingMs:stage1.slice(1).reduce((s,r)=>s+r.rawEmbeddingMs,0)/(stage1.length-1),firstColdRawEmbeddingMs:stage1[0].rawEmbeddingMs,featureReferences:features.size,featureErrors:featureQA.filter(r=>!r.ok),referenceFeatureComputeMs:featureQA.reduce((s,r)=>s+(r.featureMs??0),0)};
  await save('summary',summary);
  if(hash(await fs.readFile(`${review}/decisions.json`))!==prior.decisionsHash)throw Error('Decisions changed');
  console.log('SUMMARY',JSON.stringify(summary));
}