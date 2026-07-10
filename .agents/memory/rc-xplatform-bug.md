---
name: RevenueCat X-Platform server-side bug
description: RC v1 REST API rejects secret keys with error 7243 if X-Platform header is included in server-side calls; also returns 200-with-error-body
---

# RevenueCat Server-Side REST API Pitfalls

## Rule 1: Never send X-Platform from the server
Do not include `X-Platform: ios` (or any X-Platform value) in **server-side** RevenueCat REST API calls. Only send `Authorization` + `Content-Type`.

**Why:** RC v1 REST API uses `X-Platform` to decide the caller is a mobile client, then rejects secret keys (`sk_...`) with error code 7243 — "Secret API keys should not be used in your app." This silently broke all iOS activations (server returned failure, client didn't check it).

**How to apply:** Any fetch to `api.revenuecat.com/v1/subscribers/...` from `server/` must omit X-Platform.

## Rule 2: RC returns HTTP 200 with an error body
A failed RC lookup can come back as **HTTP 200** carrying `{ code, message }` (the 7243 case), not a network error. Checking only `res.ok` treats these as success and silently skips the user.

**Why:** An audit/lookup that only inspects `res.ok` will report false "all clear" while every lookup actually failed.

**How to apply:** After `res.json()`, treat `!res.ok || !body || typeof body.code === 'number'` as a failed check and count/surface those errors separately from "no entitlement found." Note RC returns **HTTP 201** (auto-creates an empty subscriber) for UIDs it hasn't seen — treat 201 like 200, not an error.

## Rule 3: Never rely on the client `activate` call alone for iOS upgrades
iOS upgrades must survive a missed/failed client `POST /api/revenuecat/activate`. The durable path is a **server-to-server RevenueCat webhook** (`POST /api/revenuecat/webhook`) plus a **daily reconcile cron** safety net that scans non-SUPER_HERO users and upgrades anyone with an active `super_hero` entitlement. Shared logic lives in `server/services/revenueCatSync.ts`.

**Why:** The whole "iOS payers stuck on SIDE_KICK" incident happened because activation depended solely on the client. One bug (or a closed app) = silent paid-but-not-upgraded users.

**How to apply:** Webhook must (a) require `REVENUECAT_WEBHOOK_SECRET` in production (reject if unset), (b) re-verify the entitlement via REST before ANY plan change, (c) on revoke, only downgrade when `verify.ok === true && !entitlement` AND the user has no Stripe sub — a failed lookup must return 500 for RC retry, never a downgrade.

## Rule 4: Exclude the system account from paid-user counts
`SYSTEM_USER_MCV` (firebase_uid) is granted SUPER_HERO for messaging but is NOT a customer. Any "paid users" count (admin stats, funnel `upgraded`) must add `AND (firebase_uid IS NULL OR firebase_uid != 'SYSTEM_USER_MCV')`.

## Rule 5: SUPER_HERO plan ≠ paying customer — three distinct buckets
A user on the SUPER_HERO plan can be a Stripe payer, an Apple/RevenueCat payer, OR a comped/admin free grant. The DB only records Stripe (`stripe_subscription_id`) directly; there is NO stored column marking Apple-vs-comped, so the only way to tell an iPhone payer from a comped grant is to ask RevenueCat per user.

**Why:** "18 SUPER_HERO" looked like 18 paying customers but was really 1 system + 8 Stripe + 4 Apple + 5 comped. Reporting one "Paid Users" number will always be ambiguous and erode trust.

**How to apply:** For any subscriber breakdown, verify only the small no-Stripe SUPER_HERO subset against RC and **cache it** (dashboards refresh often — never hit RC per request). A failed RC lookup must go to an explicit `unknown` bucket, NOT to `comped` (guessing inflates comped). Keep buckets reconciling exactly: `free + payingStripe + payingApple + comped + unknown + system === totalUsers`.

## Prod vs dev database confusion
The Replit workspace preview uses the DEV database; the deployed marvelcardvault.com uses the PROD database — they hold different row counts. When an owner says "the numbers changed/fluctuate," first suspect they compared the dev admin against the prod admin, not a real bug. Ground-truth prod counts only via the production DB (read replica), never the dev preview.
