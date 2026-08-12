import Stripe from "stripe";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * One-time backfill of users.upgraded_at for pre-existing paid subscribers,
 * using the Stripe subscription's created timestamp (earliest subscription
 * found for the customer). Users with no Stripe footprint (e.g. Apple/
 * RevenueCat-only) are left NULL and simply excluded from days-to-upgrade
 * stats. Going forward the DB trigger stamps upgraded_at automatically.
 *
 * Idempotent: only touches rows where upgraded_at IS NULL. Caller gates it
 * with a startup_migrations marker so the Stripe scan runs once per env.
 */
export async function backfillUpgradedAtFromStripe(): Promise<{ updated: number; skipped: number; errors: number }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY not configured");
  const stripe = new Stripe(secretKey);

  const res = await db.execute(sql`
    SELECT id, stripe_customer_id, stripe_subscription_id
    FROM users
    WHERE upgraded_at IS NULL
      AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL)
      AND (plan = 'SUPER_HERO' OR subscription_status = 'cancelled')
  `);

  let updated = 0, skipped = 0, errors = 0;
  for (const row of (res as any).rows as { id: number; stripe_customer_id: string | null; stripe_subscription_id: string | null }[]) {
    try {
      let createdUnix: number | null = null;
      if (row.stripe_subscription_id) {
        try {
          const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
          createdUnix = sub.created;
        } catch {
          // fall through to customer lookup
        }
      }
      if (createdUnix === null && row.stripe_customer_id) {
        const subs = await stripe.subscriptions.list({ customer: row.stripe_customer_id, status: "all", limit: 10 });
        if (subs.data.length) {
          createdUnix = Math.min(...subs.data.map(s => s.created));
        }
      }
      if (createdUnix === null) {
        skipped++;
        continue;
      }
      await db.execute(sql`
        UPDATE users SET upgraded_at = to_timestamp(${createdUnix}) AT TIME ZONE 'UTC'
        WHERE id = ${row.id} AND upgraded_at IS NULL
      `);
      updated++;
    } catch (err) {
      errors++;
      console.error(`[UpgradedAt Backfill] user ${row.id} failed:`, (err as Error).message);
    }
  }
  return { updated, skipped, errors };
}
