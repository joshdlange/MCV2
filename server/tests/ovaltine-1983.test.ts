import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards,cardSets,mainSets } from '../../shared/schema';
import { completeOvaltine1983Tx,ovaltineLists,ovaltineSlug,ovaltineImage } from '../seeds/completeOvaltine1983';

test('Ovaltine consolidates existing subsets, loads exact checklists and assigns all three images',async()=>{
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL!==process.env.NEON_DATABASE_URL);
  assert.deepEqual(ovaltineLists.map(l=>l.cards.length),[144,10]);
  assert.deepEqual(ovaltineLists[0].cards.map(c=>c.cardNumber),Array.from({length:144},(_,i)=>String(i+1)));
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx=>{
    const before = await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`);
    const originalIds = [];
    for(const l of ovaltineLists) {
      const [s]=await tx.select().from(cardSets).where(eq(cardSets.slug,`1983-${ovaltineSlug}-${l.country.toLowerCase()}-base`));
      originalIds.push(s.id);
    }
    console.log(await completeOvaltine1983Tx(tx));
    const [main]=await tx.select().from(mainSets).where(eq(mainSets.slug,ovaltineSlug));
    assert.equal(main.thumbnailImageUrl,ovaltineImage);
    const sets=await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    assert.deepEqual(sets.map(s=>s.id).sort((a,b)=>a-b),originalIds.sort((a,b)=>a-b));
    for(const l of ovaltineLists){
      const s=sets.find(s=>s.name===l.country)!;
      assert.equal(s.totalCards,l.cards.length);
      const rows=(await tx.select().from(cards).where(eq(cards.setId,s.id))).filter(c=>!c.archivedAt).sort((a,b)=>Number(a.cardNumber)-Number(b.cardNumber));
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name})),l.cards);
      if(l.country==='USA'){
        assert.equal(s.imageUrl,ovaltineImage);
        assert.equal(rows[9].frontImageUrl,ovaltineImage);
      } else assert.ok(rows.every(c=>c.frontImageUrl===null));
      const [old]=await tx.select().from(mainSets).where(eq(mainSets.slug,`${ovaltineSlug}-${l.country.toLowerCase()}`));
      assert.equal(old.isActive,false);assert.ok(old.archivedAt);
    }
    assert.deepEqual(await completeOvaltine1983Tx(tx),{added:0,reparented:0});
    assert.deepEqual((await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows,before.rows);
    throw new Rollback();
  }),e=>e instanceof Rollback);
});
test.after(()=>pool.end());
