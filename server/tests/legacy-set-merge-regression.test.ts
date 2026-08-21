import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  applyCardMergePairs,
  mergeDuplicateLegacySets,
} from "../seeds/mergeDuplicateLegacySets";
import {
  cardSets,
  cards,
  feedEvents,
  listings,
  pcBinderCards,
  pcBinders,
  pendingCardImages,
  scanFeedback,
  scanUploads,
  userCollections,
  userWishlists,
  users,
  xpEvents,
} from "../../shared/schema";

const POWERBLAST_SOURCE = "1994-1994-flair-marvel-annual-flair-marvel-universe-powerblast";
const POWERBLAST_TARGET = "1994-flair-marvel-annual-flair-marvel-universe-powerblast";
const LOST_MARVEL_SOURCE = "1994-1994-flair-marvel-annual-base";
const LOST_MARVEL_TARGET = "1992-1992-skybox-marvel-masterpieces-lost-marvel-bonus-cards";

class FixtureRollback extends Error {}

test("card-pair merge preserves quantities and repoints every live reference", async () => {
  const tag = `legacy-merge-fixture-${Date.now()}`;

  await assert.rejects(
    db.transaction(async (tx) => {
      const [sourceSet, targetSet] = await tx.insert(cardSets).values([
        { name: `${tag} source`, slug: `${tag}-source`, year: 1994, totalCards: 3 },
        { name: `${tag} target`, slug: `${tag}-target`, year: 1994, totalCards: 2 },
      ]).returning({ id: cardSets.id });

      const fixtureCards = await tx.insert(cards).values([
        {
          setId: sourceSet.id,
          cardNumber: "2",
          name: "Punisher",
          rarity: "Common",
        },
        {
          setId: sourceSet.id,
          cardNumber: "10",
          name: "Punisher",
          rarity: "Common",
        },
        {
          setId: sourceSet.id,
          cardNumber: "6",
          name: "Spider-Man",
          rarity: "Common",
          frontImageUrl: "/mcv/sets/fixture-spider.webp",
        },
        {
          setId: targetSet.id,
          cardNumber: "10",
          name: "Punisher",
          rarity: "Common",
        },
        {
          setId: targetSet.id,
          cardNumber: "15",
          name: "Spider-Man",
          rarity: "Common",
        },
      ]).returning({
        id: cards.id,
        setId: cards.setId,
        cardNumber: cards.cardNumber,
        name: cards.name,
      });

      const sourcePunisher2 = fixtureCards.find(
        (card) => card.setId === sourceSet.id && card.cardNumber === "2",
      )!;
      const sourcePunisher10 = fixtureCards.find(
        (card) => card.setId === sourceSet.id && card.cardNumber === "10",
      )!;
      const sourceSpider6 = fixtureCards.find(
        (card) => card.setId === sourceSet.id && card.cardNumber === "6",
      )!;
      const targetPunisher10 = fixtureCards.find(
        (card) => card.setId === targetSet.id && card.cardNumber === "10",
      )!;
      const targetSpider15 = fixtureCards.find(
        (card) => card.setId === targetSet.id && card.cardNumber === "15",
      )!;

      const [userA, userB] = await tx.insert(users).values([
        {
          firebaseUid: `${tag}-a`,
          username: `${tag}-a`,
          email: `${tag}-a@example.invalid`,
        },
        {
          firebaseUid: `${tag}-b`,
          username: `${tag}-b`,
          email: `${tag}-b@example.invalid`,
        },
      ]).returning({ id: users.id });

      const collectionFixtures = await tx.insert(userCollections).values([
        { userId: userA.id, cardId: sourcePunisher2.id, quantity: 2 },
        { userId: userA.id, cardId: sourcePunisher10.id, quantity: 1 },
        { userId: userA.id, cardId: targetPunisher10.id, quantity: 3 },
        { userId: userB.id, cardId: sourceSpider6.id, quantity: 4 },
      ]).returning({
        id: userCollections.id,
        userId: userCollections.userId,
        cardId: userCollections.cardId,
      });
      const userASourceCollection = collectionFixtures.find(
        (row) => row.userId === userA.id && row.cardId === sourcePunisher2.id,
      )!;
      const userATargetCollection = collectionFixtures.find(
        (row) => row.userId === userA.id && row.cardId === targetPunisher10.id,
      )!;
      const userBSourceCollection = collectionFixtures.find(
        (row) => row.userId === userB.id && row.cardId === sourceSpider6.id,
      )!;

      await tx.insert(userWishlists).values([
        { userId: userA.id, cardId: sourcePunisher2.id },
        { userId: userA.id, cardId: targetPunisher10.id },
      ]);
      const [binder] = await tx.insert(pcBinders)
        .values({ userId: userA.id, name: `${tag} binder` })
        .returning({ id: pcBinders.id });
      await tx.insert(pcBinderCards).values([
        { binderId: binder.id, cardId: sourcePunisher10.id },
        { binderId: binder.id, cardId: targetPunisher10.id },
      ]);
      await tx.insert(xpEvents).values([
        { userId: userA.id, eventType: "card_added", cardId: sourcePunisher2.id, points: 1 },
        { userId: userA.id, eventType: "card_added", cardId: sourcePunisher10.id, points: 1 },
        { userId: userA.id, eventType: "card_added", cardId: targetPunisher10.id, points: 1 },
        { userId: userB.id, eventType: "card_added", cardId: sourceSpider6.id, points: 1 },
      ]);
      await tx.insert(feedEvents).values({
        userId: userB.id,
        eventType: "first_card",
        title: "Fixture card",
        relatedType: "card",
        relatedId: sourceSpider6.id,
        dedupeKey: `${tag}-feed`,
      });
      await tx.insert(pendingCardImages).values({
        userId: userB.id,
        cardId: sourceSpider6.id,
        frontImageUrl: "/mcv/sets/fixture-upload.webp",
      });
      const [scan] = await tx.insert(scanUploads).values({
        userId: userB.id,
        confidenceLevel: "high",
        topMatchCardId: sourceSpider6.id,
      }).returning({ id: scanUploads.id });
      await tx.insert(scanFeedback).values({
        scanUploadId: scan.id,
        userId: userB.id,
        feedbackType: "wrong",
        selectedCardId: sourcePunisher2.id,
      });
      await tx.insert(listings).values([
        {
          sellerId: userA.id,
          userCollectionId: userASourceCollection.id,
          cardId: sourcePunisher2.id,
          price: "5.00",
          description: "Fixture listing A",
          conditionSnapshot: "Near Mint",
        },
        {
          sellerId: userB.id,
          userCollectionId: userBSourceCollection.id,
          cardId: sourceSpider6.id,
          price: "6.00",
          description: "Fixture listing B",
          conditionSnapshot: "Near Mint",
        },
      ]);

      const pairs = [
        { dup: sourcePunisher2.id, surv: targetPunisher10.id },
        { dup: sourcePunisher10.id, surv: targetPunisher10.id },
        { dup: sourceSpider6.id, surv: targetSpider15.id },
      ];
      await applyCardMergePairs(tx, pairs, "Isolated fixture merge");

      const mergedCollections = await tx.select().from(userCollections)
        .where(inArray(userCollections.userId, [userA.id, userB.id]));
      assert.equal(mergedCollections.length, 2);
      const mergedA = mergedCollections.find((row) => row.userId === userA.id)!;
      const mergedB = mergedCollections.find((row) => row.userId === userB.id)!;
      assert.equal(mergedA.id, userATargetCollection.id);
      assert.equal(mergedA.cardId, targetPunisher10.id);
      assert.equal(mergedA.quantity, 6);
      assert.equal(mergedB.id, userBSourceCollection.id);
      assert.equal(mergedB.cardId, targetSpider15.id);
      assert.equal(mergedB.quantity, 4);

      const mergedListings = await tx.select().from(listings)
        .where(inArray(listings.sellerId, [userA.id, userB.id]));
      const listingA = mergedListings.find((row) => row.sellerId === userA.id)!;
      const listingB = mergedListings.find((row) => row.sellerId === userB.id)!;
      assert.equal(listingA.userCollectionId, userATargetCollection.id);
      assert.equal(listingA.cardId, targetPunisher10.id);
      assert.equal(listingB.userCollectionId, userBSourceCollection.id);
      assert.equal(listingB.cardId, targetSpider15.id);

      const [wishlistRows, binderRows, xpRows, feedRows, pendingRows, scanRows, feedbackRows] =
        await Promise.all([
          tx.select().from(userWishlists).where(eq(userWishlists.userId, userA.id)),
          tx.select().from(pcBinderCards).where(eq(pcBinderCards.binderId, binder.id)),
          tx.select().from(xpEvents).where(inArray(xpEvents.userId, [userA.id, userB.id])),
          tx.select().from(feedEvents).where(eq(feedEvents.userId, userB.id)),
          tx.select().from(pendingCardImages).where(eq(pendingCardImages.userId, userB.id)),
          tx.select().from(scanUploads).where(eq(scanUploads.userId, userB.id)),
          tx.select().from(scanFeedback).where(eq(scanFeedback.userId, userB.id)),
        ]);
      assert.deepEqual(wishlistRows.map((row) => row.cardId), [targetPunisher10.id]);
      assert.deepEqual(binderRows.map((row) => row.cardId), [targetPunisher10.id]);
      assert.deepEqual(
        xpRows.map((row) => row.cardId).sort((a, b) => Number(a) - Number(b)),
        [targetPunisher10.id, targetSpider15.id].sort((a, b) => a - b),
      );
      assert.equal(feedRows[0].relatedId, targetSpider15.id);
      assert.equal(pendingRows[0].cardId, targetSpider15.id);
      assert.equal(scanRows[0].topMatchCardId, targetSpider15.id);
      assert.equal(feedbackRows[0].selectedCardId, targetPunisher10.id);

      const sourceIds = pairs.map((pair) => pair.dup);
      const archivedSources = await tx.select().from(cards).where(inArray(cards.id, sourceIds));
      assert.equal(archivedSources.length, 3);
      assert.ok(archivedSources.every((card) => card.archivedAt !== null));
      const [imageTarget] = await tx.select().from(cards)
        .where(and(eq(cards.id, targetSpider15.id), eq(cards.setId, targetSet.id)));
      assert.equal(imageTarget.frontImageUrl, "/mcv/sets/fixture-spider.webp");

      const lingering: any = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM user_collections WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM user_wishlists WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM pc_binder_cards WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM listings WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM xp_events WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM pending_card_images WHERE card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM scan_uploads WHERE top_match_card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM scan_feedback WHERE selected_card_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)}))
        + (SELECT count(*) FROM feed_events
           WHERE related_type = 'card' AND related_id IN (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})) AS count`);
      assert.equal(Number(lingering.rows[0].count), 0);

      throw new FixtureRollback();
    }),
    (error: unknown) => error instanceof FixtureRollback,
  );
});

async function getMergeState() {
  const result = await db.execute(sql`
    WITH power_source AS (
      SELECT id FROM card_sets WHERE slug = ${POWERBLAST_SOURCE}
    ),
    power_target AS (
      SELECT id, is_active, is_canonical, is_insert_subset, total_cards
      FROM card_sets WHERE slug = ${POWERBLAST_TARGET}
    ),
    lost_source AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${LOST_MARVEL_SOURCE}
    ),
    lost_target AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${LOST_MARVEL_TARGET}
    ),
    retired_cards AS (
      SELECT c.id
      FROM cards c
      WHERE c.set_id = (SELECT id FROM power_source)
         OR (
           c.set_id = (SELECT id FROM lost_source)
           AND c.card_number IN ('LM-1', 'LM-2', 'LM-3', 'LM-4', 'LM-5')
         )
    )
    SELECT
      (SELECT is_active FROM card_sets WHERE id = (SELECT id FROM power_source)) AS power_source_active,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM power_source) AND archived_at IS NULL) AS power_source_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM power_source) AND archived_at IS NOT NULL) AS power_source_archived_cards,
      (SELECT is_active FROM power_target) AS power_target_active,
      (SELECT is_canonical FROM power_target) AS power_target_canonical,
      (SELECT is_insert_subset FROM power_target) AS power_target_insert_subset,
      (SELECT total_cards FROM power_target) AS power_target_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM power_target) AND archived_at IS NULL) AS power_target_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM power_target) AND archived_at IS NULL AND is_insert = false) AS power_target_non_insert_cards,
      (SELECT is_active FROM lost_source) AS lost_source_active,
      (SELECT total_cards FROM lost_source) AS lost_source_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lost_source) AND archived_at IS NULL) AS lost_source_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lost_source)
         AND card_number IN ('LM-1', 'LM-2', 'LM-3', 'LM-4', 'LM-5')
         AND archived_at IS NULL) AS misplaced_lm_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lost_source)
         AND ((card_number = '58' AND name = 'Jubilee') OR (card_number = '62' AND name = 'Typhoid Mary'))
         AND archived_at IS NULL) AS legitimate_base_namesakes,
      (SELECT is_active FROM lost_target) AS lost_target_active,
      (SELECT total_cards FROM lost_target) AS lost_target_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lost_target) AND archived_at IS NULL) AS lost_target_active_cards,
      (SELECT count(*)::int FROM user_collections WHERE card_id IN (SELECT id FROM retired_cards)) AS collection_refs,
      (SELECT count(*)::int FROM user_wishlists WHERE card_id IN (SELECT id FROM retired_cards)) AS wishlist_refs,
      (SELECT count(*)::int FROM pc_binder_cards WHERE card_id IN (SELECT id FROM retired_cards)) AS binder_refs,
      (SELECT count(*)::int FROM listings WHERE card_id IN (SELECT id FROM retired_cards)) AS listing_refs,
      (SELECT count(*)::int FROM xp_events WHERE card_id IN (SELECT id FROM retired_cards)) AS xp_refs,
      (SELECT count(*)::int FROM pending_card_images WHERE card_id IN (SELECT id FROM retired_cards)) AS pending_image_refs,
      (SELECT count(*)::int FROM scan_uploads WHERE top_match_card_id IN (SELECT id FROM retired_cards)) AS scan_upload_refs,
      (SELECT count(*)::int FROM scan_feedback WHERE selected_card_id IN (SELECT id FROM retired_cards)) AS scan_feedback_refs,
      (SELECT count(*)::int FROM feed_events
       WHERE related_type = 'card' AND related_id IN (SELECT id FROM retired_cards)) AS feed_refs,
      (SELECT coalesce(sum(quantity), 0)::int FROM user_collections
       WHERE card_id IN (SELECT id FROM cards WHERE set_id = (SELECT id FROM power_target))) AS power_target_quantity,
      (SELECT coalesce(sum(quantity), 0)::int FROM user_collections
       WHERE card_id IN (SELECT id FROM cards WHERE set_id = (SELECT id FROM lost_target))) AS lost_target_quantity
  `);
  return result.rows[0] as Record<string, unknown>;
}

test("legacy set repair consolidates PowerBlast and relocates Lost Marvel cards idempotently", async () => {
  await mergeDuplicateLegacySets();
  const first = await getMergeState();

  assert.equal(first.power_source_active, false);
  assert.equal(first.power_source_active_cards, 0);
  assert.equal(first.power_source_archived_cards, 20);
  assert.equal(first.power_target_active, true);
  assert.equal(first.power_target_canonical, true);
  assert.equal(first.power_target_insert_subset, true);
  assert.equal(first.power_target_total, 18);
  assert.equal(first.power_target_active_cards, 18);
  assert.equal(first.power_target_non_insert_cards, 0);

  assert.equal(first.lost_source_active, true);
  assert.equal(first.lost_source_total, 135);
  assert.equal(first.lost_source_active_cards, 135);
  assert.equal(first.misplaced_lm_active_cards, 0);
  assert.equal(first.legitimate_base_namesakes, 2);
  assert.equal(first.lost_target_active, true);
  assert.equal(first.lost_target_total, 5);
  assert.equal(first.lost_target_active_cards, 5);

  for (const key of [
    "collection_refs",
    "wishlist_refs",
    "binder_refs",
    "listing_refs",
    "xp_refs",
    "pending_image_refs",
    "scan_upload_refs",
    "scan_feedback_refs",
    "feed_refs",
  ]) {
    assert.equal(first[key], 0, `${key} should be fully repointed`);
  }

  await mergeDuplicateLegacySets();
  assert.deepEqual(await getMergeState(), first);
});