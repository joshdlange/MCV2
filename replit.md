# Marvelous Card Vault - Replit Development Guide

## Overview
Marvelous Card Vault (formerly Marvel Card Vault) is a comprehensive web application for managing Marvel trading card collections. It supports large-scale card databases (194,800+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features. The project aims to provide a robust platform for collectors to organize, track, and manage their Marvel trading card assets.

## User Preferences
Preferred communication style: Simple, everyday language.
**IMPORTANT**: This is a live production app at marvelcardvault.com. All changes must be published to take effect - there's no need for dev-only changes.
**UI RULE**: NO black backgrounds in text input fields anywhere in the app. All inputs, textareas, and selects must have white/light backgrounds with dark text for visibility. This applies to all existing and future features.

## System Architecture

### Full-Stack Architecture
- **Frontend**: React 18 with TypeScript, Vite for build tooling
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Firebase Authentication
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: Zustand for client-side state
- **Data Fetching**: TanStack Query (React Query) for server state

### Performance Optimizations
The application incorporates comprehensive performance optimizations for handling large datasets, including database indexing, paginated API endpoints, virtual scrolling, intelligent caching with TTL management, and background jobs for heavy operations.

### Key Components
- **Database Schema**: Efficiently manages users, card sets, cards, user collections, wishlists, cached pricing, and upcoming set releases.
- **Authentication & Authorization**: Firebase for user management, admin role-based access, JWT validation, and subscription tier access.
- **Upcoming Sets Tracker**: Manages and displays upcoming Marvel card set releases with URL import, OpenGraph scraping, image caching, countdown timers, RSS auto-sync from Cardboard Connection (weekly, Mon 5 AM CT), auto-expire of released sets (daily 6 AM CT), seed data on startup, and admin manual trigger buttons. Uses `fast-xml-parser` for RSS parsing. Service: `server/services/upcomingSetsSync.ts`. sourceUrl is internal-only (stripped from public API). Admin inline edit button on public page for quick updates. Interest tracking via `upcoming_set_interests` table — on set launch, system messages sent to interested users from "Marvelous Card Vault" system account (auto-created, email: system@marvelcardvault.com).
- **Email Integration**: Resend is the primary provider for all outbound app email (July 2026):
  - **Resend** (`RESEND_API_KEY`, from `no-reply@marvelcardvault.com`): ALL transactional and marketing email — welcome, password reset, badge unlocked, trade notifications, card image approved/rejected, monthly nudges/digest, coupon blasts, admin notification emails, admin campaigns. Centralized in `server/services/emailService.ts`: `sendEmail(to, subject, html, template?, jobName?)` is the general interface (delegates to `sendResendEmail`); `sendResendEmail(options)` is the low-level call; `sendPasswordResetEmail({to, resetUrl})` handles reset emails. `server/email.ts` is a thin wrapper used by direct `routes.ts` call sites — also routes through Resend. Password reset flow: client `resetPassword()` → public `POST /api/auth/forgot-password` → Firebase Admin `generatePasswordResetLink` (token/expiry handled by Firebase) → branded `passwordResetTemplate` sent via Resend. Anti-enumeration: unknown emails get the same generic success response. Sends are logged to `email_logs`.
  - **Brevo**: `server/contactsSync.ts` (`syncFirebaseUsersToBrevo`) — Brevo Contacts REST API for contact-list management only. Not email sending. Admin endpoint: `POST /api/admin/sync-contacts`. BREVO_SMTP_USER/BREVO_SMTP_KEY secrets no longer needed for email sending.
  - Admin email endpoints (all admin-only): `POST /api/test-email` (general test, via Resend), `POST /api/admin/test-resend-email` (explicit Resend test). `POST /api/test-email` was previously unauthenticated — fixed July 2026.
- **Migration Console**: Admin-only tool for safely migrating cards between sets with preview, conflict detection, transaction-wrapped operations, and audit logging.
- **Canonical Taxonomy & Legacy Archive**: System for defining canonical sets, archiving legacy sets (soft delete), and filtering public API results.
- **Large Import Handling**: Pagination for card listing endpoints, optimized database indexes, and a bulk card import endpoint with batch processing and resumable imports.
- **"Still Populating" Section**: Displays canonical master sets without cards yet in the browse section, showing "Coming Soon" badges.
- **Card Data Cleanup**: Multi-phase normalization for card names, serial numbers, and deduplication of cards, with safe migration of user collections.
- **Search Functionality**: Enhanced `searchCardSets()` with increased limits and frontend pagination for large result sets.
- **Admin User Management**: Backend route for updating user details, including lifetime SUPER_HERO grants.
- **Nightly Pricing Backfill (July 2026)**: Cron at 3 AM CT prices cards that have a front image but NO card_price_cache row — up to 1,000 cards/night, paced 10s apart, hard budget of 3,500 actual eBay API calls per run (each card can trigger multiple query variations; total stays under the ~5,000/day eBay quota alongside the 70/hr baseline limiter). Postgres advisory lock prevents duplicate runs across autoscale instances. Errored cards get a -1 cache row so they aren't retried forever. `runNightlyPricingBackfill()` / `startNightlyPricingBackfillCron()` in `server/ebay-pricing.ts`, wired at startup in `server/index.ts`. Old `startBackgroundPricingFetch` remains disabled.
- **Nightly COMC → Cloudinary Image Migration (July 2026)**: Cron at 1:30 AM CT copies COMC-hotlinked card images (~10.8k) into Cloudinary (folder `marvel-cards/comc-migration`, public_id `card_{id}_{side}`, overwrite/idempotent) and swaps front/back URLs only after successful upload. Server downloads COMC image directly (Cloudinary's fetch proxy gets 401 from COMC) then uploads the buffer. Up to 450 cards/night at 4s pacing, random order (bad URLs can't block queue), 30s download / 60s upload timeouts, 80-min run cutoff (never overlaps 3 AM pricing backfill), 25-consecutive-failure circuit breaker, in-memory skip set for failed ids, pg advisory lock for autoscale safety. `runImageMigrationBatch()` / `startImageMigrationCron()` / `getImageMigrationStatus()` in `server/services/imageMigration.ts`, wired at startup in `server/index.ts`. Admin: `POST /api/admin/run-image-migration` (optional maxCards 1–1000), `GET /api/admin/image-migration-status`.
- **Trending Cards**: Insert cards only, no repeats for 30+ days. Deterministic seeded shuffle of 34k+ insert cards; each day picks a unique slice of 10. Master set diversity enforced via round-robin.
- **Upgrade Flow**: Comprehensive audit and fixes for the subscription upgrade process, including client-side checks, 403 error handling, and a dedicated `/subscribe` page.
- **iOS App Store Compliance**: RevenueCat (`@revenuecat/purchases-capacitor` v12) is the active iOS billing layer. Product ID: `MCV_Apple_Superhero`, entitlement: `super_hero`. RC initializes on app startup (`App.tsx`), fetches offerings, and presents StoreKit sheet on purchase tap. After purchase/restore, client calls `POST /api/revenuecat/activate` to update user plan to SUPER_HERO. Old custom StoreKit (`cordova-plugin-purchase`) code is preserved in `appleIAP.ts` but gated behind `APPLE_IAP_ENABLED = false`. RC controlled via `REVENUECAT_ENABLED = true` in `revenueCat.ts`. iOS API key: `VITE_REVENUECAT_IOS_API_KEY` env var. Android still uses Stripe via external browser. Sign in with Apple added for Guideline 4.8 compliance. Account deletion for Guideline 5.1.1(v). Subscription disclosure block (price, terms, privacy links) shown on all iOS upgrade modal paths.
- **Android Hardware Back Button**: `useBackButton` hook (native Android only) handles hardware back: page-registered handlers (scan stage machine, mobile menu drawer) → close open Radix overlay via Escape dispatch → double-press-to-exit on Dashboard root → in-app history back. Pages with internal wizard state register via `useHardwareBackHandler` from `@/hooks/useBackButton`. **IMPORTANT for Android releases**: `npx cap update android` (or `cap sync`) MUST be run before every Android build — the Capacitor 8 CLI requires Node ≥22, so run it via `nix-shell -p nodejs_22 --run "node_modules/.bin/cap update android"`. If skipped, `android/app/src/main/assets/capacitor.plugins.json` goes stale and native plugins (App, RevenueCat, social login) silently ship missing from the AAB.
- **Marketplace & eBay Affiliate**: Marketplace functionality is feature-flagged. Integrated eBay affiliate links for "Buy on eBay" buttons, with dynamic query generation and customizable affiliate parameters.
- **Marketplace Fulfillment System**: Seller payout workflow including earnings tracking, payout account management, payout requests, admin approval, and fee calculations.
- **PC Binders**: User-created custom binders (`pc_binders` + `pc_binder_cards` tables) with name, optional description, and category (Character/Artist/Theme/Chase List/Other). Hold owned AND unowned cards — owned render normal with green "Owned" badge, unowned grayscale with amber "Chasing" badge. Progress = owned/total. Never mutates user_collections. Caps: 50 binders/user, 500 cards/binder (no pagination). Routes: `/pc-binders` list + `/pc-binders/:id` detail; sidebar nav "PC Binders" (BookOpen icon, gold "NEW" badge). API under `/api/pc-binders`, all owner-scoped. **SUPER_HERO-only (July 2026)**: `requirePcBinderAccess` middleware on all 12 `/api/pc-binders` routes (403 code `SUPER_HERO_REQUIRED`, admin bypass); public token-based shared-binder view stays open. Side Kick users see an upsell page at `/pc-binders` (explains feature + Super Hero perks incl. Trade Block/Marketplace "coming soon") with UpgradeModal (trigger `pc_binders`); `/pc-binders/:id` redirects them to `/pc-binders`. UpgradeModal now accepts optional `title`/`description`/`features` props (features support `comingSoon` flag); defaults preserve the original limit-reached content.
- **User Blocking System**: Full block/unblock functionality with enforcement across all social features (friend requests, messaging, profile viewing, collection/wishlist access, user search). Block button on user profiles with confirmation dialog. Blocked users list in profile Privacy tab for management. Blocking auto-removes friendships.
- **Conversion Funnel Analytics**: Admin page at `/admin/analytics` shows 5-stage funnel (Signup → Added Card → Returning User → Upgraded → Cancelled) with bar chart, conversion rates, and churn rate. `analyticsEvents` table tracks upgrade modal impressions, clicks, and dismissals with platform and trigger breakdown. Upgrade modal fires `upgrade_modal_shown`, `upgrade_clicked`, `upgrade_dismissed` events via `POST /api/analytics/event`. All UpgradeModal callers pass `trigger` prop (sidebar, profile, marketplace, limit_reached, card_limit_warning).
- **Monthly Email**: Updated `weeklyDigestTemplate` to include iOS App Store section (https://apps.apple.com/us/app/marvelous-card-vault/id6759801987) with download CTA button.

### Data Flow
- **Card Management**: Admin CSV uploads, background processing, eBay API for images, Cloudinary optimization, and price data refreshes.
- **User Collection**: Users add cards to collections/wishlists, with cached statistics and background market pricing updates.
- **Performance Monitoring**: API response time, slow query detection, database optimization metrics, and memory usage monitoring.

### Deployment Strategy
- **Replit Deployment**: Configured for `npm run build` and `npm run start` commands, internal port 5000, external port 80. Node.js 20 with PostgreSQL 16.
- **Database Management**: Drizzle Kit for migrations and pre-configured performance indexes.
- **Production Considerations**: Environment variables for API keys, rate limiting, caching, and background job management.

### UI/UX Decisions
Modern, clean interface with visual consistency. Uses Marvel red themes (red-500/red-600) for branding. Messaging interfaces mimic native mobile experiences with avatars and message bubbles. Profile section acts as a social dashboard with friends and "super powers" (achievements).

## External Dependencies

### Production APIs
- **eBay Finding API**: For card image search and pricing.
- **eBay OAuth**: For API authentication.
- **Stripe API**: For subscription payment processing.
- **Firebase Auth**: For user authentication and management.
- **Cloudinary**: For image processing and CDN hosting.
- **Brevo SMTP**: For transactional email delivery and contact management.

### Performance Optimizations (Mar 3, 2026)
- Removed verbose auth middleware logging (JWT tokens were logged on every request — security + perf issue)
- Moved `recordUserLogin` from auth middleware (every request) to auth/sync endpoint (once per login)
- Optimized trending cards query: replaced correlated subqueries with JOIN approach (2046ms → 327ms)
- Added 30s user stats cache with invalidation on collection/wishlist changes (1513ms → 198ms, cached: <1ms)
- Silenced cache cleanup and image processing spam logs
- Raised slow query warning threshold from 100ms to 500ms (appropriate for 194k card dataset)

### Development Tools
- **Drizzle Kit**: For database migrations.
- **Vite**: Frontend build tool.
- **ESBuild**: For backend TypeScript compilation.
- **Replit**: Development and deployment platform.

### Charting
- **Recharts** is the only charting library. Chart.js was removed to save ~300KB bundle size. All charts use Recharts components (AreaChart, LineChart, BarChart, etc.).