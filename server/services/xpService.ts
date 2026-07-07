import { db } from '../db';
import {
  xpEvents,
  userBadges,
  badges,
  pendingCardImages,
  cards,
} from '../../shared/schema';
import { and, eq, sql, count, desc } from 'drizzle-orm';
import {
  computeXpProgress,
  imageContributionXp,
  DEFAULT_BADGE_XP,
  XP_PER_CARD_ADDED,
  type XpProgress,
} from '../../shared/xp';

export interface UserXpBreakdown {
  badgeXp: number;
  imageXp: number;
  cardXp: number;
  totalXp: number;
  progress: XpProgress;
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
 * Single source of truth for a user's XP, shared by the dashboard summary and
 * the collector profile. Badge XP and image XP stay DERIVED (as before);
 * card_added / set_completed XP come from the xp_events ledger.
 */
export async function computeUserXp(userId: number): Promise<UserXpBreakdown> {
  const [badgeRows, approvedResArr, ledgerResArr] = await Promise.all([
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
  ]);

  const badgeXp = badgeRows.reduce((sum, b) => {
    const rarity = (b.rarity || 'bronze').toLowerCase();
    const pts = b.points ?? DEFAULT_BADGE_XP[rarity] ?? 10;
    return sum + pts;
  }, 0);
  const imageXp = imageContributionXp(Number(approvedResArr[0]?.count ?? 0));
  const cardXp = Number(ledgerResArr[0]?.total ?? 0);
  const totalXp = badgeXp + imageXp + cardXp;

  return { badgeXp, imageXp, cardXp, totalXp, progress: computeXpProgress(totalXp) };
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
  const [row] = await db
    .select({ count: count() })
    .from(xpEvents)
    .where(eq(xpEvents.eventType, 'card_added'))
    .limit(1);
  return Number(row?.count ?? 0) > 0;
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
