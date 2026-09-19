import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  RECOVERY_WINDOW_MS,
  beginStripeRecovery,
  finalizePaidStripeRecovery,
  processStripePaymentFailure,
  recordSubscriptionTransition,
  stopStripeRecoveryForInvoice,
} from "../services/subscriptionTruth";

test.before(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscription_truth_events (
      id serial PRIMARY KEY, provider text NOT NULL, provider_event_id text NOT NULL,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL, reason text NOT NULL, occurred_at timestamp NOT NULL,
      applied boolean NOT NULL DEFAULT false, created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_event_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscription_truth_snapshots (
      id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL, status text NOT NULL, reason text NOT NULL,
      provider_occurred_at timestamp NOT NULL, recovery_ends_at timestamp,
      evidence_id text NOT NULL, updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(user_id, provider)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stripe_recovery_claims (
      invoice_id text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id text NOT NULL, first_failed_at timestamp NOT NULL,
      recovery_ends_at timestamp NOT NULL, next_attempt_at timestamp,
      attempt_count integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending',
      claim_token text, claimed_at timestamp, last_error text,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stripe_recovery_attempts (
      id serial PRIMARY KEY, invoice_id text NOT NULL, attempt_number integer NOT NULL,
      idempotency_key text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'claimed',
      decline_code text, error text, attempted_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(invoice_id, attempt_number)
    )
  `);
});

async function createTestUser(label: string): Promise<number> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await db.execute(sql`
    INSERT INTO users (firebase_uid, username, email)
    VALUES (${`test-${unique}`}, ${`test-${unique}`}, ${`${unique}@example.invalid`})
    RETURNING id
  `);
  return Number((result as any).rows[0].id);
}

async function removeTestUser(userId: number): Promise<void> {
  await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

test("critical provider-read failure rejects for webhook redelivery", async () => {
  const providerFailure = new Error("temporary Stripe outage");
  const stripeClient: any = {
    subscriptions: { retrieve: async () => { throw providerFailure; } },
    invoices: { update: async () => { throw new Error("must not mutate"); } },
  };
  await assert.rejects(
    processStripePaymentFailure({
      eventId: "evt_retry_test",
      occurredAt: new Date(),
      invoiceId: "in_retry_test",
      subscriptionId: "sub_retry_test",
      userId: -1,
      stripeClient,
      mutateBilling: true,
    }),
    providerFailure,
  );
});

test("concurrent duplicate events append once and equal-second cancellation wins", async () => {
  const userId = await createTestUser("truth-concurrency");
  try {
    const occurredAt = new Date();
    const eventId = `evt_duplicate_${userId}`;
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      recordSubscriptionTransition({
        provider: "stripe",
        providerEventId: eventId,
        userId,
        type: "payment_failed",
        status: "payment_declined",
        reason: "integration test",
        occurredAt,
      })
    ));
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    const count = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM subscription_truth_events
      WHERE provider = 'stripe' AND provider_event_id = ${eventId}
    `);
    assert.equal(Number((count as any).rows[0].n), 1);

    await Promise.all([
      recordSubscriptionTransition({
        provider: "stripe", providerEventId: `evt_fail_same_${userId}`, userId,
        type: "payment_failed", status: "payment_declined", reason: "failed", occurredAt,
      }),
      recordSubscriptionTransition({
        provider: "stripe", providerEventId: `evt_cancel_same_${userId}`, userId,
        type: "cancellation_scheduled", status: "cancellation_scheduled", reason: "canceled", occurredAt,
      }),
    ]);
    const snapshot = await db.execute(sql`
      SELECT status FROM subscription_truth_snapshots WHERE user_id = ${userId} AND provider = 'stripe'
    `);
    assert.equal((snapshot as any).rows[0].status, "cancellation_scheduled");
  } finally {
    await removeTestUser(userId);
  }
});

test("concurrent failed invoices share earliest episode and payment stops only exact invoice", async () => {
  const userId = await createTestUser("truth-recovery");
  const subscriptionId = `sub_concurrent_${userId}`;
  const early = new Date(Date.now() - 60_000);
  const late = new Date();
  try {
    const [lateEnd, earlyEnd] = await Promise.all([
      beginStripeRecovery({ invoiceId: `in_late_${userId}`, subscriptionId, userId, failedAt: late }),
      beginStripeRecovery({ invoiceId: `in_early_${userId}`, subscriptionId, userId, failedAt: early }),
    ]);
    const expected = early.getTime() + RECOVERY_WINDOW_MS;
    // Both calls can observe before/after the earlier adjustment; durable truth
    // must always retain the earliest episode boundary.
    assert.ok(lateEnd);
    assert.ok(earlyEnd);
    const claims = await db.execute(sql`
      SELECT invoice_id, recovery_ends_at, status FROM stripe_recovery_claims
      WHERE subscription_id = ${subscriptionId}
    `);
    assert.equal((claims as any).rows.length, 1);
    assert.equal(new Date((claims as any).rows[0].recovery_ends_at).getTime(), expected);

    assert.equal(await stopStripeRecoveryForInvoice("in_not_owner", "recovered"), false);
    const stillActive = await db.execute(sql`
      SELECT status FROM stripe_recovery_claims WHERE subscription_id = ${subscriptionId}
    `);
    assert.equal((stillActive as any).rows[0].status, "pending");
    const ownerInvoice = (claims as any).rows[0].invoice_id;
    const cancelAt = Math.floor(expected / 1000);
    const failingStripe: any = {
      subscriptions: {
        retrieve: async () => ({ id: subscriptionId, status: "past_due", cancel_at: cancelAt, cancel_at_period_end: false }),
        update: async () => { throw new Error("temporary deadline-clear failure"); },
      },
    };
    await assert.rejects(finalizePaidStripeRecovery({
      invoiceId: ownerInvoice,
      subscriptionId,
      stripeClient: failingStripe,
      mutateBilling: true,
    }), /deadline-clear failure/);
    const afterFailure = await db.execute(sql`
      SELECT status FROM stripe_recovery_claims WHERE invoice_id = ${ownerInvoice}
    `);
    assert.equal((afterFailure as any).rows[0].status, "pending", "failed cleanup leaves exact claim resumable and prevents another charge");

    let cleared = 0;
    const successfulStripe: any = {
      subscriptions: {
        retrieve: failingStripe.subscriptions.retrieve,
        update: async () => { cleared++; },
      },
    };
    assert.equal(await finalizePaidStripeRecovery({
      invoiceId: ownerInvoice,
      subscriptionId,
      stripeClient: successfulStripe,
      mutateBilling: true,
    }), true);
    assert.equal(cleared, 1);
  } finally {
    await removeTestUser(userId);
  }
});