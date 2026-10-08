import assert from "node:assert/strict";
import { test } from "node:test";
import { filterMessageThreads, resolveMessageUser, type MessageThread, type MessageUser } from "./messageNavigation";

const friends = new Set([7]);
const threads: MessageThread[] = [
  { user: { id: 9, username: "cosmicvault", displayName: "Rae Chen" },
    lastMessage: { content: "Looking for a silver parallel", createdAt: "2026-02-10", senderId: 9 }, unreadCount: 2 },
  { user: { id: 7, username: "panelcollector", displayName: null },
    lastMessage: { content: "That sketch is available", createdAt: "2026-02-09", senderId: 7 }, unreadCount: 0 },
  { user: { id: 3, username: "sketchhunter", displayName: "Marisol" },
    lastMessage: { content: "Thanks!", createdAt: "2026-02-08", senderId: 3 } },
];

test("search matches username, display name and latest preview case-insensitively", () => {
  for (const query of [" COSMIC ", "rae chen", "SILVER PARALLEL"]) {
    assert.deepEqual(filterMessageThreads(threads, query, "all", friends), [threads[0]]);
  }
  assert.deepEqual(filterMessageThreads(threads, "panel", "all", friends), [threads[1]]);
});

test("All preserves server order and object identity without mutating input", () => {
  const result = filterMessageThreads(threads, "", "all", friends);
  assert.deepEqual(result, threads);
  assert.equal(result[0], threads[0]);
  assert.deepEqual(threads.map(thread => thread.user.id), [9, 7, 3]);
});

test("Unread and Friends combine with text search and handle missing unread counts", () => {
  assert.deepEqual(filterMessageThreads(threads, "", "unread", friends), [threads[0]]);
  assert.deepEqual(filterMessageThreads(threads, "", "friends", friends), [threads[1]]);
  assert.deepEqual(filterMessageThreads(threads, "cosmic", "friends", friends), []);
  assert.deepEqual(filterMessageThreads([], "", "all", friends), []);
});

test("new recipient resolves before first send and existing threads reuse the same ID", () => {
  const selected: MessageUser = { id: 12, username: "inkarchive", displayName: "Tessa" };
  assert.equal(resolveMessageUser(12, threads, selected, [], []), selected);
  assert.equal(resolveMessageUser(9, threads, { ...selected, id: 9 }, [], []), threads[0].user);
  assert.equal(resolveMessageUser(7, [], selected, [threads[1].user], []), threads[1].user);
  assert.equal(resolveMessageUser(3, [], selected, [], [threads[2].user]), threads[2].user);
  assert.equal(resolveMessageUser(15, threads, selected, [], []), undefined);
  assert.equal(resolveMessageUser(null, threads, selected, [], []), undefined);
});
