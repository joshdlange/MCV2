---
name: MCV Lifecycle Marketing
description: Guides all Marvel Card Vault email, notification, onboarding, and nurture work. Use whenever building, editing, or sending lifecycle emails, campaigns, drips, or re-engagement messaging.
---

# MCV Lifecycle Marketing

## Purpose
Help Marvel Card Vault create smarter lifecycle messaging based on user behavior, not generic monthly blasts. Every message exists because something happened or did not happen for a specific user.

## Current state (Aug 2026)
- **Lifecycle system v1 is live** in `server/jobs/lifecycleEmails.ts`: ACTIVE = welcome (event-triggered at onboarding, new signups after 2026-08-08 only, never retroactive) + 24h first-card nudge (hourly cron, zero-card users only). The 10 journey emails (empty vault, momentum, PC Binder prompt/upsell, missing image, share binder, wishlist, reactivation, new set, image-approved XP) exist as DRAFT templates with eligibility counts, `active: false` — flip ONE at a time after admin preview/test.
- **Global frequency cap: max 1 lifecycle/marketing email per user per 14 days** (welcome exempt; transactional exempt). Enforced via `email_logs` job_name namespaces `lifecycle-%` / `campaign-%`; `-test` sends excluded. The vault-upgrade drip also respects the cap.
- Admin tools: `GET /api/admin/lifecycle/status` (registry + eligible counts), `GET /api/admin/lifecycle/preview?key=`, `POST /api/admin/lifecycle/test` (sends to admin only), `POST /api/admin/lifecycle/first-card-nudge/run`.
- Automatic monthly nudges + digest are DISABLED in `server/jobs/emailCron.ts` (`startEmailCronJobs` no longer starts any scheduled marketing jobs). The job code and templates are preserved for reuse.
- The four legacy "one-time" campaign jobs are also not started: their cron patterns repeat annually and would re-send past campaigns.
- Provider: Resend for password reset emails, Brevo for the rest (do not change providers). Password reset, transactional emails, and admin test tools are untouched and must stay working.
- Marketing sends are gated by `users.marketingOptIn` (NOT `emailUpdates`). Sends are logged in `email_logs` with a `job_name` used for dedupe.
- Resend free plan limits are too low to email the whole user base in one day. Batch large sends (see the vault-upgrade drip pattern in `emailCron.ts`: daily capped batch, dedupes off `email_logs`, self-stops).

## Voice and tone
- Collector-first: talk about their cards, sets, binders, and chase list.
- Fun, clear, and useful. Comic-inspired but not cheesy.
- Short, punchy CTAs. One primary CTA per email.
- No em dashes.
- No false affiliation language. Never claim affiliation with Marvel, Disney, Upper Deck, Topps, or any card manufacturer.

## Marketing principles
- Send because something happened or did not happen.
- Every email has a specific reason and one primary CTA.
- No generic "monthly update" emails unless truly personalized and content-rich.
- Prefer behavior-based triggers over calendar-based blasts.
- Respect unsubscribe and preferences. Marketing templates MUST include `{{UNSUBSCRIBE_URL}}` in the footer.
- Avoid over-emailing: cap frequency per user; check `email_logs` before sending.
- Batch large sends to respect Resend plan limits.
- Always test to admin (josh@marvelcardvault.com) before any production campaign.

## Lifecycle stages to support
1. **Activation** — signup with no cards added; first card added; collection started but stalled.
2. **Engagement** — adds cards; creates PC Binder; adds wishlist/chase cards; shares binder/PC/profile.
3. **Contribution** — views missing image; owns cards missing images; image uploaded; image approved/rejected; XP earned for approved image.
4. **Upgrade** — nears Side Kick 500-card limit; clicks a Super Hero-only feature; creates/wants PC Binder; wants Market Trends or Scan to Add.
5. **Retention** — inactive 7 / 14 / 30 days; new sets or images added since last visit.
6. **Referral/sharing** — binder shared; public link viewed; signup from shared link; XP/badge earned for sharing.
7. **Community** — leaderboard placement; badge unlocked; set completed; contribution milestone.

## Example triggers to build from
- Welcome email after signup.
- First-card nudge if no card added within 24 hours.
- Add-more-cards nudge after first card.
- Create-PC-Binder prompt for Super Hero users; PC Binder upsell for Free/Side Kick.
- Missing-image contribution prompt; image-approved XP email.
- Binder-share prompt; referral/signup credit email.
- Inactive-user reactivation email.
- New-set-specific announcement; new-image-coverage update.

## Rules for every future email build
- Always write the task as Must do / Must not do / Preserve / QA.
- Never send a campaign without admin test approval.
- Never send to all users without explicit approval from Joshua.
- Segment users whenever possible; smallest useful audience wins.
- Include unsubscribe/footer for all marketing emails.
- Use production app links only after confirming the production URL.
- Log every send and failure to `email_logs` with a distinct `job_name` (this is also the dedupe key).
- Rate limit or batch sends to stay within Resend plan limits (drip pattern above).
- Never expose API keys or hardcode secrets; use the environment/secrets tooling.
- Scheduled jobs: never use annual cron patterns for one-time sends; use a date-checked guard or run manually, and make every job idempotent via `email_logs` dedupe.

## QA checklist for any campaign work
- [ ] Password reset email still works (Resend path).
- [ ] Transactional emails unaffected.
- [ ] No emails sent during development/testing except to admin.
- [ ] Unsubscribe link present and functional in marketing templates.
- [ ] Send is batched, logged, and idempotent on rerun.
