import { db } from '../db';
import {
  xpEvents,
  userBadges,
  badges,
  pendingCardImages,
  cards,
} from '../../shared/schema';
import { and, eq, sql, count, desc, inArray } from 'drizzle-orm';
import {
  computeXpProgress,
  imageContributionXp,
  DEFAULT_BADGE_XP,
  XP_PER_CARD_ADDED,
  XP_FIRST_BINDER_SHARE,
  XP_DAILY_BINDER_SHARE,
  XP_EVENT_BINDER_SHARE_FIRST,
  XP_EVENT_BINDER_SHARE_DAILY,
  type XpProgress,
} from '../../shared/xp';

export interface UserXpBreakdown {
  badgeXp: number;
  imageXp: number;
  cardXp: number;
  shareXp: number;
  totalXp: number;
  progress: XpProgress;
}

export interface BinderShareXpResult {
  awarded: boolean;
  points: number;
  kind: 'first' | 'daily' | 'limit';
}

export interface RecentXpEvent {
  id: number;
  eventType: string;
  points: number;
  cardId: number | null;
  cardName: string | null;
  createdAt: Date;
}

/**
 * Award +1 XP the first time a user adds a given card to their collection.
 * Farm-proof: the (user_id, event_type, card_id) unique index means re-adding
 * the same card (or the upsert in addToCollection bumping quantity) is a no-op
 * insert. Must never throw into the caller — adding a card must always succeed.
 */
export async function awardCardAddedXp(userId: number, cardId: number): Promise<void> {
  try {
    await db
      .insert(xpEvents)
      .values({ userId, eventType: 'card_added', cardId, points: XP_PER_CARD_ADDED })
      .onConflictDoNothing();
  } catch (err) {
    console.error('[xpService] awardCardAddedXp failed', { userId, cardId, err });
  }
}

/**
 * Award XP for sharing a subset binder. Farm-proof, two tiers:
 * - First share ever: +25 one-time bonus, DB-enforced by the partial unique
 *   index xp_events_share_first_idx (ON CONFLICT DO NOTHING makes repeats no-ops).
 * - After that: +10 max once per UTC day, enforced by an atomic guarded INSERT
 *   (INSERT ... WHERE NOT EXISTS today's event). Repeated shares/copies the
 *   same day award nothing.
 * cardSetId is stored as metadata for future analytics/anti-spam.
 * Must never throw into the caller — sharing must always succeed.
 */
export async function awardBinderShareXp(userId: number, cardSetId: number): Promise<BinderShareXpResult> {
  try {
    const firstRes = await db.execute(sql`
      INSERT INTO xp_events (user_id, event_type, card_set_id, points)
      VALUES (${userId}, ${XP_EVENT_BINDER_SHARE_FIRST}, ${cardSetId}, ${XP_FIRST_BINDER_SHARE})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (((firstRes as any).rowCount ?? 0) > 0) {
      return { awarded: true, points: XP_FIRST_BINDER_SHARE, kind: 'first' };
    }

    const dailyRes = await db.execute(sql`
      INSERT INTO xp_events (user_id, event_type, card_set_id, points)
      SELECT ${userId}, ${XP_EVENT_BINDER_SHARE_DAILY}, ${cardSetId}, ${XP_DAILY_BINDER_SHARE}
      WHERE NOT EXISTS (
        SELECT 1 FROM xp_events
        WHERE user_id = ${userId}
          AND event_type = ${XP_EVENT_BINDER_SHARE_DAILY}
          AND created_at >= date_trunc('day', now())
      )
      RETURNING id
    `);
    if (((dailyRes as any).rowCount ?? 0) > 0) {
      return { awarded: true, points: XP_DAILY_BINDER_SHARE, kind: 'daily' };
    }

    return { awarded: false, points: 0, kind: 'limit' };
  } catch (err) {
    console.error('[xpService] awardBinderShareXp failed', { userId, cardSetId, err });
    return { awarded: false, points: 0, kind: 'limit' };
  }
}

/**
 * Single source of truth for a user's XP, shared by the dashboard summary and
 * the collector profile. Badge XP and image XP stay DERIVED (as before);
 * card_added and binder-share XP come from the xp_events ledger.
 */
export async function computeUserXp(userId: number): Promise<UserXpBreakdown> {
  const [badgeRows, approvedResArr, ledgerResArr, shareResArr] = await Promise.all([
    db
      .select({ points: badges.points, rarity: badges.rarity })
      .from(userBadges)
      .innerJoin(badges, eq(userBadges.badgeId, badges.id))
      .where(eq(userBadges.userId, userId)),
    db
      .select({ count: count() })
      .from(pendingCardImages)
      .where(and(eq(pendingCardImages.userId, userId), eq(pendingCardImages.status, 'approved'))),
    db
      .select({ total: sql<number>`coalesce(sum(${xpEvents.points}), 0)` })
      .from(xpEvents)
      .where(and(eq(xpEvents.userId, userId), eq(xpEvents.eventType, 'card_added'))),
    db
      .select({ total: sql<number>`coalesce(sum(${xpEvents.points}), 0)` })
      .from(xpEvents)
      .where(and(
        eq(xpEvents.userId, userId),
        inArray(xpEvents.eventType, [XP_EVENT_BINDER_SHARE_FIRST, XP_EVENT_BINDER_SHARE_DAILY]),
      )),
  ]);

  const badgeXp = badgeRows.reduce((sum, b) => {
    const rarity = (b.rarity || 'bronze').toLowerCase();
    const pts = b.points ?? DEFAULT_BADGE_XP[rarity] ?? 10;
    return sum + pts;
  }, 0);
  const imageXp = imageContributionXp(Number(approvedResArr[0]?.count ?? 0));
  const cardXp = Number(ledgerResArr[0]?.total ?? 0);
  const shareXp = Number(shareResArr[0]?.total ?? 0);
  const totalXp = badgeXp + imageXp + cardXp + shareXp;

  return { badgeXp, imageXp, cardXp, shareXp, totalXp, progress: computeXpProgress(totalXp) };
}

/** Recent XP-earning activity for the dashboard feed (ledger events only). */
export async function getRecentXpEvents(userId: number, limit = 10): Promise<RecentXpEvent[]> {
  const rows = await db
    .select({
      id: xpEvents.id,
      eventType: xpEvents.eventType,
      points: xpEvents.points,
      cardId: xpEvents.cardId,
      cardName: cards.name,
      createdAt: xpEvents.createdAt,
    })
    .from(xpEvents)
    .leftJoin(cards, eq(xpEvents.cardId, cards.id))
    .where(eq(xpEvents.userId, userId))
    .orderBy(desc(xpEvents.createdAt))
    .limit(limit);
  return rows as RecentXpEvent[];
}

/** True if any card_added XP has ever been recorded (backfill guard). */
export async function hasAnyCardAddedXp(): Promise<boolean> {
  // Existence check (not count) so it short-circuits at the first row instead of
  // scanning every card_added row on each boot.
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(xpEvents)
    .where(eq(xpEvents.eventType, 'card_added'))
    .limit(1);
  return rows.length > 0;
}

/**
 * Idempotent backfill: one card_added event per (user, card) already owned,
 * backdated to acquired_date so the recent-events feed isn't flooded on deploy.
 * ON CONFLICT DO NOTHING makes this safe to re-run. Returns rows inserted.
 */
export async function backfillCardAddedXp(): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO xp_events (user_id, event_type, card_id, points, created_at)
    SELECT user_id, 'card_added', card_id, ${XP_PER_CARD_ADDED}, acquired_date
    FROM user_collections
    ON CONFLICT DO NOTHING
  `);
  return (result as any).rowCount ?? 0;
}

/** Startup-guarded backfill: runs only if no card_added XP exists yet. */
export async function backfillCardAddedXpIfEmpty(): Promise<void> {
  try {
    if (await hasAnyCardAddedXp()) return;
    const inserted = await backfillCardAddedXp();
    console.log(`[xpService] Backfilled ${inserted} card_added XP events from existing collections`);
  } catch (err) {
    console.error('[xpService] backfillCardAddedXpIfEmpty failed', err);
  }
}
