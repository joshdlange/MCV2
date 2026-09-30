import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {downloadCatalogReference} from '../server/services/catalogVisualFetch';
import {embedCatalogVisualImage,MODEL_VERSION} from '../server/services/catalogVisualModel';
import {FROZEN_DETAIL_POLICY} from './dev-detail-vision';

const dir='.local/broad-validation',mode=process.argv[2]??'prepare';
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,v:any)=>fs.writeFile(`${dir}/${p}.json`,JSON.stringify(v,null,2));
process.env.CATALOG_VISUAL_OFFLINE='true';
if(process.env.NODE_ENV==='production')throw Error('DEV only');
const baseline=await read(`${dir}/baseline-freeze.json`);
for(const f of baseline.files)assert.equal(hash(await fs.readFile(f.path)),f.sha256,`Baseline changed ${f.path}`);
async function dhash(bytes:Buffer,rotation=0){
  const b=await sharp(bytes).rotate(rotation).resize(17,16,{fit:'fill'}).grayscale().raw().toBuffer();
  return Array.from({length:256},(_,i)=>b[Math.floor(i/16)*17+i%16]>b[Math.floor(i/16)*17+i%16+1]?'1':'0').join('');
}
const distance=(a:string,b:string)=>[...a].reduce((s,v,i)=>s+(v!==b[i]?1:0),0);
if(mode==='prepare'){
  const catalog=await read(`${dir}/dev-catalog-snapshot.json`);
  const candidates=await read(`${dir}/positive-candidates.json`);
  const availability=await read(`${dir}/continuation-availability.json`);
  const provenance=await read('.local/scan-review/provenance.json');
  const verification=[
    {scanId:2683,accepted:false,category:'back',note:'Query shows sideways Synch biography/back #37, not front.'},
    {scanId:2780,accepted:false,category:'historical-identity-conflict',note:'Query is Topps Chrome Dane Whitman full-body/lightning; selected label/reference is Upper Deck Eternals blue portrait. Do not replace historical label.'},
    {scanId:2784,accepted:false,category:'historical-identity-conflict',note:'Query is 1995 Chromium binder page Banshee Generation X artwork; selected label/reference is different 2018 Banshee artwork. Do not relabel.'},
    {scanId:2801,accepted:false,category:'parallel-unresolved',note:'Carnage front artwork agrees, but binder-page lighting/foil and multiple Power Blast Gold/Rainbow/Silver catalog siblings do not independently establish exact selected printing. No guessed parallel.'},
    {scanId:2832,accepted:false,category:'parallel-unresolved',note:'Cable front artwork agrees; gold/silver foil under glare cannot independently establish Gold Blasters versus Metal Blasters/Silver Flasher. Reference is also a small card in slab/store scene, not a trustworthy crop extent.'},
    {scanId:2837,accepted:true,category:'verified-front',parallel:false,note:'Deadpool 1992 X-Men #43 front: matching red border, SUPER-VILLAINS header, moon, pose, skyline, name and yellow X logo. Unsigned base front; reference is independently framed clean catalog raster, query has physical top-loader and background. Active ID16946; same-URL529346 inactive and excluded.'},
    ...[2882,3029,3047].map(scanId=>({scanId,accepted:false,category:'missing-reference',note:'No front_image_url in authorized current DEV catalog; exact positive reference unavailable.'})),
  ];
  const cases=candidates.filter((c:any)=>verification.find(v=>v.scanId===c.scanId)?.accepted);
  const leakage:any[]=[];
  for(const c of cases){
    const q=await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`);
    const qhashes=await Promise.all([0,90,180,270].map(r=>dhash(q,r)));
    c.dhash=qhashes;
    for(const p of provenance.selected){
      if(p.scanId===c.scanId)continue;
      const b=await fs.readFile(`.local/scan-review/${p.originalPhotoFile}`);
      const d=await dhash(b);
      const min=Math.min(...qhashes.map(h=>distance(h,d)));
      leakage.push({scanId:c.scanId,otherScanId:p.scanId,previouslyQueried:availability.actualQueryIds.includes(p.scanId),exact:hash(q)===hash(b),dhashDistance:min});
    }
  }
  assert(!leakage.some(r=>r.exact||r.dhashDistance<=12),'Query duplicate requires independent review');
  const usable=(r:any)=>r.url?.startsWith('https://res.cloudinary.com/')&&!r.url.includes('/scan_uploads/')&&!r.archived_at&&r.set_active&&!r.set_archived;
  const pool=catalog.filter(usable),selected=new Map<number,any>(),hardNegatives:any[]=[];
  const add=(r:any,role:string)=>{if(!selected.has(r.id))selected.set(r.id,{...r,role});};
  for(const c of cases){
    const p=c.reference;add(p,'verified-positive');
    const groups={
      'same-family-number':pool.filter((r:any)=>r.id!==p.id&&r.main_set_id===p.main_set_id&&r.card_number===p.card_number),
      'same-character':pool.filter((r:any)=>r.id!==p.id&&r.name.toLowerCase()===p.name.toLowerCase()).sort((a:any,b:any)=>hash(String(a.id)).localeCompare(hash(String(b.id)))).slice(0,30),
      'same-set-near-number':pool.filter((r:any)=>r.id!==p.id&&r.set_id===p.set_id).sort((a:any,b:any)=>Math.abs(Number(a.card_number)-Number(p.card_number))-Math.abs(Number(b.card_number)-Number(p.card_number))||a.id-b.id).slice(0,15),
    };
    for(const [group,rows] of Object.entries(groups)){hardNegatives.push({scanId:c.scanId,group,ids:rows.map((r:any)=>r.id)});for(const r of rows)add(r,`hard-negative:${group}`);}
  }
  const strata=new Map<string,Map<number,any[]>>();
  for(const r of pool){
    const kind=/gold|silver|rainbow|refractor|foil|blue|green|black|red|purple|orange|pink|yellow|aqua|sapphire|prizm|parallel/i.test(`${r.set_name} ${r.variation??''}`)?'variant-metadata':'other';
    const key=`${Math.floor(r.year/10)*10}:${kind}`;
    r.stratum=key;
    if(!strata.has(key))strata.set(key,new Map());
    const families=strata.get(key)!;
    if(!families.has(r.main_set_id))families.set(r.main_set_id,[]);
    families.get(r.main_set_id)!.push(r);
  }
  const queues=[...strata].sort(([a],[b])=>a.localeCompare(b)).map(([key,families])=>{
    const groups=[...families].sort(([a],[b])=>hash(String(a)).localeCompare(hash(String(b)))).map(([,rows])=>rows.sort((a,b)=>hash(String(a.id)).localeCompare(hash(String(b.id)))));
    const queue:any[]=[];let i=0;while(groups.some(g=>g.length>i)){for(const g of groups)if(g[i])queue.push(g[i]);i++;}
    return{key,queue};
  });
  let i=0;while(selected.size<3000&&queues.some(s=>s.queue.length>i)){
    for(const s of queues){if(selected.size>=3000)break;if(s.queue[i])add(s.queue[i],'metadata-stratified');}i++;
  }
  const plan={createdBeforeInference:new Date().toISOString(),model:MODEL_VERSION,basePolicy:FROZEN_DETAIL_POLICY,
    policy:'3000 active DEV catalog card IDs: verified positives; up to30 exact-character hash-ordered hard negatives,15 nearby same-set numbers,all same-family same-number; remainder equal round-robin decade × metadata variant stratum, families round-robin within each stratum, SHA256 ID tie order. Public Cloudinary only. No outcome-based substitution. Failed downloads reduce actual index size.',
    breadths:[10,20],inputs:['raw','frozen ORB optionalcrop, unchanged gates; only prior independently verified boundary digests may project; otherwise raw'],
    optionalCropBoundaryLimitation:'Prior34-reference boundary whitelist reused, not assumed universal. No new label-guided annotations. May fall back for all new candidates.',
    cases,verification,leakage,hardNegatives,selected:[...selected.values()],availableActivePublicReferenceCards:pool.length,
    snapshotHash:hash(await fs.readFile(`${dir}/dev-catalog-snapshot.json`)),
    queryExposure:'Prepared for review and historical matcher exposure, but no prior DINO/reranker experiment query. One independently verified eligible front; not a representative untouched human-unseen holdout.',
    sourceHashes:Object.fromEntries(await Promise.all(['scripts/dev-broad-index.ts','scripts/dev-detail-vision.ts','scripts/dev-orb-isolation.py','server/services/catalogVisualModel.ts'].map(async p=>[p,hash(await fs.readFile(p))])))};
  await fs.writeFile(`${dir}/frozen-plan.json`,JSON.stringify(plan,null,2),{flag:'wx'});
  await save('reference-verification',verification);
  await save('feasibility-update',{status:'RUNNING_WITH_ONE_VERIFIED_UNUSED_HISTORICAL_QUERY',eligible:cases.map((c:any)=>c.scanId),freshDevScans:0,localHistoricExplicit:16,excludedPriorInference:4,manualConflicts:3,candidates:9,verifiedExactFront:1,back:1,wrongHistoricalIdentity:2,parallelUnresolved:2,missingReference:3,plannedIndexCards:selected.size,note:'Parent relaxed exclusion of review-only exposure. Existing local historical export reused, no production contact; initial zero-query report superseded.'});
  console.log('FROZEN',cases.map((c:any)=>c.scanId),'index',selected.size,'nearestQueries',leakage.sort((a,b)=>a.dhashDistance-b.dhashDistance).slice(0,5));
}
if(mode==='download'){
  const plan=await read(`${dir}/frozen-plan.json`);
  await fs.mkdir(`${dir}/references`,{recursive:true});
  const allScanHashes=new Set((await read('.local/scan-review/provenance.json')).selected.map((p:any)=>p.imageHash));
  const rows:any[]=[];let cursor=0,done=0;
  const start=performance.now();
  async function worker(){
    while(cursor<plan.selected.length){
      const r={...plan.selected[cursor++]};
      try{
        const file=`${dir}/references/${r.id}.image`;
        let bytes:Buffer;try{bytes=await fs.readFile(file);}catch(e:any){if(e.code!=='ENOENT')throw e;bytes=await downloadCatalogReference(r.url);await fs.writeFile(file,bytes);}
        const digest=hash(bytes);if(allScanHashes.has(digest))throw Error('Exact saved-query leakage');
        const meta=await sharp(bytes).metadata();if(!meta.width||!meta.height||meta.width<80||meta.height<80)throw Error('Reference too small');
        const d=await dhash(bytes);
        const min=Math.min(...plan.cases.flatMap((c:any)=>c.dhash.map((q:string)=>distance(q,d))));
        if(min<=12)throw Error(`Near-query reference requires capture verification (dhash ${min})`);
        Object.assign(r,{file,digest,dimensions:[meta.width,meta.height],queryDhashDistance:min});
      }catch(e){r.error=String(e);}
      rows.push(r);done++;if(done%100===0)console.log('DOWNLOADED',done,'errors',rows.filter(r=>r.error).length);
    }
  }
  await Promise.all(Array.from({length:8},worker));
  rows.sort((a,b)=>a.id-b.id);
  await save('reference-manifest',{createdAt:new Date().toISOString(),planHash:hash(await fs.readFile(`${dir}/frozen-plan.json`)),downloadWallMs:performance.now()-start,rows});
  console.log('REFERENCES',rows.length,'usable',rows.filter(r=>!r.error).length,'unique',new Set(rows.filter(r=>!r.error).map(r=>r.digest)).size);
}
if(mode==='embed'){
  const manifest=await read(`${dir}/reference-manifest.json`);
  assert.equal(manifest.planHash,hash(await fs.readFile(`${dir}/frozen-plan.json`)));
  await fs.mkdir(`${dir}/vectors`,{recursive:true});
  const unique=[...new Map<string,any>(manifest.rows.filter((r:any)=>!r.error).map((r:any)=>[r.digest,r])).values()];
  let done=0,cached=0;const start=performance.now();
  for(const r of unique){
    const path=`${dir}/vectors/${r.digest}.json`;
    try{const old=await read(path);assert.equal(old.model,MODEL_VERSION);assert.equal(old.digest,r.digest);assert.equal(old.vector.length,384);cached++;continue;}catch(e:any){if(e.code!=='ENOENT')throw e;}
    const bytes=await fs.readFile(r.file);assert.equal(hash(bytes),r.digest);
    const t=performance.now(),vector=await embedCatalogVisualImage(bytes);
    await fs.writeFile(path,JSON.stringify({model:MODEL_VERSION,digest:r.digest,vector,embeddingMs:performance.now()-t}));
    done++;if(done%100===0)console.log('EMBEDDED',done,'cached',cached,'of',unique.length,'ms',Math.round(performance.now()-start));
  }
  await save('index-summary',{model:MODEL_VERSION,cardIds:manifest.rows.filter((r:any)=>!r.error).length,uniqueReferenceEmbeddings:unique.length,createdThisPass:done,cached,wallMs:performance.now()-start,canonicalSingleImage:true,noPermanentWrites:true,manifestHash:hash(await fs.readFile(`${dir}/reference-manifest.json`))});
  console.log('INDEX COMPLETE',unique.length,'unique',manifest.rows.filter((r:any)=>!r.error).length,'cards');
}