# Marvel Card Vault - Replit Development Guide

## Overview
Marvel Card Vault is a comprehensive web application for managing Marvel trading card collections. It supports large-scale card databases (194,800+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features. The project aims to provide a robust platform for collectors to organize, track, and manage their Marvel trading card assets.

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
- **Upcoming Sets Tracker**: Manages and displays upcoming Marvel card set releases with URL import, OpenGraph scraping, image caching, and countdown timers.
- **Email Integration**: Brevo SMTP for transactional emails, Firebase to Brevo contact sync, and an email automation system with branded templates.
- **Migration Console**: Admin-only tool for safely migrating cards between sets with preview, conflict detection, transaction-wrapped operations, and audit logging.
- **Canonical Taxonomy & Legacy Archive**: System for defining canonical sets, archiving legacy sets (soft delete), and filtering public API results.
- **Large Import Handling**: Pagination for card listing endpoints, optimized database indexes, and a bulk card import endpoint with batch processing and resumable imports.
- **"Still Populating" Section**: Displays canonical master sets without cards yet in the browse section, showing "Coming Soon" badges.
- **Card Data Cleanup**: Multi-phase normalization for card names, serial numbers, and deduplication of cards, with safe migration of user collections.
- **Search Functionality**: Enhanced `searchCardSets()` with increased limits and frontend pagination for large result sets.
- **Admin User Management**: Backend route for updating user details, including lifetime SUPER_HERO grants.
- **Trending Cards**: Insert cards only, no repeats for 30+ days. Deterministic seeded shuffle of 34k+ insert cards; each day picks a unique slice of 10. Master set diversity enforced via round-robin.
- **Upgrade Flow**: Comprehensive audit and fixes for the subscription upgrade process, including client-side checks, 403 error handling, and a dedicated `/subscribe` page.
- **iOS App Store Compliance**: Implemented Capacitor native platform checks to redirect iOS/Android users to an external website for Stripe checkout. Sign in with Apple added for Guideline 4.8 compliance (iOS native only, uses Firebase OAuthProvider). Account deletion added for Guideline 5.1.1(v) compliance (DELETE /api/user/account, transactional cleanup of all user data).
- **Marketplace & eBay Affiliate**: Marketplace functionality is feature-flagged. Integrated eBay affiliate links for "Buy on eBay" buttons, with dynamic query generation and customizable affiliate parameters.
- **Marketplace Fulfillment System**: Seller payout workflow including earnings tracking, payout account management, payout requests, admin approval, and fee calculations.

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