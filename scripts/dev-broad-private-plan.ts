import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {downloadCatalogReference} from '../server/services/catalogVisualFetch';
import {embedCatalogVisualImage,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {FROZEN_DETAIL_POLICY} from './dev-detail-vision';
process.umask(0o077);process.env.CATALOG_VISUAL_OFFLINE='true';
const root=process.argv[2],mode=process.argv[3]??'plan';
assert(/^\/tmp\/mcv-private-validation-[A-Za-z0-9]+$/.test(root));
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${root}/${p}.json`,JSON.stringify(v,null,2),{mode:0o600});
const candidates=await read(`${root}/cases-prepared.json`);
const acceptedIds=[3173,3169,3108,3104,3100,3098,3097,3090,3087,3086,3078,3056,3014,3012,2984,2983,2981,2969,2965,2950,2939,2910,2909,2906,2903,2902,2901,2900,2899,2871,2869,2866,2838,2836,2835,2826,2825,2824,2823,2813,2790];
const insertIds=[3012,2965,2910,2909,2906,2903,2902,2901,2900,2899,2838,2836,2835,2826,2825,2824,2823];
const wrongIds=[3167,3067,2991,2861,2798,2791,2787];
const ambiguousIds=[3089,3053,3013,2831,2830];
const captureIds=[3107,3103,3102,3112,2829,2828];
const badIds=[3162,3161,3160,3159,3158,3157,3156,3155,3154,3153,3152,3151,3150,3148,3147];
const baseline=await read('.local/broad-validation/baseline-freeze.json');
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256);
async function dhash(b:Buffer){
  const d=await sharp(b).rotate().resize(17,16,{fit:'fill'}).grayscale().raw().toBuffer();
  return Array.from({length:256},(_,i)=>d[Math.floor(i/16)*17+i%16]>d[Math.floor(i/16)*17+i%16+1]?'1':'0').join('');
}
const distance=(a:string,b:string)=>[...a].reduce((s,v,i)=>s+(v!==b[i]?1:0),0);
if(mode==='plan'){
  const qa=candidates.map((c:any)=>{
    const accepted=acceptedIds.includes(c.scanId);
    const reason=accepted?'verified-independent-exact-front'
      :badIds.includes(c.scanId)?'unusable-no-visible-card'
      :captureIds.includes(c.scanId)?'same-card-capture-cluster-or-prior-exposure'
      :wrongIds.includes(c.scanId)?'historical-exact-identity-or-parallel-conflict'
      :ambiguousIds.includes(c.scanId)?'exact-printing-unresolved'
      :c.scanId===2977?'back-image'
      :c.scanId===2938?'capture-origin-indeterminate'
      :c.referenceError==='inactive-identity'?'archived-identity-unresolved'
      :c.referenceError?'independent-positive-reference-unavailable':'unresolved';
    return {scanId:c.scanId,cardId:c.cardId,accepted,reason,parallel:false,
      printedInsert:insertIds.includes(c.scanId),side:badIds.includes(c.scanId)?'not-visible':c.scanId===2977?'back':'front',
      evidence:accepted?'Query/reference inspected side-by-side: exact artwork, composition, logos, borders and printed title/insert indicators agree; independent physical query context versus catalog raster. No inferred foil color parallel.'
       :c.scanId===3112?'Conservatively excluded alongside previously queried3113 Electro: same card and binder capture context.'
       :captureIds.includes(c.scanId)?'Retained only one distinct confirmed-card/capture cluster, excluding repeat views.':'No label changes or inferred replacements.'};
  });
  assert.equal(qa.filter((r:any)=>r.accepted).length,41);
  const cases=candidates.filter((c:any)=>acceptedIds.includes(c.scanId));
  for(const c of cases)assert(!c.queryError&&!c.referenceError&&!c.priorDuplicate&&!c.cohortDuplicate&&!c.referenceCopy);
  const dev=await read('.local/broad-validation/dev-catalog-snapshot.json');
  const originalManifest=await read('.local/broad-validation/reference-manifest.json');
  const selected=new Map<number,any>(originalManifest.rows.filter((r:any)=>!r.error).map((r:any)=>[r.id,{...r,source:'reused-frozen-2938-card-index'}]));
  const additions=new Map<number,any>(),hardNegativeGroups:any[]=[];
  const usable=(r:any)=>r.url?.startsWith('https://res.cloudinary.com/')&&!r.url.includes('/scan_uploads/')&&!r.archived_at&&r.set_active&&!r.set_archived;
  for(const c of cases){
    const p=c.reference;
    // Explicit positive bytes are independently verified, even if an existing catalog row changed.
    additions.set(p.id,{...p,file:c.referenceFile,digest:c.referenceDigest,source:'new-verified-positive'});
    const parallels=dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.main_set_id===p.main_set_id&&r.card_number===p.card_number)
      .sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,4);
    const characters=dev.filter((r:any)=>usable(r)&&r.id!==p.id&&r.name.toLowerCase()===p.name.toLowerCase())
      .sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,2);
    hardNegativeGroups.push({scanId:c.scanId,sameFamilyNumberIds:parallels.map((r:any)=>r.id),sameCharacterIds:characters.map((r:any)=>r.id)});
    for(const r of [...parallels,...characters])if(!selected.has(r.id)&&!additions.has(r.id))additions.set(r.id,{...r,source:'new-metadata-hard-negative'});
  }
  const extra=[...additions.values()];
  await save('preinference-selection',{createdBeforeInference:new Date().toISOString(),model:MODEL_VERSION,basePolicy:FROZEN_DETAIL_POLICY,
    cases:cases.map((c:any)=>({scanId:c.scanId,cardId:c.cardId,queryDigest:c.queryDigest,referenceDigest:c.referenceDigest})),
    qa,hardNegativeGroups,additionalReferenceIds:extra.map(r=>r.id),baseCardIds:[...selected.keys()],
    policy:'Single bounded100-record production replica SELECT export, newest reliable explicit choices after known-exclusion/same-owner/conflict/URL-dedup filters. No replacements. Visually verified independent exact fronts only; active historical IDs only; no alias guessing. Keep all safe2938 prior stratified index IDs; add positives and up to4 same-family same-number +2 same-character metadata hard negatives per case, hash-ID order. Index/QA frozen before fresh inference. No foil-parallel guessing; printed inserts are not counted as parallels.',
    crop:'Frozen original ORB safety gates and only prior34-digest boundary whitelist; raw fallback otherwise',
    sourceHashes:Object.fromEntries(await Promise.all(['scripts/dev-broad-private-plan.ts','scripts/dev-detail-vision.ts','scripts/dev-orb-isolation.py','server/services/catalogVisualModel.ts'].map(async p=>[p,hash(await fs.readFile(p))]))),
    extractHash:hash(await fs.readFile(`${root}/extract.json`)),positiveMetadataHash:hash(await fs.readFile(`${root}/catalog-positives.json`)),
    oldIndexManifestHash:hash(await fs.readFile('.local/broad-validation/reference-manifest.json'))});
  await save('qa',qa);
  let cursor=0;
  async function worker(){
    while(cursor<extra.length){
      const r=extra[cursor++];
      try{
        if(!r.file){
          const bytes=await downloadCatalogReference(r.url);r.file=`${root}/references/additional-${r.id}.image`;
          r.digest=hash(bytes);await fs.writeFile(r.file,bytes,{mode:0o600});
        }
        const b=await fs.readFile(r.file);await sharp(b).metadata();
      }catch{r.error='reference-download-or-decode-failed';}
    }
  }
  await Promise.all(Array.from({length:6},worker));
  for(const r of extra)if(!r.error)selected.set(r.id,r);
  const scanHashes=new Set(candidates.map((c:any)=>c.queryDigest));
  const screened=new Map<string,any>(),leakageExclusions:any[]=[];
  for(const r of selected.values()){
    let screen=screened.get(r.digest);
    if(!screen){
      const b=await fs.readFile(r.file);assert.equal(hash(b),r.digest);
      const d=await dhash(b),near=candidates.find((c:any)=>c.queryDhash&&Math.min(...c.queryDhash.map((q:string)=>distance(q,d)))<=12);
      screen={digest:r.digest,exact:scanHashes.has(r.digest),nearScanId:near?.scanId??null};
      screened.set(r.digest,screen);
    }
    if(screen.exact||screen.nearScanId){selected.delete(r.id);leakageExclusions.push({cardId:r.id,...screen});}
  }
  for(const c of cases)assert.equal(selected.get(c.cardId)?.digest,c.referenceDigest,`Correct independent positive missing for scan${c.scanId}`);
  const final={createdBeforeInference:new Date().toISOString(),cases,index:[...selected.values()],qa,extraFailures:extra.filter(r=>r.error).map(r=>({cardId:r.id,error:r.error})),leakageExclusions,hardNegativeGroups,
    selectionHash:hash(await fs.readFile(`${root}/preinference-selection.json`))};
  await save('frozen-index',final);
  await save('feasibility',{exported:100,eligible:cases.length,correctReferencePresent:cases.length,indexCardIds:selected.size,uniqueReferenceImages:new Set([...selected.values()].map(r=>r.digest)).size,
    newReferences:extra.length,failedExtra:extra.filter(r=>r.error).length,indexLeakageExclusions:leakageExclusions.length,
    qaCounts:qa.reduce((o:any,r:any)=>{o[r.reason]=(o[r.reason]??0)+1;return o;},{})});
  console.log(JSON.stringify(await read(`${root}/feasibility.json`)));
}
if(mode==='embed'){
  const frozen=await read(`${root}/frozen-index.json`);
  await fs.mkdir(`${root}/vectors`,{mode:0o700,recursive:true});
  const unique=[...new Map<string,any>(frozen.index.map((r:any)=>[r.digest,r])).values()];
  let reused=0,created=0;
  for(const r of unique){
    const oldPath=`.local/broad-validation/vectors/${r.digest}.json`;
    try{const old=await read(oldPath);assert.equal(old.model,MODEL_VERSION);r.vectorFile=oldPath;reused++;continue;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    const path=`${root}/vectors/${r.digest}.json`;
    const b=await fs.readFile(r.file);assert.equal(hash(b),r.digest);
    const t=performance.now(),vector=await embedCatalogVisualImage(b);
    await fs.writeFile(path,JSON.stringify({model:MODEL_VERSION,digest:r.digest,vector,embeddingMs:performance.now()-t}),{mode:0o600});
    r.vectorFile=path;created++;if(created%25===0)console.log('PRIVATE NEW EMBEDDINGS',created);
  }
  await save('vector-index',{model:MODEL_VERSION,indexHash:hash(await fs.readFile(`${root}/frozen-index.json`)),references:unique.map(r=>({digest:r.digest,vectorFile:r.vectorFile})),reused,created});
  console.log(JSON.stringify({cardIds:frozen.index.length,uniqueVectors:unique.length,reused,created}));
}