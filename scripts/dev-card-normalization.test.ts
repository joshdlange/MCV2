import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { normalizeCard, projectivePoint } from './dev-card-normalization';
const dir='.local/image-experiment';
await fs.mkdir(dir,{recursive:true});
const outcomes:any[]=[];
for(const [name,points] of [
  ['rotated','110,45 272,95 197,340 35,290'],
  ['perspective','83,45 248,66 270,333 62,316'],
] as const) {
  const svg=`<svg width="340" height="380"><rect width="340" height="380" fill="#181818"/><polygon points="${points}" fill="#ddd"/><circle cx="165" cy="170" r="35" fill="#6588ab"/><rect x="130" y="230" width="60" height="25" fill="#885544"/></svg>`;
  const input=await sharp(Buffer.from(svg)).png().toBuffer();
  const result=await normalizeCard(input);
  assert.equal(result.status,'detected',`${name}: ${result.reason}`);
  assert.equal(result.usedRaw,false);
  const meta=await sharp(result.bytes).metadata();
  assert.equal(meta.width,600);assert.equal(meta.height,900);
  await fs.writeFile(`${dir}/synthetic-${name}.png`,input);
  await fs.writeFile(`${dir}/synthetic-${name}-outline.jpg`,result.outline);
  await fs.writeFile(`${dir}/synthetic-${name}-normalized.jpg`,result.bytes);
  outcomes.push({name,status:result.status,corners:result.corners,edgeSupport:result.edgeSupport,output:[meta.width,meta.height]});
}
const flat=await sharp({create:{width:300,height:400,channels:3,background:'#777'}}).png().toBuffer();
const fallback=await normalizeCard(flat);
assert.equal(fallback.status,'failed');assert.ok(fallback.bytes.equals(flat),'Fallback preserves exact raw bytes');
const quad=[{x:10,y:20},{x:90,y:25},{x:100,y:180},{x:5,y:170}];
for(const [u,v,i] of [[0,0,0],[1,0,1],[1,1,2],[0,1,3]]) {
  const p=projectivePoint(quad,u,v);assert.ok(Math.hypot(p.x-quad[i].x,p.y-quad[i].y)<1e-8);
}
outcomes.push({name:'uniform safe fallback',status:fallback.status,exactBytes:true},{name:'projective four-corner mapping',passed:true});
await fs.writeFile(`${dir}/normalization-tests.json`,JSON.stringify(outcomes,null,2));
console.log(JSON.stringify(outcomes,null,2));