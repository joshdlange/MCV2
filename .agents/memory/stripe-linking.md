---
name: Stripe subscription linking & reconciliation
description: Why Stripe payments could complete without upgrading the user, and the guardrails now in place
---
The July 2026 unlinked-subscription cluster happened because the Stripe dashboard pointed at `/api/stripe/webhook`, which only had a GET diagnostic — POSTs 404'd, so checkouts completed but users stayed SIDE_KICK, and some retried checkout creating duplicate subscriptions (same cardholder across multiple Stripe customers/emails).

**Why:** webhook route existed only at `/api/stripe-webhook`; nothing alerted when a paid subscription matched no user.

**How to apply:**
- Webhook POST is now registered at BOTH paths; never remove either.
- Linking resolves metadata userId → client_reference_id → customer email, and emails the admin if a paid sub still can't be linked.
- `create-checkout-session` pre-checks Stripe for an existing active sub by email and links it instead of re-charging (409 alreadySubscribed).
- Daily cron (7:30 AM CT, `server/services/stripeReconcile.ts`) auto-links unambiguous unlinked subs and emails the admin about the rest. It refuses to auto-link when the user already has a sub (duplicate → human decision).
- Duplicate detection tip: Stripe customer `name` (cardholder) often identifies the same person retrying under different emails.
- Remember: prod code changes only take effect after publishing.
