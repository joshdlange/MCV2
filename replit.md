# Marvel Card Vault - Replit Development Guide

## Overview

Marvel Card Vault is a comprehensive web application for managing Marvel trading card collections. The application supports large-scale card databases (60,000+ cards) with optimized performance, user authentication, subscription management, and advanced collection tracking features.

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
The application implements comprehensive performance optimizations for handling large datasets:
- Database indexing for critical queries
- Paginated API endpoints with lightweight payloads
- Virtual scrolling for large card grids
- Intelligent caching with TTL management
- Background job system for heavy operations
- Rate limiting for external API calls

## Key Components

### Database Schema
- **Users**: Firebase-integrated user management with subscription tracking
- **Main Sets**: Top-level card set categories (e.g., "Spider-Man", "X-Men")
- **Card Sets**: Individual card sets within main sets (e.g., "Amazing Spider-Man 1990")
- **Cards**: Individual trading cards with metadata
- **User Collections**: User-owned cards with acquisition tracking
- **User Wishlists**: Cards users want to acquire
- **Card Price Cache**: Cached pricing data from eBay API

### Authentication & Authorization
- Firebase Authentication for user management
- Admin role-based access control
- JWT token validation middleware
- Subscription tier enforcement (Side Kick vs Super Hero plans)

### External Integrations
- **eBay API**: Automated card image finding and pricing data
- **Stripe**: Subscription payment processing
- **Cloudinary**: Image optimization and hosting
- **Firebase**: Authentication and user management

## Data Flow

### Card Management Flow
1. Admin uploads CSV files with card data
2. Background jobs process and validate card information
3. eBay API integration finds missing card images
4. Cloudinary optimizes and hosts images
5. Price data is cached and refreshed periodically

### User Collection Flow
1. Users browse cards through optimized pagination
2. Cards can be added to collection or wishlist
3. Collection statistics are calculated and cached
4. Market pricing updates run in background

### Performance Monitoring
- API response time tracking with performance headers
- Slow query detection (>100ms logged)
- Database query optimization metrics
- Memory usage monitoring for large datasets

## External Dependencies

### Production APIs
- **eBay Finding API**: Card image search and pricing
- **eBay OAuth**: API authentication
- **Stripe API**: Payment processing
- **Firebase Auth**: User authentication
- **Cloudinary**: Image processing and CDN

### Development Tools
- **Drizzle Kit**: Database migrations and schema management
- **Vite**: Frontend build tool with HMR
- **ESBuild**: Backend TypeScript compilation
- **Replit**: Development and deployment platform

### Key NPM Packages
- Database: `@neondatabase/serverless`, `drizzle-orm`
- UI Components: `@radix-ui/*` component library
- Forms: `react-hook-form`, `@hookform/resolvers`
- Authentication: `firebase`
- Payments: `@stripe/stripe-js`, `@stripe/react-stripe-js`
- Image Processing: `cloudinary`, `multer`

## Deployment Strategy

### Replit Deployment
- **Build Command**: `npm run build` - Compiles both frontend and backend
- **Start Command**: `npm run start` - Runs production server
- **Development**: `npm run dev` - Starts development server with HMR
- **Port Configuration**: Internal port 5000, external port 80
- **Environment**: Node.js 20 with PostgreSQL 16 module

### Database Management
- **Migrations**: `npm run db:push` - Applies schema changes
- **Performance Indexes**: Pre-configured for 60,000+ card optimization
- **Connection Pooling**: Neon serverless with WebSocket support

### Production Considerations
- Environment variables for all external API keys
- Rate limiting implementation for eBay API compliance
- Cached data strategies to minimize API calls
- Background job management for heavy operations
- Image optimization pipeline through Cloudinary

## Changelog

```
Changelog:
- June 17, 2025. Initial setup
```

## User Preferences

```
Preferred communication style: Simple, everyday language.
```