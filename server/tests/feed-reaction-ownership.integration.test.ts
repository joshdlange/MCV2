import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { users, feedEvents, feedReactions, xpEvents } from "../../shared/schema";
import { emitFeedEvent, getFeedPage, setReaction, removeReaction } from "../services/feedService";

test("two collectors accumulate reactions; changing/removing one never changes the other's row", {
  skip: process.env.RUN_FEED_REACTION_INTEGRATION !== "1",
}, async () => {
  assert.equal(process.env.NODE_ENV, "development", "Fixture test is development-only");
  const tag = `reaction-ownership-${Date.now()}`;
  const ids: number[] = [];
  let eventId: number | undefined;
  try {
    for (const suffix of ["a", "b"]) {
      const key = `${tag}-${suffix}`;
      const [user] = await db.insert(users).values({
        firebaseUid: key, username: key, email: `${key}@example.invalid`,
        profileVisibility: "public", showActivityInFeed: true,
      }).returning({ id: users.id });
      ids.push(user.id);
    }
    await emitFeedEvent({ userId: ids[0], eventType: "first_card", title: "Reaction test fixture", dedupeKey: tag });
    const [event] = await db.select({ id: feedEvents.id }).from(feedEvents).where(eq(feedEvents.dedupeKey, tag));
    assert.ok(event);
    eventId = event.id;
    const pageFor = async (userId: number) => {
      const rows = await getFeedPage({ viewerId: userId, filter: "everyone", limit: 50 });
      const found = rows.find(row => row.id === eventId);
      assert.ok(found);
      return found;
    };
    await setReaction(ids[1], eventId, "fire_pull");
    assert.equal((await pageFor(ids[0])).myReaction, null, "B's icon must not be marked as A's");
    const combined = await setReaction(ids[0], eventId, "fire_pull");
    assert.equal(combined.reactions?.fire_pull, 2);
    assert.equal((await pageFor(ids[0])).reactions.fire_pull, 2);
    const switched = await setReaction(ids[0], eventId, "hero_move");
    assert.deepEqual(switched.reactions, { fire_pull: 1, hero_move: 1 });
    assert.equal((await pageFor(ids[1])).myReaction, "fire_pull");
    const removed = await removeReaction(ids[0], eventId);
    assert.deepEqual(removed.reactions, { fire_pull: 1 });
    assert.equal(removed.myReaction, null);
    assert.deepEqual((await removeReaction(ids[0], eventId)).reactions, { fire_pull: 1 }, "Repeated removal cannot delete B's reaction");
    assert.equal((await pageFor(ids[1])).myReaction, "fire_pull");
    const [remaining] = await db.select().from(feedReactions).where(and(eq(feedReactions.feedEventId, eventId), eq(feedReactions.userId, ids[1])));
    assert.equal(remaining.reactionType, "fire_pull");
  } finally {
    if (eventId !== undefined) {
      await db.delete(feedReactions).where(eq(feedReactions.feedEventId, eventId));
      await db.delete(feedEvents).where(eq(feedEvents.id, eventId));
    }
    if (ids.length) {
      await db.delete(xpEvents).where(inArray(xpEvents.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    await pool.end();
  }
});
