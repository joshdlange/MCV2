import sharp from 'sharp';
import { projectivePoint, normalizeCard } from './dev-card-normalization';
type P={x:number,y:number};
const dist=(a:P,b:P)=>Math.hypot(a.x-b.x,a.y-b.y);
const polyArea=(q:P[])=>Math.abs(q.reduce((s,p,i)=>s+p.x*q[(i+1)%4].y-p.y*q[(i+1)%4].x,0))/2;
export const FROZEN_DETAIL_POLICY={
  version:'detail-v1-preregistered',dinoWeight:.65,detailWeight:.35,
  detailWeights:{borderColor:.35,regionalColor:.25,edgeLayout:.25,luminanceStructure:.15},
  minimumAlignmentNCC:.48,minimumAlignmentGap:.012,
  selection:'NCC of mean-centered grayscale at multiple scales/translations and 0/90/180/270 reference rotations; coarse-to-fine, no labels or metadata',
  warning:'Scores are heuristic, not probabilities. Template alignment may fail with glare, sleeves, severe perspective and card-background contamination.',
};
export async function isolateCard(input:Buffer) {
  const t=performance.now();
  // Preserve an already conservative contour result before trying the stronger
  // partial-edge Hough proposal path. Neither path is trusted without the
  // experiment's pre-inference visual QA gate.
  const conservative=await normalizeCard(input);
  if(conservative.status==='detected')return{
    geometryStatus:'proposal',detectorWidth:conservative.detectorWidth,detectorHeight:conservative.detectorHeight,
    corners:conservative.corners,score:conservative.edgeSupport,edgeSupport:[conservative.edgeSupport],
    proposalCount:conservative.proposalCount,orientation:conservative.upright,method:'conservative-contour',
    bytes:conservative.bytes,outline:conservative.outline,ms:performance.now()-t,
  };
  const {data,info}=await sharp(input).rotate().resize({width:300,height:300,fit:'inside'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height,n=w*h,g=new Float32Array(n),edge=new Float32Array(n);
  for(let i=0;i<n;i++)g[i]=data[3*i]*.299+data[3*i+1]*.587+data[3*i+2]*.114;
  const points:P[]=[];
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const i=y*w+x,gx=-g[i-w-1]+g[i-w+1]-2*g[i-1]+2*g[i+1]-g[i+w-1]+g[i+w+1],gy=-g[i-w-1]-2*g[i-w]-g[i-w+1]+g[i+w-1]+2*g[i+w]+g[i+w+1];
    edge[i]=Math.hypot(gx,gy);if(edge[i]>180&&(x+y)%2===0)points.push({x,y});
  }
  const diag=Math.ceil(Math.hypot(w,h)),bins=diag*2+1,acc=new Uint16Array(60*bins),cs=[],sn=[];
  for(let a=0;a<60;a++){cs.push(Math.cos(a*Math.PI/60));sn.push(Math.sin(a*Math.PI/60));}
  for(const p of points)for(let a=0;a<60;a++)acc[a*bins+Math.round((p.x*cs[a]+p.y*sn[a])/2)+diag]++;
  const peaks:any[]=[];
  for(let k=0;k<48;k++){
    let max=14,at=-1;for(let i=0;i<acc.length;i++)if(acc[i]>max){max=acc[i];at=i;}
    if(at<0)break;const a=Math.floor(at/bins),r=at%bins;
    peaks.push({a,c:cs[a],s:sn[a],rho:(r-diag)*2,votes:max});
    for(let aa=Math.max(0,a-2);aa<=Math.min(59,a+2);aa++)for(let rr=Math.max(0,r-4);rr<=Math.min(bins-1,r+4);rr++)acc[aa*bins+rr]=0;
  }
  const pairs:any[]=[];
  for(let i=0;i<peaks.length;i++)for(let j=i+1;j<peaks.length;j++)if(Math.abs(peaks[i].a-peaks[j].a)<6&&Math.abs(peaks[i].rho-peaks[j].rho)>35)pairs.push([peaks[i],peaks[j]]);
  const intersect=(a:any,b:any)=>{const d=a.c*b.s-b.c*a.s;return{x:(a.rho*b.s-b.rho*a.s)/d,y:(a.c*b.rho-b.c*a.rho)/d};};
  const candidates:any[]=[];
  for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
    const [a,b]=pairs[i],[c,d]=pairs[j],angle=Math.abs((a.a+b.a-c.a-d.a)/2);
    if(angle<23||angle>37)continue;
    let q=[intersect(a,c),intersect(b,c),intersect(b,d),intersect(a,d)];
    if(q.some(p=>!Number.isFinite(p.x)||p.x<2||p.y<2||p.x>w-3||p.y>h-3))continue;
    const area=polyArea(q),fraction=area/n;if(fraction<.18||fraction>.90)continue;
    const lens=q.map((p,i)=>dist(p,q[(i+1)%4]));
    if(Math.max(lens[0]/lens[2],lens[2]/lens[0],lens[1]/lens[3],lens[3]/lens[1])>1.45)continue;
    const ww=(lens[0]+lens[2])/2,hh=(lens[1]+lens[3])/2,ratio=Math.min(ww,hh)/Math.max(ww,hh);
    if(ratio<.53||ratio>.83)continue;
    const support=q.map((p,i)=>{const end=q[(i+1)%4];let count=0;for(let t=3;t<48;t++){const x=Math.round(p.x+(end.x-p.x)*t/50),y=Math.round(p.y+(end.y-p.y)*t/50);let max=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)max=Math.max(max,edge[(y+dy)*w+x+dx]??0);if(max>130)count++;}return count/45;});
    const ordered=[...support].sort((a,b)=>a-b),avg=support.reduce((a,b)=>a+b,0)/4;
    if(ordered[0]<.22||ordered[1]<.5||avg<.65)continue;
    const center=q.reduce((p,v)=>({x:p.x+v.x/4,y:p.y+v.y/4}),{x:0,y:0}),centerDist=Math.hypot((center.x-w/2)/w,(center.y-h/2)/h);
    const score=avg+.22*fraction-.35*centerDist;
    if(ww>hh)q.push(q.shift()!);
    if(q[0].y+q[1].y>q[2].y+q[3].y)q.push(...q.splice(0,2));
    // Ensure left-to-right top edge; preserve content orientation up to 180.
    if(q[0].x>q[1].x)q=[q[1],q[0],q[3],q[2]];
    candidates.push({q,score,support,fraction});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const unique:any[]=[];for(const c of candidates)if(!unique.some(v=>c.q.reduce((s:number,p:P,i:number)=>s+dist(p,v.q[i]),0)/4<8))unique.push(c);
  const best=unique[0],ambiguous=best&&unique.slice(1).some(c=>best.score-c.score<.025&&Math.abs(best.fraction-c.fraction)>.12);
  const base=await sharp(data,{raw:{width:w,height:h,channels:3}}).jpeg().toBuffer();
  let outline=base;
  if(best)outline=await sharp(base).composite([{input:Buffer.from(`<svg width="${w}" height="${h}"><polygon points="${best.q.map((p:P)=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ambiguous?'orange':'lime'}" stroke-width="3"/></svg>`)}]).jpeg().toBuffer();
  const geometryStatus=!best?'failed':ambiguous?'uncertain':'proposal';
  const metadata={geometryStatus,detectorWidth:w,detectorHeight:h,corners:best?.q??null,score:best?.score??null,edgeSupport:best?.support??null,proposalCount:unique.length,method:'partial-edge-hough',orientation:'Portrait axes only; semantic upright/180° not established'};
  if(!best||ambiguous)return{...metadata,bytes:input,outline,ms:performance.now()-t};
  const source=await sharp(input).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const q=best.q.map((p:P)=>({x:p.x*source.info.width/w,y:p.y*source.info.height/h}));
  const width=(dist(q[0],q[1])+dist(q[2],q[3]))/2,height=(dist(q[1],q[2])+dist(q[3],q[0]))/2,H=900,W=Math.round(H*width/height),out=Buffer.alloc(W*H*3);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=projectivePoint(q,x/(W-1),y/(H-1)),xx=Math.max(0,Math.min(source.info.width-1,p.x)),yy=Math.max(0,Math.min(source.info.height-1,p.y)),x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(source.info.width-1,x0+1),y1=Math.min(source.info.height-1,y0+1),fx=xx-x0,fy=yy-y0;
    for(let c=0;c<3;c++){const at=(x:number,y:number)=>source.data[(y*source.info.width+x)*3+c];out[(y*W+x)*3+c]=Math.round(at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy);}
  }
  const bytes=await sharp(out,{raw:{width:W,height:H,channels:3}}).resize(600,900,{fit:'contain',background:'#777'}).jpeg({quality:94}).toBuffer();
  return{...metadata,bytes,outline,ms:performance.now()-t};
}

type Raster={rgb:Uint8Array,w:number,h:number};
export async function raster(bytes:Buffer):Promise<Raster>{
  const {data,info}=await sharp(bytes).rotate().resize({width:240,height:240,fit:'inside'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  return{rgb:data,w:info.width,h:info.height};
}
const SW=16,SH=24,N=SW*SH;
function descriptor(source:Raster,x:number,y:number,w:number,h:number,rotation=0) {
  const rgb=new Float32Array(N*3),gray=new Float32Array(N);
  let sum=0,squares=0;
  for(let j=0;j<SH;j++)for(let i=0;i<SW;i++){
    const u=(i+.5)/SW,v=(j+.5)/SH;
    const uv=rotation===90?[v,1-u]:rotation===180?[1-u,1-v]:rotation===270?[1-v,u]:[u,v];
    const xx=Math.min(source.w-1,Math.max(0,Math.round(x+uv[0]*w))),yy=Math.min(source.h-1,Math.max(0,Math.round(y+uv[1]*h))),at=(yy*source.w+xx)*3,k=j*SW+i;
    for(let c=0;c<3;c++)rgb[k*3+c]=source.rgb[at+c]/255;
    gray[k]=rgb[k*3]*.299+rgb[k*3+1]*.587+rgb[k*3+2]*.114;sum+=gray[k];squares+=gray[k]*gray[k];
  }
  return{rgb,gray,mean:sum/N,variance:Math.max(1e-8,squares/N-(sum/N)**2)};
}
type Descriptor=ReturnType<typeof descriptor>;
const ncc=(a:Descriptor,b:Descriptor)=>{
  let cross=0;for(let i=0;i<N;i++)cross+=a.gray[i]*b.gray[i];
  return(cross/N-a.mean*b.mean)/Math.sqrt(a.variance*b.variance);
};
export function referenceFeatures(source:Raster) {
  return [0,90,180,270].map(rotation=>({rotation,ratio:rotation%180===0?source.w/source.h:source.h/source.w,features:descriptor(source,0,0,source.w-1,source.h-1,rotation)}));
}
export function alignAndCompare(query:Raster,refs:ReturnType<typeof referenceFeatures>) {
  let best:any=null,second=-1;
  for(const ref of refs)for(const scale of [.35,.45,.55,.65,.75,.85,.95]){
    const h=query.h*scale,w=h*ref.ratio;if(w>query.w*.99||w<query.w*.2)continue;
    const step=Math.max(5,Math.round(Math.min(w,h)/7));
    for(let y=0;y<=query.h-h;y+=step)for(let x=0;x<=query.w-w;x+=step){
      const d=descriptor(query,x,y,w,h),score=ncc(d,ref.features);
      if(!best||score>best.ncc){if(best)second=best.ncc;best={x,y,w,h,ncc:score,ref,d};}else second=Math.max(second,score);
    }
  }
  if(!best)return{reliable:false,reason:'No plausible alignment window',detailScore:0,alignmentNCC:0,alignmentGap:0};
  // Refine the winning location/scale without changing method using labels.
  const seed=best;
  for(const scale of [.94,1,1.06])for(let dy=-4;dy<=4;dy+=2)for(let dx=-4;dx<=4;dx+=2){
    const w=seed.w*scale,h=seed.h*scale,x=seed.x+dx,y=seed.y+dy;
    if(x<0||y<0||x+w>query.w||y+h>query.h)continue;
    const d=descriptor(query,x,y,w,h),score=ncc(d,seed.ref.features);
    if(score>best.ncc)best={x,y,w,h,ncc:score,ref:seed.ref,d};
  }
  const gap=best.ncc-second;
  const reliable=best.ncc>=FROZEN_DETAIL_POLICY.minimumAlignmentNCC&&gap>=FROZEN_DETAIL_POLICY.minimumAlignmentGap;
  if(!reliable)return{reliable:false,reason:'Insufficient template alignment evidence; detail evidence disabled',detailScore:0,alignmentNCC:best.ncc,alignmentGap:gap,box:{x:best.x,y:best.y,w:best.w,h:best.h},rotation:best.ref.rotation};
  const a=best.d as Descriptor,b=best.ref.features as Descriptor;
  let border=0,borderN=0,region=0,edgeErr=0,edgeN=0;
  for(let y=0;y<SH;y++)for(let x=0;x<SW;x++){
    const i=y*SW+x;let err=0;for(let c=0;c<3;c++)err+=Math.abs(a.rgb[i*3+c]-b.rgb[i*3+c])/3;
    region+=err;
    if(x<3||x>=SW-3||y<4||y>=SH-4){border+=err;borderN++;}
    if(x>0&&y>0){edgeErr+=Math.abs((a.gray[i]-a.gray[i-1])-(b.gray[i]-b.gray[i-1]))+Math.abs((a.gray[i]-a.gray[i-SW])-(b.gray[i]-b.gray[i-SW]));edgeN+=2;}
  }
  const signals={borderColor:Math.max(0,1-border/borderN*2),regionalColor:Math.max(0,1-region/N*2),edgeLayout:Math.max(0,1-edgeErr/edgeN*3),luminanceStructure:Math.max(0,best.ncc)};
  const weights=FROZEN_DETAIL_POLICY.detailWeights;
  const detailScore=Object.entries(signals).reduce((s,[k,v])=>s+v*weights[k as keyof typeof weights],0);
  return{reliable:true,detailScore,signals,alignmentNCC:best.ncc,alignmentGap:gap,box:{x:best.x,y:best.y,w:best.w,h:best.h},rotation:best.ref.rotation};
}