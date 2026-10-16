import { pool } from "../db";
import { badgeService } from "../badge-service";

export async function ensureValueScout() {
  const result=await pool.query(`INSERT INTO badges(name,description,icon_url,category,requirement,rarity,points,unlock_hint)
    VALUES('Value Scout','Checked the market and uncovered a card''s value.',
      '/value-scout.webp','Achievement','{"type":"market_price_refresh","count":1}','bronze',10,
      'Check a card''s Market Price.')
    ON CONFLICT(name) DO UPDATE SET icon_url=excluded.icon_url RETURNING id`);
  return result.rows[0].id as number;
}
export async function awardValueScout(userId:number,price:any) {
  return completeValueScout(userId,price,{
    award:async(id)=>{await badgeService.awardBadge(id,await ensureValueScout());}
  }).catch(()=>console.warn("Value Scout award unavailable"));
}
export async function completeValueScout(userId:number,price:any,actions:{award:(id:number)=>Promise<void>}) {
  if (price?.upgradeRequired || price?.refreshing || !(Number(price?.avgPrice)>0)) return;
  await actions.award(userId);
}
