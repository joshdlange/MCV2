import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { cards, cardSets, users, userCollections, userWishlists, xpEvents } from '../../shared/schema';
import { repairChromiumChecklist, chromiumSubsets, chromiumChecklists } from '../seeds/repairUltraXMenChromium1995';

test('Chromium repair rehearses real catalog, preserves quantities/images and safely folds references', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const sets = await tx.select().from(cardSets).where(inArray(cardSets.slug, Object.values(chromiumSubsets).map(s => s.slug)));
    assert.equal(sets.length, 4);
    const setId = (kind: keyof typeof chromiumSubsets) => sets.find(s => s.slug === chromiumSubsets[kind].slug)!.id;
    const original = await tx.select().from(cards).where(inArray(cards.setId, sets.map(s => s.id)));
    const base = original.find(c => c.setId === setId('base') && c.cardNumber === '1' && c.name === 'Archangel' && !c.archivedAt)!;
    const stray = original.find(c => c.setId === setId('alternate') && c.cardNumber === '1' && c.name === 'Archangel' && !c.archivedAt);
    const [owner] = await tx.insert(users).values({
      username: `chromium-${Date.now()}`, firebaseUid: `chromium-${Date.now()}`,
      email: 'chromium@example.invalid', marketingOptIn: false, emailUpdates: false,
    }).returning();
    const [owned] = await tx.insert(userCollections).values({
      userId: owner.id, cardId: base.id, quantity: 2, notes: 'Survivor notes',
    }).returning();
    if (stray) {
      await tx.insert(userCollections).values({ userId: owner.id, cardId: stray.id, quantity: 3, notes: 'Private absorbed notes' });
      await tx.insert(userWishlists).values([base, stray].map(c => ({ userId: owner.id, cardId: c.id })));
      await tx.insert(xpEvents).values([base, stray].map(c => ({ userId: owner.id, cardId: c.id, eventType: 'card_added', points: 5 })));
    }
    console.log('Rehearsal:', await repairChromiumChecklist(tx));
    const after = await tx.select().from(cards).where(inArray(cards.setId, sets.map(s => s.id))).orderBy(cards.id);
    for (const kind of Object.keys(chromiumSubsets) as (keyof typeof chromiumSubsets)[]) {
      const live = after.filter(c => c.setId === setId(kind) && !c.archivedAt);
      assert.equal(live.length, chromiumChecklists[kind].length, kind);
      for (const expected of chromiumChecklists[kind]) {
        const matches = live.filter(c => c.cardNumber === expected.number && c.name === expected.name);
        assert.equal(matches.length, 1);
        if (expected.artist) assert.ok(matches[0].description?.includes(`Artist: ${expected.artist}.`));
      }
    }
    for (const survivor of after.filter(c => !c.archivedAt)) {
      const old = original.find(c => c.id === survivor.id);
      if (old?.frontImageUrl) assert.equal(survivor.frontImageUrl, old.frontImageUrl);
      if (old?.backImageUrl) assert.equal(survivor.backImageUrl, old.backImageUrl);
    }
    const [folded] = await tx.select().from(userCollections).where(eq(userCollections.id, owned.id));
    assert.equal(folded.quantity, stray ? 5 : 2);
    assert.equal(folded.notes, 'Survivor notes');
    if (stray) {
      assert.equal((await tx.select().from(userWishlists).where(eq(userWishlists.userId, owner.id))).length, 1);
      assert.equal((await tx.select().from(xpEvents).where(eq(xpEvents.userId, owner.id))).length, 1);
      const audit = await tx.execute(sql`SELECT notes FROM admin_audit_logs
        WHERE action_type='legacy_powerblast_collection_fold' AND notes::jsonb->>'ownerId'=${String(owner.id)}`);
      assert.ok(audit.rows.some((r: any) => r.notes.includes('Private absorbed notes')));
    }
    assert.deepEqual(await repairChromiumChecklist(tx), { skipped: false, merged: 0, added: 0 });
    assert.deepEqual(await tx.select().from(cards).where(inArray(cards.setId, sets.map(s => s.id))).orderBy(cards.id), after);
    await tx.update(cards).set({ name: 'Unknown identity' }).where(eq(cards.id, base.id));
    await assert.rejects(repairChromiumChecklist(tx), /unmatched\/ambiguous/);
    throw new Rollback();
  }), error => error instanceof Rollback);
});
test.after(() => pool.end());
