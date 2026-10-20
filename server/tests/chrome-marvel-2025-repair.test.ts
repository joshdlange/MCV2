import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import checklist from '../seeds/data/toppsChromeMarvel2025.json';
import {
  CHROME_MARVEL_2025_KAKAWOW_TARGETS, CHROME_MARVEL_2025_MARKER,
  CHROME_MARVEL_2025_PARENT, CHROME_MARVEL_2025_PREFIX,
  CHROME_MARVEL_2025_VARIANTS, repairToppsChromeMarvel2025,
} from '../seeds/repairToppsChromeMarvel2025';
import {
  adminAuditLogs, cards, cardSets, mainSets, userCollections, userWishlists,
  pcBinders, pcBinderCards, users, listings, xpEvents, pendingCardImages,
  scanUploads, scanFeedback, feedEvents, cardPriceCache, migrationLogs, migrationLogCards,
} from '../../shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}
test.after(async () => { await pool.end(); });

test('2025 Chrome uses all 200 exact supplied CSV identities and exactly 22 parallel slugs', () => {
  const csv = readFileSync('attached_assets/2025_Topps_Marvel_Chrome_-_Sheet1_1792514124641.csv', 'utf8');
  const supplied = csv.trim().split(/\r?\n/).slice(1).map(line => {
    const [parent, subset, num, name, insert] = line.split(',');
    assert.equal(parent, '2025 Topps Marvel Chrome');
    assert.equal(subset, 'Base');
    assert.equal(insert, '');
    return { num, name };
  });
  assert.deepEqual(checklist, supplied);
  assert.deepEqual(checklist.map(c => c.num), Array.from({ length: 200 }, (_, i) => String(i + 1)));
  assert.equal(CHROME_MARVEL_2025_VARIANTS.length, 23);
  assert.equal(new Set(CHROME_MARVEL_2025_VARIANTS.map(([slug]) => slug)).size, 23);
  assert.equal(CHROME_MARVEL_2025_VARIANTS.find(([slug]) => slug === 'clawed-chrome')![1],
    'Base Clawed Chrome Stainless Steel');
});

async function fixture(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  const tag = `chrome-2025-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await tx.execute(sql`DELETE FROM startup_migrations WHERE name = ${CHROME_MARVEL_2025_MARKER}`);
  for (const slug of [CHROME_MARVEL_2025_PARENT, '2025-kakawow-aura-marvel']) {
    await tx.update(mainSets).set({ slug: `${tag}-${slug}` }).where(eq(mainSets.slug, slug));
  }
  const [parent, kakawow] = await tx.insert(mainSets).values([
    { slug: CHROME_MARVEL_2025_PARENT, name: '2025 Topps Chrome Marvel' },
    { slug: '2025-kakawow-aura-marvel', name: '2025 Kakawow Aura Marvel' },
  ]).returning();
  const slugs = [
    ...CHROME_MARVEL_2025_VARIANTS.map(([suffix]) => CHROME_MARVEL_2025_PREFIX + suffix),
    ...Object.values(CHROME_MARVEL_2025_KAKAWOW_TARGETS),
  ];
  for (const slug of slugs) {
    await tx.update(cardSets).set({ slug: `${tag}-${slug}` }).where(eq(cardSets.slug, slug));
  }
  const subsets = await tx.insert(cardSets).values(CHROME_MARVEL_2025_VARIANTS.map(([suffix]) => ({
    slug: CHROME_MARVEL_2025_PREFIX + suffix, name: `Old ${suffix}`, year: 2025,
    mainSetId: parent.id, totalCards: suffix === 'base' ? 204 : suffix === 'superfractor' ? 101 : 100,
    isInsertSubset: true,
  }))).returning();
  const base = subsets[0];
  const destinations = await tx.insert(cardSets).values(
    Object.values(CHROME_MARVEL_2025_KAKAWOW_TARGETS).map(slug => ({
      slug, name: slug, year: 2025, mainSetId: kakawow.id,
    })),
  ).returning();
  const retained = await tx.insert(cards).values(subsets.flatMap(subset =>
    checklist.slice(0, subset.id === base.id ? 200 : 100).map(c => ({
      setId: subset.id, cardNumber: c.num,
      name: c.num === '74' ? 'The Makers' : c.num === '8' ? `${c.name} (1st Appearance)` : c.name.toLowerCase(),
      rarity: 'Common', isInsert: true,
      frontImageUrl: c.num === '1' ? `/mcv/sets/${tag}/${subset.id}/front.webp` : null,
    })),
  )).returning();
  const sourceIdentities = [
    { cardNumber: 'AM-B-05', name: 'Sabretooth', targetName: 'Sabretooth', group: 0 },
    { cardNumber: 'AM-B-30', name: 'Ms. America', targetName: 'Ms.America', group: 0 },
    { cardNumber: 'AM-CB-01', name: 'SPIDER-MAN', targetName: 'Spider-Man', group: 1 },
    { cardNumber: 'AM-EB-01', name: 'The Dark Phoenix Saga', targetName: 'The Dark Phoenix Saga', group: 2 },
    { cardNumber: 'AM-EB-08', name: 'The Ballad of Beta Ray Bill', targetName: 'The Ballad of Beta-Ray Bill', group: 2 },
  ];
  const sources = await tx.insert(cards).values(sourceIdentities.map(c => ({
    setId: base.id, cardNumber: c.cardNumber, name: c.name, rarity: 'Common',
    frontImageUrl: `/mcv/sets/${tag}/source.webp`, backImageUrl: `/mcv/sets/${tag}/back.webp`,
  }))).returning();
  const targets = await tx.insert(cards).values(sourceIdentities.map(c => ({
    setId: destinations[c.group].id, cardNumber: c.cardNumber, name: c.targetName, rarity: 'Common',
    frontImageUrl: c.group === 0 ? `/mcv/sets/${tag}/target.webp` : null,
  }))).returning();
  // Exact same insert identity also appears in generic Kakawow Base. It must
  // NOT win over the specifically authorized insert destination.
  await tx.insert(cards).values({
    setId: destinations[0].id, cardNumber: 'AM-CB-01', name: 'Spider-Man', rarity: 'Common',
  });
  const [stray] = await tx.insert(cards).values({
    setId: subsets.find(s => s.slug.endsWith('-superfractor'))!.id,
    cardNumber: '2099', name: 'Spider-Man 2099 #MO-SM', rarity: 'Common',
    frontImageUrl: `/mcv/sets/${tag}/stray.webp`,
  }).returning();
  const [unrelated] = await tx.insert(cardSets).values({
    slug: `${tag}-unrelated-inserts`, name: 'Untouched insert subset', year: 2025,
    mainSetId: parent.id, isInsertSubset: true, totalCards: 1,
  }).returning();
  await tx.insert(cards).values({ setId: unrelated.id, cardNumber: 'GL-1', name: 'Galactus', rarity: 'Rare', isInsert: true });
  return { tag, parent, subsets, base, retained, destinations, sources, targets, stray, unrelated };
}

async function rollbackFixture(callback: (tx: Tx, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  await assert.rejects(db.transaction(async tx => {
    const f = await fixture(tx);
    await callback(tx, f);
    throw new Rollback();
  }), (error: unknown) => error instanceof Rollback);
}

test('populated repair conserves all references, existing IDs/images, and is a validated no-op on rerun', async () => {
  await rollbackFixture(async (tx, f) => {
    const protectedSlugs = ['2025-topps-chrome-marvel-gold-wave-refractor', '2025-topps-chrome-marvel-orange-lava-refractor'];
    const protectedSets = await tx.select().from(cardSets).where(inArray(cardSets.slug, protectedSlugs));
    const untouchedIds = [...protectedSets.map(s => s.id), f.unrelated.id];
    const untouchedBefore = await tx.select().from(cards).where(inArray(cards.setId, untouchedIds)).orderBy(cards.id);
    const [user] = await tx.insert(users).values({
      firebaseUid: f.tag, username: f.tag, email: `${f.tag}@example.invalid`,
    }).returning();
    const [sourceCollection, targetCollection] = await tx.insert(userCollections).values([
      { userId: user.id, cardId: f.sources[0].id, quantity: 2, notes: 'PRIVATE folded metadata', condition: 'Poor' },
      { userId: user.id, cardId: f.targets[0].id, quantity: 3, notes: 'survivor metadata', condition: 'Mint' },
    ]).returning();
    await tx.insert(userWishlists).values([f.sources[0], f.targets[0]].map(c => ({ userId: user.id, cardId: c.id })));
    const [binder] = await tx.insert(pcBinders).values({ userId: user.id, name: f.tag }).returning();
    await tx.insert(pcBinderCards).values([f.sources[0], f.targets[0]].map(c => ({ binderId: binder.id, cardId: c.id })));
    await tx.insert(xpEvents).values([f.sources[0], f.targets[0]].map(c => ({
      userId: user.id, cardId: c.id, eventType: 'card_added', points: 1,
    })));
    const [listing] = await tx.insert(listings).values({
      sellerId: user.id, userCollectionId: sourceCollection.id, cardId: f.sources[0].id,
      price: '5.00', description: 'Kept listing', conditionSnapshot: 'Poor',
    }).returning();
    const [pending] = await tx.insert(pendingCardImages).values({
      userId: user.id, cardId: f.sources[1].id, frontImageUrl: '/mcv/sets/pending.webp',
    }).returning();
    const [scan] = await tx.insert(scanUploads).values({
      userId: user.id, confidenceLevel: 'high', topMatchCardId: f.sources[2].id,
    }).returning();
    const [feedback] = await tx.insert(scanFeedback).values({
      scanUploadId: scan.id, userId: user.id, feedbackType: 'wrong', selectedCardId: f.sources[3].id,
    }).returning();
    const [feed] = await tx.insert(feedEvents).values({
      userId: user.id, eventType: 'first_card', title: 'Fixture', relatedType: 'card',
      relatedId: f.sources[2].id, dedupeKey: f.tag,
    }).returning();
    const [cache] = await tx.insert(cardPriceCache).values({ cardId: f.sources[0].id, avgPrice: '3.00', salesCount: 1 }).returning();
    const [strayCache] = await tx.insert(cardPriceCache).values({ cardId: f.stray.id, avgPrice: '5.00', salesCount: 1 }).returning();
    const [migration] = await tx.insert(migrationLogs).values({
      sourceSetId: f.base.id, destinationSetId: f.destinations[0].id, movedCardCount: 1,
    }).returning();
    const [migrationCard] = await tx.insert(migrationLogCards).values({
      migrationLogId: migration.id, cardId: f.sources[0].id,
      oldSetId: f.base.id, newSetId: f.destinations[0].id, oldIsInsert: false, newIsInsert: false,
    }).returning();
    const inserted = await repairToppsChromeMarvel2025(tx);
    assert.equal(inserted, 2200);
    const active = await tx.select().from(cards).where(and(
      inArray(cards.setId, f.subsets.map(s => s.id)), sql`${cards.archivedAt} IS NULL`,
    ));
    assert.equal(active.length, 4600);
    for (const subset of f.subsets) {
      const rows = active.filter(c => c.setId === subset.id).sort((a, b) => Number(a.cardNumber) - Number(b.cardNumber));
      assert.deepEqual(rows.map(c => ({ num: c.cardNumber, name: c.name })), checklist);
      assert.ok(rows.every(c => !c.isInsert));
    }
    for (const old of f.retained) {
      const current = active.find(c => c.id === old.id)!;
      assert.ok(current, `preserved card ID ${old.id}`);
      assert.equal(current.frontImageUrl, old.frontImageUrl);
      assert.equal(current.backImageUrl, old.backImageUrl);
      if (old.cardNumber === '8') assert.equal(current.description, '1st Appearance');
    }
    const sources = await tx.select().from(cards).where(inArray(cards.id, [...f.sources.map(c => c.id), f.stray.id]));
    assert.equal(sources.length, f.sources.length + 1);
    assert.ok(sources.every(c => c.archivedAt));
    assert.equal(sources.find(c => c.id === f.sources[0].id)!.frontImageUrl, f.sources[0].frontImageUrl);
    const targets = await tx.select().from(cards).where(inArray(cards.id, f.targets.map(c => c.id))).orderBy(cards.id);
    assert.equal(targets[0].frontImageUrl, f.targets[0].frontImageUrl, 'conflicting image is not overwritten');
    assert.equal(targets[0].backImageUrl, f.sources[0].backImageUrl, 'only missing image is transferred');
    assert.equal(targets[2].frontImageUrl, f.sources[2].frontImageUrl);
    const collections = await tx.select().from(userCollections).where(eq(userCollections.userId, user.id));
    assert.equal(collections.length, 1);
    assert.equal(collections[0].id, targetCollection.id);
    assert.equal(collections[0].quantity, 5);
    assert.equal(collections[0].notes, 'survivor metadata');
    const [updatedListing] = await tx.select().from(listings).where(eq(listings.id, listing.id));
    assert.equal(updatedListing.cardId, f.targets[0].id);
    assert.equal(updatedListing.userCollectionId, targetCollection.id);
    assert.deepEqual((await tx.select().from(userWishlists).where(eq(userWishlists.userId, user.id))).map(r => r.cardId), [f.targets[0].id]);
    assert.deepEqual((await tx.select().from(pcBinderCards).where(eq(pcBinderCards.binderId, binder.id))).map(r => r.cardId), [f.targets[0].id]);
    assert.deepEqual((await tx.select().from(xpEvents).where(eq(xpEvents.userId, user.id))).map(r => r.cardId), [f.targets[0].id]);
    assert.equal((await tx.select().from(pendingCardImages).where(eq(pendingCardImages.id, pending.id)))[0].cardId, f.targets[1].id);
    assert.equal((await tx.select().from(scanUploads).where(eq(scanUploads.id, scan.id)))[0].topMatchCardId, f.targets[2].id);
    assert.equal((await tx.select().from(scanFeedback).where(eq(scanFeedback.id, feedback.id)))[0].selectedCardId, f.targets[3].id);
    assert.equal((await tx.select().from(feedEvents).where(eq(feedEvents.id, feed.id)))[0].relatedId, f.targets[2].id);
    assert.equal((await tx.select().from(cardPriceCache).where(eq(cardPriceCache.id, cache.id)))[0].cardId, f.targets[0].id);
    assert.equal((await tx.select().from(cardPriceCache).where(eq(cardPriceCache.id, strayCache.id)))[0].cardId, f.stray.id);
    assert.equal((await tx.select().from(migrationLogCards).where(eq(migrationLogCards.id, migrationCard.id)))[0].cardId, f.targets[0].id);
    const audits = await tx.select().from(adminAuditLogs).where(and(
      eq(adminAuditLogs.actionType, 'legacy_powerblast_collection_fold'), eq(adminAuditLogs.entityId, sourceCollection.id),
    ));
    assert.equal(audits.length, 1);
    assert.ok(audits[0].notes!.includes('PRIVATE folded metadata'));
    const allBefore = await tx.select().from(cards).where(inArray(cards.setId, f.subsets.map(s => s.id))).orderBy(cards.id);
    assert.equal(await repairToppsChromeMarvel2025(tx), 0);
    assert.deepEqual(await tx.select().from(cards).where(inArray(cards.setId, f.subsets.map(s => s.id))).orderBy(cards.id), allBefore);
    // Also exercise a populated catalog whose marker was absent/lost. Archived
    // source rows are retained, so their destinations must still resolve safely.
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name = ${CHROME_MARVEL_2025_MARKER}`);
    assert.equal(await repairToppsChromeMarvel2025(tx), 0);
    assert.deepEqual(await tx.select().from(cards).where(inArray(cards.setId, f.subsets.map(s => s.id))).orderBy(cards.id), allBefore);
    assert.equal((await tx.select().from(userCollections).where(eq(userCollections.id, targetCollection.id)))[0].quantity, 5);
    assert.deepEqual(await tx.select().from(cards).where(inArray(cards.setId, untouchedIds)).orderBy(cards.id), untouchedBefore);
    assert.deepEqual(await tx.select().from(cardSets).where(inArray(cardSets.slug, protectedSlugs)), protectedSets);
    await tx.update(cards).set({ isInsert: true }).where(eq(cards.id, f.retained[0].id));
    await assert.rejects(repairToppsChromeMarvel2025(tx), /Terminal checklist\/metadata validation failed/);
  });
});

test('identity conflicts and ambiguous Kakawow destinations fail before catalog mutations or marker', async () => {
  await rollbackFixture(async (tx, f) => {
    const before = await tx.select().from(cards).where(eq(cards.setId, f.base.id)).orderBy(cards.id);
    await tx.update(cards).set({ name: 'Wrong character' }).where(eq(cards.id, f.targets[0].id));
    await assert.rejects(repairToppsChromeMarvel2025(tx), /Expected one exact Kakawow identity/);
    assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, f.base.id)).orderBy(cards.id), before);
    assert.equal((await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${CHROME_MARVEL_2025_MARKER}`)).rows.length, 0);
    await tx.update(cards).set({ name: 'Sabretooth' }).where(eq(cards.id, f.targets[0].id));
    await tx.insert(cards).values({
      setId: f.targets[0].setId, cardNumber: 'AM-B-05', name: 'SABRETOOTH', rarity: 'Common',
    });
    await assert.rejects(repairToppsChromeMarvel2025(tx), /found 2/);
  });
});

test('an absent requested subset is created canonically without touching a misleading alternate subset', async () => {
  await rollbackFixture(async (tx, f) => {
    const oldBlue = f.subsets.find(s => s.slug === CHROME_MARVEL_2025_PREFIX + 'blue')!;
    const renamed = `${f.tag}-unrelated-blue-inserts`;
    await tx.update(cardSets).set({ slug: renamed }).where(eq(cardSets.id, oldBlue.id));
    const before = await tx.select().from(cards).where(eq(cards.setId, oldBlue.id)).orderBy(cards.id);
    assert.equal(await repairToppsChromeMarvel2025(tx), 2300);
    const [created] = await tx.select().from(cardSets).where(eq(cardSets.slug, CHROME_MARVEL_2025_PREFIX + 'blue'));
    assert.notEqual(created.id, oldBlue.id);
    assert.equal(created.totalCards, 200);
    assert.equal(created.mainSetId, f.parent.id);
    assert.equal(created.isCanonical, true);
    assert.equal(created.isInsertSubset, false);
    assert.equal(created.description, '/299');
    assert.equal((await tx.select().from(cards).where(eq(cards.setId, created.id))).length, 200);
    assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, oldBlue.id)).orderBy(cards.id), before);
    assert.equal(await repairToppsChromeMarvel2025(tx), 0);
  });
});

test('malformed insert cannot be silently archived when referenced; duplicate Base identities are rejected', async () => {
  await rollbackFixture(async (tx, f) => {
    const [user] = await tx.insert(users).values({
      firebaseUid: f.tag, username: f.tag, email: `${f.tag}@example.invalid`,
    }).returning();
    await tx.insert(userWishlists).values({ userId: user.id, cardId: f.stray.id });
    await assert.rejects(repairToppsChromeMarvel2025(tx), /Malformed Mask-Off Superfractor insert.*reference/);
    await tx.delete(userWishlists).where(eq(userWishlists.userId, user.id));
    await tx.insert(cards).values({ setId: f.base.id, cardNumber: '1', name: 'Iron Man', rarity: 'Common' });
    await assert.rejects(repairToppsChromeMarvel2025(tx), /Identity conflict/);
  });
});
