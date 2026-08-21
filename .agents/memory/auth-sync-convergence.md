---
name: Auth sync must converge
description: Reliability boundary between Firebase authentication and the application's production user record.
---

Treat Firebase authentication and backend account creation as one login boundary. A collector must not enter authenticated app routes until `/api/auth/sync` returns a valid backend user. Clear persisted user state before syncing. During deployment, `APP_STARTING`, token-network errors, and transport failures must retry automatically behind the loading gate rather than requiring a click or reload.

Backend user creation must be idempotent across concurrent requests. Requests for the same Firebase UID converge on one row, while an unrelated user already owning the email-prefix username receives a deterministic unique fallback instead of causing account creation to fail.

The sync endpoint must derive UID, email, display name, and photo only from a verified Firebase ID token plus the canonical Firebase Admin user record. Never trust identity fields from the request body.

Production startup may recover Firebase-only identities automatically only when neither their UID nor normalized email exists in the database. Same-email/different-UID identities require manual reconciliation and must never be auto-merged. Required recovery finishes before readiness; exhausted failures must keep the deployment unready.

**Why:** A production collector successfully authenticated with Firebase but had no `users` row because their email prefix was already another collector's username. The client ignored the 500 sync response and exposed the app anyway, leaving every user-owned action broken. A review also found that trusting request-body identity fields made the old sync endpoint impersonable.

**How to apply:** Keep Firebase UID as the account identity and never merge users based only on username or email prefix. Any new auth provider or login path must use the verified backend-sync gate and must not set the authenticated app user before backend sync succeeds.