import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  applyCardMergePairs,
  assertExactPrefixedCardNumbers,
  buildExactLenDuplicatePairs,
  mergeExactLenDuplicateRows,
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
const FLAIR_2023_BASE = "2023-2023-flair-marvel-base";
const FLAIR_2023_CARVED = "2023-2023-flair-marvel-carved";
const FLAIR_2023_FLAIRIUM = "2023-2023-flair-marvel-flairium";
const LENTICULAR_2024 = "2024-2024-upper-deck-marvel-masterpieces-92-platinum-lenticular";

class FixtureRollback extends Error {}

test("2023 Flair checklist guard rejects missing, duplicate, and out-of-range numbers", () => {
  const validCarved = Array.from({ length: 24 }, (_, index) => `CC-${index + 1}`);
  assert.doesNotThrow(() =>
    assertExactPrefixedCardNumbers("valid carved", validCarved, "CC", 24));

  const missingCarved = [...validCarved.slice(0, 23), "CC-25"];
  assert.throws(
    () => assertExactPrefixedCardNumbers("missing carved", missingCarved, "CC", 24),
    /missing \[CC24\].*unexpected \[CC25\]/,
  );

  const duplicateCarved = [...validCarved.slice(0, 23), "CC-23"];
  assert.throws(
    () => assertExactPrefixedCardNumbers("duplicate carved", duplicateCarved, "CC", 24),
    /missing \[CC24\].*duplicates 1/,
  );

  const outOfRangeFlairium = [
    ...Array.from({ length: 59 }, (_, index) => `FT-${index + 1}`),
    "FT-61",
  ];
  assert.throws(
    () => assertExactPrefixedCardNumbers("out of range Flairium", outOfRangeFlairium, "FT", 60),
    /missing \[FT60\].*unexpected \[FT61\]/,
  );
});

test("2024 Lenticular LEN guard requires exact one-to-one name and number pairs", () => {
  const validCards = [
    { id: 1, cardNumber: "1", name: "Blob" },
    { id: 2, cardNumber: "1", name: "BlobLEN" },
    { id: 3, cardNumber: "2", name: "Johnny Blaze" },
    { id: 4, cardNumber: "2", name: "Johnny BlazeLEN" },
  ];
  assert.deepEqual(
    buildExactLenDuplicatePairs("valid Lenticular", validCards, 2),
    [{ dup: 2, surv: 1 }, { dup: 4, surv: 3 }],
  );

  assert.throws(
    () => buildExactLenDuplicatePairs(
      "wrong character",
      validCards.map((card) => card.id === 4 ? { ...card, name: "Black WidowLEN" } : card),
      2,
    ),
    /no exact regular match for 2 Black WidowLEN/,
  );

  assert.throws(
    () => buildExactLenDuplicatePairs(
      "duplicate number",
      validCards.map((card) => card.id >= 3 ? { ...card, cardNumber: "1" } : card),
      2,
    ),
    /missing \[2\].*duplicates 1/,
  );

  assert.throws(
    () => buildExactLenDuplicatePairs("missing LEN", validCards.slice(0, 3), 2),
    /expected 2 regular \+ 2 LEN cards/,
  );

  assert.throws(
    () => buildExactLenDuplicatePairs(
      "malformed suffix",
      validCards.map((card) => card.id === 2 ? { ...card, name: "BlobLEN!" } : card),
      2,
    ),
    /malformed LEN suffix/,
  );
});

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
          backImageUrl: "/mcv/sets/fixture-spider-back.webp",
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
          frontImageUrl: "https://images.example.invalid/existing-spider.jpg",
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
      await applyCardMergePairs(
        tx,
        pairs,
        "Isolated fixture merge",
        { imageTransferMode: "missing-only" },
      );

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
      assert.equal(imageTarget.frontImageUrl, "https://images.example.invalid/existing-spider.jpg");
      assert.equal(imageTarget.backImageUrl, "/mcv/sets/fixture-spider-back.webp");

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

test("Lenticular LEN merge wiring preserves references and target images", async () => {
  const tag = `lenticular-len-fixture-${Date.now()}`;

  await assert.rejects(
    db.transaction(async (tx) => {
      const [subset] = await tx.insert(cardSets).values({
        name: `${tag} Lenticular`,
        slug: tag,
        year: 2024,
        totalCards: 4,
      }).returning();
      const fixtureCards = await tx.insert(cards).values([
        {
          setId: subset.id,
          cardNumber: "1",
          name: "Blob",
          rarity: "Common",
          frontImageUrl: "/mcv/sets/existing-blob-front.webp",
        },
        {
          setId: subset.id,
          cardNumber: "1",
          name: "BlobLEN",
          rarity: "Common",
          frontImageUrl: "/mcv/sets/source-blob-front.webp",
          backImageUrl: "/mcv/sets/source-blob-back.webp",
        },
        {
          setId: subset.id,
          cardNumber: "2",
          name: "Johnny Blaze",
          rarity: "Common",
          backImageUrl: "/mcv/sets/existing-blaze-back.webp",
        },
        {
          setId: subset.id,
          cardNumber: "2",
          name: "Johnny BlazeLEN",
          rarity: "Common",
          frontImageUrl: "/mcv/sets/source-blaze-front.webp",
          backImageUrl: "/mcv/sets/source-blaze-back.webp",
        },
      ]).returning();
      const blob = fixtureCards.find((card) => card.name === "Blob")!;
      const blobLen = fixtureCards.find((card) => card.name === "BlobLEN")!;
      const blaze = fixtureCards.find((card) => card.name === "Johnny Blaze")!;
      const blazeLen = fixtureCards.find((card) => card.name === "Johnny BlazeLEN")!;

      const [user] = await tx.insert(users).values({
        firebaseUid: tag,
        username: tag,
        email: `${tag}@example.invalid`,
      }).returning();
      const collections = await tx.insert(userCollections).values([
        { userId: user.id, cardId: blob.id, quantity: 3 },
        { userId: user.id, cardId: blobLen.id, quantity: 2 },
      ]).returning();
      const targetCollection = collections.find((row) => row.cardId === blob.id)!;
      const sourceCollection = collections.find((row) => row.cardId === blobLen.id)!;

      await tx.insert(userWishlists).values([
        { userId: user.id, cardId: blob.id },
        { userId: user.id, cardId: blobLen.id },
      ]);
      const [binder] = await tx.insert(pcBinders)
        .values({ userId: user.id, name: `${tag} binder` })
        .returning();
      await tx.insert(pcBinderCards).values([
        { binderId: binder.id, cardId: blob.id },
        { binderId: binder.id, cardId: blobLen.id },
      ]);
      await tx.insert(xpEvents).values([
        { userId: user.id, eventType: "card_added", cardId: blob.id, points: 1 },
        { userId: user.id, eventType: "card_added", cardId: blobLen.id, points: 1 },
      ]);
      await tx.insert(feedEvents).values({
        userId: user.id,
        eventType: "first_card",
        title: "LEN fixture",
        relatedType: "card",
        relatedId: blazeLen.id,
        dedupeKey: `${tag}-feed`,
      });
      await tx.insert(pendingCardImages).values({
        userId: user.id,
        cardId: blazeLen.id,
        frontImageUrl: "/mcv/sets/pending-len.webp",
      });
      const [scan] = await tx.insert(scanUploads).values({
        userId: user.id,
        confidenceLevel: "high",
        topMatchCardId: blazeLen.id,
      }).returning();
      await tx.insert(scanFeedback).values({
        scanUploadId: scan.id,
        userId: user.id,
        feedbackType: "wrong",
        selectedCardId: blobLen.id,
      });
      await tx.insert(listings).values({
        sellerId: user.id,
        userCollectionId: sourceCollection.id,
        cardId: blobLen.id,
        price: "5.00",
        description: "LEN fixture listing",
        conditionSnapshot: "Near Mint",
      });

      const result = await mergeExactLenDuplicateRows(tx, subset, 2, "LEN fixture");
      assert.deepEqual(result, {
        merged: 2,
        frontImagesCopied: 1,
        backImagesCopied: 1,
      });

      const remainingCards = await tx.select().from(cards)
        .where(eq(cards.setId, subset.id));
      const mergedBlob = remainingCards.find((card) => card.id === blob.id)!;
      const mergedBlaze = remainingCards.find((card) => card.id === blaze.id)!;
      assert.equal(mergedBlob.frontImageUrl, "/mcv/sets/existing-blob-front.webp");
      assert.equal(mergedBlob.backImageUrl, "/mcv/sets/source-blob-back.webp");
      assert.equal(mergedBlaze.frontImageUrl, "/mcv/sets/source-blaze-front.webp");
      assert.equal(mergedBlaze.backImageUrl, "/mcv/sets/existing-blaze-back.webp");
      assert.ok(remainingCards.find((card) => card.id === blobLen.id)!.archivedAt);
      assert.ok(remainingCards.find((card) => card.id === blazeLen.id)!.archivedAt);

      const [mergedCollection] = await tx.select().from(userCollections)
        .where(eq(userCollections.userId, user.id));
      assert.equal(mergedCollection.id, targetCollection.id);
      assert.equal(mergedCollection.cardId, blob.id);
      assert.equal(mergedCollection.quantity, 5);
      const [listing] = await tx.select().from(listings).where(eq(listings.sellerId, user.id));
      assert.equal(listing.userCollectionId, targetCollection.id);
      assert.equal(listing.cardId, blob.id);

      const [wishlistRows, binderRows, xpRows, feedRows, pendingRows, scanRows, feedbackRows] =
        await Promise.all([
          tx.select().from(userWishlists).where(eq(userWishlists.userId, user.id)),
          tx.select().from(pcBinderCards).where(eq(pcBinderCards.binderId, binder.id)),
          tx.select().from(xpEvents).where(eq(xpEvents.userId, user.id)),
          tx.select().from(feedEvents).where(eq(feedEvents.userId, user.id)),
          tx.select().from(pendingCardImages).where(eq(pendingCardImages.userId, user.id)),
          tx.select().from(scanUploads).where(eq(scanUploads.userId, user.id)),
          tx.select().from(scanFeedback).where(eq(scanFeedback.userId, user.id)),
        ]);
      assert.deepEqual(wishlistRows.map((row) => row.cardId), [blob.id]);
      assert.deepEqual(binderRows.map((row) => row.cardId), [blob.id]);
      assert.deepEqual(xpRows.map((row) => row.cardId), [blob.id]);
      assert.equal(feedRows[0].relatedId, blaze.id);
      assert.equal(pendingRows[0].cardId, blaze.id);
      assert.equal(scanRows[0].topMatchCardId, blaze.id);
      assert.equal(feedbackRows[0].selectedCardId, blob.id);

      const [refreshedSubset] = await tx.select().from(cardSets)
        .where(eq(cardSets.id, subset.id));
      assert.equal(refreshedSubset.totalCards, 2);
      assert.deepEqual(
        await mergeExactLenDuplicateRows(tx, refreshedSubset, 2, "LEN fixture"),
        { merged: 0, frontImagesCopied: 0, backImagesCopied: 0 },
      );

      throw new FixtureRollback();
    }),
    (error: unknown) => error instanceof FixtureRollback,
  );
});

test("Lenticular LEN merge rejects malformed pairs before changing cards", async () => {
  const tag = `lenticular-len-invalid-${Date.now()}`;

  await assert.rejects(
    db.transaction(async (tx) => {
      const [subset] = await tx.insert(cardSets).values({
        name: tag,
        slug: tag,
        year: 2024,
        totalCards: 4,
      }).returning();
      await tx.insert(cards).values([
        { setId: subset.id, cardNumber: "1", name: "Blob", rarity: "Common" },
        { setId: subset.id, cardNumber: "1", name: "BlobLEN", rarity: "Common" },
        { setId: subset.id, cardNumber: "2", name: "Johnny Blaze", rarity: "Common" },
        { setId: subset.id, cardNumber: "2", name: "Black WidowLEN", rarity: "Common" },
      ]);

      await assert.rejects(
        mergeExactLenDuplicateRows(tx, subset, 2, "invalid LEN fixture"),
        /no exact regular match/,
      );
      const untouched = await tx.select().from(cards).where(eq(cards.setId, subset.id));
      assert.equal(untouched.length, 4);
      assert.ok(untouched.every((card) => card.archivedAt === null));

      const [terminalSubset] = await tx.insert(cardSets).values({
        name: `${tag} terminal`,
        slug: `${tag}-terminal`,
        year: 2024,
        totalCards: 2,
      }).returning();
      await tx.insert(cards).values([
        { setId: terminalSubset.id, cardNumber: "1", name: "BlobL.E.N.", rarity: "Common" },
        { setId: terminalSubset.id, cardNumber: "2", name: "Johnny Blaze", rarity: "Common" },
      ]);
      await assert.rejects(
        mergeExactLenDuplicateRows(tx, terminalSubset, 2, "invalid terminal LEN fixture"),
        /malformed LEN suffix remains in terminal checklist/,
      );
      const terminalUntouched = await tx.select().from(cards)
        .where(eq(cards.setId, terminalSubset.id));
      assert.equal(terminalUntouched.length, 2);
      assert.ok(terminalUntouched.every((card) => card.archivedAt === null));

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
    flair_base AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${FLAIR_2023_BASE}
    ),
    flair_carved AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${FLAIR_2023_CARVED}
    ),
    flair_flairium AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${FLAIR_2023_FLAIRIUM}
    ),
    lenticular_2024 AS (
      SELECT id, is_active, total_cards FROM card_sets WHERE slug = ${LENTICULAR_2024}
    ),
    retired_cards AS (
      SELECT c.id
      FROM cards c
      WHERE c.set_id = (SELECT id FROM power_source)
         OR (
           c.set_id = (SELECT id FROM lost_source)
           AND c.card_number IN ('LM-1', 'LM-2', 'LM-3', 'LM-4', 'LM-5')
         )
         OR (
           c.set_id = (SELECT id FROM flair_base)
           AND (upper(c.card_number) LIKE 'CC%' OR upper(c.card_number) LIKE 'FT%')
         )
         OR (
           c.set_id = (SELECT id FROM lenticular_2024)
           AND upper(trim(c.name)) ~ 'LEN$'
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
      (SELECT is_active FROM flair_base) AS flair_base_active,
      (SELECT total_cards FROM flair_base) AS flair_base_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_base) AND archived_at IS NULL) AS flair_base_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_base) AND archived_at IS NULL
         AND card_number ~ '^[0-9]+$' AND card_number::int BETWEEN 1 AND 90) AS flair_base_1_to_90,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_base) AND archived_at IS NULL
         AND (upper(card_number) LIKE 'CC%' OR upper(card_number) LIKE 'FT%')) AS flair_misplaced_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_base) AND archived_at IS NOT NULL
         AND (upper(card_number) LIKE 'CC%' OR upper(card_number) LIKE 'FT%')) AS flair_relocated_archived_cards,
      (SELECT is_active FROM flair_carved) AS flair_carved_active,
      (SELECT total_cards FROM flair_carved) AS flair_carved_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_carved) AND archived_at IS NULL) AS flair_carved_active_cards,
      (SELECT is_active FROM flair_flairium) AS flair_flairium_active,
      (SELECT total_cards FROM flair_flairium) AS flair_flairium_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_flairium) AND archived_at IS NULL) AS flair_flairium_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_flairium) AND archived_at IS NULL
         AND front_image_url IS NOT NULL) AS flair_flairium_front_images,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_flairium) AND archived_at IS NULL
         AND back_image_url IS NOT NULL) AS flair_flairium_back_images,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM flair_flairium) AND archived_at IS NULL
         AND regexp_replace(upper(card_number), '[^A-Z0-9]', '', 'g') = 'FT53'
         AND name = 'Bucky Barnes') AS flair_ft53_target,
      (SELECT is_active FROM lenticular_2024) AS lenticular_2024_active,
      (SELECT total_cards FROM lenticular_2024) AS lenticular_2024_total,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL) AS lenticular_2024_active_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL
         AND card_number ~ '^[0-9]+$' AND card_number::int BETWEEN 1 AND 100) AS lenticular_2024_numbers_1_to_100,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL
         AND upper(trim(name)) ~ 'LEN$') AS lenticular_2024_active_len_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NOT NULL
         AND upper(trim(name)) ~ 'LEN$') AS lenticular_2024_archived_len_cards,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL
         AND front_image_url IS NOT NULL) AS lenticular_2024_front_images,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL
         AND back_image_url IS NOT NULL) AS lenticular_2024_back_images,
      (SELECT count(*)::int FROM cards
       WHERE set_id = (SELECT id FROM lenticular_2024) AND archived_at IS NULL
         AND card_number = '1' AND name = 'Blob') AS lenticular_2024_blob_target,
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

test("legacy set repair consolidates known duplicate and misplaced checklists idempotently", async () => {
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

  assert.equal(first.flair_base_active, true);
  assert.equal(first.flair_base_total, 90);
  assert.equal(first.flair_base_active_cards, 90);
  assert.equal(first.flair_base_1_to_90, 90);
  assert.equal(first.flair_misplaced_active_cards, 0);
  assert.equal(first.flair_relocated_archived_cards, 84);
  assert.equal(first.flair_carved_active, true);
  assert.equal(first.flair_carved_total, 24);
  assert.equal(first.flair_carved_active_cards, 24);
  assert.equal(first.flair_flairium_active, true);
  assert.equal(first.flair_flairium_total, 60);
  assert.equal(first.flair_flairium_active_cards, 60);
  assert.equal(first.flair_flairium_front_images, 60);
  assert.equal(first.flair_flairium_back_images, 60);
  assert.equal(first.flair_ft53_target, 1);

  assert.equal(first.lenticular_2024_active, true);
  assert.equal(first.lenticular_2024_total, 100);
  assert.equal(first.lenticular_2024_active_cards, 100);
  assert.equal(first.lenticular_2024_numbers_1_to_100, 100);
  assert.equal(first.lenticular_2024_active_len_cards, 0);
  assert.equal(first.lenticular_2024_archived_len_cards, 100);
  assert.equal(first.lenticular_2024_front_images, 99);
  assert.equal(first.lenticular_2024_back_images, 30);
  assert.equal(first.lenticular_2024_blob_target, 1);

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