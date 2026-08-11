import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * User Activity / Lifecycle Intelligence v1 (admin-only, read-only).
 *
 * Everything here is CALCULATED on the fly from existing data — no new
 * columns, no backfill, no writes to user rows. Definitions are documented
 * in STAGE_RULES below and surfaced to the admin UI.
 */

export const STAGE_ORDER = [
  "Signed Up",
  "Onboarding Complete",
  "Empty Vault",
  "Collector Started",
  "Returning Collector",
  "Engaged Collector",
  "Power Collector",
  "Super Hero",
  "Cancelled",
  "Dormant",
] as const;

export const STAGE_RULES: Record<string, string> = {
  "Super Hero": "Active paid subscriber (plan SUPER_HERO, status active)",
  "Cancelled": "Previously subscribed (has a Stripe customer/subscription or Apple record) and status is cancelled, no longer paying",
  "Dormant": "Free user with no login in 30+ days (and account older than 30 days)",
  "Power Collector": "100+ cards, or 20+ total logins with 10+ cards",
  "Engaged Collector": "10+ cards, or has a PC binder, wishlist item, image upload, or shared binder",
  "Returning Collector": "Logged in 3+ times",
  "Collector Started": "Added at least one card",
  "Empty Vault": "Onboarding complete, zero cards, account older than 7 days",
  "Onboarding Complete": "Onboarding complete, zero cards, account 7 days old or newer",
  "Signed Up": "Account exists, onboarding not completed",
};

/**
 * One set-based query computing per-user counts + lifecycle stage.
 * Precedence (first match wins): Cancelled > Super Hero > Dormant >
 * Power > Engaged > Returning > Started > Empty Vault > Onboarding > Signed Up.
 */
const PER_USER_CTE = sql`
  WITH counts AS (
    SELECT u.id,
      u.plan, u.subscription_status, u.onboarding_complete, u.created_at,
      u.last_login, u.total_logins,
      -- stripe_subscription_id is cleared when a subscription is cancelled, so a churned
      -- user's only remaining Stripe footprint is stripe_customer_id (created at checkout).
      (u.stripe_subscription_id IS NOT NULL OR u.stripe_customer_id IS NOT NULL OR u.apple_original_transaction_id IS NOT NULL) AS ever_subscribed,
      COALESCE(c.cards, 0) AS cards,
      COALESCE(pb.binders, 0) AS binders,
      COALESCE(w.wishlist, 0) AS wishlist,
      COALESCE(img.images, 0) AS images,
      COALESCE(sh.shared_binders, 0) AS shared_binders
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) AS cards FROM user_collections GROUP BY user_id) c ON c.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS binders FROM pc_binders GROUP BY user_id) pb ON pb.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS wishlist FROM user_wishlists GROUP BY user_id) w ON w.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS images FROM pending_card_images GROUP BY user_id) img ON img.user_id = u.id
    LEFT JOIN (
      SELECT b.user_id, COUNT(DISTINCT l.binder_id) AS shared_binders
      FROM pc_binder_share_links l JOIN pc_binders b ON b.id = l.binder_id
      WHERE l.is_active GROUP BY b.user_id
    ) sh ON sh.user_id = u.id
    WHERE u.firebase_uid IS NULL OR u.firebase_uid != 'SYSTEM_USER_MCV'
  ),
  staged AS (
    SELECT *,
      CASE
        WHEN ever_subscribed AND subscription_status = 'cancelled' THEN 'Cancelled'
        WHEN plan = 'SUPER_HERO' AND subscription_status = 'active' THEN 'Super Hero'
        WHEN COALESCE(last_login, created_at) < now() - interval '30 days'
             AND created_at < now() - interval '30 days' THEN 'Dormant'
        WHEN cards >= 100 OR (total_logins >= 20 AND cards >= 10) THEN 'Power Collector'
        WHEN cards >= 10 OR binders > 0 OR wishlist > 0 OR images > 0 OR shared_binders > 0 THEN 'Engaged Collector'
        WHEN total_logins >= 3 THEN 'Returning Collector'
        WHEN cards >= 1 THEN 'Collector Started'
        WHEN onboarding_complete AND created_at <= now() - interval '7 days' THEN 'Empty Vault'
        WHEN onboarding_complete THEN 'Onboarding Complete'
        ELSE 'Signed Up'
      END AS stage
    FROM counts
  )
`;

export interface LifecycleUserRow {
  userId: number;
  stage: string;
  pcBinderCount: number;
  wishlistCount: number;
  imagesUploaded: number;
  sharedBinders: number;
  platforms: string[];
  platformFirstSeen: string | null;
}

/** Per-user lifecycle stage + engagement counts + platforms, for the admin user table. */
export async function getLifecycleUserRows(): Promise<Map<number, LifecycleUserRow>> {
  const [stagesRes, platformsRes] = await Promise.all([
    db.execute(sql`${PER_USER_CTE}
      SELECT id, stage, binders, wishlist, images, shared_binders FROM staged`),
    db.execute(sql`
      SELECT user_id,
        ARRAY_AGG(platform ORDER BY first_seen_at) AS platforms,
        (ARRAY_AGG(platform ORDER BY first_seen_at))[1] AS first_platform
      FROM user_platforms GROUP BY user_id`),
  ]);
  const platMap = new Map<number, { platforms: string[]; first: string | null }>();
  for (const r of platformsRes.rows as any[]) {
    platMap.set(r.user_id, { platforms: r.platforms || [], first: r.first_platform || null });
  }
  const map = new Map<number, LifecycleUserRow>();
  for (const r of stagesRes.rows as any[]) {
    const p = platMap.get(r.id);
    map.set(r.id, {
      userId: r.id,
      stage: r.stage,
      pcBinderCount: parseInt(r.binders) || 0,
      wishlistCount: parseInt(r.wishlist) || 0,
      imagesUploaded: parseInt(r.images) || 0,
      sharedBinders: parseInt(r.shared_binders) || 0,
      platforms: p?.platforms || [],
      platformFirstSeen: p?.first || null,
    });
  }
  return map;
}

/** Counts by lifecycle stage + funnel + conversion rates, for the analytics dashboard. */
export async function getLifecycleOverview() {
  const [stagesRes, funnelRes] = await Promise.all([
    db.execute(sql`${PER_USER_CTE}
      SELECT stage, COUNT(*) AS n FROM staged GROUP BY stage`),
    db.execute(sql`${PER_USER_CTE}
      SELECT
        COUNT(*) AS signed_up,
        COUNT(*) FILTER (WHERE onboarding_complete) AS onboarding_complete,
        COUNT(*) FILTER (WHERE cards >= 1) AS added_first_card,
        COUNT(*) FILTER (WHERE total_logins >= 3) AS returning,
        COUNT(*) FILTER (WHERE cards >= 10 OR binders > 0 OR wishlist > 0 OR images > 0 OR shared_binders > 0) AS engaged,
        COUNT(*) FILTER (WHERE plan = 'SUPER_HERO' AND subscription_status = 'active') AS upgraded,
        COUNT(*) FILTER (WHERE ever_subscribed AND subscription_status = 'cancelled') AS cancelled
      FROM staged`),
  ]);
  const byStage: Record<string, number> = {};
  for (const s of STAGE_ORDER) byStage[s] = 0;
  for (const r of stagesRes.rows as any[]) byStage[r.stage] = parseInt(r.n) || 0;

  const f: any = (funnelRes.rows as any[])[0] || {};
  const funnel = {
    signedUp: parseInt(f.signed_up) || 0,
    onboardingComplete: parseInt(f.onboarding_complete) || 0,
    addedFirstCard: parseInt(f.added_first_card) || 0,
    returning: parseInt(f.returning) || 0,
    engaged: parseInt(f.engaged) || 0,
    upgraded: parseInt(f.upgraded) || 0,
    cancelled: parseInt(f.cancelled) || 0,
  };
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    stages: STAGE_ORDER.map(s => ({ stage: s, count: byStage[s] })),
    rules: STAGE_RULES,
    funnel,
    conversion: {
      onboardingRate: pct(funnel.onboardingComplete, funnel.signedUp),
      firstCardRate: pct(funnel.addedFirstCard, funnel.onboardingComplete),
      returningRate: pct(funnel.returning, funnel.addedFirstCard),
      engagedRate: pct(funnel.engaged, funnel.addedFirstCard),
      upgradeRate: pct(funnel.upgraded, funnel.signedUp),
      churnRate: pct(funnel.cancelled, funnel.upgraded + funnel.cancelled),
    },
  };
}

/**
 * Activity heatmap: day-of-week × hour-of-day in America/Chicago over the
 * last N weeks, from every timestamped user action we have (card adds, scans,
 * analytics events, XP events). Also computes the quietest and busiest
 * 2-hour windows — the quietest windows are the safest times to publish.
 */
export async function getActivityHeatmap(weeks = 8) {
  const res = await db.execute(sql`
    WITH events AS (
      SELECT acquired_date AS ts FROM user_collections WHERE acquired_date > now() - make_interval(weeks => ${weeks})
      UNION ALL
      SELECT created_at FROM user_scan_logs WHERE created_at > now() - make_interval(weeks => ${weeks})
      UNION ALL
      SELECT created_at FROM analytics_events WHERE created_at > now() - make_interval(weeks => ${weeks})
      UNION ALL
      SELECT created_at FROM xp_events WHERE created_at > now() - make_interval(weeks => ${weeks})
    )
    SELECT
      -- columns are timestamp-without-timezone storing UTC; two-step conversion
      -- (UTC -> Chicago) matches the existing activity-stats implementation and is DST-safe
      EXTRACT(DOW FROM ts AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::int AS dow,
      EXTRACT(HOUR FROM ts AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::int AS hour,
      COUNT(*) AS actions
    FROM events
    GROUP BY 1, 2
  `);

  // 7x24 grid, zero-filled
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of res.rows as any[]) {
    grid[r.dow][r.hour] = parseInt(r.actions) || 0;
  }

  // Aggregate by hour across all days for window ranking
  const byHour = Array(24).fill(0);
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) byHour[h] += grid[d][h];

  const windows = Array.from({ length: 24 }, (_, h) => ({
    startHour: h,
    endHour: (h + 2) % 24,
    actions: byHour[h] + byHour[(h + 1) % 24],
  }));
  const sorted = [...windows].sort((a, b) => a.actions - b.actions);

  return {
    timezone: "America/Chicago",
    weeks,
    grid, // grid[dayOfWeek 0=Sun][hour 0-23] = action count
    byHour,
    quietestWindows: sorted.slice(0, 3),
    busiestWindows: sorted.slice(-3).reverse(),
  };
}
