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

## v2 additions (Aug 10, 2026)
- empty-vault + collection-momentum ACTIVE. Launch gates prevent retroactive blasts: empty-vault requires created_at >= v1 launch; momentum requires the user's most recent card add >= LIFECYCLE_V2_LAUNCH_DATE (stall must BEGIN post-launch).
- 14-day cap is now enforced ATOMICALLY inside claimAndSend: per-email pg_advisory_xact_lock + cap recheck + claim insert in one transaction; claim rows get sent_at=now() so they count against the cap immediately; status='failed' rows are excluded from the cap but still block their own journey.
- ALL batch runners (nudge + v2 journeys) hard-guard on REPLIT_DEPLOYMENT — dev cannot send real recipient emails even via admin endpoints. Preview/test/counts work everywhere.
- New journeys must be added to BATCH_JOURNEYS map to be cron/admin runnable; POST /api/admin/lifecycle/run/:key runs any active batch journey.

## Long-tail dormant win-back (Aug 10, 2026)
- 7 DRAFT journeys (dormant-empty-vault/started/engaged/upgrade/missing-image, winback-90, babycomeback) live in LONGTAIL_JOURNEYS, NOT BATCH_JOURNEYS — the cron only iterates BATCH_JOURNEYS, so long-tail can NEVER auto-run even when active. Admin endpoint requires typed body {"confirm":"SEND <key>"}.
- 150/24h global dormant cap enforced under a session-level pg advisory lock (key 913151) held for the whole run — serializes all long-tail runs across keys/instances; cap count inside lock.
- BABYCOMEBACK: Stripe promotion code confirmed active ($5 off x 2 months repeating = 2 free months of the $5 plan); checkout session uses allow_promotion_codes: true; web-only, never claim iOS availability. lifecycleTemplate now supports codeBlock + footnote.
- Inactivity = users.last_login (NULL excluded), same as the reactivation draft.

## v3 revenue/nurture (Aug 13, 2026)
- All-DRAFT additions: payment-failed (transactional), subscription-cancelled, near-limit-500; tightened pc-binder-prompt (10+ cards), pc-binder-upgrade (real intent = analytics_events upgrade_modal_shown trigger='pc_binders'), missing-image (no pending_card_images in 30d), share-binder. All 5 marketing ones now in BATCH_JOURNEYS (runner still refuses active:false).
- Billing emails are EVENT-wired into the Stripe webhook but triple-gated: def.active flag + REPLIT_DEPLOYMENT + fire-and-forget try/catch (webhook must always 200). payment-failed dedupes PER INVOICE via job_name 'billing-payment-failed' + template 'billing-payment-failed:<invoiceId>' (outside lifecycle-% namespace → cap-exempt, no once-per-user index) and bypasses marketingOptIn (billing critical). subscription-cancelled uses claimAndSend (once per user, respects opt-in).
- **Stripe SDK v18 gotcha:** Invoice no longer has `.subscription`; the sub id lives at `invoice.parent?.subscription_details?.subscription` (string or expanded object). Handle both.
- Hero images: lifecycleTemplate accepts heroKey; HERO_IMAGES map (8 keys email-vault-starter … email-collector-network) holds url:null until assets uploaded to Cloudinary marvel-card-vault/email/<key>; template skips the img row when url null, so emails ship image-less safely. Status endpoint exposes heroKey/heroUploaded/heroUrl/heroStatus. CRITICAL: email assets must use https://app.marvelcardvault.com (the app deployment); marvelcardvault.com / www. is a SEPARATE marketing-site project that 404s app assets. checkHeroImages() preflight (HEAD + image content-type, 60s cache) surfaces unreachable heroes in the admin Lifecycle panel; assets live in client/public/email-assets/ and only become reachable after a production publish.
- Known gap (pre-existing, intentionally untouched): welcome email has no REPLIT_DEPLOYMENT guard — dev onboarding can send a real welcome email.

**Monthly send budget (Aug 2026):** marketing lifecycle sends are hard-capped per calendar month (EMAIL_MONTHLY_SEND_LIMIT env, default 3000 = Resend free tier). Enforced atomically inside the claimAndSend transaction under a global `email-monthly-budget` advisory lock counting email_logs (status<>'failed'). Transactional emails + welcome are NEVER blocked by the budget. Admin panel shows usage bar from getLifecycleStatus().monthlyUsage. Calendar month ≈ Resend billing period — keep the env value matching the actual plan.

**Activation overrides (Aug 2026):** template active state is DB-backed via lifecycle_email_settings (CREATE IF NOT EXISTS at startup; def.active is only the code default). ALL send paths must gate on isLifecycleActive(def) — claimAndSend rechecks per claim. Admin toggles via POST /api/admin/lifecycle/activate (typed `ACTIVATE <key>`); welcome + transactional keys rejected server-side. Long-tail dormant journeys additionally need per-batch `SEND <key>` via run/:key. Budget limit default 50000 (Resend 50k plan); non-claimAndSend send paths (plain sendResendEmail) don't take the budget lock — count can drift by concurrent transactional sends, acceptable at 50k scale.

**Fully-automatic model (Joshua, Aug 13 2026):** NO manual batches — all journeys (incl. dormant/win-back long-tail) run from the hourly cron once activated, in JOURNEY_PRIORITY_ORDER (upgrade-intent > adoption > share > dormant > coupon). Priority is enforced by processing order + the 14-day cap, made deterministic by a cross-instance advisory lock (PRIORITY_PASS_LOCK_KEY) held for the whole pass; manual run/:key calls also take it. Long-tail keeps the 150/24h global cap. Timing gates match Joshua's table: pc-binder-prompt 10th card ≥3d old, pc-binder-upgrade gate-hit ≥1h old, missing-image account ≥7d, share-binder binder ≥3d, dormant-engaged/upgrade 45d inactive. "Send batch" UI removed by design — don't re-add.
