import fs from 'node:fs/promises';
import sharp from 'sharp';
const dir='.local/bounded-dino';
const m=JSON.parse(await fs.readFile(`${dir}/manifest.json`,'utf8'));
// Recorded BEFORE any query or new reference embeddings. Human-visible image
// inspection of all four positive sheets and seven negative sheets.
const findings:[number,boolean,string][]=[
  [3032,true,'Black Widow pose, hair, gray/red base design, Annual 21/22 branding and nameplate match; catalog #8 base identity matches. Reference has clean border versus binder-photo query.'],
  [3035,false,'Wrong side: stored FRONT displays checklist back text; query shows illustrated Creators Collection cover/front. No replacement used.'],
  [3038,false,'No catalog front URL for confirmed Mantis #76.'],
  [3040,false,'Same Groot artwork but exact Exclusives parallel unverified: reference explicitly says EXCLUSIVES; query lower-right marking is not safely legible. Uncertain, not asserted wrong.'],
  [3046,false,'Same Gambit artwork, but exact Base versus foil/parallel identity cannot safely be verified from lighting and current reference. Uncertain, not asserted wrong.'],
  [3077,true,'Captain America #1, 1990 Impel, matching superhero header, red frame, shield pose and star-pattern name ribbon. Clean catalog image independent of desk photo.'],
  [3088,true,'Random #4 Hunters & Stalkers Gold: matching artwork, metallic gold field and tall RANDOM heading; gold distinct from visually inspected Rainbow and Silver references.'],
  [3093,true,'Iceman #98, 1994 Ultra, matching surfing ice wave, Original Team strip and X-Men gold logo; independent clean front.'],
  [3094,false,'No catalog front URL for confirmed Wolverine XH-1 hologram.'],
  [3095,true,'Vulture 2099 #2, matching red foil-stamped 2099 artwork, red field and character text; catalog generic base-container name is imprecise but front image URL and visible design identify the red-foil 2099 card.'],
  [3110,true,'Magneto #63, 1990 Impel; matching purple/gray artwork and Super-Villains banner, white border, yellow diagonal nameplate.'],
  [3113,true,'Electro #58, 1990 Impel; matching lightning/city artwork and green border, Super-Villains banner and yellow nameplate.'],
  [3124,false,'Exact reference identity unverified: query visibly says WOLVERINES while stored image title says WOLVERINES & DEADPOOLS; related same artwork is not sufficient to establish the exact Cover Stars variant.'],
  [3126,true,'Phoenix #5, matching landscape 1992 X-Men blue/red border and flame artwork; reference is independently photographed graded card, query in binder. Graded holder retained.'],
  [3127,true,'Phoenix #41, matching green costume/flame pose, yellow/orange 1993 SkyBox design and vertical character title; independent front.'],
  [3130,false,'Clearly wrong stored front: catalog Mr. Sinister #135 image visibly says HATE-MONGER. Query visibly MR. SINISTER. No relabeling/substitution; excluded.'],
];
const verification=[];
const thumbnails=new Map<number,Buffer>();
for(const c of m.cases) thumbnails.set(c.scanId,await sharp(await fs.readFile(`.local/scan-review/${c.originalPhotoFile}`)).rotate().resize(96,128,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer());
const leakage=[];
for(const r of m.references.filter((r:any)=>r.file)) {
  const thumb=await sharp(await fs.readFile(`${dir}/${r.file}`)).rotate().resize(96,128,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  let best:any=null;
  for(const [scanId,q] of thumbnails) {
    let err=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
    for(let i=0;i<q.length;i++){const x=q[i],y=thumb[i];err+=Math.abs(x-y);sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;}
    const mae=err/q.length,corr=(q.length*sxy-sx*sy)/Math.sqrt((q.length*sxx-sx*sx)*(q.length*syy-sy*sy));
    if(!best||mae<best.mae)best={scanId,mae,corr};
  }
  leakage.push({cardId:r.id,...best,flag:best.mae<=10&&best.corr>=.95});
}
for(const [scanId,accepted,note] of findings) {
  const p=m.positives.find((p:any)=>p.scanId===scanId);
  const leak=leakage.find((r:any)=>r.cardId===p.id);
  if(accepted&&(!p.file||p.error||leak?.flag))throw Error(`Reference rejected ${scanId}`);
  verification.push({scanId,cardId:p.id,accepted,note,visualReview:'Positive sheets 1–4; artwork/layout/visible design matched, no OCR used in retrieval',leakage:leak??null});
}
await fs.writeFile(`${dir}/verification.json`,JSON.stringify(verification,null,2));
await fs.writeFile(`${dir}/reference-qa.json`,JSON.stringify({
  review:'All negative contact sheets visually inspected before scoring. Declared parallel identities can depend on back/finish; not every negative exact parallel is independently provable from front alone.',
  rejectedNegatives:[{cardId:183693,reason:'Catalog Vulture 2099 but reference visibly Moon Knight'},{cardId:17218,reason:'Catalog Hulk but reference visibly Doom 2099'},{cardId:16742,reason:'Catalog Terrax but reference visibly Slug'},{cardId:16744,reason:'Catalog Slug but reference visibly Crossbones'},{cardId:16741,reason:'Catalog Blackheart but reference visibly Mr. Sinister'}],
  leakageScreen:leakage,limitations:'Full-frame 96x128 RGB MAE<=10 and correlation>=.95 is a conservative screen, not proof against transformed/cropped shared source. Positive reference sheets inspected for independent framing/lighting; no near-copy source suspected. Identical artwork itself is intended, not leakage.',
},null,2));
console.log('VERIFIED',verification.filter(r=>r.accepted).length,'of',verification.length,'leakageFlags',leakage.filter(r=>r.flag));