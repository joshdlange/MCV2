import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { CollectionLimitExceededError } from "../storage";
import {
  cards,
  feedEvents,
  userCollections,
  userWishlists,
  users,
  xpEvents,
} from "../../shared/schema";

const tag = `feed-card-actions-${Date.now()}`;
let ownerId = 0;
let otherUserId = 0;
let cardId = 0;
let otherCardId = 0;

before(async () => {
  const created = await db
    .insert(users)
    .values([
      {
        firebaseUid: `${tag}-owner`,
        username: `${tag}-owner`,
        email: `${tag}-owner@example.invalid`,
      },
      {
        firebaseUid: `${tag}-other`,
        username: `${tag}-other`,
        email: `${tag}-other@example.invalid`,
      },
    ])
    .returning({ id: users.id });
  ownerId = created[0].id;
  otherUserId = created[1].id;

  const activeCards = await db
    .select({ id: cards.id })
    .from(cards)
    .where(isNull(cards.archivedAt))
    .limit(2);
  if (activeCards.length < 2) throw new Error("Two active cards are required for feed action tests");
  cardId = activeCards[0].id;
  otherCardId = activeCards[1].id;
});

after(async () => {
  if (!ownerId || !otherUserId) return;
  await new Promise(resolve => setTimeout(resolve, 300));
  const userIds = [ownerId, otherUserId];
  await db.delete(userWishlists).where(inArray(userWishlists.userId, userIds)).catch(() => {});
  await db.delete(userCollections).where(inArray(userCollections.userId, userIds)).catch(() => {});
  await db.delete(feedEvents).where(inArray(feedEvents.userId, userIds)).catch(() => {});
  await db.delete(xpEvents).where(inArray(xpEvents.userId, userIds)).catch(() => {});
  await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
});

test("feed card actions are idempotent and owner-scoped", async () => {
  const [collectionA, collectionB] = await Promise.all([
    storage.addToCollection({ userId: ownerId, cardId }, { incrementExisting: false }),
    storage.addToCollection({ userId: ownerId, cardId }, { incrementExisting: false }),
  ]);
  assert.equal(collectionA.id, collectionB.id);

  const collectionRows = await db
    .select()
    .from(userCollections)
    .where(and(eq(userCollections.userId, ownerId), eq(userCollections.cardId, cardId)));
  assert.equal(collectionRows.length, 1);
  assert.equal(collectionRows[0].quantity, 1);

  const repeatAtLimit = await storage.addToCollection(
    { userId: ownerId, cardId },
    { incrementExisting: false, distinctCardLimit: 1 },
  );
  assert.equal(repeatAtLimit.id, collectionA.id);

  await assert.rejects(
    storage.addToCollection(
      { userId: ownerId, cardId: otherCardId },
      { incrementExisting: false, distinctCardLimit: 1 },
    ),
    (error: unknown) =>
      error instanceof CollectionLimitExceededError
      && error.currentCount === 1
      && error.limit === 1,
  );

  const [wishlistA, wishlistB] = await Promise.all([
    storage.addToWishlist({ userId: ownerId, cardId, priority: 1 }),
    storage.addToWishlist({ userId: ownerId, cardId, priority: 1 }),
  ]);
  assert.equal(wishlistA.id, wishlistB.id);

  const wishlistRows = await db
    .select()
    .from(userWishlists)
    .where(and(eq(userWishlists.userId, ownerId), eq(userWishlists.cardId, cardId)));
  assert.equal(wishlistRows.length, 1);

  assert.equal(await storage.removeFromCollection(collectionA.id, otherUserId), false);
  assert.equal(await storage.removeFromWishlist(wishlistA.id, otherUserId), false);

  const [collectionStillOwned] = await db
    .select({ id: userCollections.id })
    .from(userCollections)
    .where(eq(userCollections.id, collectionA.id));
  const [wishlistStillOwned] = await db
    .select({ id: userWishlists.id })
    .from(userWishlists)
    .where(eq(userWishlists.id, wishlistA.id));
  assert.equal(collectionStillOwned?.id, collectionA.id);
  assert.equal(wishlistStillOwned?.id, wishlistA.id);

  assert.equal(await storage.removeFromCollection(collectionA.id, ownerId), true);
  assert.equal(await storage.removeFromWishlist(wishlistA.id, ownerId), true);
});