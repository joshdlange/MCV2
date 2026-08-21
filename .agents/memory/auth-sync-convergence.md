---
name: Auth sync must converge
description: Reliability boundary between Firebase authentication and the application's production user record.
---

Treat Firebase authentication and backend account creation as one login boundary. A collector must not enter authenticated app routes until `/api/auth/sync` returns a valid backend user. Clear persisted user state before syncing, retry transient failures, and show a recovery screen rather than allowing a Firebase-only session.

Backend user creation must be idempotent across concurrent requests. Requests for the same Firebase UID converge on one row, while an unrelated user already owning the email-prefix username receives a deterministic unique fallback instead of causing account creation to fail.

**Why:** A production collector successfully authenticated with Firebase but had no `users` row because their email prefix was already another collector's username. The client ignored the 500 sync response and exposed the app anyway, leaving every user-owned action broken.

**How to apply:** Keep Firebase UID as the account identity and never merge users based only on username or email prefix. Any new auth provider or login path must use the same backend-sync gate and must not set the authenticated app user before backend sync succeeds.