import sharp from 'sharp';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
const cross = (a: Point,b: Point,c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(points: Point[]) {
  points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const lower:Point[]=[], upper:Point[]=[];
  for(const p of points) { while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0) lower.pop(); lower.push(p); }
  for(const p of [...points].reverse()) { while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0) upper.pop(); upper.push(p); }
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function area(points:Point[]) {
  return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-p.y*q.x;},0))/2;
}
function quadFromHull(points:Point[]) {
  const q=[...points];
  while(q.length>4) {
    let at=0, cost=Infinity;
    for(let i=0;i<q.length;i++) {
      const c=Math.abs(cross(q[(i+q.length-1)%q.length],q[i],q[(i+1)%q.length]));
      if(c<cost) {cost=c;at=i;}
    }
    q.splice(at,1);
  }
  return q;
}

/** Maps unit-square coordinates into a detected quadrilateral, using a
 * projective (not bilinear) transform. No recognition, text or catalog inputs. */
export function projectivePoint(q:Point[],u:number,v:number):Point {
  const [a,b,c,d]=q;
  const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
  const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
  const det=dx1*dy2-dx2*dy1;
  const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
  const z=g*u+h*v+1;
  return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/z,
    y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/z};
}

export async function normalizeCard(input:Buffer) {
  const {data,info}=await sharp(input).rotate().resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height,n=w*h;
  const gray=new Float32Array(n),edge=new Float32Array(n);
  for(let i=0;i<n;i++) gray[i]=.299*data[i*3]+.587*data[i*3+1]+.114*data[i*3+2];
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x;
    const gx=-gray[i-w-1]+gray[i-w+1]-2*gray[i-1]+2*gray[i+1]-gray[i+w-1]+gray[i+w+1];
    const gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];
    edge[i]=Math.hypot(gx,gy);
  }
  const candidates:{quad:Point[],score:number,area:number,support:number,ratio:number}[]=[];
  // Threshold-connected contours supply proposals; independent Sobel support
  // on all four complete edges is required before accepting any proposal.
  for(const threshold of [40,75,110,145,180,215]) for(const light of [true,false]) {
    const seen=new Uint8Array(n);
    for(let seed=0;seed<n;seed++) {
      if(seen[seed] || (gray[seed]>=threshold)!==light) continue;
      const queue=[seed], boundary:Point[]=[]; seen[seed]=1;
      for(let at=0;at<queue.length;at++) {
        const i=queue[at],x=i%w,y=Math.floor(i/w);let border=false;
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const xx=x+dx,yy=y+dy,j=yy*w+xx;
          if(xx<0||xx>=w||yy<0||yy>=h||(gray[j]>=threshold)!==light) {border=true;continue;}
          if(!seen[j]) {seen[j]=1;queue.push(j);}
        }
        if(border) boundary.push({x,y});
      }
      if(queue.length<n*.12||boundary.length<20) continue;
      const convex=hull(boundary),quad=quadFromHull(convex),a=area(quad);
      if(quad.length!==4||a<n*.2||a>n*.94||area(convex)/a>1.045||quad.some(p=>p.x<4||p.y<4||p.x>w-5||p.y>h-5)) continue;
      const sides=quad.map((p,i)=>distance(p,quad[(i+1)%4]));
      if(Math.max(sides[0]/sides[2],sides[2]/sides[0],sides[1]/sides[3],sides[3]/sides[1])>1.35) continue;
      let width=(sides[0]+sides[2])/2,height=(sides[1]+sides[3])/2;
      const ratio=Math.min(width,height)/Math.max(width,height);
      if(ratio<.52||ratio>.82) continue;
      if(quad.some((p,i)=> {
        const prev=quad[(i+3)%4],next=quad[(i+1)%4];
        return Math.abs(((prev.x-p.x)*(next.x-p.x)+(prev.y-p.y)*(next.y-p.y))/(distance(prev,p)*distance(next,p)))>.45;
      })) continue;
      const supports=quad.map((p,i)=> {
        const q=quad[(i+1)%4];let hits=0;
        for(let t=2;t<49;t++) {
          const x=Math.round(p.x+(q.x-p.x)*t/50),y=Math.round(p.y+(q.y-p.y)*t/50);let max=0;
          for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) max=Math.max(max,edge[(y+dy)*w+x+dx]??0);
          if(max>95) hits++;
        }
        return hits/47;
      });
      const support=Math.min(...supports);
      if(support<.8) continue;
      // Reorder so short edges run horizontally; retain input's up direction
      // where possible. Geometry cannot prove semantic upright/180 degrees.
      if(width>height) quad.push(quad.shift()!);
      if((quad[0].y+quad[1].y)>(quad[2].y+quad[3].y)) quad.push(...quad.splice(0,2));
      candidates.push({quad,area:a,support,ratio,score:support+a/n*.1});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  const ambiguous=best&&candidates.some(c=>c!==best&&Math.abs(c.area-best.area)/best.area>.12&&c.support>=best.support-.05);
  const status=!best?'failed':ambiguous?'partial/uncertain':'detected';
  const reason=!best?'No complete, high-support card-like quadrilateral':ambiguous?'Competing rectangles; possible sleeve/toploader or background':'Geometry accepted; physical-card identity and 180-degree upright remain unverified';
  const base=await sharp(data,{raw:{width:w,height:h,channels:3}}).jpeg().toBuffer();
  let outline=base;
  if(best) {
    const svg=`<svg width="${w}" height="${h}"><polygon points="${best.quad.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${ambiguous?'orange':'lime'}" stroke-width="3"/></svg>`;
    outline=await sharp(base).composite([{input:Buffer.from(svg)}]).jpeg().toBuffer();
  }
  const details={status,reason,corners:best?.quad??null,detectorWidth:w,detectorHeight:h,edgeSupport:best?.support??null,proposalCount:candidates.length,
    upright:'180-degree orientation not established without semantic/OCR evidence; no guessed 180 rotation',
    sleeve:'Not reliably identifiable; distinct competing rectangles trigger fallback',
    removal:'Only regions outside accepted quadrilateral removed; hands occluding card cannot be removed',
    contentClipping:'Not automatically verifiable; inspect outline preview',
    usedRaw:status!=='detected'};
  if(status!=='detected') return {...details,bytes:input,outline};
  const source=await sharp(input).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  const q=best.quad.map(p=>({x:p.x*source.info.width/w,y:p.y*source.info.height/h}));
  // Single-view geometry cannot uniquely recover physical aspect ratio.
  // Estimate from mean opposite edge lengths, reject strong perspective above,
  // then use contain padding, NEVER force artwork into a 2:3 resize.
  const naturalWidth=(distance(q[0],q[1])+distance(q[2],q[3]))/2;
  const naturalHeight=(distance(q[1],q[2])+distance(q[3],q[0]))/2;
  const outH=900,outW=Math.round(outH*naturalWidth/naturalHeight);
  const out=Buffer.alloc(outW*outH*3);
  for(let y=0;y<outH;y++) for(let x=0;x<outW;x++) {
    const p=projectivePoint(q,x/(outW-1),y/(outH-1));
    const xx=Math.max(0,Math.min(source.info.width-1,p.x)),yy=Math.max(0,Math.min(source.info.height-1,p.y));
    const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(source.info.width-1,x0+1),y1=Math.min(source.info.height-1,y0+1),fx=xx-x0,fy=yy-y0;
    for(let c=0;c<3;c++) {
      const at=(x:number,y:number)=>source.data[(y*source.info.width+x)*3+c];
      out[(y*outW+x)*3+c]=Math.round(at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy);
    }
  }
  const bytes=await sharp(out,{raw:{width:outW,height:outH,channels:3}}).resize(600,900,{fit:'contain',background:'#777777'}).jpeg({quality:94}).toBuffer();
  return {...details,aspectRatioMethod:'mean opposite edge lengths; approximate under perspective, not calibrated physical ratio',bytes,outline};
}