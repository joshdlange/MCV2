import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { badgeService } from "../badge-service";
import {
  acknowledgeVaultRegularMoment,
  recordNativeMobileLogin,
} from "../services/nativeMobileLogin";
import {
  seedVaultRegularBadge,
  VAULT_REGULAR_BADGE_NAME,
} from "../services/vaultRegularBadgeSeed";
import { badges, notifications, userBadges, users } from "../../shared/schema";

const RUN_TAG = `vault-regular-test-${Date.now()}`;
const createdUserIds: number[] = [];
let badgeId: number;

async function createTestUser() {
  const suffix = `${RUN_TAG}-${createdUserIds.length}`;
  const [user] = await db.insert(users).values({
    firebaseUid: suffix,
    username: suffix,
    email: `${suffix}@example.invalid`,
  }).returning({ id: users.id });
  createdUserIds.push(user.id);
  return user;
}

async function earnedCount(userId: number) {
  const rows = await db.select({ id: userBadges.id })
    .from(userBadges)
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
  return rows.length;
}

before(async () => {
  await seedVaultRegularBadge();
  const [badge] = await db.select().from(badges)
    .where(eq(badges.name, VAULT_REGULAR_BADGE_NAME))
    .limit(1);
  assert.ok(badge, "Vault Regular badge seed is missing");
  badgeId = badge.id;
});

after(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(userBadges).where(inArray(userBadges.userId, createdUserIds));
  await db.delete(notifications).where(inArray(notifications.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

test("only the fourth unique native session awards Vault Regular", async () => {
  const user = await createTestUser();

  for (let loginNumber = 1; loginNumber <= 3; loginNumber += 1) {
    const result = await recordNativeMobileLogin(
      user.id,
      `native-session-${loginNumber}`,
      "android",
    );
    assert.equal(result.recorded, true);
    assert.equal(result.loginNumber, loginNumber);
    await badgeService.checkVaultRegular(user.id, result.loginNumber);
    assert.equal(await earnedCount(user.id), 0);
  }

  const fourth = await recordNativeMobileLogin(
    user.id,
    "native-session-4",
    "android",
  );
  assert.equal(fourth.loginNumber, 4);
  await badgeService.checkVaultRegular(user.id, fourth.loginNumber);
  assert.equal(await earnedCount(user.id), 1);
});

test("a retried auth sync cannot count the same native launch twice", async () => {
  const user = await createTestUser();
  const first = await recordNativeMobileLogin(user.id, "retry-safe-session", "android");
  const retry = await recordNativeMobileLogin(user.id, "retry-safe-session", "android");

  assert.equal(first.recorded, true);
  assert.equal(first.loginNumber, 1);
  assert.equal(retry.recorded, false);
  assert.equal(retry.loginNumber, 1);
});

test("acknowledgement permanently suppresses another badge/review moment", async () => {
  const user = await createTestUser();
  for (let loginNumber = 1; loginNumber <= 4; loginNumber += 1) {
    await recordNativeMobileLogin(user.id, `ack-session-${loginNumber}`, "android");
  }

  const firstAcknowledgement = await acknowledgeVaultRegularMoment(
    user.id,
    "claim-first-device",
  );
  const retriedAcknowledgement = await acknowledgeVaultRegularMoment(
    user.id,
    "claim-first-device",
  );
  const competingAcknowledgement = await acknowledgeVaultRegularMoment(
    user.id,
    "claim-second-device",
  );
  assert.deepEqual(firstAcknowledgement, {
    claimed: true,
    eligible: true,
    acknowledged: true,
  });
  assert.deepEqual(retriedAcknowledgement, {
    claimed: true,
    eligible: true,
    acknowledged: true,
  });
  assert.deepEqual(competingAcknowledgement, {
    claimed: false,
    eligible: true,
    acknowledged: true,
  });
  const fifth = await recordNativeMobileLogin(user.id, "ack-session-5", "android");
  assert.equal(fifth.loginNumber, 5);
  assert.equal(fifth.milestoneAcknowledged, true);
});

test("acknowledgement cannot be claimed before the fourth native launch", async () => {
  const user = await createTestUser();
  const result = await acknowledgeVaultRegularMoment(user.id, "claim-too-early");

  assert.deepEqual(result, {
    claimed: false,
    eligible: false,
    acknowledged: false,
  });
});

test("review request remains native Android-only and never tracks a rating", () => {
  const syncClient = readFileSync(
    path.resolve(import.meta.dirname, "../../client/src/lib/backendUserSync.ts"),
    "utf8",
  );
  const reviewService = readFileSync(
    path.resolve(import.meta.dirname, "../../client/src/services/appReview.ts"),
    "utf8",
  );
  const reviewMoment = readFileSync(
    path.resolve(import.meta.dirname, "../../client/src/components/reviews/NativeReviewMilestone.tsx"),
    "utf8",
  );

  assert.match(syncClient, /nativeLogin:\s*options\.nativeLogin/);
  assert.match(reviewService, /Capacitor\.getPlatform\(\)\s*!==\s*"android"/);
  assert.match(reviewService, /CapgoInAppReview\.requestReview\(\)/);
  assert.doesNotMatch(reviewMoment, /Leave a Review|5.?star|positive review/i);
  assert.doesNotMatch(reviewService, /trackRating|ratingValue|reviewCompleted|reviewSubmitted/i);
});