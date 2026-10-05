import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, or } from "drizzle-orm";
import { db, pool } from "../db";
import { users, feedEvents, messages } from "../../shared/schema";
import { getFeedPage, emitFeedEvent } from "../services/feedService";
import { storage } from "../storage";

test("feed filters precede pagination; inbox prioritizes received messages without truncation", {
  skip: process.env.RUN_SOCIAL_INTEGRATION !== "1",
}, async () => {
  assert.equal(process.env.NODE_ENV, "development");
  const ids: number[] = [];
  const tag = `social-fixture-${Date.now()}`;
  try {
    for (let i = 0; i < 4; i++) {
      const name = `${tag}-${i}`;
      const [row] = await db.insert(users).values({
        firebaseUid: name, username: name, email: `${name}@example.invalid`,
        profileVisibility: "private", showActivityInFeed: false,
      }).returning({ id: users.id });
      ids.push(row.id);
    }
    for (const eventType of ["badge_earned", "first_card", "image_approved", "level_milestone"]) {
      await emitFeedEvent({ userId: ids[0], eventType, title: tag, dedupeKey: `${tag}:${eventType}` });
    }
    const page = (type: "all" | "badges" | "cards" | "activity", limit = 25) =>
      getFeedPage({ viewerId: ids[0], filter: "me", type, limit });
    assert.equal((await page("all")).length, 4);
    assert.deepEqual((await page("badges", 1)).map(e => e.eventType), ["badge_earned"]);
    assert.equal((await page("cards")).length, 2);
    assert.deepEqual((await page("activity")).map(e => e.eventType), ["level_milestone"]);
    const first = (await page("cards", 1))[0];
    const next = await getFeedPage({ viewerId: ids[0], filter: "me", type: "cards", limit: 1, before: new Date(first.createdAt), beforeId: first.id });
    assert.equal(next.length, 1);
    assert.notEqual(next[0].id, first.id);
    assert.ok(!(await getFeedPage({viewerId: ids[1], filter: "everyone", type: "badges"})).some(e => e.user.id === ids[0]), "Type filter preserves privacy");
    const day = (n: number) => new Date(`2026-01-${String(n).padStart(2, "0")}T12:00:00Z`);
    await db.insert(messages).values([
      { senderId: ids[1], recipientId: ids[0], content: "older received", createdAt: day(1) },
      { senderId: ids[2], recipientId: ids[0], content: "newer received", createdAt: day(2) },
      { senderId: ids[0], recipientId: ids[3], content: "sent only", createdAt: day(4) },
      ...Array.from({length: 110}, () => ({ senderId: ids[0], recipientId: ids[1], content: "new sent", createdAt: day(3) })),
    ]);
    const threads = await storage.getMessageThreads(ids[0]);
    assert.deepEqual(threads.map(t => t.user.id), [ids[2], ids[1], ids[3]]);
    assert.deepEqual(threads.map(t => t.unreadCount), [1, 1, 0]);
    assert.equal(threads[1].lastMessage.content, "new sent", "Preview remains latest exchange");
    const conversation = await storage.getMessages(ids[0], ids[1]);
    assert.equal(conversation.length, 111);
    assert.equal(conversation.at(-1)?.content, "new sent");
  } finally {
    if (ids.length) {
      await db.delete(messages).where(or(inArray(messages.senderId, ids), inArray(messages.recipientId, ids)));
      await db.delete(feedEvents).where(inArray(feedEvents.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    await pool.end();
  }
});
