import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Idempotent startup seed: creates the "Top 10 Collector" badge, awarded when
 * a collector makes the all-time Top 10 XP leaderboard. Advisory-locked,
 * matches by unique badge name, safe to run on every boot (dev and prod).
 * Also keeps the icon URL in sync if it changes.
 *
 * Awarding happens in feedService when the all-time leaderboard is computed;
 * like Hall of Fame, the badge is permanent once earned.
 */
export const TOP_TEN_BADGE_NAME = 'Top 10 Collector';

export async function seedTopTenBadge(): Promise<{ ran: boolean; reason?: string }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(913153)`);
    const existing: any = await tx.execute(sql`
      SELECT id, icon_url FROM badges WHERE name = ${TOP_TEN_BADGE_NAME} LIMIT 1
    `);
    const row = (existing.rows ?? existing)[0];
    const iconUrl = '/uploads/badges/top-10-collector.png';
    if (row) {
      if (row.icon_url !== iconUrl) {
        await tx.execute(sql`UPDATE badges SET icon_url = ${iconUrl} WHERE id = ${row.id}`);
        return { ran: true, reason: 'icon updated' };
      }
      return { ran: false, reason: 'already seeded' };
    }
    await tx.execute(sql`
      INSERT INTO badges (name, description, icon_url, category, requirement, rarity, points, unlock_hint, is_active)
      VALUES (
        ${TOP_TEN_BADGE_NAME},
        ${'Made the all-time Top 10 XP leaderboard. A true legend of the Vault.'},
        ${iconUrl},
        ${'Achievement'},
        ${JSON.stringify({ type: 'top_ten_all_time_xp' })},
        ${'legendary'},
        ${100},
        ${'Climb into the all-time Top 10 collectors by XP'},
        true
      )
    `);
    return { ran: true, reason: 'created' };
  });
}
