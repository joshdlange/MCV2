# Marvelous Card Vault - Replit Development Guide

## Overview
Marvelous Card Vault (formerly Marvel Card Vault) is a comprehensive web application for managing Marvel trading card collections. It supports large-scale card databases (194,800+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features. Live production app at marvelcardvault.com, plus iOS (App Store) and Android (Capacitor) apps.

**Detailed implementation notes live in `docs/feature-history.md`** — read the relevant entry there before working on any established feature (email, pricing crons, image migration, Drive sync, PC Binders, iOS billing, etc.). Nothing in that file is obsolete; it was moved out of here to keep this file lean.

## User Preferences
Preferred communication style: Simple, everyday language.
**IMPORTANT**: This is a live production app at marvelcardvault.com. All changes must be published to take effect - there's no need for dev-only changes.
**ONE-TIME FIXES**: For data cleanups/corrections, ASK the user whether they want a reusable admin tool or a one-time fix before building. Default to a one-time idempotent startup cleanup (removable after it runs in prod) — the admin portal is already overgrown with single-use tools.
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
- **Charting**: Recharts only (Chart.js was removed to save ~300KB bundle)
- **Mobile**: Capacitor (iOS + Android). iOS billing via RevenueCat; Android uses Stripe via external browser. Before every Android build: `nix-shell -p nodejs_22 --run "node_modules/.bin/cap update android"` (see docs/feature-history.md → Android Hardware Back Button).

### Feature Map (details in docs/feature-history.md)
- **Card database & admin**: Add Cards/CSV bulk import, Main Sets, Migration Console (audit-logged), Canonical Taxonomy & Legacy Archive, Base Set Population, Upcoming Sets Tracker (RSS auto-sync).
- **Images**: user-submitted image approvals (+ trusted uploaders auto-approve), nightly COMC → Cloudinary migration cron, Google Drive image sync (dry-run + gated import), eBay image lookup.
- **Pricing**: eBay Browse API pricing with nightly backfill cron (3 AM CT, quota-budgeted, advisory-locked).
- **Email**: Resend for ALL sends (`server/services/emailService.ts`); Brevo for contact-list sync only. Monthly nudges/digest crons.
- **Subscriptions**: Stripe (web/Android) + RevenueCat (iOS, entitlement `super_hero`); daily RC reconciliation cron; upgrade funnel analytics at `/admin/analytics`.
- **Social & collections**: collections/wishlists, PC Binders (SUPER_HERO-only), friends/messaging, user blocking, XP/badges, trending cards, Scan-to-Add (GPT-4o-mini vision).
- **Marketplace**: feature-flagged off; payout workflow built but dormant. eBay affiliate "Buy on eBay" links are active.
- **One-time startup fixes**: idempotent, advisory-locked blocks near the end of `server/routes.ts` (Kakawow fix, Topps Chrome seed, XP backfill, AU duplicate cleanup). Removable once their audit-log/prod run is confirmed.

### Data Flow
- **Card Management**: Admin CSV uploads, background processing, eBay API for images, Cloudinary optimization, and price data refreshes.
- **User Collection**: Users add cards to collections/wishlists, with cached statistics and background market pricing updates.
- **Performance**: Extensive optimizations for the 194k-card dataset — DB indexing, paginated endpoints, virtual scrolling, TTL caching, background jobs (details in docs/feature-history.md → Performance Optimizations).

### Deployment Strategy
- **Replit Deployment**: `npm run build` / `npm run start`, internal port 5000, external port 80. Node.js 20 with PostgreSQL 16. Autoscale — all crons/one-time fixes must be advisory-locked.
- **Database Management**: Drizzle Kit for migrations. NOTE: `db:push` is blocked by legacy dupes — schema changes ship via idempotent startup ALTER/CREATE in `server/index.ts`.

### UI/UX Decisions
Modern, clean interface with visual consistency. Uses Marvel red themes (red-500/red-600) for branding. Messaging interfaces mimic native mobile experiences with avatars and message bubbles. Profile section acts as a social dashboard with friends and "super powers" (achievements).

## External Dependencies
- **eBay Browse/Finding API + OAuth**: card pricing and image search
- **Stripe API**: subscription payments (web/Android)
- **RevenueCat**: iOS subscription billing
- **Firebase Auth**: user authentication (+ Firebase Admin for password reset links)
- **Cloudinary**: image processing and CDN hosting
- **Resend**: all outbound email
- **Brevo**: contact-list management only (not email sending)
- **Google Drive API**: read-only card image sync (service account)
- **OpenAI (GPT-4o-mini)**: Scan-to-Add card recognition
