# Marvel Card Vault - Replit Development Guide

## Overview
Marvel Card Vault is a comprehensive web application for managing Marvel trading card collections. Its main purpose is to support large-scale card databases (60,000+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features. The project aims to provide a robust platform for collectors to organize, track, and manage their Marvel trading card assets, enhancing the collecting experience with powerful tools and integrations.

## User Preferences
Preferred communication style: Simple, everyday language.

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
- **Authentication**: `firebase`
- **Payments**: `@stripe/stripe-js`, `@stripe/react-stripe-js`
- **Image Processing**: `cloudinary`, `multer`