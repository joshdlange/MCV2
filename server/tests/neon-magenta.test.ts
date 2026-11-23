import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool, healthPool } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from '../seeds/data/topps-marvel-neon-2026.json';
import { addNeonMagenta2026, magentaSlug, magentaImage } from '../seeds/addNeonMagenta2026';

after(async () => { await pool.end(); await healthPool.end(); });
test('Magenta clones 200 identities, only Carnage artwork, and runs once', async () => {
  const rollback = new Error('rollback');
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name='owner_neon_magenta_costco_2026'`);
    let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, '2026-topps-marvel-neon'));
    if (!main) {
      [main] = await tx.insert(mainSets).values({ name: '2026 Topps Marvel Neon', slug: '2026-topps-marvel-neon', isCanonical: true }).returning();
      const [base] = await tx.insert(cardSets).values({ name: 'BASE', slug: '2026-topps-marvel-neon-base', year: 2026, mainSetId: main.id, totalCards: 200 }).returning();
      await tx.insert(cards).values(checklist.find(s => s.name === 'BASE')!.cards.map(c => ({
        setId: base.id, name: c.name, cardNumber: c.number, rarity: 'Common', frontImageUrl: 'base-photo',
      })));
    }
    const before = await tx.select().from(cards).orderBy(cards.id);
    assert.equal(await addNeonMagenta2026(tx), true);
    const [subset] = await tx.select().from(cardSets).where(eq(cardSets.slug, magentaSlug));
    const rows = await tx.select().from(cards).where(eq(cards.setId, subset.id));
    assert.equal(rows.length, 200);
    assert.equal(rows.filter(c => c.frontImageUrl).length, 1);
    assert.equal(rows.find(c => c.cardNumber === '97')?.frontImageUrl, magentaImage);
    assert.ok(rows.every(c => !c.backImageUrl && !c.estimatedValue));
    assert.deepEqual((await tx.select().from(cards).orderBy(cards.id)).filter(c => c.setId !== subset.id), before);
    assert.equal(await addNeonMagenta2026(tx), false);
    throw rollback;
  }), e => e === rollback);
});
