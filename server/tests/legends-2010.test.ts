import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { completeLegends2010Tx, legends2010Lists, legends2010Slug } from '../seeds/completeLegends2010';

test('Legends 2010 consolidates three existing subsets, preserves artist columns and repeats safely', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  assert.equal(legends2010Lists[0].cards[2].description, 'Artists: Adi Granov | Joe Bennett, Sandu Florea');
  assert.equal(legends2010Lists[1].cards[6].description, 'Artists: unknown | Clayton Henry');
  assert.equal(legends2010Lists[2].cards[2].description, 'Artists: Salvador Larroca | Gerald Parel');
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const quantities = async () => (await tx.execute(sql`SELECT user_id,sum(quantity)::text qty FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows;
    const before = await quantities();
    const ids: number[] = [];
    for (const list of legends2010Lists) {
      const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, `2010-${legends2010Slug}-${list.key}-base`));
      ids.push(set.id);
    }
    console.log(await completeLegends2010Tx(tx));
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, legends2010Slug));
    assert.equal(main.name, '2010 Rittenhouse Legends of Marvel');
    const subsets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    assert.deepEqual(subsets.map(s=>s.id).sort((a,b)=>a-b), ids.sort((a,b)=>a-b));
    for (const list of legends2010Lists) {
      const set = subsets.find(s=>s.name===list.name)!;
      assert.equal(set.totalCards,9);
      const rows = await tx.select().from(cards).where(eq(cards.setId,set.id)).orderBy(cards.cardNumber);
      assert.deepEqual(rows.map(c=>({cardNumber:c.cardNumber,name:c.name,description:c.description})),list.cards);
      assert.ok(rows.every(c=>!c.frontImageUrl && !c.backImageUrl && !c.isInsert));
      const [old] = await tx.select().from(mainSets).where(eq(mainSets.slug, `${legends2010Slug}-${list.key}`));
      assert.equal(old.isActive,false);
      assert.ok(old.archivedAt);
    }
    const snapshot = await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c WHERE c.set_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY c.id`);
    assert.deepEqual(await completeLegends2010Tx(tx),{added:0,reparented:0,notesAdded:0});
    assert.deepEqual((await tx.execute(sql`SELECT to_jsonb(c) row FROM cards c WHERE c.set_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY c.id`)).rows,snapshot.rows);
    assert.deepEqual(await quantities(),before);
    throw new Rollback();
  }), e=>e instanceof Rollback);
});
test.after(()=>pool.end());
