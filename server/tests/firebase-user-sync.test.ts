import { after, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { users } from "../../shared/schema";
import { createOrGetFirebaseUser } from "../services/firebaseUserSync";

const tag = `firebase-sync-${Date.now()}`;
const firebaseUids = [
  `${tag}-blocker`,
  `${tag}-collision`,
  `${tag}-race`,
];

after(async () => {
  await db.delete(users).where(inArray(users.firebaseUid, firebaseUids));
  await pool.end();
});

test("username collisions receive a unique fallback instead of failing signup", async () => {
  const baseUsername = `${tag}-collector`;
  await db.insert(users).values({
    firebaseUid: firebaseUids[0],
    username: baseUsername,
    email: `${tag}-blocker@example.test`,
    plan: "SIDE_KICK",
    subscriptionStatus: "active",
  });

  const result = await createOrGetFirebaseUser({
    firebaseUid: firebaseUids[1],
    username: baseUsername,
    email: `${tag}-collision@example.test`,
    plan: "SIDE_KICK",
    subscriptionStatus: "active",
  });

  assert.equal(result.created, true);
  assert.notEqual(result.user.username, baseUsername);
  assert.match(result.user.username, /-[a-f0-9]{6}$/);
  assert.ok(result.user.username.length <= 40);
});

test("concurrent syncs for one Firebase account converge on one user", async () => {
  const userData = {
    firebaseUid: firebaseUids[2],
    username: `${tag}-race`,
    email: `${tag}-race@example.test`,
    plan: "SIDE_KICK",
    subscriptionStatus: "active",
  };

  const results = await Promise.all([
    createOrGetFirebaseUser(userData),
    createOrGetFirebaseUser(userData),
  ]);

  assert.equal(new Set(results.map(result => result.user.id)).size, 1);
  assert.equal(results.filter(result => result.created).length, 1);

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.firebaseUid, [firebaseUids[2]]));
  assert.equal(rows.length, 1);
});