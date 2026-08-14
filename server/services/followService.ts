// ---------------------------------------------------------------------------
// Follow / Friends system v1
// ---------------------------------------------------------------------------
// - Follow is one-way; Friends = mutual follows (both directions exist).
// - A user is followable if their profile is public OR they enabled
//   allow_followers. Private profiles and bidirectional blocks always refuse.
// - No XP, no emails, no notifications in v1 (spec requirement).
// ---------------------------------------------------------------------------

import { db } from '../db';
import { follows, users, blocks } from '../../shared/schema';
import { and, eq, or, sql, inArray } from 'drizzle-orm';

export function isFollowableUser(target: { profileVisibility?: string | null; allowFollowers?: boolean | null }) {
  const visibility = (target.profileVisibility || 'public').toLowerCase();
  return visibility === 'public' || target.allowFollowers === true;
}

async function isBlockedEitherWay(userA: number, userB: number): Promise<boolean> {
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, userA), eq(blocks.blockedUserId, userB)),
      and(eq(blocks.blockerId, userB), eq(blocks.blockedUserId, userA)),
    ))
    .limit(1);
  return !!row;
}

export async function followUser(viewerId: number, targetUserId: number): Promise<{ ok: boolean; status: number; message?: string }> {
  if (viewerId === targetUserId) return { ok: false, status: 400, message: "You can't follow yourself" };

  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) return { ok: false, status: 404, message: 'Collector not found' };
  if (!isFollowableUser(target)) return { ok: false, status: 403, message: 'This collector is not accepting followers' };
  if (await isBlockedEitherWay(viewerId, targetUserId)) return { ok: false, status: 403, message: 'This collector is not available' };

  // Idempotent: duplicate follow is a no-op (unique index enforces it too).
  const inserted = await db.execute(sql`
    INSERT INTO follows (follower_user_id, following_user_id)
    VALUES (${viewerId}, ${targetUserId})
    ON CONFLICT (follower_user_id, following_user_id) DO NOTHING
    RETURNING id
  `);

  // Follow-back nudge: only on a genuinely new follow, and rate-limited so an
  // unfollow/refollow loop can't spam the target (one nudge per follower per
  // target per 7 days).
  if (((inserted as any).rows ?? []).length > 0) {
    // Friend badges (Friendly Face, Squad Assembled, ...) derive from mutual
    // follows now — evaluate for both sides on every new follow (fire & forget).
    import('../badge-service').then(({ badgeService }) => Promise.all([
      badgeService.checkBadgesOnFriendChange(viewerId),
      badgeService.checkBadgesOnFriendChange(targetUserId),
    ])).catch(e => console.error('[Follow] badge check failed:', e));
    try {
      const recent = await db.execute(sql`
        SELECT 1 FROM notifications
        WHERE user_id = ${targetUserId}
          AND type IN ('new_follower', 'new_friend')
          AND data LIKE ${'%"followerUserId":' + viewerId + '%'}
          AND created_at > now() - interval '7 days'
        LIMIT 1
      `);
      if (((recent as any).rows ?? []).length > 0) return { ok: true, status: 200 };
      const [viewer] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, viewerId)).limit(1);
      const followsBack = await db.execute(sql`
        SELECT 1 FROM follows WHERE follower_user_id = ${targetUserId} AND following_user_id = ${viewerId} LIMIT 1
      `);
      const name = viewer?.displayName || (viewer?.username ? `@${viewer.username}` : 'A collector');
      const isNowFriends = ((followsBack as any).rows ?? []).length > 0;
      const { notificationService } = await import('../notification-service');
      await notificationService.createNotification(
        targetUserId,
        isNowFriends ? 'new_friend' : 'new_follower',
        isNowFriends ? 'You have a new friend!' : 'New follower!',
        isNowFriends
          ? `${name} followed you back — you're now Friends!`
          : `${name} is now following you. Follow back to become Friends!`,
        { followerUserId: viewerId, followerUsername: viewer?.username ?? null },
      );
    } catch (e) {
      console.error('[Follow] notification failed (follow still saved):', e);
    }
  }
  return { ok: true, status: 200 };
}

/**
 * System-level mutual follow (used for auto-friending new signups with the
 * creator account and for the legacy-friends migration). Bypasses the
 * followability gate — both sides are made friends silently and idempotently.
 */
export async function makeFriends(userA: number, userB: number): Promise<void> {
  if (userA === userB) return;
  if (await isBlockedEitherWay(userA, userB)) return; // blocks always win
  await db.execute(sql`
    INSERT INTO follows (follower_user_id, following_user_id)
    VALUES (${userA}, ${userB}), (${userB}, ${userA})
    ON CONFLICT (follower_user_id, following_user_id) DO NOTHING
  `);
}

export async function unfollowUser(viewerId: number, targetUserId: number): Promise<{ ok: boolean; status: number }> {
  await db
    .delete(follows)
    .where(and(eq(follows.followerUserId, viewerId), eq(follows.followingUserId, targetUserId)));
  // Keep the legacy friends table consistent: breaking the mutual follow ends
  // the friendship everywhere (old Social surfaces still read this table).
  await db.execute(sql`
    DELETE FROM friends
    WHERE status = 'accepted'
      AND ((requester_id = ${viewerId} AND recipient_id = ${targetUserId})
        OR (requester_id = ${targetUserId} AND recipient_id = ${viewerId}))
  `);
  return { ok: true, status: 200 };
}

/**
 * Viewer's relationship with a target + the target's public counts.
 * Friend = both follow rows exist; disappears automatically on unfollow
 * because it's derived, never stored.
 */
export async function getFollowInfo(viewerId: number, targetUserId: number) {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM follows WHERE following_user_id = ${targetUserId}) AS followers,
      (SELECT count(*)::int FROM follows WHERE follower_user_id = ${targetUserId}) AS following,
      (SELECT count(*)::int FROM follows a
        JOIN follows b ON b.follower_user_id = a.following_user_id AND b.following_user_id = a.follower_user_id
        WHERE a.follower_user_id = ${targetUserId}) AS friends,
      EXISTS(SELECT 1 FROM follows WHERE follower_user_id = ${viewerId} AND following_user_id = ${targetUserId}) AS i_follow,
      EXISTS(SELECT 1 FROM follows WHERE follower_user_id = ${targetUserId} AND following_user_id = ${viewerId}) AS follows_me
  `);
  const r = ((res as any).rows ?? [])[0] ?? {};
  const iFollow = r.i_follow === true;
  const followsMe = r.follows_me === true;
  return {
    followerCount: Number(r.followers ?? 0),
    followingCount: Number(r.following ?? 0),
    friendCount: Number(r.friends ?? 0),
    isFollowing: iFollow,
    followsYou: followsMe,
    isFriend: iFollow && followsMe,
  };
}

/** Set of user IDs the viewer follows (for feed filtering / button state). */
export async function getFollowingIds(viewerId: number): Promise<number[]> {
  const rows = await db
    .select({ id: follows.followingUserId })
    .from(follows)
    .where(eq(follows.followerUserId, viewerId));
  return rows.map(r => r.id);
}

/** Set of user IDs that are mutual follows (friends) with the viewer. */
export async function getFriendIds(viewerId: number): Promise<number[]> {
  const res = await db.execute(sql`
    SELECT a.following_user_id AS id
    FROM follows a
    JOIN follows b ON b.follower_user_id = a.following_user_id AND b.following_user_id = a.follower_user_id
    WHERE a.follower_user_id = ${viewerId}
  `);
  return (((res as any).rows ?? []) as any[]).map(r => Number(r.id));
}

/**
 * Discovery: public, feed-visible, non-admin collectors the viewer doesn't
 * already follow, ranked by recent activity (latest feed event). Private and
 * feed-hidden users never appear. Blocked relationships excluded.
 */
export async function getSuggestedCollectors(viewerId: number, limit = 12) {
  const res = await db.execute(sql`
    SELECT u.id, u.username, u.display_name, u.photo_url, u.collector_avatar_key, u.collector_focus
    FROM users u
    WHERE u.id <> ${viewerId}
      AND u.is_admin = false
      AND u.profile_visibility = 'public'
      AND u.show_activity_in_feed = true
      AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_user_id = ${viewerId} AND f.following_user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = ${viewerId} AND bl.blocked_user_id = u.id)
                                               OR (bl.blocker_id = u.id AND bl.blocked_user_id = ${viewerId}))
    ORDER BY
      -- Engaged collectors first: recent feed activity (30d), then recent
      -- collection adds (30d), then follower count. Signup date is a
      -- last-resort tiebreak only.
      (SELECT count(*) FROM feed_events fe WHERE fe.user_id = u.id AND fe.created_at > now() - interval '30 days') DESC,
      (SELECT count(*) FROM user_collections uc WHERE uc.user_id = u.id AND uc.acquired_date > now() - interval '30 days') DESC,
      (SELECT count(*) FROM follows f2 WHERE f2.following_user_id = u.id) DESC,
      u.created_at DESC NULLS LAST, u.id DESC
    LIMIT ${limit}
  `);
  const rows = (((res as any).rows ?? []) as any[]);
  const ids = rows.map(r => Number(r.id));
  const { computeLevelsForUsers } = await import('./feedService');
  const levels = await computeLevelsForUsers(ids);
  return rows.map(r => ({
    id: Number(r.id),
    username: r.username,
    displayName: r.display_name,
    photoURL: r.photo_url,
    collectorAvatarKey: r.collector_avatar_key,
    collectorFocus: r.collector_focus,
    collectorLevel: levels[Number(r.id)] ?? 1,
  }));
}

/**
 * Social Hub lists: followers / following / friends for a user, with the
 * viewer's relation to each row so the UI can render Follow / Following /
 * Friends buttons. Blocked users excluded.
 */
export async function getRelationshipLists(userId: number) {
  const res = await db.execute(sql`
    WITH my_following AS (SELECT following_user_id AS id FROM follows WHERE follower_user_id = ${userId}),
         my_followers AS (SELECT follower_user_id AS id FROM follows WHERE following_user_id = ${userId}),
         blocked AS (
           SELECT blocked_user_id AS id FROM blocks WHERE blocker_id = ${userId}
           UNION SELECT blocker_id FROM blocks WHERE blocked_user_id = ${userId}
         )
    SELECT u.id, u.username, u.display_name, u.photo_url, u.collector_avatar_key,
           (u.id IN (SELECT id FROM my_following)) AS i_follow,
           (u.id IN (SELECT id FROM my_followers)) AS follows_me
    FROM users u
    WHERE u.id IN (SELECT id FROM my_following UNION SELECT id FROM my_followers)
      AND u.id NOT IN (SELECT id FROM blocked)
    ORDER BY lower(coalesce(u.display_name, u.username, ''))
  `);
  const rows = (((res as any).rows ?? []) as any[]).map(r => ({
    id: Number(r.id),
    username: r.username,
    displayName: r.display_name,
    photoURL: r.photo_url,
    collectorAvatarKey: r.collector_avatar_key,
    isFollowing: r.i_follow === true,
    followsYou: r.follows_me === true,
    isFriend: r.i_follow === true && r.follows_me === true,
  }));
  return {
    followers: rows.filter(r => r.followsYou),
    following: rows.filter(r => r.isFollowing),
    friends: rows.filter(r => r.isFriend),
  };
}

/** Viewer's relation to a set of user IDs (for annotating search results). */
export async function getRelationshipMap(viewerId: number, ids: number[]): Promise<Record<number, { isFollowing: boolean; followsYou: boolean; isFriend: boolean }>> {
  if (ids.length === 0) return {};
  const res = await db.execute(sql`
    SELECT u.id,
           EXISTS(SELECT 1 FROM follows WHERE follower_user_id = ${viewerId} AND following_user_id = u.id) AS i_follow,
           EXISTS(SELECT 1 FROM follows WHERE follower_user_id = u.id AND following_user_id = ${viewerId}) AS follows_me
    FROM users u WHERE u.id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})
  `);
  const out: Record<number, { isFollowing: boolean; followsYou: boolean; isFriend: boolean }> = {};
  for (const r of ((res as any).rows ?? []) as any[]) {
    const iFollow = r.i_follow === true, followsMe = r.follows_me === true;
    out[Number(r.id)] = { isFollowing: iFollow, followsYou: followsMe, isFriend: iFollow && followsMe };
  }
  return out;
}

/** Admin visibility: totals, most-followed collectors, recent follows. */
export async function getAdminFollowStats() {
  const totals = await db.execute(sql`SELECT count(*)::int AS total FROM follows`);
  const top = await db.execute(sql`
    SELECT u.id, u.username, count(*)::int AS followers
    FROM follows f JOIN users u ON u.id = f.following_user_id
    GROUP BY u.id, u.username ORDER BY followers DESC LIMIT 10
  `);
  const recent = await db.execute(sql`
    SELECT f.id, f.created_at, a.username AS follower_username, b.username AS following_username
    FROM follows f
    JOIN users a ON a.id = f.follower_user_id
    JOIN users b ON b.id = f.following_user_id
    ORDER BY f.created_at DESC LIMIT 20
  `);
  return {
    totalFollows: Number(((totals as any).rows?.[0] ?? {}).total ?? 0),
    topFollowed: (((top as any).rows ?? []) as any[]).map(r => ({ id: Number(r.id), username: r.username, followers: Number(r.followers) })),
    recentFollows: (((recent as any).rows ?? []) as any[]).map(r => ({
      id: Number(r.id),
      createdAt: r.created_at,
      followerUsername: r.follower_username,
      followingUsername: r.following_username,
    })),
  };
}

/** Admin moderation: remove a follow row (abuse cleanup). */
export async function adminRemoveFollow(followId: number) {
  await db.delete(follows).where(eq(follows.id, followId));
  return { ok: true };
}
