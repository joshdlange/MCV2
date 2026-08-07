---
name: Lifecycle email system v1
description: How MCV lifecycle emails work — claim-then-send dedupe, 14-day cap, launch-date gate, draft journeys
---

# Lifecycle email system v1 (server/jobs/lifecycleEmails.ts)

- ACTIVE: welcome (event-triggered at onboarding completion) + 24h first-card nudge (hourly cron). 10 journey emails exist as drafts (`active:false`) — flip ONE at a time only after admin preview/test.
- **Rule: max 1 lifecycle/marketing email per user per 14 days.** Enforced via email_logs job_name namespaces `lifecycle-%` / `campaign-%`; welcome and `%-test` are exempt; transactional email never uses these namespaces so it is exempt.
- **Why:** Joshua's explicit requirement after disabling monthly blasts; protects trust with a small user base.
- **Claim-then-send pattern:** partial unique index `email_logs_lifecycle_unique_idx` on `(job_name, lower(trim(email))) WHERE job_name LIKE 'lifecycle-%' AND job_name NOT LIKE '%-test'` (exists in BOTH dev and prod). Insert a `status='sending'` claim row ON CONFLICT DO NOTHING first, send with `skipLog:true`, then update to sent/failed. Failed sends are fail-closed (never auto-retried) — check email_logs status='failed' to see them.
- **How to apply:** any new lifecycle email must use `claimAndSend`, a `lifecycle-<key>` job name, and be added to the LIFECYCLE_EMAILS registry; never send around it.
- LIFECYCLE_LAUNCH_DATE (2026-08-08) gates welcome/nudge — users created before it are never emailed retroactively. Do not move it backwards.
- email_logs gained status / lifecycle_stage / provider_message_id / error columns (added directly in dev AND prod, additive).
- Admin tools: GET /api/admin/lifecycle/status (+ eligible counts), /preview?key=, POST /test (locked to requesting admin), POST /first-card-nudge/run.
