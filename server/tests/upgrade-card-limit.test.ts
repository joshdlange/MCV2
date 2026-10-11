import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { storage, CollectionLimitExceededError } from "../storage";
import { users, cards, userCollections, feedEvents, xpEvents } from "../../shared/schema";

test("free account rejects card 501; upgraded account accepts it without a new session", async () => {
  const tag = `upgrade-limit-${Date.now()}`;
  const [user] = await db.insert(users).values({
    firebaseUid: tag, username: tag, email: `${tag}@example.invalid`, plan: "SIDE_KICK",
  }).returning();
  try {
    const catalog = await db.select({ id: cards.id }).from(cards).where(isNull(cards.archivedAt)).limit(501);
    assert.equal(catalog.length, 501);
    await db.insert(userCollections).values(catalog.slice(0, 500).map(card => ({ userId: user.id, cardId: card.id, quantity: 1 })));
    // The route reads the current database plan, not req.user's cached plan.
    const add = async (cardId: number) => {
      const [fresh] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, user.id));
      return storage.addToCollection({ userId: user.id, cardId, quantity: 1 }, {
        incrementExisting: false,
        distinctCardLimit: fresh.plan === "SUPER_HERO" ? undefined : 500,
      });
    };
    await assert.rejects(add(catalog[500].id), CollectionLimitExceededError);
    await add(catalog[0].id); // Already-owned retries remain valid at the limit.
    await db.update(users).set({ plan: "SUPER_HERO" }).where(eq(users.id, user.id));
    await add(catalog[500].id);
    const owned = await db.select({ id: userCollections.id }).from(userCollections).where(eq(userCollections.userId, user.id));
    assert.equal(owned.length, 501);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 500));
    await db.delete(feedEvents).where(eq(feedEvents.userId, user.id));
    await db.delete(xpEvents).where(eq(xpEvents.userId, user.id));
    await db.delete(userCollections).where(eq(userCollections.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
