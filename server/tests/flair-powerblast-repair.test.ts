import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { repair1994FlairPowerBlast } from "../seeds/mergeDuplicateLegacySets";
import {
  adminAuditLogs, cardSets, cards, feedEvents, listings, pcBinderCards, pcBinders,
  pendingCardImages, scanFeedback, scanUploads, userCollections, userWishlists,
  users, xpEvents,
} from "../../shared/schema";

const sourceSlug = "1994-1994-flair-marvel-annual-flair-marvel-universe-powerblast";
const targetSlug = "1994-flair-marvel-annual-flair-marvel-universe-powerblast";
const names = [
  "Cable", "Cyclops", "Iron Man", "Magneto", "Phoenix", "Storm",
  "Venom", "Wolverine", "Ghost Rider", "Punisher", "Captain America",
  "Gambit", "Thor", "Silver Surfer", "Spider-Man", "Deadpool",
  "Invisible Woman", "Dr. Doom",
];
class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function rollbackFixture(
  callback: (tx: Tx, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
  await assert.rejects(db.transaction(async tx => {
    const f = await fixture(tx);
    await callback(tx, f);
    throw new Rollback();
  }), (error: unknown) => error instanceof Rollback);
}

async function fixture(tx: Tx) {
  // Temporarily free the production slugs inside this transaction; neither
  // existing catalog rows nor fixture rows survive the forced rollback.
  const tag = `powerblast-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (const slug of [sourceSlug, targetSlug]) {
    await tx.update(cardSets).set({ slug: `${tag}-${slug}` }).where(eq(cardSets.slug, slug));
  }
  const [source, target] = await tx.insert(cardSets).values([
    { slug: sourceSlug, name: `${tag} source`, year: 1994, totalCards: 20 },
    { slug: targetSlug, name: `${tag} target`, year: 1994, totalCards: 18 },
  ]).returning();
  const targets = await tx.insert(cards).values(names.map((name, i) => ({
    setId: target.id, cardNumber: String(i + 1), name, rarity: "Common",
    frontImageUrl: i === 14 ? "https://example.invalid/target-front.jpg" : null,
  }))).returning();
  const sources = await tx.insert(cards).values([
    ...names.map((name, i) => ({
      setId: source.id, cardNumber: String(i + 1), name, rarity: "Common",
      frontImageUrl: i === 14 ? "/mcv/sets/source-front.webp" : null,
      backImageUrl: i === 14 ? "/mcv/sets/source-back.webp" : null,
    })),
    { setId: source.id, cardNumber: "2", name: "Punisher", rarity: "Common" },
    { setId: source.id, cardNumber: "6", name: "Spider-Man", rarity: "Common" },
  ]).returning();
  return { tag, source, target, sources, targets,
    punisher: targets[9], spider: targets[14],
    sourcePunishers: [sources[9], sources[18]],
    sourceSpiders: [sources[14], sources[19]] };
}

test("1994 PowerBlast rejects incomplete, alien and ambiguous checklists before mutation", async () => {
  const cases: Array<{
    label: string;
    change: (tx: Tx, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>;
    error: RegExp;
  }> = [
    { label: "missing source subset", change: async (tx, f) => {
      await tx.update(cardSets).set({ slug: `${f.tag}-missing` }).where(eq(cardSets.id, f.source.id));
    }, error: /source and active canonical target/ },
    { label: "missing target subset", change: async (tx, f) => {
      await tx.update(cardSets).set({ slug: `${f.tag}-missing` }).where(eq(cardSets.id, f.target.id));
    }, error: /source and active canonical target/ },
    { label: "inactive target", change: async (tx, f) => {
      await tx.update(cardSets).set({ isActive: false }).where(eq(cardSets.id, f.target.id));
    }, error: /source and active canonical target/ },
    { label: "archived target", change: async (tx, f) => {
      await tx.update(cardSets).set({ archivedAt: new Date() }).where(eq(cardSets.id, f.target.id));
    }, error: /source and active canonical target/ },
    { label: "missing source row", change: async (tx, f) => {
      await tx.delete(cards).where(eq(cards.id, f.sources[0].id));
    }, error: /expected exactly 20 source rows/ },
    { label: "archived alien source", change: async (tx, f) => {
      await tx.update(cards).set({ name: "Alien", archivedAt: new Date() })
        .where(eq(cards.id, f.sources[0].id));
    }, error: /unexpected source identity/ },
    { label: "missing target row", change: async (tx, f) => {
      await tx.delete(cards).where(eq(cards.id, f.targets[0].id));
    }, error: /expected exactly 18 active canonical rows/ },
    { label: "duplicate canonical slot", change: async (tx, f) => {
      await tx.update(cards).set({ cardNumber: "1" }).where(eq(cards.id, f.targets[1].id));
    }, error: /invalid or duplicate canonical number/ },
    { label: "wrong canonical Punisher", change: async (tx, f) => {
      await tx.update(cards).set({ name: "Not Punisher" }).where(eq(cards.id, f.punisher.id));
    }, error: /unexpected canonical identity #10/ },
    { label: "wrong canonical Spider-Man", change: async (tx, f) => {
      await tx.update(cards).set({ name: "Not Spider-Man" }).where(eq(cards.id, f.spider.id));
    }, error: /unexpected canonical identity #15/ },
    { label: "wrong regular source identity", change: async (tx, f) => {
      await tx.update(cards).set({ name: "Alien" }).where(eq(cards.id, f.sources[0].id));
    }, error: /unexpected source identity/ },
    { label: "wrong extra source identity", change: async (tx, f) => {
      await tx.update(cards).set({ name: "Alien" }).where(eq(cards.id, f.sources[18].id));
    }, error: /unexpected source identity/ },
    { label: "ambiguous repeated extra", change: async (tx, f) => {
      await tx.update(cards).set({ cardNumber: "2", name: "Punisher" })
        .where(eq(cards.id, f.sources[19].id));
    }, error: /repeated extra/ },
    { label: "ambiguous repeated regular", change: async (tx, f) => {
      await tx.update(cards).set({ cardNumber: "1", name: names[0] })
        .where(eq(cards.id, f.sources[1].id));
    }, error: /unexpected source identity/ },
  ];
  for (const scenario of cases) {
    await rollbackFixture(async (tx, f) => {
      await scenario.change(tx, f);
      const beforeSource = await tx.select().from(cards).where(eq(cards.setId, f.source.id));
      const beforeTarget = await tx.select().from(cards).where(eq(cards.setId, f.target.id));
      const beforeSets = await tx.select().from(cardSets).where(inArray(cardSets.id, [f.source.id, f.target.id]));
      await assert.rejects(repair1994FlairPowerBlast(tx), scenario.error, scenario.label);
      assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, f.source.id)), beforeSource, scenario.label);
      assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, f.target.id)), beforeTarget, scenario.label);
      assert.deepEqual(await tx.select().from(cardSets).where(inArray(cardSets.id, [f.source.id, f.target.id])), beforeSets, scenario.label);
      assert.deepEqual(await tx.select().from(adminAuditLogs)
        .where(inArray(adminAuditLogs.entityId, f.sources.map(c => c.id))), [], scenario.label);
    });
  }
});

test("1994 PowerBlast preserves collections and links, audits, and repairs archived residuals idempotently", async () => {
  await rollbackFixture(async (tx, f) => {
    const [a, b] = await tx.insert(users).values([
      { firebaseUid: `${f.tag}-a`, username: `${f.tag}-a`, email: `${f.tag}-a@example.invalid` },
      { firebaseUid: `${f.tag}-b`, username: `${f.tag}-b`, email: `${f.tag}-b@example.invalid` },
    ]).returning();
    const acquired = new Date("2001-02-03T04:05:06Z");
    const collectionRows = await tx.insert(userCollections).values([
      { userId: a.id, cardId: f.punisher.id, quantity: 3, notes: "survivor note", condition: "Mint" },
      { userId: a.id, cardId: f.sourcePunishers[0].id, quantity: 2, notes: "first source", condition: "Poor",
        acquiredDate: acquired, acquiredVia: "trade", personalValue: "12.34", salePrice: "19.99",
        isForSale: true, serialNumber: "SER-10", isFavorite: true },
      { userId: a.id, cardId: f.sourcePunishers[1].id, quantity: 4,
        notes: "PRIVATE-unlisted-source-note", condition: "Good",
        acquiredDate: acquired, acquiredVia: "private-gift",
        personalValue: "987.65", salePrice: "876.54", serialNumber: "PRIVATE-SERIAL" },
      { userId: b.id, cardId: f.sourceSpiders[0].id, quantity: 5, notes: "keeper", condition: "Excellent" },
      { userId: b.id, cardId: f.sourceSpiders[1].id, quantity: 6, notes: "absorbed", condition: "Fair",
        acquiredDate: acquired, acquiredVia: "gift", personalValue: "4.56", salePrice: "7.89",
        isForSale: true, serialNumber: "SER-15", isFavorite: true },
    ]).returning();
    await tx.insert(userWishlists).values([
      ...[f.punisher, ...f.sourcePunishers].map(c => ({ userId: a.id, cardId: c.id })),
      ...f.sourceSpiders.map(c => ({ userId: b.id, cardId: c.id })),
    ]);
    const [binder] = await tx.insert(pcBinders).values({ userId: a.id, name: f.tag }).returning();
    await tx.insert(pcBinderCards).values([f.punisher, ...f.sourcePunishers]
      .map(c => ({ binderId: binder.id, cardId: c.id })));
    await tx.insert(xpEvents).values([f.punisher, ...f.sourcePunishers]
      .map(c => ({ userId: a.id, cardId: c.id, eventType: "card_added", points: 1 })));
    await tx.insert(listings).values([
      { sellerId: a.id, userCollectionId: collectionRows[0].id, cardId: f.punisher.id,
        price: "4.00", description: "Already listed survivor", conditionSnapshot: "Mint" },
      { sellerId: a.id, userCollectionId: collectionRows[1].id, cardId: f.sourcePunishers[0].id,
        price: "5.00", description: "A", conditionSnapshot: "Poor" },
      { sellerId: b.id, userCollectionId: collectionRows[4].id, cardId: f.sourceSpiders[1].id,
        price: "6.00", description: "B", conditionSnapshot: "Fair" },
    ]);
    await tx.insert(feedEvents).values({ userId: a.id, eventType: "first_card", title: "Fixture",
      relatedType: "card", relatedId: f.sourceSpiders[1].id, dedupeKey: f.tag });
    await tx.insert(pendingCardImages).values({ userId: a.id, cardId: f.sourceSpiders[1].id,
      frontImageUrl: "/mcv/sets/pending.webp" });
    const [scan] = await tx.insert(scanUploads).values({ userId: a.id, confidenceLevel: "high",
      topMatchCardId: f.sourceSpiders[0].id }).returning();
    await tx.insert(scanFeedback).values({ scanUploadId: scan.id, userId: a.id,
      feedbackType: "wrong", selectedCardId: f.sourcePunishers[1].id });

    // An earlier incomplete run archived this row but left a live reference.
    await tx.update(cards).set({ archivedAt: acquired }).where(eq(cards.id, f.sourceSpiders[1].id));
    await repair1994FlairPowerBlast(tx);
    const sourceIds = f.sources.map(c => c.id);
    const sourceRows = await tx.select().from(cards).where(eq(cards.setId, f.source.id));
    assert.equal(sourceRows.length, 20);
    assert.ok(sourceRows.every(c => c.archivedAt));
    const sourceSet = (await tx.select().from(cardSets).where(eq(cardSets.id, f.source.id)))[0];
    const targetSet = (await tx.select().from(cardSets).where(eq(cardSets.id, f.target.id)))[0];
    assert.equal(sourceSet.isActive, false);
    assert.equal(sourceSet.isCanonical, false);
    assert.ok(sourceSet.archivedAt);
    assert.equal(targetSet.totalCards, 18);
    assert.equal(targetSet.isCanonical, true);
    assert.equal(targetSet.isInsertSubset, true);
    assert.equal(targetSet.canonicalSource, "manual_verified");
    const targetRows = await tx.select().from(cards).where(eq(cards.setId, f.target.id));
    assert.equal(targetRows.length, 18);
    assert.ok(targetRows.every(c => c.isInsert && !c.archivedAt));
    assert.equal(targetRows[14].frontImageUrl, "https://example.invalid/target-front.jpg");
    assert.equal(targetRows[14].backImageUrl, "/mcv/sets/source-back.webp");

    const collections = await tx.select().from(userCollections).where(inArray(userCollections.userId, [a.id, b.id]));
    assert.equal(collections.length, 2);
    const ca = collections.find(c => c.userId === a.id)!;
    const cb = collections.find(c => c.userId === b.id)!;
    assert.equal(ca.id, collectionRows[0].id);
    assert.equal(ca.cardId, f.punisher.id);
    assert.equal(ca.quantity, 9);
    assert.equal(ca.condition, "Mint");
    assert.equal(ca.notes, "survivor note");
    assert.equal(cb.notes, "keeper");
    for (const listing of [ca, cb]) {
      assert.ok(!listing.notes?.includes("PRIVATE-unlisted-source-note"));
      assert.ok(!listing.notes?.includes("PRIVATE-SERIAL"));
      assert.ok(!listing.notes?.includes("987.65"));
      assert.ok(!listing.notes?.includes("private-gift"));
      assert.ok(!listing.notes?.includes("2001-02-03"));
      assert.ok(!listing.notes?.includes("PowerBlast merged collection metadata"));
    }
    const foldAudits = (await tx.select().from(adminAuditLogs)
      .where(eq(adminAuditLogs.actionType, "legacy_powerblast_collection_fold")))
      .filter(audit => collectionRows.some(row => row.id === audit.entityId));
    assert.equal(foldAudits.length, 3);
    for (const row of [collectionRows[1], collectionRows[2], collectionRows[4]]) {
      const matching = foldAudits.filter(audit => audit.entityId === row.id);
      assert.equal(matching.length, 1, `one private audit for deleted collection ${row.id}`);
      assert.equal(matching[0].entityType, "user_collection");
      const detail = JSON.parse(matching[0].notes!);
      const entry = detail.absorbedRow;
      assert.equal(detail.ownerId, row.userId);
      assert.equal(detail.survivorCollectionId, row.userId === a.id ? ca.id : cb.id);
      assert.equal(detail.survivorCardId, row.userId === a.id ? f.punisher.id : f.spider.id);
      assert.equal(entry.id, row.id);
      assert.equal(entry.user_id, row.userId);
      assert.equal(entry.card_id, row.cardId);
      for (const field of ["condition", "acquired_date", "acquired_via", "personal_value",
        "sale_price", "is_for_sale", "serial_number", "is_favorite", "notes", "quantity"]) {
        assert.ok(Object.hasOwn(entry, field), `missing ${field}`);
      }
      assert.deepEqual({
        condition: entry.condition, acquiredDate: new Date(`${entry.acquired_date}Z`).toISOString(), acquiredVia: entry.acquired_via,
        personalValue: entry.personal_value, salePrice: entry.sale_price, isForSale: entry.is_for_sale,
        serialNumber: entry.serial_number, isFavorite: entry.is_favorite, notes: entry.notes,
        quantity: entry.quantity,
      }, {
        condition: row.condition, acquiredDate: row.acquiredDate.toISOString(), acquiredVia: row.acquiredVia,
        personalValue: row.personalValue === null ? null : Number(row.personalValue),
        salePrice: row.salePrice === null ? null : Number(row.salePrice), isForSale: row.isForSale,
        serialNumber: row.serialNumber, isFavorite: row.isFavorite, notes: row.notes,
        quantity: row.quantity,
      });
    }
    assert.equal(cb.id, collectionRows[3].id);
    assert.equal(cb.cardId, f.spider.id);
    assert.equal(cb.quantity, 11);
    assert.equal(cb.condition, "Excellent");
    assert.deepEqual({
      condition: cb.condition, acquiredDate: cb.acquiredDate, acquiredVia: cb.acquiredVia,
      personalValue: cb.personalValue, salePrice: cb.salePrice, isForSale: cb.isForSale,
      serialNumber: cb.serialNumber, isFavorite: cb.isFavorite,
    }, {
      condition: collectionRows[3].condition, acquiredDate: collectionRows[3].acquiredDate,
      acquiredVia: collectionRows[3].acquiredVia, personalValue: collectionRows[3].personalValue,
      salePrice: collectionRows[3].salePrice, isForSale: collectionRows[3].isForSale,
      serialNumber: collectionRows[3].serialNumber, isFavorite: collectionRows[3].isFavorite,
    });
    const linkedListings = await tx.select().from(listings).where(inArray(listings.sellerId, [a.id, b.id]));
    assert.deepEqual(linkedListings.map(l => [l.cardId, l.userCollectionId]),
      [[f.punisher.id, ca.id], [f.punisher.id, ca.id], [f.spider.id, cb.id]]);
    assert.deepEqual((await tx.select().from(userWishlists).where(eq(userWishlists.userId, a.id))).map(r => r.cardId), [f.punisher.id]);
    assert.deepEqual((await tx.select().from(userWishlists).where(eq(userWishlists.userId, b.id))).map(r => r.cardId), [f.spider.id]);
    assert.deepEqual((await tx.select().from(pcBinderCards).where(eq(pcBinderCards.binderId, binder.id))).map(r => r.cardId), [f.punisher.id]);
    assert.deepEqual((await tx.select().from(xpEvents).where(eq(xpEvents.userId, a.id))).map(r => r.cardId), [f.punisher.id]);
    assert.equal((await tx.select().from(feedEvents).where(eq(feedEvents.dedupeKey, f.tag)))[0].relatedId, f.spider.id);
    assert.equal((await tx.select().from(pendingCardImages).where(eq(pendingCardImages.userId, a.id)))[0].cardId, f.spider.id);
    assert.equal((await tx.select().from(scanUploads).where(eq(scanUploads.id, scan.id)))[0].topMatchCardId, f.spider.id);
    assert.equal((await tx.select().from(scanFeedback).where(eq(scanFeedback.scanUploadId, scan.id)))[0].selectedCardId, f.punisher.id);
    const residual: any = await tx.execute(sql`
      SELECT (SELECT count(*) FROM user_collections WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM user_wishlists WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM pc_binder_cards WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM listings WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM xp_events WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM pending_card_images WHERE card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM scan_uploads WHERE top_match_card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM scan_feedback WHERE selected_card_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM feed_events WHERE related_type = 'card' AND related_id IN (${sql.join(sourceIds.map(id => sql`${id}`), sql`, `)})) AS n`);
    assert.equal(Number(residual.rows[0].n), 0);
    const audits = await tx.select().from(adminAuditLogs)
      .where(eq(adminAuditLogs.actionType, "legacy_powerblast_card_merge"));
    const fixtureAudits = audits.filter(a => sourceIds.includes(a.entityId!));
    assert.equal(fixtureAudits.length, 20);
    for (const audit of fixtureAudits) {
      const detail = JSON.parse(audit.notes!);
      assert.equal(detail.sourceSlug, sourceSlug);
      assert.equal(detail.targetSlug, targetSlug);
      assert.equal(detail.survivorId, f.sourcePunishers.some(c => c.id === audit.entityId)
        ? f.punisher.id : f.sourceSpiders.some(c => c.id === audit.entityId)
          ? f.spider.id : f.targets[f.sources.findIndex(c => c.id === audit.entityId)].id);
      if (audit.entityId === f.sourceSpiders[1].id) assert.equal(detail.previouslyArchived, true);
    }
    const state = {
      sets: await tx.select().from(cardSets).where(inArray(cardSets.id, [f.source.id, f.target.id])),
      cards: await tx.select().from(cards).where(inArray(cards.setId, [f.source.id, f.target.id])),
      collections, audits: fixtureAudits, foldAudits, linkedListings,
    };
    await repair1994FlairPowerBlast(tx);
    assert.deepEqual(await tx.select().from(cardSets).where(inArray(cardSets.id, [f.source.id, f.target.id])), state.sets);
    assert.deepEqual(await tx.select().from(cards).where(inArray(cards.setId, [f.source.id, f.target.id])), state.cards);
    assert.deepEqual(await tx.select().from(userCollections).where(inArray(userCollections.userId, [a.id, b.id])), state.collections);
    assert.deepEqual(await tx.select().from(listings).where(inArray(listings.sellerId, [a.id, b.id])), state.linkedListings);
    assert.deepEqual((await tx.select().from(adminAuditLogs).where(eq(adminAuditLogs.actionType, "legacy_powerblast_card_merge")))
      .filter(audit => sourceIds.includes(audit.entityId!)), state.audits);
    assert.deepEqual((await tx.select().from(adminAuditLogs).where(eq(adminAuditLogs.actionType, "legacy_powerblast_collection_fold")))
      .filter(audit => collectionRows.some(row => row.id === audit.entityId)), state.foldAudits);
  });
});