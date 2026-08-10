import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Idempotent startup seed: creates the "I'll Never Leave You Again" badge,
 * awarded when a user who has been inactive for 30+ days logs back in.
 * Advisory-locked, matches by unique badge name, safe to run on every boot
 * (dev and prod). Also keeps the icon URL in sync if it changes.
 */
export const NEVER_LEAVE_BADGE_NAME = "I'll Never Leave You Again";

export async function seedNeverLeaveBadge(): Promise<{ ran: boolean; reason?: string }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(913152)`);
    const existing: any = await tx.execute(sql`
      SELECT id, icon_url FROM badges WHERE name = ${NEVER_LEAVE_BADGE_NAME} LIMIT 1
    `);
    const row = (existing.rows ?? existing)[0];
    const iconUrl = '/uploads/badges/never-leave-you-again.png';
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
        ${NEVER_LEAVE_BADGE_NAME},
        ${'Returned to the vault after more than a month away. We knew you would be back.'},
        ${iconUrl},
        ${'Achievement'},
        ${JSON.stringify({ type: 'dormant_return', days: 30 })},
        ${'gold'},
        ${50},
        ${'Come back after being away for over a month'},
        true
      )
    `);
    return { ran: true, reason: 'created' };
  });
}
