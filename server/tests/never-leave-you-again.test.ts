/**
 * Integration test: "I'll Never Leave You Again" badge (dormant-return login badge).
 *
 * Guards against regressions that would silently stop badge awards:
 *  1. A user whose PRE-login lastLogin is 31+ days old earns the badge exactly
 *     once; a second login does not duplicate it.
 *  2. A brand-new user (null lastLogin) and a recently active user do NOT earn it.
 *  3. The user_badges (user_id, badge_id) unique index must exist — awardBadge's
 *     ON CONFLICT depends on it (and the ON CONFLICT insert errors without it,
 *     which awardBadge would swallow).
 *  4. The login route must capture the pre-login lastLogin BEFORE calling
 *     storage.recordUserLogin (source-order tripwire), and the badge check must
 *     use the passed-in prior value rather than re-reading users.last_login.
 *
 * Runs against the development database. Creates and removes its own test users.
 * Run with: npm run test:badges
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../db";
import { badgeService } from "../badge-service";
import { users, badges, userBadges, notifications } from "../../shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const BADGE_NAME = "I'll Never Leave You Again";
const RUN_TAG = `nlya-test-${Date.now()}`;

let badgeId: number;
const createdUserIds: number[] = [];

async function createTestUser(lastLogin: Date | null): Promise<{ id: number; lastLogin: Date | null }> {
  const suffix = `${RUN_TAG}-${createdUserIds.length}`;
  const [row] = await db
    .insert(users)
    .values({
      firebaseUid: `test-${suffix}`,
      username: `test_${suffix}`,
      email: `test-${suffix}@example.invalid`,
      lastLogin,
    })
    .returning({ id: users.id, lastLogin: users.lastLogin });
  createdUserIds.push(row.id);
  return row;
}

async function badgeCount(userId: number): Promise<number> {
  const rows = await db
    .select()
    .from(userBadges)
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
  return rows.length;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

before(async () => {
  const badge = await db.select().from(badges).where(eq(badges.name, BADGE_NAME)).limit(1);
  assert.ok(
    badge[0],
    `Badge "${BADGE_NAME}" is missing from the badges table — dormant-return awards are silently disabled.`
  );
  badgeId = badge[0].id;
});

after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(userBadges).where(inArray(userBadges.userId, createdUserIds));
    await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

test("unique index user_badges_unique_user_badge exists (awardBadge ON CONFLICT depends on it)", async () => {
  const result = await db.execute(sql`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'user_badges' AND indexname = 'user_badges_unique_user_badge'
  `);
  assert.equal(
    result.rows.length,
    1,
    "user_badges_unique_user_badge index is missing — awardBadge's ON CONFLICT will throw and the error is swallowed, silently disabling ALL badge awards."
  );
  const def = String((result.rows[0] as any).indexdef);
  assert.match(def, /UNIQUE/i, "user_badges_unique_user_badge must be a UNIQUE index");
  assert.match(def, /\(user_id, badge_id\)/, "index must cover (user_id, badge_id)");
});

test("awardBadge does not swallow the missing-index failure mode: raw double insert stays deduped", async () => {
  const user = await createTestUser(daysAgo(45));
  // Two direct awards — DB-level dedupe must hold even under repeat calls.
  await badgeService.awardBadge(user.id, badgeId);
  await badgeService.awardBadge(user.id, badgeId);
  assert.equal(await badgeCount(user.id), 1, "duplicate awardBadge calls must produce exactly one user_badges row");
});

test("user dormant 31+ days gets the badge exactly once; second login doesn't duplicate", async () => {
  const user = await createTestUser(daysAgo(31.5 * 1));
  const priorLastLogin = user.lastLogin; // what the route captures pre-login

  // Simulate what recordUserLogin does BEFORE the badge check resolves:
  // lastLogin in the DB is now "now". The badge must still award, because the
  // route passes the captured PRE-login value.
  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

  await badgeService.checkBadgesOnLogin(user.id, priorLastLogin);
  assert.equal(
    await badgeCount(user.id),
    1,
    "dormant user (31+ days) must earn the badge — if this fails, the pre-login lastLogin capture or the award path is broken"
  );

  // Second login the next instant: prior lastLogin is now recent → no new award.
  await badgeService.checkBadgesOnLogin(user.id, new Date());
  assert.equal(await badgeCount(user.id), 1, "second login must not duplicate the badge");
});

test("brand-new user (null lastLogin) does NOT get the badge", async () => {
  const user = await createTestUser(null);
  await badgeService.checkBadgesOnLogin(user.id, null);
  assert.equal(await badgeCount(user.id), 0, "new users must never earn the dormant-return badge");
});

test("user active yesterday does NOT get the badge", async () => {
  const user = await createTestUser(daysAgo(1));
  await badgeService.checkBadgesOnLogin(user.id, user.lastLogin);
  assert.equal(await badgeCount(user.id), 0, "recently active users must not earn the dormant-return badge");
});

test("badge check uses the passed-in prior lastLogin, not the (already updated) DB value", async () => {
  const user = await createTestUser(daysAgo(60));
  // DB says the user just logged in (post-recordUserLogin state)...
  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));
  // ...but the captured pre-login value is 60 days old → must award.
  await badgeService.checkNeverLeaveYouAgain(user.id, daysAgo(60));
  assert.equal(
    await badgeCount(user.id),
    1,
    "checkNeverLeaveYouAgain must trust the captured pre-login value; re-reading users.last_login reintroduces the read-after-update race"
  );
});

test("login route captures priorLastLogin BEFORE recordUserLogin overwrites it (source-order tripwire)", () => {
  const routes = readFileSync(path.resolve(import.meta.dirname, "../routes.ts"), "utf8");
  const captureIdx = routes.indexOf("const priorLastLogin = user.lastLogin");
  const recordIdx = routes.indexOf("storage.recordUserLogin");
  const checkIdx = routes.indexOf("checkBadgesOnLogin(user.id, priorLastLogin)");
  assert.ok(captureIdx !== -1, "routes.ts no longer captures the pre-login lastLogin (priorLastLogin) — dormant-return badge will silently stop awarding");
  assert.ok(recordIdx !== -1, "routes.ts no longer calls storage.recordUserLogin");
  assert.ok(checkIdx !== -1, "routes.ts no longer passes priorLastLogin to checkBadgesOnLogin");
  assert.ok(
    captureIdx < recordIdx,
    "priorLastLogin must be captured BEFORE storage.recordUserLogin runs — reordering reintroduces the read-after-update race"
  );
});
