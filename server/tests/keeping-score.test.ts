import { test } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "../db";
import { eq, and } from "drizzle-orm";
import { users, badges, userBadges, notifications } from "../../shared/schema";
import { seedReturningCollectorBadge, awardReturningCollectorMilestone } from "../services/returningCollectorMilestone";

test("Keeping Score registers once, awards once, uses normal 10-XP bronze metadata", async () => {
  let userId: number | undefined;
  try {
    const id = await seedReturningCollectorBadge();
    assert.equal(await seedReturningCollectorBadge(), id);
    const [badge] = await db.select().from(badges).where(eq(badges.id, id));
    assert.equal(badge.name, "Keeping Score");
    assert.equal(badge.points, 10);
    assert.equal(badge.rarity, "bronze");
    assert.match(badge.iconUrl!, /keeping-score.webp$/);
    const tag = `keeping-score-test-${Date.now()}`;
    const [user] = await db.insert(users).values({
      firebaseUid: tag, username: tag, email: `${tag}@example.invalid`,
    }).returning();
    userId = user.id;
    assert.equal(await awardReturningCollectorMilestone(user.id), true);
    assert.equal(await awardReturningCollectorMilestone(user.id), true);
    const earned = await db.select().from(userBadges).where(and(eq(userBadges.userId, user.id), eq(userBadges.badgeId, id)));
    assert.equal(earned.length, 1);
  } finally {
    if (userId) {
      await db.delete(notifications).where(eq(notifications.userId, userId));
      await db.delete(userBadges).where(eq(userBadges.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await pool.end();
  }
});
