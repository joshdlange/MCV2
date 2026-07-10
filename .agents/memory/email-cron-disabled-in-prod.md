---
name: Email cron disabled in production
description: EMAIL_CRON_ENABLED is unset in all environments, so scheduled email crons never fire; marketing blasts run manually and any always-on job must be wired independently.
---

# Email cron is effectively OFF in production

`startEmailCronJobs()` early-returns unless `EMAIL_CRON_ENABLED === 'true'`. That
env var is **absent in dev, prod, and shared** (verified July 2026). So none of the
scheduled email campaigns (monthly nudges/digest, THANKS2U, one-shot vault-upgrade
`vaultUpgradeJob`, etc.) actually run on their cron schedule in production.

**Consequence:** big marketing blasts have historically been fired **manually** via
their admin endpoints (e.g. `POST /api/admin/campaigns/vault-upgrade/send`), not by
the cron. Don't assume a dated CronJob ran just because its date passed.

**Why it matters / how to apply:**
- If you need a job to run automatically regardless of that flag, wire its own
  `start...Cron()` directly at server startup in `registerRoutes` (next to
  `startRevenueCatReconcileCron()`), the way the RevenueCat reconcile cron and the
  vault-upgrade **drip** cron do — do NOT rely on `startEmailCronJobs()`.
- Do NOT flip `EMAIL_CRON_ENABLED=true` casually to "fix" one job — it would also
  activate every other dormant campaign at once (unintended blasts).

## Idempotent drip pattern (safe way to resume a blast that hit the Resend cap)
- Send with a stable `jobName`; `sendResendEmail` logs every send to `email_logs`.
- Compute "remaining" as eligible users where `NOT EXISTS` a matching
  `email_logs` row for that job_name (normalize with `lower(trim(email))`). Reusing
  the SAME job_name for the resume/drip makes it auto-dedupe and self-stop at 0.
- Guard the run with an in-process single-flight boolean so the daily cron and a
  manual "send now" trigger can't overlap and double-send.
- Resend free tier has a **daily** send cap shared with transactional mail; keep the
  daily batch (e.g. 90) below the cap with headroom.
