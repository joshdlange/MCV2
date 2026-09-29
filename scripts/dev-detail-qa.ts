import fs from 'node:fs/promises';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { isolateCard,raster,referenceFeatures,alignAndCompare } from './dev-detail-vision';
const dir='.local/detail-experiment';
const reviews=[
  {scanId:3032,accepted:false,reason:'Reject: binder pocket/adjacent-card strip included above card; not an actual card-only boundary.'},
  {scanId:3077,accepted:false,reason:'Reject: right quarter of Captain America card and name ribbon clipped.'},
  {scanId:3088,accepted:false,reason:'Reject: internal artwork lines produce partial torso crop; major card content lost.'},
  {scanId:3093,accepted:false,reason:'Reject: includes neighboring binder card above and clips lower card/logo; not card boundary.'},
  {scanId:3095,accepted:false,reason:'Reject: internal artwork quadrilateral crops left side and nameplate.'},
  {scanId:3110,accepted:false,reason:'Reject: Super-Villains header and outer border clipped; false geometric confidence.'},
  {scanId:3113,accepted:true,reason:'Accepted after visual inspection: retained full Electro artwork/name/header and green frame; table/neighbor cards removed. Existing conservative contour path, not a new Hough success. Outer white margin reduced; no exact physical-aspect guarantee.'},
  {scanId:3126,accepted:false,reason:'No quadrilateral found; unchanged raw fallback.'},
  {scanId:3127,accepted:false,reason:'No quadrilateral found; unchanged raw fallback.'},
].map(r=>({...r,reviewedBeforeInference:true,manualCorners:false,scope:'Offline visual QA acceptance only, NOT a production automatic confidence gate. Rejected cases require existing manual-crop fallback.'}));
await fs.writeFile(`${dir}/crop-review.json`,JSON.stringify(reviews,null,2));
const flat=await sharp({create:{width:240,height:320,channels:3,background:'#777'}}).png().toBuffer();
const f=await isolateCard(flat);
assert.equal(f.geometryStatus,'failed');assert.ok(f.bytes.equals(flat));
const b=await raster(flat),e=alignAndCompare(b,referenceFeatures(b));
assert.equal(e.reliable,false,'Blank images must not supply detail evidence');
const svg='<svg width="240" height="360"><rect width="240" height="360" fill="#bb3333"/><rect x="20" y="25" width="200" height="310" fill="#ddd"/><circle cx="120" cy="140" r="58" fill="#2455aa"/><path d="M35 280 L180 215 L215 320Z" fill="#22a566"/></svg>';
const original=await sharp(Buffer.from(svg)).png().toBuffer();
const q=await raster(original),same=alignAndCompare(q,referenceFeatures(q));
assert.ok(Number.isFinite(same.detailScore));
if(same.reliable)assert.ok(same.detailScore>.5);
const result={flatSafeFallback:true,flatDetailsAbstain:true,syntheticSameImage:same,cropReviews:reviews.length,accepted:reviews.filter(r=>r.accepted).length,
  note:'No synthetic success is counted as real-photo isolation success. Visual QA rejects six high-support Hough false positives.'};
await fs.writeFile(`${dir}/unit-qa.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));