# Marvel Card Vault - Replit Development Guide

## Overview
Marvel Card Vault is a comprehensive web application for managing Marvel trading card collections. Its main purpose is to support large-scale card databases (60,000+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features. The project aims to provide a robust platform for collectors to organize, track, and manage their Marvel trading card assets, enhancing the collecting experience with powerful tools and integrations.

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
The application incorporates comprehensive performance optimizations for handling large datasets, including database indexing, paginated API endpoints, virtual scrolling for large card grids, intelligent caching with TTL management, and background jobs for heavy operations.

### Key Components
- **Database Schema**: Structured for efficient management of users, card sets, individual cards, user collections, wishlists, cached pricing data, and upcoming set releases.
- **Authentication & Authorization**: Leverages Firebase Authentication for user management, implements admin role-based access control, JWT token validation, and enforces subscription tier access.
- **Upcoming Sets Tracker**: ✨ NEW (Nov 20, 2025) - Comprehensive system for managing and displaying upcoming Marvel card set releases with URL import, OpenGraph metadata scraping, image caching, countdown timers, and user interest tracking.
- **Email Integration**: ✨ NEW (Nov 20, 2025) - Brevo SMTP integration for transactional emails with Nodemailer configuration (`server/email.ts`), Firebase to Brevo contact sync (`server/contactsSync.ts`), admin-only sync endpoint for CRM management, and comprehensive email automation system with 15 branded templates, event triggers, and scheduled cron jobs. ✅ UPDATED (Nov 21, 2025) - Inactivity reminders and weekly digest emails are limited to 1 email per month maximum to prevent email fatigue.
- **Migration Console**: ✨ NEW (Jan 27, 2026) - Admin-only tool for safely migrating cards between sets. Features include source/destination set pickers with search/filter, preview with conflict detection, transaction-wrapped execute/rollback operations, archive instead of delete pattern, and full audit logging via `migration_logs` and `migration_log_cards` tables. Protects user collections by keeping card_ids stable.
- **Still Populating Section**: ✨ NEW (Jan 28, 2026) - Browse → Master Sets now shows a "Still Populating" section below active sets for canonical master sets that have no cards yet. Features:
  - Grayscale locked tile appearance with amber "Coming Soon" styling
  - Click shows branded modal (no navigation) with hammer icon
  - Sorted by year DESC, name ASC
  - Only shows canonical sets (canonical_source='csv_master' OR is_canonical=true)
  - Empty subsets inside active sets show "Coming Soon" badge
  - Admins can upload thumbnails for Still Populating sets via edit button
- **Marketplace Fulfillment System**: ✨ NEW (Jan 10, 2026) - Complete seller payout workflow including:
  - Earnings tracking with proper categorization: available, pending delivery, pending payout, paid out
  - Payout account management (PayPal/Venmo) stored in `payout_accounts` table
  - Payout request workflow with duplicate prevention (one pending request per seller)
  - Admin payout approval interface at `/admin/payouts` with PayPal quick-pay links
  - Notification badges for unread sales on Activity page Sales tab
  - Buyer delivery confirmation for shipped orders
  - Fee calculations: platform fee (10%), Stripe fee (2.9% + $0.30), shipping label costs deducted from seller earnings

### Data Flow
- **Card Management**: Involves admin CSV uploads, background processing, eBay API integration for image finding, Cloudinary optimization, and periodic price data refreshes.
- **User Collection**: Users can browse, add cards to collections or wishlists, with cached collection statistics and background market pricing updates.
- **Performance Monitoring**: Includes API response time tracking, slow query detection, database query optimization metrics, and memory usage monitoring.

### Deployment Strategy
- **Replit Deployment**: Configured for `npm run build` and `npm run start` commands, with internal port 5000 and external port 80. Uses Node.js 20 with PostgreSQL 16.
- **Database Management**: Utilizes Drizzle Kit for migrations and pre-configured performance indexes for large datasets.
- **Production Considerations**: Emphasizes environment variables for API keys, rate limiting, cached data strategies, and background job management.

### UI/UX Decisions
The application features a modern, clean interface with careful attention to visual consistency and user experience. Color schemes, particularly the use of Marvel red themes (red-500/red-600), are applied consistently for branding and visual hierarchy. Messaging interfaces are designed to mimic native mobile experiences (e.g., iPhone/Android messaging) with avatar-focused layouts, proper message bubbles, and integrated social features. The profile section serves as a social dashboard, displaying friends and achievements (referred to as "super powers") with visual badge icons and clear navigation.

## External Dependencies

### Production APIs
- **eBay Finding API**: For card image search and pricing.
- **eBay OAuth**: For API authentication.
- **Stripe API**: For subscription payment processing. ✅ RESTORED (Jan 19, 2025)
- **Firebase Auth**: For user authentication and management.
- **Cloudinary**: For image processing and CDN hosting.
- **Brevo SMTP**: For transactional email delivery and contact management. ✅ INTEGRATED (Nov 20, 2025)

### Payment System Status (Updated Jan 19, 2025)
- **RESOLVED**: Critical payment outage caused by accidental removal of Stripe endpoints
- **RESTORED**: All Stripe payment endpoints (`/api/create-checkout-session`, `/api/stripe-webhook`, `/api/subscription-status`, `/api/create-portal-session`)
- **CONFIGURED**: Complete Stripe key setup (Secret, Publishable, Webhook Secret)
- **AUTOMATED**: User upgrades now automatic via webhook processing
- **CUSTOMER IMPACT**: 10+ users affected during outage, compensation tools ready

### Development Tools
- **Drizzle Kit**: For database migrations and schema management.
- **Vite**: Frontend build tool with Hot Module Replacement (HMR).
- **ESBuild**: For backend TypeScript compilation.
- **Replit**: As the primary development and deployment platform.

### Key NPM Packages
- **Database**: `@neondatabase/serverless`, `drizzle-orm`
- **UI Components**: `@radix-ui/*` component library
- **Forms**: `react-hook-form`, `@hookform/resolvers`
- **Authentication**: `firebase`, `firebase-admin`
- **Payments**: `@stripe/stripe-js`, `@stripe/react-stripe-js`
- **Image Processing**: `cloudinary`, `multer`
- **Email & CRM**: `nodemailer`, `@getbrevo/brevo`