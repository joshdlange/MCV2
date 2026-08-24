---
name: Account deletion saga
description: Durable safety rules for deleting an account across billing, authentication, app data, and transactional email.
---

Account deletion must be a durable staged workflow, not one database transaction around external calls. Persist progress before Stripe or Firebase work, retry each idempotent stage, and only remove app data after required external stages succeed.

**Why:** Stripe, Firebase, PostgreSQL, and Resend cannot commit atomically. Pretending they can risks cancelling billing or deleting login while leaving the database account, and a send accepted before a local write can otherwise produce duplicate notices.

**How to apply:** Return a truthful pending status on partial failure; use stable provider idempotency keys for both deletion notices; retain only the minimum staged identity while work is pending; scrub it after completion. Keep only a permanent HMAC of the deleted recipient so delayed Resend webhooks can never recreate raw email PII.