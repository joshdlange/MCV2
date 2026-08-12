import { db } from '../db';
import { feedEvents, feedReactions, xpEvents, users, badges } from '../../shared/schema';
import { and, eq, sql, desc, lt, inArray } from 'drizzle-orm';
import { computeXpProgress } from '../../shared/xp';

// ---------------------------------------------------------------------------
// Feed v1 — app-generated activity events, reactions, XP, leaderboards.
// No freeform posts, no comments, no notifications.
// ---------------------------------------------------------------------------

export const REACTION_TYPES = ['fire_pull', 'hero_move', 'need_this', 'vault_worthy'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const COLLECTION_MILESTONES = [50, 100, 250, 500] as const;
export const LEVEL_MILESTONES = [5, 10, 15, 20, 25, 30, 40, 50] as const;

// Feed reaction XP: first reaction of the (UTC) day +5, others +1, cap 10/day.
const XP_FEED_FIRST_OF_DAY = 5;
const XP_FEED_ADDITIONAL = 1;
const XP_FEED_DAILY_CAP = 10;

export interface EmitFeedEventArgs {
  userId: number;
  eventType: string;
  title: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
  relatedType?: string;
  relatedId?: number;
  createdAt?: Date; // backfill only
}

/**
 * Idempotent emit — the dedupe_key unique index makes duplicate emissions
 * (retries, backfill re-runs) no-ops. Never throws into the caller: feed
 * emission must never break the underlying action (card add, badge, etc.).
 */
export async function emitFeedEvent(args: EmitFeedEventArgs): Promise<void> {
  try {
    await db
      .insert(feedEvents)
      .values({
        userId: args.userId,
        eventType: args.eventType,
        title: args.title,
        metadata: args.metadata ? JSON.stringify(args.metadata) : null,
        relatedType: args.relatedType ?? null,
        relatedId: args.relatedId ?? null,
        dedupeKey: args.dedupeKey,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error('[feedService] emitFeedEvent failed', { args: args.dedupeKey, err });
  }
}

/**
 * Called after a card is added: emits first-card and collection-milestone
 * events based on the user's current distinct-card count. Dedupe keys make
 * this safe to call on every add.
 */
export async function checkCollectionMilestones(userId: number): Promise<void> {
  try {
    const res = await db.execute(sql`SELECT count(*)::int AS n FROM user_collections WHERE user_id = ${userId}`);
    const n = Number((res as any).rows?.[0]?.n ?? 0);
    if (n >= 1) {
      await emitFeedEvent({
        userId,
        eventType: 'first_card',
        title: 'added their first card to the Vault',
        dedupeKey: `first_card:${userId}`,
      });
    }
    for (const m of COLLECTION_MILESTONES) {
      if (n >= m) {
        await emitFeedEvent({
          userId,
          eventType: 'collection_milestone',
          title: `reached ${m} cards in their collection`,
          metadata: { milestone: m },
          dedupeKey: `collection_milestone:${userId}:${m}`,
        });
      }
    }
  } catch (err) {
    console.error('[feedService] checkCollectionMilestones failed', { userId, err });
  }
}

/** Emit a level-milestone event when the user's computed level crosses a milestone. */
export async function checkLevelMilestone(userId: number, totalXp: number): Promise<void> {
  try {
    const level = computeXpProgress(totalXp).level;
    for (const m of LEVEL_MILESTONES) {
      if (level >= m) {
        await emitFeedEvent({
          userId,
          eventType: 'level_milestone',
          title: `reached Collector Level ${m}`,
          metadata: { level: m },
          dedupeKey: `level_milestone:${userId}:${m}`,
        });
      }
    }
  } catch (err) {
    console.error('[feedService] checkLevelMilestone failed', { userId, err });
  }
}

export async function emitBadgeEarned(userId: number, badgeId: number): Promise<void> {
  try {
    const [badge] = await db.select({ name: badges.name }).from(badges).where(eq(badges.id, badgeId));
    if (!badge) return;
    await emitFeedEvent({
      userId,
      eventType: 'badge_earned',
      title: `earned the ${badge.name} badge`,
      metadata: { badgeName: badge.name },
      relatedType: 'badge',
      relatedId: badgeId,
      dedupeKey: `badge_earned:${userId}:${badgeId}`,
    });
  } catch (err) {
    console.error('[feedService] emitBadgeEarned failed', { userId, badgeId, err });
  }
}

// ---------------------------------------------------------------------------
// Reading the feed
// ---------------------------------------------------------------------------

/**
 * Privacy filter applied at READ time (not emission time) so a user flipping
 * their settings later immediately hides/shows their history:
 * - profile must be public
 * - show_activity_in_feed must be on
 * "Me" filter bypasses privacy (you always see your own events).
 */
export async function getFeedPage(opts: {
  viewerId: number;
  filter: 'everyone' | 'following' | 'friends' | 'me';
  before?: Date;
  beforeId?: number; // composite cursor tiebreaker — same-timestamp rows aren't skipped
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 25, 50);
  const conditions = [eq(feedEvents.hidden, false)] as any[];
  if (opts.before) {
    conditions.push(
      opts.beforeId != null
        ? sql`(${feedEvents.createdAt}, ${feedEvents.id}) < (${opts.before}, ${opts.beforeId})`
        : lt(feedEvents.createdAt, opts.before),
    );
  }
  if (opts.filter === 'me') {
    conditions.push(eq(feedEvents.userId, opts.viewerId));
  }
  // Following/Friends: restrict to the relevant user set, but the normal
  // public + show_activity_in_feed privacy predicate below STILL applies —
  // following someone never bypasses their privacy settings.
  if (opts.filter === 'following' || opts.filter === 'friends') {
    const followSvc = await import('./followService');
    const ids = opts.filter === 'following'
      ? await followSvc.getFollowingIds(opts.viewerId)
      : await followSvc.getFriendIds(opts.viewerId);
    if (ids.length === 0) return [];
    conditions.push(inArray(feedEvents.userId, ids));
  }

  let rows;
  if (opts.filter === 'me') {
    rows = await db
      .select({
        id: feedEvents.id,
        userId: feedEvents.userId,
        eventType: feedEvents.eventType,
        title: feedEvents.title,
        metadata: feedEvents.metadata,
        relatedType: feedEvents.relatedType,
        relatedId: feedEvents.relatedId,
        createdAt: feedEvents.createdAt,
        username: users.username,
        displayName: users.displayName,
        photoURL: users.photoURL,
        collectorAvatarKey: users.collectorAvatarKey,
      })
      .from(feedEvents)
      .innerJoin(users, eq(feedEvents.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(feedEvents.createdAt), desc(feedEvents.id))
      .limit(limit);
  } else {
    rows = await db
      .select({
        id: feedEvents.id,
        userId: feedEvents.userId,
        eventType: feedEvents.eventType,
        title: feedEvents.title,
        metadata: feedEvents.metadata,
        relatedType: feedEvents.relatedType,
        relatedId: feedEvents.relatedId,
        createdAt: feedEvents.createdAt,
        username: users.username,
        displayName: users.displayName,
        photoURL: users.photoURL,
        collectorAvatarKey: users.collectorAvatarKey,
      })
      .from(feedEvents)
      .innerJoin(users, eq(feedEvents.userId, users.id))
      .where(and(
        ...conditions,
        sql`(${users.id} = ${opts.viewerId} OR (${users.profileVisibility} = 'public' AND ${users.showActivityInFeed} = true))`,
      ))
      .orderBy(desc(feedEvents.createdAt), desc(feedEvents.id))
      .limit(limit);
  }

  const eventIds = rows.map(r => r.id);
  let countsByEvent: Record<number, Record<string, number>> = {};
  let myReactions: Record<number, string> = {};
  if (eventIds.length > 0) {
    const countRows = await db
      .select({
        feedEventId: feedReactions.feedEventId,
        reactionType: feedReactions.reactionType,
        n: sql<number>`count(*)::int`,
      })
      .from(feedReactions)
      .where(inArray(feedReactions.feedEventId, eventIds))
      .groupBy(feedReactions.feedEventId, feedReactions.reactionType);
    for (const c of countRows) {
      (countsByEvent[c.feedEventId] ??= {})[c.reactionType] = Number(c.n);
    }
    const mine = await db
      .select({ feedEventId: feedReactions.feedEventId, reactionType: feedReactions.reactionType })
      .from(feedReactions)
      .where(and(inArray(feedReactions.feedEventId, eventIds), eq(feedReactions.userId, opts.viewerId)));
    for (const m of mine) myReactions[m.feedEventId] = m.reactionType;
  }

  // Collector level per distinct user on this page (aggregate query, no N+1).
  const userIds = Array.from(new Set(rows.map(r => r.userId)));
  const levels = await computeLevelsForUsers(userIds);

  // Visual enrichment (read time, so backfilled events get images too).
  // Only public-safe imagery: badge icons, card fronts from the shared card DB.
  const imageByEvent: Record<number, string | null> = {};
  const badgeIds = Array.from(new Set(rows.filter(r => r.relatedType === 'badge' && r.relatedId).map(r => r.relatedId as number)));
  const cardIds = Array.from(new Set(rows.filter(r => r.relatedType === 'card' && r.relatedId).map(r => r.relatedId as number)));
  const firstCardUserIds = Array.from(new Set(rows.filter(r => r.eventType === 'first_card').map(r => r.userId)));

  const [badgeIcons, cardImages, firstCards] = await Promise.all([
    badgeIds.length > 0
      ? db.execute(sql`SELECT id, icon_url FROM badges WHERE id IN (${sql.join(badgeIds.map(id => sql`${id}`), sql`, `)})`)
      : Promise.resolve({ rows: [] } as any),
    cardIds.length > 0
      ? db.execute(sql`SELECT id, front_image_url FROM cards WHERE id IN (${sql.join(cardIds.map(id => sql`${id}`), sql`, `)})`)
      : Promise.resolve({ rows: [] } as any),
    firstCardUserIds.length > 0
      ? db.execute(sql`
          SELECT DISTINCT ON (uc.user_id) uc.user_id, c.front_image_url
          FROM user_collections uc
          JOIN cards c ON c.id = uc.card_id
          JOIN users u ON u.id = uc.user_id
          WHERE uc.user_id IN (${sql.join(firstCardUserIds.map(id => sql`${id}`), sql`, `)})
            AND u.show_collection = true
            AND c.front_image_url IS NOT NULL AND c.front_image_url != ''
          ORDER BY uc.user_id, uc.acquired_date ASC NULLS LAST, uc.id ASC`)
      : Promise.resolve({ rows: [] } as any),
  ]);
  const badgeIconById: Record<number, string | null> = {};
  for (const b of (badgeIcons as any).rows ?? []) badgeIconById[Number(b.id)] = b.icon_url || null;
  const cardImageById: Record<number, string | null> = {};
  for (const c of (cardImages as any).rows ?? []) cardImageById[Number(c.id)] = c.front_image_url || null;
  const firstCardByUser: Record<number, string | null> = {};
  for (const f of (firstCards as any).rows ?? []) firstCardByUser[Number(f.user_id)] = f.front_image_url || null;

  for (const r of rows) {
    if (r.relatedType === 'badge' && r.relatedId) imageByEvent[r.id] = badgeIconById[r.relatedId] ?? null;
    else if (r.relatedType === 'card' && r.relatedId) imageByEvent[r.id] = cardImageById[r.relatedId] ?? null;
    else if (r.eventType === 'first_card') imageByEvent[r.id] = firstCardByUser[r.userId] ?? null;
    else imageByEvent[r.id] = null;
  }

  return rows.map(r => ({
    id: r.id,
    eventType: r.eventType,
    title: r.title,
    metadata: r.metadata ? safeParse(r.metadata) : null,
    relatedType: r.relatedType,
    relatedId: r.relatedId,
    image: imageByEvent[r.id] ?? null,
    createdAt: r.createdAt,
    user: {
      id: r.userId,
      username: r.username,
      displayName: r.displayName,
      photoURL: r.photoURL,
      collectorAvatarKey: r.collectorAvatarKey,
      collectorLevel: levels[r.userId] ?? 1,
    },
    reactions: countsByEvent[r.id] ?? {},
    myReaction: myReactions[r.id] ?? null,
  }));
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Batch collector-level computation (ledger + badges + approved images), one query set for N users. */
export async function computeLevelsForUsers(userIds: number[]): Promise<Record<number, number>> {
  if (userIds.length === 0) return {};
  const res = await db.execute(sql`
    WITH ledger AS (
      SELECT user_id, coalesce(sum(points), 0) AS xp
      FROM xp_events WHERE user_id = ANY(${sql.raw(`ARRAY[${userIds.map(Number).join(',')}]::int[]`)})
      GROUP BY user_id
    ), badge_xp AS (
      SELECT ub.user_id, coalesce(sum(coalesce(b.points, 10)), 0) AS xp
      FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ANY(${sql.raw(`ARRAY[${userIds.map(Number).join(',')}]::int[]`)})
      GROUP BY ub.user_id
    ), img AS (
      SELECT user_id, count(*)::int AS n
      FROM pending_card_images
      WHERE status = 'approved' AND user_id = ANY(${sql.raw(`ARRAY[${userIds.map(Number).join(',')}]::int[]`)})
      GROUP BY user_id
    )
    SELECT u.id AS user_id,
      coalesce(l.xp, 0) + coalesce(bx.xp, 0) +
      CASE WHEN coalesce(i.n, 0) > 0 THEN 25 + 10 * coalesce(i.n, 0) ELSE 0 END AS total_xp
    FROM users u
    LEFT JOIN ledger l ON l.user_id = u.id
    LEFT JOIN badge_xp bx ON bx.user_id = u.id
    LEFT JOIN img i ON i.user_id = u.id
    WHERE u.id = ANY(${sql.raw(`ARRAY[${userIds.map(Number).join(',')}]::int[]`)})
  `);
  const out: Record<number, number> = {};
  for (const row of (res as any).rows ?? []) {
    out[Number(row.user_id)] = computeXpProgress(Number(row.total_xp)).level;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reactions + XP
// ---------------------------------------------------------------------------

export interface ReactResult {
  ok: boolean;
  status: number;
  message?: string;
  reactions?: Record<string, number>;
  myReaction?: string | null;
  xpAwarded?: number;
}

/**
 * Set (create or change) the caller's reaction on a feed event.
 * XP rules (all server-enforced, farm-proof):
 * - XP only on the FIRST-EVER reaction claim per (user, event) — the partial
 *   unique index on xp_events makes toggling/changing/re-adding a no-op.
 * - Never for your own events.
 * - First claim of the UTC day +5, later claims +1, daily cap 10 (a claim row
 *   with 0 points is still recorded once the cap is hit, so removing and
 *   re-reacting later never re-opens the award).
 */
/**
 * Same visibility rule as the feed itself: an event is readable if the viewer
 * owns it, or its author has a public profile with activity sharing on (and it
 * isn't hidden). Unreadable events are indistinguishable from absent ones.
 */
async function getReadableEvent(viewerId: number, feedEventId: number): Promise<{ id: number; userId: number } | null> {
  if (!Number.isInteger(feedEventId)) return null;
  const res = await db.execute(sql`
    SELECT fe.id, fe.user_id
    FROM feed_events fe
    JOIN users u ON u.id = fe.user_id
    WHERE fe.id = ${feedEventId}
      AND fe.hidden = false
      AND (fe.user_id = ${viewerId} OR (u.profile_visibility = 'public' AND u.show_activity_in_feed = true))
  `);
  const row = (res as any).rows?.[0];
  return row ? { id: Number(row.id), userId: Number(row.user_id) } : null;
}

export async function setReaction(viewerId: number, feedEventId: number, reactionType: string): Promise<ReactResult> {
  if (!REACTION_TYPES.includes(reactionType as ReactionType)) {
    return { ok: false, status: 400, message: 'Invalid reaction' };
  }
  const event = await getReadableEvent(viewerId, feedEventId);
  if (!event) return { ok: false, status: 404, message: 'Feed event not found' };

  // Upsert the single active reaction per (event, user)
  await db.execute(sql`
    INSERT INTO feed_reactions (feed_event_id, user_id, reaction_type)
    VALUES (${feedEventId}, ${viewerId}, ${reactionType})
    ON CONFLICT (feed_event_id, user_id)
    DO UPDATE SET reaction_type = EXCLUDED.reaction_type, updated_at = now()
  `);

  // XP claim (only for others' events). The whole read-then-insert runs inside
  // a transaction holding a per-user advisory lock, so concurrent reactions
  // can't both read the same pre-insert total and blow past the daily cap.
  // Day boundary is explicit UTC.
  let xpAwarded = 0;
  if (event.userId !== viewerId) {
    try {
      xpAwarded = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(892031, ${viewerId})`);
        const todayRes = await tx.execute(sql`
          SELECT coalesce(sum(points), 0)::int AS pts, count(*)::int AS n
          FROM xp_events
          WHERE user_id = ${viewerId} AND event_type = 'feed_reaction'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc')
        `);
        const todayPts = Number((todayRes as any).rows?.[0]?.pts ?? 0);
        const todayN = Number((todayRes as any).rows?.[0]?.n ?? 0);
        const points = Math.max(0, Math.min(
          todayN === 0 ? XP_FEED_FIRST_OF_DAY : XP_FEED_ADDITIONAL,
          XP_FEED_DAILY_CAP - todayPts,
        ));
        // Claim row is always inserted (even at 0 points) so this (user, event)
        // can never award again; unique partial index makes repeats no-ops.
        const ins = await tx.execute(sql`
          INSERT INTO xp_events (user_id, event_type, feed_event_id, points)
          VALUES (${viewerId}, 'feed_reaction', ${feedEventId}, ${points})
          ON CONFLICT DO NOTHING
          RETURNING points
        `);
        return ((ins as any).rowCount ?? 0) > 0 ? points : 0;
      });
    } catch (err) {
      console.error('[feedService] reaction XP failed', { viewerId, feedEventId, err });
    }
  }

  const state = await reactionState(feedEventId, viewerId);
  return { ok: true, status: 200, ...state, xpAwarded };
}

/** Remove the caller's reaction. XP is never clawed back (and never re-awarded). */
export async function removeReaction(viewerId: number, feedEventId: number): Promise<ReactResult> {
  const event = await getReadableEvent(viewerId, feedEventId);
  if (!event) return { ok: false, status: 404, message: 'Feed event not found' };
  await db
    .delete(feedReactions)
    .where(and(eq(feedReactions.feedEventId, feedEventId), eq(feedReactions.userId, viewerId)));
  const state = await reactionState(feedEventId, viewerId);
  return { ok: true, status: 200, ...state, xpAwarded: 0 };
}

async function reactionState(feedEventId: number, viewerId: number) {
  const countRows = await db
    .select({ reactionType: feedReactions.reactionType, n: sql<number>`count(*)::int` })
    .from(feedReactions)
    .where(eq(feedReactions.feedEventId, feedEventId))
    .groupBy(feedReactions.reactionType);
  const reactions: Record<string, number> = {};
  for (const c of countRows) reactions[c.reactionType] = Number(c.n);
  const [mine] = await db
    .select({ reactionType: feedReactions.reactionType })
    .from(feedReactions)
    .where(and(eq(feedReactions.feedEventId, feedEventId), eq(feedReactions.userId, viewerId)));
  return { reactions, myReaction: mine?.reactionType ?? null };
}

// ---------------------------------------------------------------------------
// Leaderboards (weekly = current ISO week, Monday 00:00 UTC)
// ---------------------------------------------------------------------------

export async function getWeeklyLeaderboards() {
  // Weekly XP = ledger points this week + badges earned this week + images approved this week.
  // Privacy: only public + show_activity_in_feed users. Admins excluded (they'd skew it).
  const xpRes = await db.execute(sql`
    WITH week AS (SELECT date_trunc('week', now()) AS start),
    ledger AS (
      SELECT user_id, sum(points) AS xp FROM xp_events, week
      WHERE created_at >= week.start GROUP BY user_id
    ),
    badge_xp AS (
      SELECT ub.user_id, sum(coalesce(b.points, 10)) AS xp
      FROM user_badges ub JOIN badges b ON b.id = ub.badge_id, week
      WHERE ub.earned_at >= week.start GROUP BY ub.user_id
    ),
    img_xp AS (
      SELECT user_id, count(*) * 10 AS xp FROM pending_card_images, week
      WHERE status = 'approved' AND reviewed_at >= week.start GROUP BY user_id
    ),
    combined AS (
      SELECT user_id, sum(xp) AS xp FROM (
        SELECT * FROM ledger UNION ALL SELECT * FROM badge_xp UNION ALL SELECT * FROM img_xp
      ) t GROUP BY user_id
    )
    SELECT c.user_id, c.xp::int AS xp, u.username, u.display_name, u.photo_url, u.collector_avatar_key
    FROM combined c
    JOIN users u ON u.id = c.user_id
    WHERE u.is_admin = false
      AND u.profile_visibility = 'public'
      AND u.show_activity_in_feed = true
      AND c.xp > 0
    ORDER BY c.xp DESC
    LIMIT 10
  `);

  const imgRes = await db.execute(sql`
    SELECT p.user_id, count(*)::int AS approved, u.username, u.display_name, u.photo_url, u.collector_avatar_key
    FROM pending_card_images p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'approved'
      AND p.reviewed_at >= date_trunc('week', now())
      AND u.is_admin = false
      AND u.profile_visibility = 'public'
      AND u.show_activity_in_feed = true
    GROUP BY p.user_id, u.username, u.display_name, u.photo_url, u.collector_avatar_key
    ORDER BY approved DESC
    LIMIT 10
  `);

  // All-time Top 10 collectors by total XP (same sources as computeUserXp:
  // ledger + badge points + approved images, incl. the one-time image bonus).
  // Same privacy/admin exclusions as the weekly boards.
  const allTimeRes = await db.execute(sql`
    WITH ledger AS (
      SELECT user_id, sum(points) AS xp FROM xp_events GROUP BY user_id
    ),
    badge_xp AS (
      SELECT ub.user_id, sum(coalesce(b.points, 10)) AS xp
      FROM user_badges ub JOIN badges b ON b.id = ub.badge_id GROUP BY ub.user_id
    ),
    img_xp AS (
      SELECT user_id, count(*) * 10 + 25 AS xp FROM pending_card_images
      WHERE status = 'approved' GROUP BY user_id
    ),
    combined AS (
      SELECT user_id, sum(xp) AS xp FROM (
        SELECT * FROM ledger UNION ALL SELECT * FROM badge_xp UNION ALL SELECT * FROM img_xp
      ) t GROUP BY user_id
    )
    SELECT c.user_id, c.xp::int AS xp, u.username, u.display_name, u.photo_url, u.collector_avatar_key
    FROM combined c
    JOIN users u ON u.id = c.user_id
    WHERE u.is_admin = false
      AND u.profile_visibility = 'public'
      AND u.show_activity_in_feed = true
      AND c.xp > 0
    ORDER BY c.xp DESC
    LIMIT 10
  `);

  const xpRows = ((xpRes as any).rows ?? []) as any[];
  const imgRows = ((imgRes as any).rows ?? []) as any[];
  const allTimeRows = ((allTimeRes as any).rows ?? []) as any[];

  // Award the "Top 10 Collector" badge to current all-time top-10 members.
  // Permanent once earned (Hall of Fame precedent); ON CONFLICT makes it
  // idempotent, and awardBadge emits the feed event + quiet notification.
  syncTopTenBadge(allTimeRows.map(r => Number(r.user_id))).catch(err =>
    console.error('[Feed] top-10 badge sync failed:', err));

  const allIds = Array.from(new Set([...xpRows, ...imgRows, ...allTimeRows].map(r => Number(r.user_id))));
  const levels = await computeLevelsForUsers(allIds);

  const shape = (r: any, value: number, valueKey: string) => ({
    user: {
      id: Number(r.user_id),
      username: r.username,
      displayName: r.display_name,
      photoURL: r.photo_url,
      collectorAvatarKey: r.collector_avatar_key,
      collectorLevel: levels[Number(r.user_id)] ?? 1,
    },
    [valueKey]: value,
  });

  return {
    weekStart: null, // client shows "This Week"
    topXp: xpRows.map(r => shape(r, Number(r.xp), 'xp')),
    topImageContributors: imgRows.map(r => shape(r, Number(r.approved), 'approved')),
    allTimeTopXp: allTimeRows.map(r => shape(r, Number(r.xp), 'xp')),
  };
}

/** Fire-and-forget: award the Top 10 Collector badge to current top-10 users. */
async function syncTopTenBadge(userIds: number[]) {
  if (userIds.length === 0) return;
  const { TOP_TEN_BADGE_NAME } = await import('./topTenBadgeSeed');
  const [badge] = await db
    .select({ id: badges.id })
    .from(badges)
    .where(eq(badges.name, TOP_TEN_BADGE_NAME))
    .limit(1);
  if (!badge) return; // seed hasn't run yet
  const { badgeService } = await import('../badge-service');
  for (const userId of userIds) {
    await badgeService.awardBadge(userId, badge.id);
  }
}

// ---------------------------------------------------------------------------
// Admin: stats, hide, backfill
// ---------------------------------------------------------------------------

export async function getFeedAdminStats() {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM feed_events) AS total_events,
      (SELECT count(*)::int FROM feed_events WHERE hidden) AS hidden_events,
      (SELECT count(*)::int FROM feed_events WHERE created_at >= date_trunc('day', now())) AS events_today,
      (SELECT count(*)::int FROM feed_reactions) AS total_reactions,
      (SELECT count(*)::int FROM feed_reactions WHERE created_at >= date_trunc('day', now())) AS reactions_today,
      (SELECT coalesce(sum(points), 0)::int FROM xp_events WHERE event_type = 'feed_reaction' AND created_at >= date_trunc('day', now())) AS feed_xp_today
  `);
  const row = (res as any).rows?.[0] ?? {};
  const byTypeRes = await db.execute(sql`
    SELECT event_type, count(*)::int AS n FROM feed_events GROUP BY event_type ORDER BY n DESC
  `);
  return {
    totalEvents: Number(row.total_events ?? 0),
    hiddenEvents: Number(row.hidden_events ?? 0),
    eventsToday: Number(row.events_today ?? 0),
    totalReactions: Number(row.total_reactions ?? 0),
    reactionsToday: Number(row.reactions_today ?? 0),
    feedXpToday: Number(row.feed_xp_today ?? 0),
    eventsByType: ((byTypeRes as any).rows ?? []).map((r: any) => ({ eventType: r.event_type, count: Number(r.n) })),
  };
}

/** Admin: latest events regardless of privacy/hidden (for moderation). */
export async function getRecentFeedEventsAdmin(limit = 50) {
  const rows = await db
    .select({
      id: feedEvents.id,
      userId: feedEvents.userId,
      eventType: feedEvents.eventType,
      title: feedEvents.title,
      hidden: feedEvents.hidden,
      createdAt: feedEvents.createdAt,
      username: users.username,
      displayName: users.displayName,
    })
    .from(feedEvents)
    .innerJoin(users, eq(feedEvents.userId, users.id))
    .orderBy(desc(feedEvents.createdAt))
    .limit(Math.min(limit, 100));
  return rows;
}

export async function setFeedEventHidden(id: number, hidden: boolean): Promise<boolean> {
  const res = await db.execute(sql`UPDATE feed_events SET hidden = ${hidden} WHERE id = ${id} RETURNING id`);
  return ((res as any).rowCount ?? 0) > 0;
}

/**
 * Backfill: last 90 days of badges/binders/shares/approved images + all-time
 * collection milestones (first card + 50/100/250/500, reliably reconstructable
 * from user_collections ordered by created date). Dedupe keys make the confirm
 * run idempotent; dry run writes NOTHING and only counts what a real run would
 * insert. Privacy is enforced at read time, so backfill inserts for everyone
 * but hidden/private users never appear publicly.
 */
export async function runFeedBackfill(dryRun: boolean): Promise<Record<string, number>> {
  const candidates: { key: string; sql: ReturnType<typeof sql> }[] = [
    {
      key: 'first_card',
      sql: sql`
        SELECT user_id, 'first_card' AS event_type,
          'added their first card to the Vault' AS title,
          NULL AS metadata, NULL AS related_type, NULL::int AS related_id,
          'first_card:' || user_id AS dedupe_key,
          min(acquired_date) AS created_at
        FROM user_collections GROUP BY user_id
      `,
    },
    {
      key: 'collection_milestone',
      sql: sql`
        SELECT user_id, 'collection_milestone' AS event_type,
          'reached ' || m.milestone || ' cards in their collection' AS title,
          json_build_object('milestone', m.milestone)::text AS metadata,
          NULL AS related_type, NULL::int AS related_id,
          'collection_milestone:' || user_id || ':' || m.milestone AS dedupe_key,
          max(t.acquired_date) AS created_at
        FROM (
          SELECT user_id, acquired_date, row_number() OVER (PARTITION BY user_id ORDER BY acquired_date) AS rn
          FROM user_collections
        ) t
        JOIN (VALUES (50), (100), (250), (500)) AS m(milestone) ON t.rn = m.milestone
        GROUP BY user_id, m.milestone
      `,
    },
    {
      key: 'badge_earned',
      sql: sql`
        SELECT ub.user_id, 'badge_earned' AS event_type,
          'earned the ' || b.name || ' badge' AS title,
          json_build_object('badgeName', b.name)::text AS metadata,
          'badge' AS related_type, b.id AS related_id,
          'badge_earned:' || ub.user_id || ':' || b.id AS dedupe_key,
          ub.earned_at AS created_at
        FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
        WHERE ub.earned_at >= now() - interval '90 days'
      `,
    },
    {
      key: 'binder_created',
      sql: sql`
        SELECT user_id, 'binder_created' AS event_type,
          'created the "' || name || '" PC Binder' AS title,
          json_build_object('binderName', name)::text AS metadata,
          'binder' AS related_type, id AS related_id,
          'binder_created:' || user_id || ':' || id AS dedupe_key,
          created_at
        FROM pc_binders
        WHERE created_at >= now() - interval '90 days'
      `,
    },
    {
      key: 'binder_shared',
      sql: sql`
        SELECT b.user_id, 'binder_shared' AS event_type,
          'shared the "' || b.name || '" PC Binder' AS title,
          json_build_object('binderName', b.name)::text AS metadata,
          'share_link' AS related_type, min(l.id) AS related_id,
          'binder_shared:' || b.user_id || ':' || b.id AS dedupe_key,
          min(l.created_at) AS created_at
        FROM pc_binder_share_links l
        JOIN pc_binders b ON b.id = l.binder_id
        WHERE l.created_at >= now() - interval '90 days'
        GROUP BY b.user_id, b.id, b.name
      `,
    },
    {
      key: 'image_approved',
      sql: sql`
        SELECT user_id, 'image_approved' AS event_type,
          'contributed a card image to the Vault' AS title,
          NULL AS metadata, 'card' AS related_type, card_id AS related_id,
          'image_approved:' || user_id || ':' || id AS dedupe_key,
          coalesce(reviewed_at, created_at) AS created_at
        FROM pending_card_images
        WHERE status = 'approved'
          AND coalesce(reviewed_at, created_at) >= now() - interval '90 days'
      `,
    },
  ];

  const results: Record<string, number> = {};
  for (const c of candidates) {
    if (dryRun) {
      const res = await db.execute(sql`
        SELECT count(*)::int AS n FROM (${c.sql}) cand
        WHERE NOT EXISTS (SELECT 1 FROM feed_events fe WHERE fe.dedupe_key = cand.dedupe_key)
      `);
      results[c.key] = Number((res as any).rows?.[0]?.n ?? 0);
    } else {
      const res = await db.execute(sql`
        INSERT INTO feed_events (user_id, event_type, title, metadata, related_type, related_id, dedupe_key, created_at)
        SELECT user_id, event_type, title, metadata, related_type, related_id, dedupe_key, created_at
        FROM (${c.sql}) cand
        ON CONFLICT (dedupe_key) DO NOTHING
      `);
      results[c.key] = Number((res as any).rowCount ?? 0);
    }
  }
  return results;
}
