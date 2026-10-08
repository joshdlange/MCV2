import { db } from '../db';
import { users, blocks } from '../../shared/schema';
import { and, eq, or, sql } from 'drizzle-orm';

/** Shared privacy boundary for every collector data endpoint. */
export async function resolveCollectorAccess(username: string, callerId?: number) {
  const [targetUser] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!targetUser) return { ok: false as const, status: 404, message: 'Collector not found' };
  const isOwnProfile = callerId === targetUser.id;
  if (isOwnProfile) return { ok: true as const, targetUser, isOwnProfile };
  if (callerId) {
    const [blocked] = await db.select({ id: blocks.id }).from(blocks).where(or(
      and(eq(blocks.blockerId, callerId), eq(blocks.blockedUserId, targetUser.id)),
      and(eq(blocks.blockerId, targetUser.id), eq(blocks.blockedUserId, callerId)),
    )).limit(1);
    if (blocked) return { ok: false as const, status: 403, message: 'This profile is not available' };
  }
  const visibility = (targetUser.profileVisibility || 'public').toLowerCase();
  if (visibility === 'private') return { ok: false as const, status: 403, message: 'This profile is not available' };
  if (visibility === 'friends') {
    const mutual = callerId ? await db.execute(sql`
      SELECT 1 FROM follows a JOIN follows b
        ON b.follower_user_id = a.following_user_id AND b.following_user_id = a.follower_user_id
      WHERE a.follower_user_id = ${callerId} AND a.following_user_id = ${targetUser.id} LIMIT 1
    `) : null;
    if (!mutual?.rows.length) return { ok: false as const, status: 403, message: 'This profile is not available' };
  }
  return { ok: true as const, targetUser, isOwnProfile };
}
