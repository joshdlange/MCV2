import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_WINDOW_MS,
  classifyAppleLifecycle,
  decideRecovery,
  shouldApplyTransition,
  summarizeTruthStatuses,
  shouldVerifyAppleAfterStripeStatus,
} from "../services/subscriptionTruth";

test("failed Stripe payment recovers when its invoice is paid", () => {
  const failedAt = new Date("2026-09-01T00:00:00Z");
  assert.equal(decideRecovery({
    paid: true,
    canceled: false,
    now: new Date(failedAt.getTime() + 24 * 60 * 60 * 1000),
    recoveryEndsAt: new Date(failedAt.getTime() + RECOVERY_WINDOW_MS),
    attemptCount: 1,
  }), "recovered");
});

test("failed Stripe payment expires at the five-day boundary", () => {
  const failedAt = new Date("2026-09-01T00:00:00Z");
  const recoveryEndsAt = new Date(failedAt.getTime() + RECOVERY_WINDOW_MS);
  assert.equal(decideRecovery({
    paid: false,
    canceled: false,
    now: recoveryEndsAt,
    recoveryEndsAt,
    attemptCount: 3,
  }), "expire");
});

test("cancellation immediately stops recovery, including mid-window", () => {
  const failedAt = new Date("2026-09-01T00:00:00Z");
  assert.equal(decideRecovery({
    paid: false,
    canceled: true,
    now: new Date(failedAt.getTime() + 60_000),
    recoveryEndsAt: new Date(failedAt.getTime() + RECOVERY_WINDOW_MS),
    attemptCount: 0,
  }), "canceled");
});

test("hard declines and required authentication are not blindly retried", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  for (const declineCode of ["stolen_card", "authentication_required"]) {
    assert.equal(decideRecovery({
      paid: false,
      canceled: false,
      now,
      recoveryEndsAt: new Date(now.getTime() + RECOVERY_WINDOW_MS),
      attemptCount: 0,
      declineCode,
    }), "wait");
  }
});

test("duplicate/out-of-order provider evidence cannot roll back current truth", () => {
  const current = new Date("2026-09-05T00:00:00Z");
  assert.equal(shouldApplyTransition(current, new Date("2026-09-04T23:59:59Z")), false);
  assert.equal(shouldApplyTransition(current, current), true);
  assert.equal(shouldApplyTransition(null, current), true);
});

test("complimentary access is excluded from paying customers", () => {
  const summary = summarizeTruthStatuses(["paying", "cancellation_scheduled", "complimentary", "payment_declined"]);
  assert.equal(summary.paying, 2, "scheduled cancellation remains paid through expiry");
  assert.equal(summary.cancellationScheduled, 1);
  assert.equal(summary.complimentary, 1);
  assert.equal(summary.paymentDeclined, 1);
});

test("Apple cancellation remains paying until provider expiry, then churns", () => {
  const lifecycle = {
    unsubscribeDetectedAt: "2026-09-12T02:59:27Z",
    billingIssuesDetectedAt: null,
    expiresAt: "2026-09-19T13:09:37Z",
  };
  assert.equal(classifyAppleLifecycle({
    ...lifecycle,
    entitlementActive: true,
    now: new Date("2026-09-18T00:00:00Z"),
  }), "cancellation_scheduled");
  assert.equal(classifyAppleLifecycle({
    ...lifecycle,
    entitlementActive: false,
    now: new Date("2026-09-19T13:09:38Z"),
  }), "churned_canceled");
});

test("terminal stale Stripe linkage cannot hide active Apple verification", () => {
  assert.equal(shouldVerifyAppleAfterStripeStatus("churned_canceled"), true);
  assert.equal(shouldVerifyAppleAfterStripeStatus("churned_declined"), true);
  assert.equal(shouldVerifyAppleAfterStripeStatus("unknown"), true);
  assert.equal(shouldVerifyAppleAfterStripeStatus("paying"), false);
  assert.equal(shouldVerifyAppleAfterStripeStatus("payment_declined"), false);
});