import { sql } from "drizzle-orm";
import { db } from "../db";
import { badgeService } from "../badge-service";

/** Owner-approved fourth-session achievement, unrelated to requesting or submitting reviews. */
export const returningCollectorBadge = {
  name: "Keeping Score",
  description: "Returned for four authenticated app sessions on one device.",
  iconUrl: "https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795041190/badges/keeping-score.webp",
};
export const returningCollectorMilestoneKey = "returning_collector_review_milestone";

export async function seedReturningCollectorBadge(): Promise<number> {
  const config = returningCollectorBadge;
  // Same badge tables, XP points and notification service as every other achievement.
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${returningCollectorMilestoneKey}))`);
    const existing = await tx.execute(sql`SELECT id FROM badges WHERE name=${config.name} LIMIT 1`);
    if (existing.rows[0]) return Number(existing.rows[0].id);
    const result = await tx.execute(sql`
      INSERT INTO badges(name, description, icon_url, category, requirement, rarity, points, unlock_hint, is_active)
      VALUES(${config.name},${config.description},${config.iconUrl},'Achievement',
        ${JSON.stringify({ type: "device_authenticated_sessions", count: 4, key: returningCollectorMilestoneKey })},
        'bronze',10,'Return for four authenticated app sessions on one device',true) RETURNING id`);
    return Number(result.rows[0].id);
  });
}

export async function awardReturningCollectorMilestone(userId: number): Promise<boolean> {
  const badgeId = await seedReturningCollectorBadge();
  await badgeService.awardBadge(userId, badgeId);
  return badgeService.hasUserEarnedBadge(userId, badgeId);
}
