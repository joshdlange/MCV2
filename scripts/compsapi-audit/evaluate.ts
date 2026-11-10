// Isolated evaluator: no production pricing imports, DB access, or provider routing.
export const norm=(s:string)=>s.toLowerCase().replace(/['’]/g,"").replace(/\bpower\s*blast\b/g,"powerblast")
  .replace(/\bx[\s-]*fractor\b/g,"xfractor").replace(/\bray[\s-]*wave\b/g,"raywave")
  .replace(/\bspider[\s-]*web\b/g,"spiderweb").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const words=(s:string)=>norm(s).split(" ").filter(Boolean);
const has=(t:string,w:string)=>` ${t} `.includes(` ${w} `);
export function core(c:any){
  let s=c.parent.replace(/\b\d{4}(?:[-–/]\d{2,4})?\b/g,"");
  s=s.replace(/\b(Comics|Hildebrandt Brothers|Nahuel Grego|65th Anniversary)\b/gi,"");
  if(c.year===1994&&/Flair/.test(c.parent))s=s.replace(/Annual|Universe/gi,"");
  if(/Impel Marvel Universe/.test(c.parent))s=s.replace(/Impel/gi,"");
  return norm(s);
}
export function detail(c:any,s=c.subset){
  const parent=new Set(words(c.parent));
  return [...new Set(words(s.replace(/\d*\s*\/\s*\d+/g,"")))]
    .filter(w=>!parent.has(w)&&!["base","insert","inserts","refractor","parallel","cards","card","variant","variation","comics"].includes(w)&&!/^\d+$/.test(w))
    .filter(w=>!(c.year===1994&&/Flair/.test(c.parent)&&["universe","annual"].includes(w)));
}
export function queries(c:any){
  const d=detail(c,`${c.subset} ${c.variation||""}`).join(" ");
  const primary=`${c.year} ${core(c)} ${c.name} ${c.cardNumber} ${d}`.replace(/\s+/g," ").trim();
  const fallback=`${c.year} ${core(c).replace(/\bmarvel\b/g,"").trim()} ${c.name} ${c.cardNumber}`.replace(/\s+/g," ").trim();
  return [primary,fallback];
}
export function numberMatches(n:string,t:string){
  const parts=n.match(/[a-z]+|\d+/gi)||[];
  if(!parts.length)return false;
  const pattern=parts.map(p=>/^\d+$/.test(p)?`0*${Number(p)}`:p).join("[ -]*");
  const regex=new RegExp(`(?:^|[^a-z0-9])(${pattern})(?![a-z0-9]|-[a-z0-9]|\\s*-\\s*[a-z]\\b)`,"gi");
  return [...t.matchAll(regex)].some(m=>!/[a-z0-9]\s*-\s*$/i.test(t.slice(0,m.index!+m[0].length-m[1].length)));
}
export function serial(c:any){
  const explicit=`${c.subset} ${c.variation||""}`.match(/\/\s*(\d+)/)?.[1];
  if(explicit)return Number(explicit);
  if(c.year===2024&&c.parent==="2024 Topps Chrome Marvel"&&detail(c).join(" ")==="blue wave")return 150;
  // Collectosk's exact 2026 Neon base-parallel checklist; no Diamante/Sparkle equivalence.
  if(c.year===2026&&c.parent==="2026 Topps Marvel Neon"&&!c.variation){
    return ({blue:150,green:99,gold:50} as Record<string,number>)[detail(c).join(" ")]??null;
  }
  // Exact base-parallel definitions, checked against Checklist Insider; evidence saved beside audit.
  if(c.year===2026&&c.parent==="2026 Topps Chrome Marvel Comics"&&!c.variation){
    const denominators:Record<string,number>={"spiderweb":399,"purple shimmer":75,"green raywave":99,"purple raywave":75};
    return denominators[detail(c).join(" ")]??null;
  }
  return null;
}
export function reason(c:any,r:any):string|null{
  const original=r.title||"",t=norm(original);
  if(r.card?.graded||r.card?.grader||/\b(psa|bgs|cgc|sgc|csg|beckett|slabbed|graded|grading|slab|gem mint\s+\d+|mint\s+\d+|mint\s*\+?\s+\d+|nm mt\s+\d+|tag\s+\d+|gma\s+\d+)\b/.test(t))return "graded";
  if(/\bnice\s+\d+(?:\s+\d+)?\b/.test(t))return "uncertain_grade";
  if(r.card?.flags?.some((f:string)=>["lot","sealed","accessory","replica"].includes(f))||
    /\b(lot|bundle|playset|pick|choose|complete set|complete subset|booster|box|break|repack|packs|sealed)\b/.test(t)||
    /\bmystery\s+(pack|card|box)\b/.test(t)||
    /#\s*\d+\s*[,&+]\s*#?\d+/i.test(original)||/\b(x\s*[2-9]\d*|\d+\s*(cards|pcs|count))\b/.test(t)||
    /#[a-z0-9-]+.*\s[&+]\s.*#[a-z0-9-]+/i.test(original))return "multi_card_or_non_card";
  if(!words(c.name).every(w=>has(t,w)))return "name_mismatch";
  const explicitNumbers=[...original.matchAll(/#\s*([a-z]*-?\d+[a-z]*(?:-[a-z0-9]+)*)/gi)].map(m=>m[1]);
  if(explicitNumbers.length&&!explicitNumbers.some(n=>numberMatches(c.cardNumber,n)))return "number_mismatch";
  if(!numberMatches(c.cardNumber,original))return "number_mismatch";
  const allowed=[c.year];
  if(new RegExp(`${c.year}[-–/](?:${String(c.year+1).slice(2)}|${c.year+1})\\b`).test(c.parent))allowed.push(c.year+1);
  if((original.match(/\b(?:19|20)\d{2}\b/g)||[]).some((y:string)=>!allowed.includes(+y)))return "year_mismatch";
  if(!words(core(c)).every(w=>has(t,w)))return "uncertain_product";
  if(has(t,"cosmic")&&!has(core(c),"cosmic"))return "uncertain_product";
  const expected=detail(c,`${c.subset} ${c.variation||""}`);
  const variantTitle=t.replace(norm(c.name),"");
  const denominator=serial(c);
  const observed=[...original.replace(/\b(?:19|20)\d{2}\/\d{2,4}\b/g,"").matchAll(/\/\s*(\d+)\b/g)].map(m=>+m[1]);
  if(denominator&&observed.some(n=>n!==denominator))return "wrong_serial";
  if(!denominator&&observed.length)return "uncertain_serial";
  for(const s of c.siblings){
    const diff=detail(c,s).filter(w=>!expected.includes(w));
    if(diff.length&&diff.every(w=>has(variantTitle,w)))return "wrong_subset";
  }
  const variants=["canvas","diamante","rivals","neon etch","sparkle","foil","image variation","variant cover","vc","refractor","xfractor","raywave","wave","shimmer","speckle","sapphire","gold","green","blue","red","purple","orange","pink","black","autograph","auto"];
  const target=norm(`${c.subset} ${c.variation||""} ${c.parent}`);
  if(variants.some(v=>has(variantTitle,v)&&!has(target,v)&&!(["refractor","foil"].includes(v)&&expected.length)))return "wrong_parallel";
  if(!expected.every(w=>has(t,w)))return "uncertain_subset";
  return null;
}
export function analyze(c:any,rows:any[]){
  const seen=new Set<string>();
  const decisions=rows.map(r=>{
    let rejection=seen.has(r.item_id)?"duplicate":reason(c,r);seen.add(r.item_id);
    const exclusion=!Number.isFinite(r.price)||r.price<=0?"invalid_price":
      !r.last_sold||!Number.isFinite(Date.parse(r.last_sold))?"invalid_date":null;
    return {...r,rejection,exclusion,usable:!rejection&&!exclusion};
  });
  const usable=decisions.filter(r=>r.usable),prices=usable.map(r=>r.price).sort((a,b)=>a-b);
  const dates=usable.map(r=>r.last_sold).sort(),mid=Math.floor(prices.length/2);
  return {upstreamCount:rows.length,identityMatches:decisions.filter(r=>!r.rejection).length,
    usableCount:usable.length,rejected:decisions.filter(r=>r.rejection).length,
    bestOfferCount:usable.filter(r=>r.best_offer===true).length,
    median:prices.length?(prices[mid]+prices[Math.floor((prices.length-1)/2)])/2:null,
    low:prices[0]??null,high:prices.at(-1)??null,oldest:dates[0]??null,newest:dates.at(-1)??null,
    state:prices.length>=3?"COMPSAPI_SOLD_COMPS":prices.length?"COMPSAPI_LIMITED_DATA":"COMPSAPI_NO_COMPS",decisions};
}
