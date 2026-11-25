import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool, healthPool } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { importFleerXMenWalmart1996, fleerXMenWalmart1996 as config } from '../seeds/importFleerXMenWalmart1996';

after(async () => { await pool.end(); await healthPool.end(); });

test('imports one active master, a 100-card base, and only the Archangel image', async () => {
  const rollback = new Error('rollback');
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${config.marker}`);
    const otherCards = (await tx.execute(sql`SELECT count(*)::int AS n FROM cards`)).rows[0].n;
    const result = await importFleerXMenWalmart1996(tx);
    assert.equal(result.imported, true);
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.slug));
    assert.equal(main.name, config.name);
    assert.equal(main.thumbnailImageUrl, config.thumbnail);
    const subsets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    assert.deepEqual(subsets.map(s => [s.name, s.year, s.isInsertSubset, s.totalCards]), [['Base', 1996, false, 100]]);
    const rows = await tx.select().from(cards).where(eq(cards.setId, subsets[0].id));
    assert.equal(rows.length, 100);
    assert.equal(rows.find(c => c.cardNumber === '1')?.frontImageUrl, config.archangel);
    assert.equal(rows.find(c => c.cardNumber === '1')?.description, 'Andy Kubert · X-Men');
    assert.equal(rows.find(c => c.cardNumber === '100')?.name, 'Checklist');
    assert.equal(rows.filter(c => c.frontImageUrl).length, 1);
    assert.equal((await tx.execute(sql`SELECT count(*)::int AS n FROM cards`)).rows[0].n, otherCards + 100);
    assert.deepEqual(await importFleerXMenWalmart1996(tx), { imported: false });
    throw rollback;
  }), error => error === rollback);
});
