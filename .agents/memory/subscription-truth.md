---
name: Subscription reporting and recovery semantics
description: Shared meanings for paying, cancellation, decline, and complimentary access across admin reporting.
---

Paying customers include customers who turned off renewal but still have paid time remaining. Cancellation scheduled is a subset, not an additional paying cohort. Payment decline/recovery and terminal canceled/declined churn must remain distinct. A provider customer ID or Super Hero plan alone is not proof of payment.

**Why:** A live Apple expiration reduced the provider-derived paying count while the application still granted Super Hero access. The old dashboard classified the expired subscription as complimentary and the funnel missed the churn. Inconsistent definitions concealed the customer movement.

**How to apply:** Reconcile provider lifecycle evidence, preserve timestamped transitions, and surface unknown verification states explicitly. Never classify an expired paid subscription as complimentary merely because its current entitlement is absent. Do not fabricate pre-tracking events or call a mixed lifetime cancellation fraction monthly churn.

The user chose a maximum five-day payment recovery window, ending on customer cancellation. Apple billing retries remain store-managed. Stripe recovery must have one automation owner, durable per-invoice attempts, and one earliest deadline for a subscription's recovery episode.

**Why:** Competing retries or resetting the window on repeated provider notifications can cause unwanted charges. A hard decline can require customer action rather than another charge attempt.

**How to apply:** Never charge from development verification. Test cancellation, duplicate/out-of-order notifications, recovery after a crash, hard declines, and cross-provider entitlements before changing billing automation.