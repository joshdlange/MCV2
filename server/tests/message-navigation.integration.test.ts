import test from "node:test";
import assert from "node:assert/strict";
import { inArray, or } from "drizzle-orm";
import { db, pool } from "../db";
import { users, messages, follows, blocks } from "../../shared/schema";
import { storage } from "../storage";
import { searchMessageUsers } from "../services/messageNavigation";

test("message lookup, incoming order, deterministic ties and recipient-only read marking", {
  skip: process.env.RUN_SOCIAL_INTEGRATION !== "1",
}, async () => {
  assert.equal(process.env.NODE_ENV, "development");
  const ids: number[] = [];
  const tag = `msgqa-${Date.now()}`;
  try {
    for (let i = 0; i < 6; i++) {
      const name = `${tag}-${i}`;
      const [row] = await db.insert(users).values({
        firebaseUid: name, username: name, email: `${name}@example.invalid`,
        displayName: i === 5 ? `${tag} literal_%` : name,
        profileVisibility: "private",
      }).returning({ id: users.id });
      ids.push(row.id);
    }
    await db.insert(follows).values([
      { followerUserId: ids[0], followingUserId: ids[1] },
      { followerUserId: ids[1], followingUserId: ids[0] },
    ]);
    await db.insert(blocks).values([
      { blockerId: ids[0], blockedUserId: ids[3] },
      { blockerId: ids[4], blockedUserId: ids[0] },
    ]);
    assert.deepEqual((await searchMessageUsers(ids[0], "")).map(u => u.id), [ids[1]]);
    const results = await searchMessageUsers(ids[0], tag);
    assert.deepEqual(results.map(u => u.id), [ids[1], ids[2], ids[5]]);
    assert.deepEqual(Object.keys(results[0]).sort(), ["collectorAvatarKey", "displayName", "id", "isFriend", "photoURL", "username"]);
    assert.equal(results[0].isFriend, true);
    assert.deepEqual((await searchMessageUsers(ids[0], "literal_%")).map(u => u.id), [ids[5]]);
    const at = (day: number) => new Date(`2026-01-0${day}T12:00:00Z`);
    const inserted = await db.insert(messages).values([
      { senderId: ids[1], recipientId: ids[0], content: "incoming A", createdAt: at(2) },
      { senderId: ids[2], recipientId: ids[0], content: "incoming B", createdAt: at(2) },
      { senderId: ids[0], recipientId: ids[5], content: "no reply", createdAt: at(4) },
    ]).returning();
    const initial = (await storage.getMessageThreads(ids[0])).map(t => t.user.id);
    assert.deepEqual(initial, [ids[1], ids[2], ids[5]]);
    await storage.sendMessage(ids[0], ids[2], "outgoing must not break received tie");
    assert.deepEqual((await storage.getMessageThreads(ids[0])).map(t => t.user.id), initial);
    await storage.markMessageAsRead(inserted[0].id, ids[2]);
    assert.equal(await storage.getUnreadMessageCount(ids[0]), 2);
    await storage.markMessageAsRead(inserted[0].id, ids[0]);
    assert.equal(await storage.getUnreadMessageCount(ids[0]), 1);
    await storage.sendMessage(ids[2], ids[0], "new incoming");
    assert.deepEqual((await storage.getMessageThreads(ids[0])).map(t => t.user.id), [ids[2], ids[1], ids[5]]);
  } finally {
    if (ids.length) {
      await db.delete(messages).where(or(inArray(messages.senderId, ids), inArray(messages.recipientId, ids)));
      await db.delete(follows).where(or(inArray(follows.followerUserId, ids), inArray(follows.followingUserId, ids)));
      await db.delete(blocks).where(or(inArray(blocks.blockerId, ids), inArray(blocks.blockedUserId, ids)));
      await db.delete(users).where(inArray(users.id, ids));
    }
    await pool.end();
  }
});
