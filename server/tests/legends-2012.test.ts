import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { completeLegends2012Tx, legends2012Lists } from '../seeds/completeLegends2012';

test('2012 Legends consolidates six subsets with 54 artist-credited cards and safe reruns', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  const slug = '2012-rittenhouse-legends-of-marvel';
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const previousYears = async () => (await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c
      JOIN card_sets s ON s.id=c.set_id WHERE s.slug LIKE '2010-2010-rittenhouse-legends-of-marvel-%'
      OR s.slug LIKE '2011-2011-rittenhouse-legends-of-marvel-%' ORDER BY c.id`)).rows;
    const quantities = async () => (await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows;
    const old = await previousYears(), holdings = await quantities();
    const ids: number[] = [];
    for (const list of legends2012Lists) {
      const [s] = await tx.select().from(cardSets).where(eq(cardSets.slug, `2012-${slug}-${list.key}-base`));
      ids.push(s.id);
    }
    console.log(await completeLegends2012Tx(tx));
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug,slug));
    assert.equal(main.name, '2012 Rittenhouse Legends of Marvel');
    const subsets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    assert.equal(subsets.length,6);
    assert.deepEqual(subsets.map(s=>s.id).sort((a,b)=>a-b),ids.sort((a,b)=>a-b));
    for (const list of legends2012Lists) {
      const s = subsets.find(s=>s.name===list.name)!;
      assert.equal(s.totalCards,9);
      const rows = await tx.select().from(cards).where(eq(cards.setId,s.id)).orderBy(cards.cardNumber);
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name,description:c.description})),list.cards);
      assert.deepEqual(rows.map(c=>c.cardNumber),['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
      assert.ok(rows.every(c=>!c.frontImageUrl && !c.backImageUrl));
      const [legacy] = await tx.select().from(mainSets).where(eq(mainSets.slug,`${slug}-${list.key}`));
      assert.equal(legacy.isActive,false); assert.ok(legacy.archivedAt);
    }
    assert.equal(legends2012Lists.find(l=>l.key==='thing')!.cards[7].description,
      "Artists — Front: Kau Amac;etp; Back: Gabriele Dell'Otto");
    assert.equal(legends2012Lists.find(l=>l.key==='moon-knight')!.cards[1].description,
      'Artists — Front: Frank G. Darmata, David Finch; Back: Mark Texeira');
    const snapshot = async () => (await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c WHERE c.set_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY c.id`)).rows;
    const beforeRepeat = await snapshot();
    assert.deepEqual(await completeLegends2012Tx(tx),{added:0,reparented:0,notesAdded:0});
    assert.deepEqual(await snapshot(),beforeRepeat);
    assert.deepEqual(await previousYears(),old);
    assert.deepEqual(await quantities(),holdings);
    throw new Rollback();
  }), e=>e instanceof Rollback);
});
test.after(()=>pool.end());
