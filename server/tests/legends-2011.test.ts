import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { completeLegends2011Tx, legends2011Lists } from '../seeds/completeLegends2011';

test('2011 Legends preserves subset IDs and exact front/back credits, without changing 2010', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  const slug = '2011-rittenhouse-legends-of-marvel';
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const previousYear = async () => (await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c
      JOIN card_sets s ON s.id=c.set_id WHERE s.slug LIKE '2010-2010-rittenhouse-legends-of-marvel-%' ORDER BY c.id`)).rows;
    const old = await previousYear();
    const ids: number[] = [];
    for (const list of legends2011Lists) {
      const [s] = await tx.select().from(cardSets).where(eq(cardSets.slug, `2011-${slug}-${list.key}-base`));
      ids.push(s.id);
    }
    console.log(await completeLegends2011Tx(tx));
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug,slug));
    assert.equal(main.name, '2011 Rittenhouse Legends of Marvel');
    const subsets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    assert.deepEqual(subsets.map(s=>s.id).sort((a,b)=>a-b),ids.sort((a,b)=>a-b));
    for (const list of legends2011Lists) {
      const s = subsets.find(s=>s.name===list.name)!;
      assert.equal(s.totalCards,9);
      const rows = await tx.select().from(cards).where(eq(cards.setId,s.id)).orderBy(cards.cardNumber);
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name,description:c.description})),list.cards);
      assert.deepEqual(rows.map(c=>c.cardNumber),['L1','L2','L3','L4','L5','L6','L7','L8','L9']);
      assert.ok(rows.every(c=>!c.frontImageUrl && !c.backImageUrl));
      const [legacy] = await tx.select().from(mainSets).where(eq(mainSets.slug,`${slug}-${list.key}`));
      assert.equal(legacy.isActive,false); assert.ok(legacy.archivedAt);
    }
    assert.equal(legends2011Lists[0].cards[6].description,"Artists — Front: Rodney Buchemi; Back: Gabriele Dell'Otto");
    assert.equal(legends2011Lists[1].cards[7].description,'Artists — Front: Tom Fleming; Back: Roberto De La Torre');
    assert.equal(legends2011Lists[2].cards[1].description,'Artists — Front: Mark Texeira; Back: Greg Horn');
    assert.deepEqual(await completeLegends2011Tx(tx),{added:0,reparented:0,notesAdded:0});
    assert.deepEqual(await previousYear(),old);
    throw new Rollback();
  }), e=>e instanceof Rollback);
});
test.after(()=>pool.end());
