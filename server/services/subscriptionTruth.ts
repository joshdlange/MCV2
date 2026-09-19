import { randomUUID } from "node:crypto";
import { CronJob } from "cron";
import Stripe from "stripe";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { verifyRcEntitlement, SYSTEM_USER_FIREBASE_UID } from "./revenueCatSync";

export const RECOVERY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 4;

export type SubscriptionProvider = "stripe" | "apple" | "complimentary" | "unknown";
export type SubscriptionTruthStatus =
  | "paying"
  | "complimentary"
  | "cancellation_scheduled"
  | "payment_declined"
  | "churned_canceled"
  | "churned_declined"
  | "unknown";

export interface SubscriptionTruthOverview {
  summary: {
    paying: number;
    complimentary: number;
    cancellationScheduled: number;
    paymentDeclined: number;
    churnedCanceled: number;
    churnedDeclined: number;
    unknown: number;
  };
  customers: Array<{
    userId: number;
    username: string | null;
    email: string | null;
    provider: SubscriptionProvider;
    status: SubscriptionTruthStatus;
    reason: string;
    changedAt: string | null;
    recoveryEndsAt: string | null;
  }>;
  events: Array<{
    id: number;
    userId: number;
    username: string | null;
    type: string;
    reason: string;
    occurredAt: string;
    provider: SubscriptionProvider;
  }>;
}

export interface TruthTransition {
  provider: "stripe" | "apple";
  providerEventId: string;
  userId: number;
  type: string;
  status: SubscriptionTruthStatus;
  reason: string;
  occurredAt: Date;
  recoveryEndsAt?: Date | null;
}

let overviewCache: { value: SubscriptionTruthOverview; at: number } | null = null;
let overviewInFlight: Promise<SubscriptionTruthOverview> | null = null;
const OVERVIEW_TTL_MS = 5 * 60 * 1000;

/** Pure stale-event rule, exported so the critical ordering behavior is testable. */
export function shouldApplyTransition(currentOccurredAt: Date | null, incomingOccurredAt: Date): boolean {
  return !currentOccurredAt || incomingOccurredAt.getTime() >= currentOccurredAt.getTime();
}

export type RecoveryDecision = "recovered" | "canceled" | "expire" | "wait" | "retry";
export function decideRecovery(input: {
  paid: boolean;
  canceled: boolean;
  now: Date;
  recoveryEndsAt: Date;
  attemptCount: number;
  declineCode?: string | null;
}): RecoveryDecision {
  if (input.canceled) return "canceled";
  if (input.paid) return "recovered";
  if (input.now.getTime() >= input.recoveryEndsAt.getTime()) return "expire";
  // Hard declines / required authentication are not safely chargeable, but the
  // member keeps the remainder of the five-day grace period.
  if (isNonRetryableDecline(input.declineCode)) return "wait";
  if (input.attemptCount >= MAX_RECOVERY_ATTEMPTS) return "wait";
  return "retry";
}

export function summarizeTruthStatuses(statuses: SubscriptionTruthStatus[]): SubscriptionTruthOverview["summary"] {
  const result = {
    paying: 0, complimentary: 0, cancellationScheduled: 0, paymentDeclined: 0,
    churnedCanceled: 0, churnedDeclined: 0, unknown: 0,
  };
  for (const status of statuses) {
    // Scheduled cancellations are still paid/entitled through period end.
    // `cancellationScheduled` is a diagnostic subset, not a subtraction from
    // the paying headline (e.g. 26 renewing + 3 scheduled = 29 paying).
    if (status === "paying" || status === "cancellation_scheduled") result.paying++;
    if (status === "paying") continue;
    if (status === "complimentary") result.complimentary++;
    else if (status === "cancellation_scheduled") result.cancellationScheduled++;
    else if (status === "payment_declined") result.paymentDeclined++;
    else if (status === "churned_canceled") result.churnedCanceled++;
    else if (status === "churned_declined") result.churnedDeclined++;
    else result.unknown++;
  }
  return result;
}

export function classifyAppleLifecycle(input: {
  entitlementActive: boolean;
  unsubscribeDetectedAt?: string | null;
  billingIssuesDetectedAt?: string | null;
  expiresAt?: string | null;
  now: Date;
}): SubscriptionTruthStatus | null {
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.entitlementActive) {
    if (input.billingIssuesDetectedAt) return "payment_declined";
    if (input.unsubscribeDetectedAt) return "cancellation_scheduled";
    return "paying";
  }
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= input.now) {
    return input.billingIssuesDetectedAt ? "churned_declined" : "churned_canceled";
  }
  return null;
}

export function shouldVerifyAppleAfterStripeStatus(status: SubscriptionTruthStatus): boolean {
  return status === "churned_canceled" || status === "churned_declined" || status === "unknown";
}

/**
 * Append provider evidence exactly once and update that provider's snapshot only
 * when it is not older than the evidence already applied.
 */
export async function recordSubscriptionTransition(input: TruthTransition): Promise<{ duplicate: boolean; applied: boolean }> {
  const result = await db.transaction(async (tx) => {
    const inserted = await tx.execute(sql`
      INSERT INTO subscription_truth_events
        (provider, provider_event_id, user_id, type, reason, occurred_at, applied)
      VALUES
        (${input.provider}, ${input.providerEventId}, ${input.userId}, ${input.type},
         ${input.reason}, ${input.occurredAt}, false)
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
    `);
    if (!(inserted as any).rows?.length) {
      const current = await tx.execute(sql`
        SELECT 1 FROM subscription_truth_snapshots
        WHERE user_id = ${input.userId} AND provider = ${input.provider}
          AND evidence_id = ${input.providerEventId}
        LIMIT 1
      `);
      return { duplicate: true, applied: !!(current as any).rows?.length };
    }

    const applied = await tx.execute(sql`
      INSERT INTO subscription_truth_snapshots
        (user_id, provider, status, reason, provider_occurred_at, recovery_ends_at, evidence_id, updated_at)
      VALUES
        (${input.userId}, ${input.provider}, ${input.status}, ${input.reason},
         ${input.occurredAt}, ${input.recoveryEndsAt ?? null}, ${input.providerEventId}, now())
      ON CONFLICT (user_id, provider) DO UPDATE SET
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        provider_occurred_at = EXCLUDED.provider_occurred_at,
        recovery_ends_at = EXCLUDED.recovery_ends_at,
        evidence_id = EXCLUDED.evidence_id,
        updated_at = now()
      WHERE subscription_truth_snapshots.provider_occurred_at < EXCLUDED.provider_occurred_at
         OR (
           subscription_truth_snapshots.provider_occurred_at = EXCLUDED.provider_occurred_at
           AND CASE EXCLUDED.status
             WHEN 'churned_declined' THEN 7 WHEN 'churned_canceled' THEN 7
             WHEN 'cancellation_scheduled' THEN 6 WHEN 'paying' THEN 5
             WHEN 'payment_declined' THEN 4 WHEN 'complimentary' THEN 3 ELSE 1
           END >= CASE subscription_truth_snapshots.status
             WHEN 'churned_declined' THEN 7 WHEN 'churned_canceled' THEN 7
             WHEN 'cancellation_scheduled' THEN 6 WHEN 'paying' THEN 5
             WHEN 'payment_declined' THEN 4 WHEN 'complimentary' THEN 3 ELSE 1
           END
         )
      RETURNING id
    `);
    const didApply = !!(applied as any).rows?.length;
    if (didApply) {
      await tx.execute(sql`
        UPDATE subscription_truth_events SET applied = true
        WHERE provider = ${input.provider} AND provider_event_id = ${input.providerEventId}
      `);
    }
    return { duplicate: false, applied: didApply };
  });
  if (result.applied) overviewCache = null;
  return result;
}

export async function setTransitionRecoveryEnd(providerEventId: string, recoveryEndsAt: Date): Promise<void> {
  await db.execute(sql`
    UPDATE subscription_truth_snapshots
    SET recovery_ends_at = ${recoveryEndsAt}, updated_at = now()
    WHERE provider = 'stripe' AND evidence_id = ${providerEventId}
  `);
  overviewCache = null;
}

export async function processStripePaymentFailure(input: {
  eventId: string;
  occurredAt: Date;
  invoiceId: string;
  subscriptionId: string;
  userId: number;
  stripeClient: Pick<Stripe, "subscriptions" | "invoices">;
  mutateBilling: boolean;
}): Promise<{ recoveryEndsAt: Date | null; ignored: boolean }> {
  // Provider verification is intentionally before every state/mutation. A
  // failure rejects so the webhook responds 500 and Stripe retries.
  const latestSub = await input.stripeClient.subscriptions.retrieve(input.subscriptionId);
  const managedDeadline = latestSub.cancel_at
    ? await isStripeRecoveryDeadline(input.subscriptionId, latestSub.cancel_at)
    : false;
  if (latestSub.cancel_at_period_end || (latestSub.cancel_at && !managedDeadline) || latestSub.status === "canceled") {
    await stopStripeRecovery(input.subscriptionId, "canceled");
    return { recoveryEndsAt: null, ignored: true };
  }
  if (!["past_due", "unpaid", "incomplete"].includes(latestSub.status)) {
    // An old failure delivered after provider recovery must not recreate a
    // decline episode merely because its event timestamp is newer locally.
    return { recoveryEndsAt: null, ignored: true };
  }
  const transition = await recordSubscriptionTransition({
    provider: "stripe",
    providerEventId: input.eventId,
    userId: input.userId,
    type: "payment_failed",
    status: "payment_declined",
    reason: "Stripe subscription invoice payment failed",
    occurredAt: input.occurredAt,
  });
  if (!transition.applied) return { recoveryEndsAt: null, ignored: true };
  const recoveryEndsAt = await beginStripeRecovery({
    invoiceId: input.invoiceId,
    subscriptionId: input.subscriptionId,
    userId: input.userId,
    failedAt: input.occurredAt,
  });
  if (recoveryEndsAt) await setTransitionRecoveryEnd(input.eventId, recoveryEndsAt);
  if (recoveryEndsAt && input.mutateBilling) {
    await input.stripeClient.invoices.update(input.invoiceId, { auto_advance: false });
    await input.stripeClient.subscriptions.update(
      input.subscriptionId,
      { cancel_at: Math.floor(recoveryEndsAt.getTime() / 1000) },
      { idempotencyKey: `mcv-recovery-deadline:${input.invoiceId}` },
    );
  }
  return { recoveryEndsAt, ignored: false };
}

function stripeStatus(sub: Stripe.Subscription): { status: SubscriptionTruthStatus; reason: string } {
  if (sub.cancel_at_period_end || sub.cancel_at) {
    return { status: "cancellation_scheduled", reason: "Stripe cancellation is scheduled; recovery is stopped" };
  }
  if (sub.status === "active" || sub.status === "trialing") {
    return { status: "paying", reason: `Stripe subscription is ${sub.status}` };
  }
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") {
    return { status: "payment_declined", reason: `Stripe subscription is ${sub.status}` };
  }
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    return { status: "churned_canceled", reason: `Stripe subscription is ${sub.status}` };
  }
  return { status: "unknown", reason: `Unrecognized Stripe subscription status: ${sub.status}` };
}

function chooseUnified(rows: any[]): any | null {
  if (!rows.length) return null;
  const priority: Record<SubscriptionTruthStatus, number> = {
    paying: 7,
    cancellation_scheduled: 6,
    payment_declined: 5,
    complimentary: 4,
    unknown: 4,
    churned_declined: 3,
    churned_canceled: 2,
  };
  return [...rows].sort((a, b) =>
    (priority[b.status as SubscriptionTruthStatus] - priority[a.status as SubscriptionTruthStatus]) ||
    new Date(b.provider_occurred_at).getTime() - new Date(a.provider_occurred_at).getTime()
  )[0];
}

/**
 * Exact admin view. Durable provider snapshots win. Legacy rows are checked
 * against providers; a customer id by itself is never evidence of payment.
 * No lifecycle event is synthesized for pre-ledger history.
 */
export async function getSubscriptionTruthOverview(): Promise<SubscriptionTruthOverview> {
  if (overviewCache && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) return overviewCache.value;
  if (overviewInFlight) return overviewInFlight;
  overviewInFlight = computeSubscriptionTruthOverview().finally(() => { overviewInFlight = null; });
  return overviewInFlight;
}

async function computeSubscriptionTruthOverview(): Promise<SubscriptionTruthOverview> {
  const [allUsers, snapshotsResult] = await Promise.all([
    storage.getAllUsers(),
    db.execute(sql`SELECT * FROM subscription_truth_snapshots`),
  ]);
  const snapshots = (snapshotsResult as any).rows as any[];
  const byUser = new Map<number, any[]>();
  for (const row of snapshots) {
    const list = byUser.get(Number(row.user_id)) || [];
    list.push(row);
    byUser.set(Number(row.user_id), list);
  }

  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const customers: SubscriptionTruthOverview["customers"] = [];
  for (const user of allUsers) {
    if (user.firebaseUid === SYSTEM_USER_FIREBASE_UID) continue;
    const durableRows = byUser.get(user.id) || [];
    let current = chooseUnified(durableRows);

    // A linked subscription id is only a lookup key, never proof by itself.
    if (user.stripeSubscriptionId) {
      const nonStripeRows = durableRows.filter((row) => row.provider !== "stripe");
      const stripeSnapshot = durableRows.find((row) => row.provider === "stripe");
      if (!stripe) {
        current = chooseUnified([...nonStripeRows, { provider: "unknown", status: "unknown", reason: "Stripe verification unavailable", provider_occurred_at: null, recovery_ends_at: null }]);
      } else {
        try {
          const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          const snapshotEnd = stripeSnapshot?.recovery_ends_at
            ? new Date(stripeSnapshot.recovery_ends_at).getTime()
            : null;
          const managedDeadline = !!(
            sub.cancel_at && snapshotEnd
            && Math.abs(sub.cancel_at * 1000 - snapshotEnd) < 2_000
            && stripeSnapshot?.status === "payment_declined"
          );
          const mapped = managedDeadline
            ? { status: "payment_declined" as const, reason: stripeSnapshot.reason }
            : stripeStatus(sub);
          current = chooseUnified([...nonStripeRows, {
            provider: "stripe",
            ...mapped,
            provider_occurred_at: stripeSnapshot?.provider_occurred_at || null,
            recovery_ends_at: mapped.status === "payment_declined" ? stripeSnapshot?.recovery_ends_at || null : null,
          }]);
        } catch {
          current = chooseUnified([...nonStripeRows, { provider: "unknown", status: "unknown", reason: "Stripe subscription could not be verified", provider_occurred_at: null, recovery_ends_at: null }]);
        }
      }
    }

    // A stale/terminal Stripe link must never hide live Apple access. This also
    // repairs legacy cross-provider cancellations that retained the old Stripe
    // subscription id before that webhook path was fixed.
    if (
      user.firebaseUid
      && current
      && shouldVerifyAppleAfterStripeStatus(current.status)
    ) {
      const rc = await verifyRcEntitlement(user.firebaseUid);
      if (rc.ok && rc.entitlement) {
        const observedAt = rc.entitlement.purchase_date
          ? new Date(rc.entitlement.purchase_date)
          : new Date();
        current = {
          provider: "apple",
          status: "paying",
          reason: "Active Apple entitlement verified after terminal Stripe subscription",
          provider_occurred_at: observedAt,
          recovery_ends_at: null,
        };
        await recordSubscriptionTransition({
          provider: "apple",
          providerEventId: `baseline:cross-provider-active:${user.id}:${observedAt.toISOString()}`,
          userId: user.id,
          type: "active",
          status: "paying",
          reason: current.reason,
          occurredAt: observedAt,
        });
      } else if (!rc.ok) {
        current = {
          provider: "unknown",
          status: "unknown",
          reason: "Stripe is terminal and Apple entitlement verification is unavailable",
          provider_occurred_at: current.provider_occurred_at,
          recovery_ends_at: null,
        };
      }
    }

    if (!user.stripeSubscriptionId && user.plan === "SUPER_HERO") {
      if (user.firebaseUid) {
        const rc = await verifyRcEntitlement(user.firebaseUid);
        if (!rc.ok) {
          current = { provider: "unknown", status: "unknown", reason: "Apple entitlement verification unavailable", provider_occurred_at: null, recovery_ends_at: null };
        } else if (rc.entitlement) {
          const appleSnapshot = durableRows.find((row) => row.provider === "apple");
          const lifecycle = rc.lifecycle;
          const billingAt = lifecycle?.billing_issues_detected_at ? new Date(lifecycle.billing_issues_detected_at) : null;
          const canceledAt = lifecycle?.unsubscribe_detected_at ? new Date(lifecycle.unsubscribe_detected_at) : null;
          if (billingAt && !Number.isNaN(billingAt.getTime())) {
            current = { provider: "apple", status: "payment_declined", reason: "Apple billing issue; recovery is managed by Apple", provider_occurred_at: billingAt, recovery_ends_at: lifecycle?.expires_date || null };
            await recordSubscriptionTransition({
              provider: "apple", providerEventId: `baseline:billing:${user.id}:${billingAt.toISOString()}`,
              userId: user.id, type: "payment_failed", status: "payment_declined",
              reason: current.reason, occurredAt: billingAt,
              recoveryEndsAt: lifecycle?.expires_date ? new Date(lifecycle.expires_date) : null,
            });
          } else if (canceledAt && !Number.isNaN(canceledAt.getTime())) {
            current = { provider: "apple", status: "cancellation_scheduled", reason: "Apple renewal canceled; access remains through paid expiry", provider_occurred_at: canceledAt, recovery_ends_at: null };
            await recordSubscriptionTransition({
              provider: "apple", providerEventId: `baseline:cancellation:${user.id}:${canceledAt.toISOString()}`,
              userId: user.id, type: "cancellation_scheduled", status: "cancellation_scheduled",
              reason: current.reason, occurredAt: canceledAt,
            });
          } else {
            current = appleSnapshot?.status === "cancellation_scheduled"
              ? appleSnapshot
              : { provider: "apple", status: "paying", reason: "Active Apple entitlement verified by RevenueCat", provider_occurred_at: rc.entitlement.purchase_date || null, recovery_ends_at: null };
          }
        } else {
          const lifecycle = rc.lifecycle;
          const expiresAt = lifecycle?.expires_date ? new Date(lifecycle.expires_date) : null;
          if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= new Date()) {
            const declined = !!lifecycle?.billing_issues_detected_at;
            current = {
              provider: "apple",
              status: declined ? "churned_declined" : "churned_canceled",
              reason: declined ? "Apple entitlement expired after billing issue" : "Apple entitlement expired after cancellation",
              provider_occurred_at: expiresAt,
              recovery_ends_at: null,
            };
            await recordSubscriptionTransition({
              provider: "apple", providerEventId: `baseline:expiration:${user.id}:${expiresAt.toISOString()}`,
              userId: user.id, type: "expired", status: current.status,
              reason: current.reason, occurredAt: expiresAt,
            });
          } else {
            const durableApple = durableRows.find((row) => row.provider === "apple");
            current = durableApple && ["churned_canceled", "churned_declined", "payment_declined"].includes(durableApple.status)
              ? durableApple
              : { provider: "complimentary", status: "complimentary", reason: "Super Hero access with no active provider entitlement", provider_occurred_at: user.upgradedAt || null, recovery_ends_at: null };
          }
        }
      } else {
        current = { provider: "complimentary", status: "complimentary", reason: "Super Hero access granted without a billing identity", provider_occurred_at: user.upgradedAt || null, recovery_ends_at: null };
      }
    }
    if (!current && (user.stripeCustomerId || user.appleOriginalTransactionId || user.subscriptionStatus === "cancelled")) {
      current = {
        provider: "unknown",
        status: "unknown",
        reason: "Legacy billing marker has no durable provider lifecycle evidence",
        provider_occurred_at: null,
        recovery_ends_at: null,
      };
    }
    if (!current) continue; // ordinary free accounts are not subscription customers

    customers.push({
      userId: user.id,
      username: user.username,
      email: user.email,
      provider: current.provider,
      status: current.status,
      reason: current.reason,
      changedAt: current.provider_occurred_at ? new Date(current.provider_occurred_at).toISOString() : null,
      recoveryEndsAt: current.recovery_ends_at ? new Date(current.recovery_ends_at).toISOString() : null,
    });
  }

  const summary = summarizeTruthStatuses(customers.map((c) => c.status));
  const eventsResult = await db.execute(sql`
    SELECT e.id, e.user_id, u.username, e.type, e.reason, e.occurred_at, e.provider
    FROM subscription_truth_events e
    JOIN users u ON u.id = e.user_id
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 500
  `);
  const events = ((eventsResult as any).rows as any[]).map((e) => ({
    id: Number(e.id),
    userId: Number(e.user_id),
    username: e.username,
    type: e.type,
    reason: e.reason,
    occurredAt: new Date(e.occurred_at).toISOString(),
    provider: e.provider,
  }));
  const value = { summary, customers, events };
  overviewCache = { value, at: Date.now() };
  return value;
}

export function isNonRetryableDecline(code?: string | null): boolean {
  return !!code && new Set([
    "authentication_required", "card_not_supported", "currency_not_supported",
    "do_not_honor", "fraudulent", "incorrect_number", "invalid_account",
    "lost_card", "pickup_card", "restricted_card", "revocation_of_authorization",
    "stolen_card",
  ]).has(code);
}

/** Own recovery for one failed Stripe subscription invoice. */
export async function beginStripeRecovery(input: {
  invoiceId: string; subscriptionId: string; userId: number; failedAt: Date;
}): Promise<Date | null> {
  return db.transaction(async (tx) => {
    // One recovery episode per subscription. The advisory lock makes two
    // concurrent failed invoices share the earliest window rather than each
    // opening a fresh five days.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.subscriptionId}))`);
    const blocked = await tx.execute(sql`
      SELECT 1 FROM subscription_truth_snapshots
      WHERE user_id = ${input.userId} AND provider = 'stripe'
        AND status IN ('cancellation_scheduled', 'churned_canceled', 'churned_declined')
        AND provider_occurred_at >= ${input.failedAt}
      LIMIT 1
    `);
    if ((blocked as any).rows?.length) return null;

    const active = await tx.execute(sql`
      SELECT invoice_id, first_failed_at, recovery_ends_at FROM stripe_recovery_claims
      WHERE subscription_id = ${input.subscriptionId} AND status IN ('pending', 'claimed')
      ORDER BY first_failed_at ASC LIMIT 1
    `);
    const activeRow = (active as any).rows?.[0];
    if (activeRow) {
      if (input.failedAt.getTime() < new Date(activeRow.first_failed_at).getTime()) {
        const earlierEnd = new Date(input.failedAt.getTime() + RECOVERY_WINDOW_MS);
        const earlierNext = new Date(input.failedAt.getTime() + RETRY_INTERVAL_MS);
        await tx.execute(sql`
          UPDATE stripe_recovery_claims
          SET first_failed_at = ${input.failedAt}, recovery_ends_at = ${earlierEnd},
            next_attempt_at = LEAST(COALESCE(next_attempt_at, ${earlierNext}), ${earlierNext}),
            updated_at = now()
          WHERE invoice_id = ${activeRow.invoice_id}
        `);
        return earlierEnd;
      }
      return new Date(activeRow.recovery_ends_at);
    }

    const recoveryEndsAt = new Date(input.failedAt.getTime() + RECOVERY_WINDOW_MS);
    const nextAttemptAt = new Date(input.failedAt.getTime() + RETRY_INTERVAL_MS);
    await tx.execute(sql`
      INSERT INTO stripe_recovery_claims
        (invoice_id, user_id, subscription_id, first_failed_at, recovery_ends_at, next_attempt_at)
      VALUES (${input.invoiceId}, ${input.userId}, ${input.subscriptionId}, ${input.failedAt}, ${recoveryEndsAt}, ${nextAttemptAt})
      ON CONFLICT (invoice_id) DO NOTHING
    `);
    const existing = await tx.execute(sql`
      SELECT recovery_ends_at FROM stripe_recovery_claims WHERE invoice_id = ${input.invoiceId}
    `);
    const row = (existing as any).rows?.[0];
    return row ? new Date(row.recovery_ends_at) : null;
  });
}

// Subscription-wide stop is intentionally cancellation-only. Successful
// payment must always use exact-invoice finalization.
export async function stopStripeRecovery(subscriptionId: string, status: "canceled"): Promise<void> {
  await db.execute(sql`
    UPDATE stripe_recovery_claims
    SET status = ${status}, next_attempt_at = NULL, claim_token = NULL, claimed_at = NULL, updated_at = now()
    WHERE subscription_id = ${subscriptionId} AND status IN ('pending', 'claimed')
  `);
}

export async function stopStripeRecoveryForInvoice(invoiceId: string, status: "recovered" | "canceled"): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE stripe_recovery_claims
    SET status = ${status}, next_attempt_at = NULL, claim_token = NULL, claimed_at = NULL, updated_at = now()
    WHERE invoice_id = ${invoiceId} AND status IN ('pending', 'claimed')
    RETURNING invoice_id
  `);
  return !!(result as any).rows?.length;
}

export async function isActiveStripeRecoveryInvoice(invoiceId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM stripe_recovery_claims
    WHERE invoice_id = ${invoiceId} AND status IN ('pending', 'claimed')
    LIMIT 1
  `);
  return !!(result as any).rows?.length;
}

export async function hasActiveStripeRecovery(subscriptionId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM stripe_recovery_claims
    WHERE subscription_id = ${subscriptionId} AND status IN ('pending', 'claimed')
    LIMIT 1
  `);
  return !!(result as any).rows?.length;
}

async function hasOtherActiveStripeRecovery(subscriptionId: string, invoiceId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM stripe_recovery_claims
    WHERE subscription_id = ${subscriptionId} AND invoice_id <> ${invoiceId}
      AND status IN ('pending', 'claimed')
    LIMIT 1
  `);
  return !!(result as any).rows?.length;
}

export async function finalizePaidStripeRecovery(input: {
  invoiceId: string;
  subscriptionId: string;
  stripeClient: Pick<Stripe, "subscriptions">;
  mutateBilling: boolean;
}): Promise<boolean> {
  if (!await isActiveStripeRecoveryInvoice(input.invoiceId)) return false;
  const otherActive = await hasOtherActiveStripeRecovery(input.subscriptionId, input.invoiceId);
  if (input.mutateBilling && !otherActive) {
    // Re-read immediately before clearing. Never erase a customer's own
    // cancellation (period-end or a cancel_at that is not our deadline).
    const latest = await input.stripeClient.subscriptions.retrieve(input.subscriptionId);
    const managedDeadline = latest.cancel_at
      ? await isStripeRecoveryDeadline(input.subscriptionId, latest.cancel_at)
      : false;
    if (!latest.cancel_at_period_end && managedDeadline && latest.status !== "canceled") {
      await input.stripeClient.subscriptions.update(
        input.subscriptionId,
        { cancel_at: "" },
        { idempotencyKey: `mcv-recovery-clear-deadline:${input.invoiceId}` },
      );
    }
  }
  return stopStripeRecoveryForInvoice(input.invoiceId, "recovered");
}

export async function isStripeRecoveryDeadline(subscriptionId: string, cancelAtSeconds: number | null): Promise<boolean> {
  if (!cancelAtSeconds) return false;
  const result = await db.execute(sql`
    SELECT 1 FROM stripe_recovery_claims
    WHERE subscription_id = ${subscriptionId} AND status IN ('pending', 'claimed')
      AND ABS(EXTRACT(EPOCH FROM recovery_ends_at) - ${cancelAtSeconds}) < 2
    LIMIT 1
  `);
  return !!(result as any).rows?.length;
}

export async function stripeRecoveryEndedByDecline(subscriptionId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM stripe_recovery_claims
    WHERE subscription_id = ${subscriptionId} AND status = 'expired'
    LIMIT 1
  `);
  return !!(result as any).rows?.length;
}

async function runRecoveryCycle(): Promise<void> {
  // Never mutate live billing from a workspace/dev process.
  if (process.env.NODE_ENV !== "production" || !process.env.STRIPE_SECRET_KEY) return;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const token = randomUUID();
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE stripe_recovery_claims
      SET status = 'pending', claim_token = NULL, claimed_at = NULL, updated_at = now()
      WHERE status = 'claimed' AND claimed_at < now() - interval '30 minutes'
    `);
    const result = await tx.execute(sql`
      SELECT invoice_id FROM stripe_recovery_claims
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED LIMIT 10
    `);
    const ids = (result as any).rows.map((r: any) => r.invoice_id);
    if (!ids.length) return [];
    const rows: any[] = [];
    // Keep each value parameterized and avoid an empty/raw ANY(array) edge.
    for (const invoiceId of ids) {
      const updated = await tx.execute(sql`
        UPDATE stripe_recovery_claims
        SET status = 'claimed', claim_token = ${token}, claimed_at = now(), updated_at = now()
        WHERE invoice_id = ${invoiceId} AND status = 'pending'
        RETURNING *
      `);
      rows.push(...((updated as any).rows || []));
    }
    return rows;
  });

  for (const claim of claimed) {
    const attemptNumber = Number(claim.attempt_count) + 1;
    const key = `mcv-recovery:${claim.invoice_id}:${attemptNumber}`;
    try {
      const [sub, invoice] = await Promise.all([
        stripe.subscriptions.retrieve(claim.subscription_id),
        stripe.invoices.retrieve(claim.invoice_id, { expand: ["payment_intent"] }),
      ]);
      const managedDeadline = sub.cancel_at
        ? await isStripeRecoveryDeadline(sub.id, sub.cancel_at)
        : false;
      if (sub.cancel_at_period_end || (sub.cancel_at && !managedDeadline) || sub.status === "canceled") {
        await stopStripeRecovery(sub.id, "canceled");
        continue;
      }
      if (invoice.status === "paid") {
        await finalizePaidStripeRecovery({
          invoiceId: claim.invoice_id,
          subscriptionId: sub.id,
          stripeClient: stripe,
          mutateBilling: true,
        });
        continue;
      }
      const declineCode = (invoice as any).payment_intent?.last_payment_error?.decline_code
        || (invoice as any).payment_intent?.last_payment_error?.code;
      const decision = decideRecovery({
        paid: false,
        canceled: false,
        now: new Date(),
        recoveryEndsAt: new Date(claim.recovery_ends_at),
        attemptCount: attemptNumber - 1,
        declineCode,
      });
      if (decision === "wait") {
        await db.execute(sql`
          UPDATE stripe_recovery_claims SET status = 'pending', next_attempt_at = recovery_ends_at,
            claim_token = NULL, claimed_at = NULL, last_error = ${declineCode || "retry limit reached"}, updated_at = now()
          WHERE invoice_id = ${claim.invoice_id}
        `);
        continue;
      }
      if (decision === "expire") {
        // auto_advance was disabled when recovery began, so deleting the
        // subscription ends access and guarantees no further invoice retries.
        await stripe.subscriptions.cancel(sub.id, {}, { idempotencyKey: `mcv-recovery-cancel:${claim.invoice_id}` });
        await db.execute(sql`UPDATE stripe_recovery_claims SET status = 'expired', next_attempt_at = NULL, last_error = ${declineCode || "recovery window expired"}, updated_at = now() WHERE invoice_id = ${claim.invoice_id}`);
        continue;
      }
      await db.execute(sql`
        INSERT INTO stripe_recovery_attempts (invoice_id, attempt_number, idempotency_key)
        VALUES (${claim.invoice_id}, ${attemptNumber}, ${key})
        ON CONFLICT (invoice_id, attempt_number) DO NOTHING
      `);
      await stripe.invoices.pay(claim.invoice_id, {}, { idempotencyKey: key });
      await db.execute(sql`UPDATE stripe_recovery_attempts SET status = 'succeeded' WHERE idempotency_key = ${key}`);
      await finalizePaidStripeRecovery({
        invoiceId: claim.invoice_id,
        subscriptionId: sub.id,
        stripeClient: stripe,
        mutateBilling: true,
      });
    } catch (error: any) {
      await db.execute(sql`UPDATE stripe_recovery_attempts SET status = 'failed', error = ${error?.message || "payment failed"} WHERE idempotency_key = ${key}`);
      const errorCode = error?.decline_code || error?.code;
      if (isNonRetryableDecline(errorCode)) {
        await db.execute(sql`
          UPDATE stripe_recovery_claims SET status = 'pending', next_attempt_at = recovery_ends_at,
            claim_token = NULL, claimed_at = NULL, last_error = ${errorCode}, updated_at = now()
          WHERE invoice_id = ${claim.invoice_id}
        `);
        continue;
      }
      const next = new Date(Date.now() + RETRY_INTERVAL_MS);
      await db.execute(sql`
        UPDATE stripe_recovery_claims SET status = 'pending', attempt_count = ${attemptNumber},
          next_attempt_at = CASE WHEN ${next} < recovery_ends_at THEN ${next} ELSE recovery_ends_at END,
          claim_token = NULL, claimed_at = NULL, last_error = ${error?.message || "payment failed"}, updated_at = now()
        WHERE invoice_id = ${claim.invoice_id}
      `);
    }
  }
}

let recoveryCronStarted = false;
export function startStripeRecoveryCron(): void {
  if (recoveryCronStarted || process.env.NODE_ENV !== "production") return;
  recoveryCronStarted = true;
  new CronJob("*/15 * * * *", () => runRecoveryCycle().catch((e) => console.error("[Stripe Recovery]", e)), null, true, "America/Chicago");
}
