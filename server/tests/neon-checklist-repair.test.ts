import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '../db';
import { mainSets, cardSets, cards, users, userCollections, userWishlists } from '../../shared/schema';
import checklist from '../seeds/data/topps-marvel-neon-2026.json';
import { repairNeonChecklist } from '../seeds/repairToppsNeon2026';

test('Neon consolidation preserves card IDs, images and collector references; parallels are complete and repeat-safe', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const slug = '2026-topps-marvel-neon';
    assert.equal((await tx.select().from(mainSets).where(eq(mainSets.slug, slug))).length, 0,
      'Run this isolated fixture only on a development database without Neon');
    const [main] = await tx.insert(mainSets).values({ name: '2026 Topps Marvel Neon', slug }).returning();
    const sources = checklist.filter(s => s.name === 'BASE' || /^\d+ UP$/.test(s.name));
    const originals: (typeof cards.$inferSelect)[] = [];
    const sourceIds: number[] = [];
    for (const source of sources) {
      const [set] = await tx.insert(cardSets).values({
        name: source.name, slug: `${slug}-${source.name.toLowerCase().replace(/ /g, '-')}`,
        mainSetId: main.id, year: 2026, isInsertSubset: source.isInsert, totalCards: source.cards.length,
      }).returning();
      sourceIds.push(set.id);
      originals.push(...await tx.insert(cards).values(source.cards.map(c => ({
        setId: set.id, name: c.name, cardNumber: c.number, rarity: 'Common', isInsert: source.isInsert,
        frontImageUrl: `https://example.invalid/${c.number}.jpg`, estimatedValue: '12.00',
      }))).returning());
    }
    const [owner] = await tx.insert(users).values({
      username: `neon-test-${Date.now()}`, firebaseUid: `neon-test-${Date.now()}`,
      email: 'neon-test@example.invalid', marketingOptIn: false, emailUpdates: false,
    }).returning();
    const owned = originals.find(c => c.cardNumber === '1UP-8')!;
    const [collection] = await tx.insert(userCollections).values({
      userId: owner.id, cardId: owned.id, quantity: 3, notes: 'Keep this metadata',
    }).returning();
    const [wish] = await tx.insert(userWishlists).values({ userId: owner.id, cardId: owned.id }).returning();
    assert.deepEqual(await repairNeonChecklist(tx), { skipped: false, added: 1030, moved: 9 });
    assert.deepEqual(await repairNeonChecklist(tx), { skipped: false, added: 0, moved: 0 });
    const after = await tx.select().from(cards).where(inArray(cards.id, originals.map(c => c.id)));
    for (const original of originals) {
      const actual = after.find(c => c.id === original.id)!;
      assert.deepEqual({ ...actual, setId: original.setId }, original);
      if (!original.cardNumber.startsWith('1UP-')) assert.equal(actual.setId, original.setId);
    }
    assert.deepEqual((await tx.select().from(userCollections).where(eq(userCollections.id, collection.id)))[0], collection);
    assert.deepEqual((await tx.select().from(userWishlists).where(eq(userWishlists.id, wish.id)))[0], wish);
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    assert.equal(children.filter(s => s.archivedAt && !s.isActive && s.totalCards === 0).length, 9);
    for (const set of children.filter(s => s.isActive)) {
      const rows = await tx.select().from(cards).where(eq(cards.setId, set.id));
      const expected = set.name.startsWith('1-Up') ? 10 : 200;
      assert.equal(rows.length, expected, set.name);
      assert.equal(set.totalCards, expected, set.name);
      assert.equal(new Set(rows.map(c => c.cardNumber)).size, expected);
      if (!sourceIds.includes(set.id)) {
        rows.forEach(c => {
          assert.equal(c.frontImageUrl, null);
          assert.equal(c.backImageUrl, null);
          assert.equal(c.estimatedValue, null);
        });
      }
    }
    // Identity conflicts fail explicitly rather than overwriting curated content.
    await tx.update(cards).set({ name: 'Conflicting identity' }).where(eq(cards.id, owned.id));
    await assert.rejects(repairNeonChecklist(tx), /unexpected card in 1-Up/);
    throw new Rollback();
  }), error => error instanceof Rollback);
});

test.after(() => pool.end());
