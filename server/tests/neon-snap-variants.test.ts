import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from '../seeds/data/topps-marvel-neon-2026.json';
import { addNeonSnapVariantsTx, snapVariantNames } from '../seeds/addNeonSnapVariants2026';

test('Snap variants mirror all 20 identities without changing source cards; reruns are safe', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const slug = '2026-topps-marvel-neon';
    assert.equal((await tx.select().from(mainSets).where(eq(mainSets.slug, slug))).length, 0);
    assert.deepEqual(await addNeonSnapVariantsTx(tx), { skipped: true, added: 0 });
    const [main] = await tx.insert(mainSets).values({ name: '2026 Topps Marvel Neon', slug }).returning();
    const [source] = await tx.insert(cardSets).values({
      name: 'MARVEL SNAP', slug: `${slug}-marvel-snap`, mainSetId: main.id,
      year: 2026, totalCards: 20, isInsertSubset: true,
    }).returning();
    const expected = checklist.find(s => s.name === 'MARVEL SNAP')!.cards;
    const original = await tx.insert(cards).values(expected.map(c => ({
      setId: source.id, cardNumber: c.number, name: c.name, isInsert: true, rarity: 'Common',
      frontImageUrl: 'https://example.invalid/snap.jpg', estimatedValue: '10.00',
    }))).returning();
    assert.deepEqual(await addNeonSnapVariantsTx(tx), { skipped: false, added: 80 });
    assert.deepEqual(await addNeonSnapVariantsTx(tx), { skipped: false, added: 0 });
    assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, source.id)).orderBy(cards.id), original);
    const sets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    assert.equal(sets.length, 5);
    for (const name of snapVariantNames) {
      const set = sets.find(s => s.name === name)!;
      assert.equal(set.totalCards, 20);
      const rows = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
      assert.deepEqual(rows.map(c => ({ number: c.cardNumber, name: c.name })), expected);
      for (const row of rows) {
        assert.equal(row.frontImageUrl, null);
        assert.equal(row.backImageUrl, null);
        assert.equal(row.estimatedValue, null);
      }
    }
    await tx.update(cards).set({ name: 'Wrong identity' }).where(eq(cards.id, original[0].id));
    await assert.rejects(addNeonSnapVariantsTx(tx), /unexpected card/);
    throw new Rollback();
  }), e => e instanceof Rollback);
});
test.after(() => pool.end());
