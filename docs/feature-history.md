# Feature History & Implementation Details

Detailed implementation notes moved out of `replit.md` (July 2026) to keep it lean.
Nothing here was deleted — these are the full original entries. When working on one
of these areas, read the relevant entry below.

## Upcoming Sets Tracker
Manages and displays upcoming Marvel card set releases with URL import, OpenGraph scraping, image caching, countdown timers, RSS auto-sync from Cardboard Connection (weekly, Mon 5 AM CT), auto-expire of released sets (daily 6 AM CT), seed data on startup, and admin manual trigger buttons. Uses `fast-xml-parser` for RSS parsing. Service: `server/services/upcomingSetsSync.ts`. sourceUrl is internal-only (stripped from public API). Admin inline edit button on public page for quick updates. Interest tracking via `upcoming_set_interests` table — on set launch, system messages sent to interested users from "Marvelous Card Vault" system account (auto-created, email: system@marvelcardvault.com).

## Email Integration (July 2026)
Resend is the primary provider for all outbound app email:
- **Resend** (`RESEND_API_KEY`, from `no-reply@marvelcardvault.com`): ALL transactional and marketing email — welcome, password reset, badge unlocked, trade notifications, card image approved/rejected, monthly nudges/digest, coupon blasts, admin notification emails, admin campaigns. Centralized in `server/services/emailService.ts`: `sendEmail(to, subject, html, template?, jobName?)` is the general interface (delegates to `sendResendEmail`); `sendResendEmail(options)` is the low-level call; `sendPasswordResetEmail({to, resetUrl})` handles reset emails. `server/email.ts` is a thin wrapper used by direct `routes.ts` call sites — also routes through Resend. Password reset flow: client `resetPassword()` → public `POST /api/auth/forgot-password` → Firebase Admin `generatePasswordResetLink` (token/expiry handled by Firebase) → branded `passwordResetTemplate` sent via Resend. Anti-enumeration: unknown emails get the same generic success response. Sends are logged to `email_logs`.
- **Brevo**: `server/contactsSync.ts` (`syncFirebaseUsersToBrevo`) — Brevo Contacts REST API for contact-list management only. Not email sending. Admin endpoint: `POST /api/admin/sync-contacts`. BREVO_SMTP_USER/BREVO_SMTP_KEY secrets no longer needed for email sending.
- Admin email endpoints (all admin-only): `POST /api/test-email` (general test, via Resend), `POST /api/admin/test-resend-email` (explicit Resend test). `POST /api/test-email` was previously unauthenticated — fixed July 2026.

## Migration Console
Admin-only tool for safely migrating cards between sets with preview, conflict detection, transaction-wrapped operations, and audit logging.

## Canonical Taxonomy & Legacy Archive
System for defining canonical sets, archiving legacy sets (soft delete), and filtering public API results.

## Large Import Handling
Pagination for card listing endpoints, optimized database indexes, and a bulk card import endpoint with batch processing and resumable imports.

## "Still Populating" Section
Displays canonical master sets without cards yet in the browse section, showing "Coming Soon" badges.

## Card Data Cleanup
Multi-phase normalization for card names, serial numbers, and deduplication of cards, with safe migration of user collections.

## Search Functionality
Enhanced `searchCardSets()` with increased limits and frontend pagination for large result sets.

## Admin User Management
Backend route for updating user details, including lifetime SUPER_HERO grants.

## Nightly Pricing Backfill (July 2026)
Cron at 3 AM CT prices cards that have a front image but NO card_price_cache row — up to 1,000 cards/night, paced 10s apart, hard budget of 3,500 actual eBay API calls per run (each card can trigger multiple query variations; total stays under the ~5,000/day eBay quota alongside the 70/hr baseline limiter). Postgres advisory lock prevents duplicate runs across autoscale instances. Errored cards get a -1 cache row so they aren't retried forever. `runNightlyPricingBackfill()` / `startNightlyPricingBackfillCron()` in `server/ebay-pricing.ts`, wired at startup in `server/index.ts`. Old `startBackgroundPricingFetch` remains disabled.

## Nightly COMC → Cloudinary Image Migration (July 2026)
Cron at 1:30 AM CT copies COMC-hotlinked card images (~10.8k) into Cloudinary (folder `marvel-cards/comc-migration`, public_id `card_{id}_{side}`, overwrite/idempotent) and swaps front/back URLs only after successful upload. Server downloads COMC image directly (Cloudinary's fetch proxy gets 401 from COMC) then uploads the buffer. Up to 450 cards/night at 4s pacing, random order (bad URLs can't block queue), 30s download / 60s upload timeouts, 80-min run cutoff (never overlaps 3 AM pricing backfill), 25-consecutive-failure circuit breaker, in-memory skip set for failed ids, pg advisory lock for autoscale safety. `runImageMigrationBatch()` / `startImageMigrationCron()` / `getImageMigrationStatus()` in `server/services/imageMigration.ts`, wired at startup in `server/index.ts`. Admin: `POST /api/admin/run-image-migration` (optional maxCards 1–1000), `GET /api/admin/image-migration-status`.

## Trending Cards
Insert cards only, no repeats for 30+ days. Deterministic seeded shuffle of 34k+ insert cards; each day picks a unique slice of 10. Master set diversity enforced via round-robin.

## Upgrade Flow
Comprehensive audit and fixes for the subscription upgrade process, including client-side checks, 403 error handling, and a dedicated `/subscribe` page.

## iOS App Store Compliance
RevenueCat (`@revenuecat/purchases-capacitor` v12) is the active iOS billing layer. Product ID: `MCV_Apple_Superhero`, entitlement: `super_hero`. RC initializes on app startup (`App.tsx`), fetches offerings, and presents StoreKit sheet on purchase tap. After purchase/restore, client calls `POST /api/revenuecat/activate` to update user plan to SUPER_HERO. Old custom StoreKit (`cordova-plugin-purchase`) code is preserved in `appleIAP.ts` but gated behind `APPLE_IAP_ENABLED = false`. RC controlled via `REVENUECAT_ENABLED = true` in `revenueCat.ts`. iOS API key: `VITE_REVENUECAT_IOS_API_KEY` env var. Android still uses Stripe via external browser. Sign in with Apple added for Guideline 4.8 compliance. Account deletion for Guideline 5.1.1(v). Subscription disclosure block (price, terms, privacy links) shown on all iOS upgrade modal paths.

## Android Hardware Back Button
`useBackButton` hook (native Android only) handles hardware back: page-registered handlers (scan stage machine, mobile menu drawer) → close open Radix overlay via Escape dispatch → double-press-to-exit on Dashboard root → in-app history back. Pages with internal wizard state register via `useHardwareBackHandler` from `@/hooks/useBackButton`. **IMPORTANT for Android releases**: `npx cap update android` (or `cap sync`) MUST be run before every Android build — the Capacitor 8 CLI requires Node ≥22, so run it via `nix-shell -p nodejs_22 --run "node_modules/.bin/cap update android"`. If skipped, `android/app/src/main/assets/capacitor.plugins.json` goes stale and native plugins (App, RevenueCat, social login) silently ship missing from the AAB.

## Marketplace & eBay Affiliate
Marketplace functionality is feature-flagged. Integrated eBay affiliate links for "Buy on eBay" buttons, with dynamic query generation and customizable affiliate parameters.

## Marketplace Fulfillment System
Seller payout workflow including earnings tracking, payout account management, payout requests, admin approval, and fee calculations.

## PC Binders
User-created custom binders (`pc_binders` + `pc_binder_cards` tables) with name, optional description, and category (Character/Artist/Theme/Chase List/Other). Hold owned AND unowned cards — owned render normal with green "Owned" badge, unowned grayscale with amber "Chasing" badge. Progress = owned/total. Never mutates user_collections. Caps: 50 binders/user, 500 cards/binder (no pagination). Routes: `/pc-binders` list + `/pc-binders/:id` detail; sidebar nav "PC Binders" (BookOpen icon, gold "NEW" badge). API under `/api/pc-binders`, all owner-scoped. **SUPER_HERO-only (July 2026)**: `requirePcBinderAccess` middleware on all 12 `/api/pc-binders` routes (403 code `SUPER_HERO_REQUIRED`, admin bypass); public token-based shared-binder view stays open. Side Kick users see an upsell page at `/pc-binders` (explains feature + Super Hero perks incl. Trade Block/Marketplace "coming soon") with UpgradeModal (trigger `pc_binders`); `/pc-binders/:id` redirects them to `/pc-binders`. UpgradeModal now accepts optional `title`/`description`/`features` props (features support `comingSoon` flag); defaults preserve the original limit-reached content.

## User Blocking System
Full block/unblock functionality with enforcement across all social features (friend requests, messaging, profile viewing, collection/wishlist access, user search). Block button on user profiles with confirmation dialog. Blocked users list in profile Privacy tab for management. Blocking auto-removes friendships.

## How Users Found Us
`/admin/analytics` section (between Conversion Funnel and iOS Subscription Health) charting `users.heard_about` from onboarding. `GET /api/admin/heard-about-stats` (admin-only) groups raw answers in SQL, then normalizes free-typed "Other" text into buckets in JS (AI Chatbot, App Store, Search Engine, Social Media, Reddit/Forum, Friend Recommendation, YouTube/Streamer, Not Answered, Other) — normalization rules live in the route handler.

## Conversion Funnel Analytics
Admin page at `/admin/analytics` shows 5-stage funnel (Signup → Added Card → Returning User → Upgraded → Cancelled) with bar chart, conversion rates, and churn rate. `analyticsEvents` table tracks upgrade modal impressions, clicks, and dismissals with platform and trigger breakdown. Upgrade modal fires `upgrade_modal_shown`, `upgrade_clicked`, `upgrade_dismissed` events via `POST /api/analytics/event`. All UpgradeModal callers pass `trigger` prop (sidebar, profile, marketplace, limit_reached, card_limit_warning).

## Admin Area Reorganization (July 2026)
Admin dashboard (`client/src/pages/admin/dashboard.tsx`) is registry-driven: `ADMIN_SECTIONS` array with per-tool metadata (title, description, href, status badges: Active/Legacy/Advanced/Dangerous/Needs Review/Coming Soon, warning text) rendered in 7 sections — Users, Cards & Sets, Images, Notifications, APIs & Integrations, Data & Migrations, Advanced/Legacy Tools. New pages: `/admin/notifications` (Resend test email, Brevo contact sync with confirm, legacy campaign history moved from automation page) and `/admin/legacy-tools` (old SchedulerManager, PriceChartingImporter, payouts link). `/admin/automation` is now Images-only ("Image Automation"): COMC→Cloudinary migration status panel + manual 50-card batch trigger (confirm-gated) + BulkImageUpdater. RC-audit panel now lives only in `/admin/analytics` (duplicate removed from automation). Dead pages archived to `attic/admin-legacy/` (old `pages/admin.tsx`, `pages/admin/card-editor.tsx`). No backend routes were removed.

## Trusted Uploaders & Bulk Image Approval (July 2026)
`users.trusted_uploader` boolean (added via idempotent startup ALTER in `server/index.ts` — db:push is blocked by legacy dupes). Trusted users' image uploads auto-approve (skip queue) in both `POST /api/cards/:cardId/upload` and `POST /api/cards/:cardId/submit-scan-image` (`skipsQueue = isAdmin || trustedUploader`). Admin routes: `GET /api/admin/trusted-uploaders`, `POST /api/admin/trusted-uploaders` {identifier(username/email)|userId, trusted}, `POST /api/admin/pending-images/bulk-approve` {ids[] max 100} (reuses single-approve logic incl. contributor badge). Admin UI on `/admin/image-approvals`: Trusted Uploaders panel (add/remove with confirm) + per-card checkboxes, select-all, confirm-gated "Approve Selected". Security: `PUT /api/users/:id` now uses a self-service field allowlist — privileged fields (isAdmin, trustedUploader, plan, subscription/stripe fields) cannot be set through it.

## Drive Image Sync v1 — Dry-Run Only (July 2026)
Admin-only, read-only Google Drive scan that maps a Drive hierarchy (Root → Main Set → Subset → Card Number → 2 images) to mainSets/cardSets/cards via strict normalized matching (no fuzzy). NO imports, NO Cloudinary, NO DB writes, NO scheduling in v1. Service: `server/services/driveImageSync.ts` (service-account JWT via crypto.sign, drive.readonly scope, 6000-listing cap, 8-way concurrent card-folder listing, front/back filename inference, container/wrapper folder detection, duplicate file-id & duplicate card-match tracking). Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Routes: `POST /api/admin/drive-sync/dry-run`, `GET /api/admin/drive-sync/last-report` (both admin-only). TEMP dev-only boot trigger in `server/index.ts` (flag files `/tmp/run_drive_dryrun`, `/tmp/run_drive_cleanup`, NODE_ENV=development only, prod-inert) — remove after v1 review. First scan (July 17, 2026): 1030 card folders, 949 matched, 81 unmatched, 0 duplicates. Cleanup report: `buildDriveCleanupReport()` (same service) derives 4 admin tables from the last dry-run (unmatched + token-similarity DB candidates [suggestions only, never auto-mapped], ambiguous front/back with filename-marker-first proposals, wrong image counts, structure oddities); route `GET /api/admin/drive-sync/cleanup-report` (admin-only, read-only). CSV exports in `exports/drive-cleanup-*.csv`.

## Drive Image Sync v2 — Real Import (July 2026)
`runDriveImageImport({maxFolders?, overwrite?})` in `server/services/driveImageSync.ts`. Always runs a fresh read-only scan first, then imports ONLY folders passing every gate: exact card match, exactly 2 images, no nested/non-image files, front/back resolved by the approved marked-file-wins rule (one file marked FRONT/BACK → unmarked file is the opposite side; sort order never used), no duplicate Drive file ids, no duplicate card targets. Skips cards that already have an image on that side unless `overwrite:true` (default off). Downloads via Drive `alt=media`, uploads to Cloudinary folder `marvel-cards/drive-sync` (`card_{id}_{side}`), card URL + `drive_image_imports` ledger row commit in one transaction only after confirmed upload. Ledger table `drive_image_imports` (created via idempotent startup CREATE TABLE in `server/index.ts`) makes reruns idempotent — unchanged Drive file ids are skipped. Advisory lock + 400ms pacing. Routes (admin-only): `POST /api/admin/drive-sync/import` (requires body `{"confirm":"IMPORT"}`, optional `maxFolders` 1–2000, `overwrite`; returns 202, runs in background) and `GET /api/admin/drive-sync/import-report` (poll progress/result). Never creates cards, never touches user collections, never modifies Drive. Verified July 17, 2026: 5-folder test → 10 images uploaded, 5 cards updated; rerun → all 10 skipped as already-imported. Admin UI: "Drive Image Sync" section on `/admin/automation` — latest dry-run summary stats (incl. Already Imported count from ledger via `GET /api/admin/drive-sync/last-report?summary=1`, which strips large detail arrays), Run Dry Run button, confirm-gated Run Import (must type IMPORT in dialog; overwrite/maxFolders not exposed in UI), 5s polling of import-report while running, last-batch results + failure list.

## AU Duplicate Card Cleanup (July 2026)
One-time import artifact left ~1,297 cards with "AU"-suffixed names (e.g. "WolverineAU,") duplicating a base card with same set + card_number across 30 autograph subsets. Fix is a ONE-TIME STARTUP CLEANUP (no admin UI/routes by user request): `runAuDuplicateCleanup()` in `server/services/auDuplicateCleanup.ts`, invoked at startup in `routes.ts` (near the other one-time seeds). Single transaction + pg advisory lock, remaps user_collections/user_wishlists/pc_binder_cards (unique-index-safe)/listings/migration_log_cards/scan refs to base card, drops pending images + price cache rows, deletes AU cards; idempotent (rerun = zeros), lone AU-named cards without a twin never touched. Logs to admin_audit_logs (action_type `au_duplicate_cleanup`) only when it deletes something. Runs in prod on first boot after publish — the startup block can be removed once the audit-log entry exists.

## Monthly Email
Updated `weeklyDigestTemplate` to include iOS App Store section (https://apps.apple.com/us/app/marvelous-card-vault/id6759801987) with download CTA button.

## Performance Optimizations (Mar 3, 2026)
- Removed verbose auth middleware logging (JWT tokens were logged on every request — security + perf issue)
- Moved `recordUserLogin` from auth middleware (every request) to auth/sync endpoint (once per login)
- Optimized trending cards query: replaced correlated subqueries with JOIN approach (2046ms → 327ms)
- Added 30s user stats cache with invalidation on collection/wishlist changes (1513ms → 198ms, cached: <1ms)
- Silenced cache cleanup and image processing spam logs
- Raised slow query warning threshold from 100ms to 500ms (appropriate for 194k card dataset)
