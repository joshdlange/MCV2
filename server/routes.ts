import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCardSetSchema, insertCardSchema, insertUserCollectionSchema, insertUserWishlistSchema, insertUserSchema, insertMainSetSchema, insertFriendSchema, insertMessageSchema, insertBadgeSchema, insertUserBadgeSchema } from "../shared/schema";
import { z } from "zod";
import multer from "multer";
import csv from "csv-parser";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import { ebayPricingService } from "./ebay-pricing";
import admin from "firebase-admin";
import { proxyImage } from "./image-proxy";
import { db } from "./db";
import { cards, cardSets, mainSets, emailLogs, pendingCardImages, insertPendingCardImageSchema, userCollections, userBadges, migrationLogs, migrationLogCards, adminAuditLogs, users, shareLinks } from "../shared/schema";
import { sql, eq, ne, ilike, like, and, or, isNull, count, exists, desc } from "drizzle-orm";
import { findAndUpdateCardImage, batchUpdateCardImages } from "./ebay-image-finder";
import { registerPerformanceRoutes } from "./performance-routes";
import { badgeService } from "./badge-service";
import { marketTrendsService } from "./market-trends-service";
import { ebayBrowseApi } from "./ebay-browse-api";
import { ebayMarketplaceInsights } from "./ebay-marketplace-insights";
import { sendEmail } from "./email";
import { syncFirebaseUsersToBrevo } from "./contactsSync";
import { emailService } from "./services/emailService";
import * as emailTriggers from "./services/emailTriggers";
import { startEmailCronJobs } from "./jobs/emailCron";
import { uploadUserCardImage, uploadMainSetThumbnail, downloadAndUploadToCloudinary, isCloudinaryUrl } from "./cloudinary";
import { registerMarketplaceRoutes } from "./marketplace-routes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  });
}

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware to authenticate Firebase users
const authenticateUser = async (req: any, res: any, next: any) => {
  console.log("AUTH MIDDLEWARE HIT");
  console.log("Authorization Header:", req.headers.authorization);
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log("No auth header or doesn't start with Bearer");
    return res.status(401).json({ message: 'No authorization token provided' });
  }

  const token = authHeader.substring(7);
  console.log("Token extracted:", token);
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log("Token verified successfully for:", decodedToken.uid);
    
    // Find user by Firebase UID
    const user = await storage.getUserByFirebaseUid(decodedToken.uid);
    console.log("User found in DB:", user ? `ID: ${user.id}` : 'Not found');
    
    if (!user) {
      console.log("User not found in database");
      return res.status(404).json({ message: 'User not found in database' });
    }

    // Track user login (async, don't wait for it)
    storage.recordUserLogin(decodedToken.uid).catch(error => {
      console.error('Failed to track login for user:', decodedToken.uid, error);
    });
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ message: 'Invalid authorization token' });
  }
};

function validateCriticalDependencies() {
  const missing: string[] = [];
  
  if (typeof users === 'undefined') missing.push('users (schema table)');
  if (typeof userCollections === 'undefined') missing.push('userCollections (schema table)');
  if (typeof cards === 'undefined') missing.push('cards (schema table)');
  if (typeof cardSets === 'undefined') missing.push('cardSets (schema table)');
  if (typeof mainSets === 'undefined') missing.push('mainSets (schema table)');
  if (typeof db === 'undefined') missing.push('db (database connection)');
  if (typeof eq === 'undefined') missing.push('eq (drizzle operator)');
  if (typeof sql === 'undefined') missing.push('sql (drizzle operator)');
  if (typeof storage === 'undefined') missing.push('storage (storage interface)');
  if (typeof insertUserCollectionSchema === 'undefined') missing.push('insertUserCollectionSchema');
  if (typeof insertUserWishlistSchema === 'undefined') missing.push('insertUserWishlistSchema');
  if (typeof badgeService === 'undefined') missing.push('badgeService');
  
  if (!users?.plan) missing.push('users.plan (column reference)');
  if (!users?.id) missing.push('users.id (column reference)');
  if (!users?.shippingAddressJson) missing.push('users.shippingAddressJson (column reference)');
  if (!userCollections?.userId) missing.push('userCollections.userId (column reference)');
  if (!userCollections?.cardId) missing.push('userCollections.cardId (column reference)');
  
  if (typeof storage?.addToCollection !== 'function') missing.push('storage.addToCollection()');
  if (typeof storage?.removeFromCollection !== 'function') missing.push('storage.removeFromCollection()');
  if (typeof storage?.updateCollectionItem !== 'function') missing.push('storage.updateCollectionItem()');
  if (typeof storage?.addToWishlist !== 'function') missing.push('storage.addToWishlist()');
  if (typeof storage?.removeFromWishlist !== 'function') missing.push('storage.removeFromWishlist()');
  if (typeof storage?.getUserCollection !== 'function') missing.push('storage.getUserCollection()');
  if (typeof storage?.getUserWishlist !== 'function') missing.push('storage.getUserWishlist()');

  if (missing.length > 0) {
    const errorMsg = `CRITICAL STARTUP ERROR: Missing dependencies for core collection/wishlist functionality:\n  - ${missing.join('\n  - ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  console.log('Core dependency validation passed: collection & wishlist endpoints ready');
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  validateCriticalDependencies();
  
  // Health check endpoint for deployment
  app.get("/health", (req, res) => {
    res.json({ 
      status: "healthy",
      message: "Marvel Card Vault API is running",
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    });
  });

  app.get("/.well-known/assetlinks.json", (req, res) => {
    const assetLinks = [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.marvelcardvault.app",
          sha256_cert_fingerprints: [process.env.ANDROID_SHA256_FINGERPRINT || ""]
        }
      }
    ];
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(assetLinks);
  });

  // Create admin user endpoint (only for initial setup)
  app.post("/api/admin/create-user", async (req, res) => {
    try {
      const adminData = {
        firebaseUid: 'admin-' + Date.now(),
        username: 'admin',
        email: 'admin@marvelcardvault.com',
        displayName: 'Admin User',
        isAdmin: true,
        plan: 'SUPER_HERO',
        subscriptionStatus: 'active'
      };
      
      const existingUser = await storage.getUserByFirebaseUid(adminData.firebaseUid);
      if (existingUser) {
        return res.json({ message: 'Admin user already exists', user: existingUser });
      }
      
      const user = await storage.createUser(adminData);
      res.json({ message: 'Admin user created', user });
    } catch (error) {
      console.error('Error creating admin user:', error);
      res.status(500).json({ message: 'Failed to create admin user' });
    }
  });

  // Auth Routes - Sync Firebase user with backend
  app.post("/api/auth/sync", async (req, res) => {
    try {
      const { firebaseUid, email, displayName } = req.body;
      
      if (!firebaseUid || !email) {
        return res.status(400).json({ message: 'Firebase UID and email are required' });
      }

      console.log('Auth sync request for:', firebaseUid, email);

      // Check if user exists
      let user = await storage.getUserByFirebaseUid(firebaseUid);
      
      if (!user) {
        // Create new user - check if this should be an admin user
        const isAdminEmail = email === 'joshdlange045@gmail.com';
        const userData = {
          firebaseUid,
          username: email.split('@')[0],
          email,
          displayName: displayName || email.split('@')[0],
          isAdmin: isAdminEmail,
          plan: 'SIDE_KICK',
          subscriptionStatus: 'active'
        };
        
        user = await storage.createUser(userData);
        console.log('Created new user:', user.id, 'isAdmin:', user.isAdmin);
        
        // Note: Welcome email is now sent after onboarding is complete
        // so we have their actual chosen username, not just email prefix
        
        // Auto-friend new users with Joshua (admin user ID: 337)
        if (!isAdminEmail && user.id !== 337) {
          try {
            console.log('Attempting to auto-friend user', user.id, 'with Joshua (337)');
            // Check if friendship already exists
            const existingFriendship = await storage.getFriendshipStatus(337, user.id);
            console.log('Existing friendship check result:', existingFriendship);
            if (!existingFriendship) {
              // Create friendship - Joshua as requester, new user as recipient, auto-accepted
              console.log('Creating friend request from Joshua (337) to user', user.id);
              await storage.sendFriendRequest(337, user.id);
              const friendship = await storage.getFriendshipStatus(337, user.id);
              console.log('Friendship created:', friendship);
              if (friendship) {
                console.log('Accepting friendship with ID:', friendship.id);
                await storage.respondToFriendRequest(friendship.id, 'accepted');
                console.log('Auto-friended new user', user.id, 'with Joshua (337)');
              }
            } else {
              console.log('Friendship already exists, skipping auto-friend');
            }
          } catch (error) {
            console.error('Error auto-friending new user:', error);
            // Don't fail the user creation if auto-friending fails
          }
        }
      } else {
        console.log('Found existing user:', user.id, 'isAdmin:', user.isAdmin);
        
        // Ensure admin status is correct for known admin users
        if (user && email === 'joshdlange045@gmail.com' && !user.isAdmin) {
          await storage.updateUser(user.id, { isAdmin: true });
          user = await storage.getUserByFirebaseUid(firebaseUid);
          console.log('Updated user admin status:', user?.isAdmin);
        }
      }
      
      // Check badges on login/sync
      if (user) {
        await badgeService.checkBadgesOnLogin(user.id);
        
        // Run retroactive badge checks for new users
        if (!user.lastLogin) {
          await badgeService.runRetroactiveBadgeChecks(user.id);
        }
      }
      
      res.json({ user });
    } catch (error) {
      console.error('Auth sync error:', error);
      res.status(500).json({ message: 'Failed to sync user' });
    }
  });

  // Get current user
  app.get("/api/auth/me", authenticateUser, (req: any, res) => {
    res.json({ user: req.user });
  });

  // Onboarding routes
  app.get("/api/onboarding/check-username", authenticateUser, async (req: any, res) => {
    try {
      const username = req.query.username as string;
      
      // Validate username format (3-20 chars, lowercase, underscores only)
      const usernameRegex = /^[a-z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        return res.status(400).json({ 
          available: false,
          message: 'Username must be 3-20 characters, lowercase letters, numbers, and underscores only' 
        });
      }
      
      // Check if username is already taken by another user
      const existingUser = await storage.getUserByUsername(username);
      // Allow current user to keep their own username
      const isAvailable = !existingUser || existingUser.id === req.user.id;
      
      res.json({ 
        available: isAvailable,
        message: isAvailable ? 'Username is available' : 'Username is already taken'
      });
    } catch (error) {
      console.error('Check username error:', error);
      res.status(500).json({ message: 'Failed to check username availability' });
    }
  });

  app.post("/api/onboarding/complete", authenticateUser, async (req: any, res) => {
    try {
      const { username, heardAbout, favoriteSets, marketingOptIn } = req.body;
      
      // Validate username format
      const usernameRegex = /^[a-z0-9_]{3,20}$/;
      if (!usernameRegex.test(username)) {
        return res.status(400).json({ 
          message: 'Invalid username format' 
        });
      }
      
      // Check if username is taken by another user
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser && existingUser.id !== req.user.id) {
        return res.status(400).json({ 
          message: 'Username is already taken' 
        });
      }
      
      // Update user with onboarding data
      const updatedUser = await storage.updateUser(req.user.id, {
        username,
        heardAbout,
        favoriteSets: favoriteSets ? [favoriteSets] : [],
        marketingOptIn: marketingOptIn || false,
        onboardingComplete: true
      });
      
      // Send welcome email now that we have their actual username
      emailTriggers.onUserSignup({
        email: req.user.email,
        displayName: updatedUser.displayName || username,
        username: username
      }).catch(error => {
        console.error('Failed to send welcome email:', error);
      });
      
      res.json({ user: updatedUser });
    } catch (error) {
      console.error('Complete onboarding error:', error);
      res.status(500).json({ message: 'Failed to complete onboarding' });
    }
  });

  // Get all users (admin only)
  app.get("/api/users", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Admin users endpoint - matches frontend expectation
  app.get("/api/admin/users", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const users = await storage.getAllUsers();
      
      const cardCountsResult = await db.execute(sql`
        SELECT user_id, COUNT(*) as card_count 
        FROM user_collections 
        GROUP BY user_id
      `);
      const cardCountMap = new Map<number, number>();
      for (const row of cardCountsResult.rows as any[]) {
        cardCountMap.set(row.user_id, parseInt(row.card_count));
      }
      
      const usersWithCounts = users.map(user => ({
        ...user,
        cardsInCollection: cardCountMap.get(user.id) || 0
      }));
      
      res.json(usersWithCounts);
    } catch (error) {
      console.error('Get admin users error:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Admin quick stats - real-time data
  app.get("/api/admin/stats", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      // Get total users
      const usersResult = await db.execute(sql`SELECT COUNT(*) as total FROM users`);
      const totalUsers = parseInt((usersResult.rows[0] as any).total) || 0;

      // Get monthly active users (last 30 days)
      const mauResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM users 
        WHERE last_login >= NOW() - INTERVAL '30 days'
      `);
      const monthlyActiveUsers = parseInt((mauResult.rows[0] as any).total) || 0;

      // Get total card sets
      const setsResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM card_sets WHERE is_active = true
      `);
      const totalSets = parseInt((setsResult.rows[0] as any).total) || 0;

      // Get total cards
      const cardsResult = await db.execute(sql`SELECT COUNT(*) as total FROM cards`);
      const totalCards = parseInt((cardsResult.rows[0] as any).total) || 0;

      // Get paid users (users on SUPER_HERO plan)
      const paidUsersResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM users 
        WHERE plan = 'SUPER_HERO'
      `);
      const paidUsers = parseInt((paidUsersResult.rows[0] as any).total) || 0;

      // Get cards without images
      const cardsWithoutImagesResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM cards 
        WHERE front_image_url IS NULL 
           OR front_image_url = '' 
           OR front_image_url = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png'
      `);
      const cardsWithoutImages = parseInt((cardsWithoutImagesResult.rows[0] as any).total) || 0;

      // Calculate MAU percentage
      const mauPercent = totalUsers > 0 ? Math.round((monthlyActiveUsers / totalUsers) * 100) : 0;

      res.json({
        totalUsers,
        monthlyActiveUsers,
        mauPercent,
        paidUsers,
        totalSets,
        totalCards,
        cardsWithoutImages
      });
    } catch (error) {
      console.error('Admin stats error:', error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Update user
  app.put("/api/users/:id", authenticateUser, async (req: any, res) => {
    try {
      const userId = parseInt(req.params.id);
      const updates = req.body;
      
      // Users can only update their own profile, unless they're admin
      if (!req.user.isAdmin && req.user.id !== userId) {
        return res.status(403).json({ message: 'Can only update your own profile' });
      }
      
      const updatedUser = await storage.updateUser(userId, updates);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const userId = parseInt(req.params.id);
      await storage.deleteUser(userId);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Get user profile
  app.get("/api/user/profile", authenticateUser, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error('Get user profile error:', error);
      res.status(500).json({ message: "Failed to fetch user profile" });
    }
  });

  // Update user profile - includes shipping address sync
  app.patch("/api/user/profile", authenticateUser, async (req: any, res) => {
    try {
      const { displayName, bio, location, website, address, privacySettings, notifications } = req.body;
      
      const updates: any = {};
      
      if (displayName !== undefined) updates.displayName = displayName;
      if (bio !== undefined) updates.bio = bio;
      if (location !== undefined) updates.location = location;
      if (website !== undefined) updates.website = website;
      
      // Privacy settings
      if (privacySettings) {
        if (privacySettings.showEmail !== undefined) updates.showEmail = privacySettings.showEmail;
        if (privacySettings.showCollection !== undefined) updates.showCollection = privacySettings.showCollection;
        if (privacySettings.showWishlist !== undefined) updates.showWishlist = privacySettings.showWishlist;
      }
      
      // Notification settings
      if (notifications) {
        if (notifications.emailUpdates !== undefined) updates.emailUpdates = notifications.emailUpdates;
        if (notifications.priceAlerts !== undefined) updates.priceAlerts = notifications.priceAlerts;
        if (notifications.friendActivity !== undefined) updates.friendActivity = notifications.friendActivity;
      }
      
      // Convert address to shippingAddressJson for marketplace compatibility
      if (address && (address.street || address.city || address.state || address.postalCode)) {
        const shippingAddress = {
          name: displayName || req.user.displayName || '',
          street1: address.street || '',
          street2: '',
          city: address.city || '',
          state: address.state || '',
          zip: address.postalCode || '',
          country: address.country || 'US',
          phone: ''
        };
        updates.shippingAddressJson = JSON.stringify(shippingAddress);
      }
      
      const updatedUser = await storage.updateUser(req.user.id, updates);
      res.json(updatedUser);
    } catch (error) {
      console.error('Update user profile error:', error);
      res.status(500).json({ message: "Failed to update user profile" });
    }
  });

  // Main Sets Routes
  // PUBLIC: Only return CANONICAL main sets that are active and have actual cards
  app.get("/api/main-sets", async (req, res) => {
    try {
      // Filter by:
      // 1. isActive = true (not archived)
      // 2. isCanonical = true (from CSV import, not legacy duplicates)
      // 3. Has at least one card in database
      const populatedMainSets = await db
        .select()
        .from(mainSets)
        .where(
          and(
            eq(mainSets.isActive, true),
            eq(mainSets.isCanonical, true),
            exists(
              db.select({ one: sql`1` })
                .from(cards)
                .innerJoin(cardSets, eq(cards.setId, cardSets.id))
                .where(eq(cardSets.mainSetId, mainSets.id))
            )
          )
        )
        .orderBy(desc(mainSets.createdAt));
      
      res.json(populatedMainSets);
    } catch (error) {
      console.error('Get main sets error:', error);
      res.status(500).json({ message: "Failed to fetch main sets" });
    }
  });

  // Still Populating: Canonical main sets with zero cards across all subsets
  // These are NOT shown in the active Master Sets section (which requires actual cards)
  // OPTIMIZED: Uses aggregation with LEFT JOIN instead of scalar subqueries
  app.get("/api/main-sets/still-populating", async (req, res) => {
    try {
      // Optimized query using aggregation with JOINs to find main sets where:
      // 1. Has at least one canonical subset
      // 2. Total cards across ALL subsets = 0
      const stillPopulatingMainSets = await db.execute(sql`
        WITH card_counts AS (
          SELECT set_id, COUNT(*) as card_count
          FROM cards
          GROUP BY set_id
        ),
        main_set_stats AS (
          SELECT 
            cs.main_set_id,
            MAX(cs.year) as max_year,
            SUM(CASE WHEN cs.canonical_source = 'csv_master' OR cs.is_canonical = true THEN 1 ELSE 0 END) as canonical_count,
            COALESCE(SUM(cc.card_count), 0) as total_cards
          FROM card_sets cs
          LEFT JOIN card_counts cc ON cc.set_id = cs.id
          WHERE cs.main_set_id IS NOT NULL
            AND cs.is_active = true
          GROUP BY cs.main_set_id
          HAVING SUM(CASE WHEN cs.canonical_source = 'csv_master' OR cs.is_canonical = true THEN 1 ELSE 0 END) > 0
        )
        SELECT ms.*, COALESCE(mss.max_year, 0) as sort_year
        FROM main_sets ms
        INNER JOIN main_set_stats mss ON mss.main_set_id = ms.id
        WHERE mss.total_cards = 0
          AND ms.is_active = true
        ORDER BY mss.max_year DESC, ms.name ASC
      `);
      
      res.json(stillPopulatingMainSets.rows);
    } catch (error) {
      console.error('Get still-populating main sets error:', error);
      res.status(500).json({ message: "Failed to fetch still-populating main sets" });
    }
  });

  app.get("/api/main-sets/:identifier", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const identifier = req.params.identifier;
      let mainSet;
      
      // Check if identifier is numeric (ID) or slug
      if (/^\d+$/.test(identifier)) {
        const id = parseInt(identifier);
        mainSet = await storage.getMainSet(id);
      } else {
        mainSet = await storage.getMainSetBySlug(identifier);
      }
      
      if (!mainSet) {
        return res.status(404).json({ message: "Main set not found" });
      }
      
      res.json(mainSet);
    } catch (error) {
      console.error('Get main set error:', error);
      res.status(500).json({ message: "Failed to fetch main set" });
    }
  });

  app.post("/api/main-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const validatedData = insertMainSetSchema.parse(req.body);
      const mainSet = await storage.createMainSet(validatedData);
      
      // Auto-suggest and assign matching base sets
      const matchingBaseSets = await storage.findMatchingBaseSets(validatedData.name);
      let suggestedAssignments = [];
      let conflictingSets = [];
      
      if (matchingBaseSets.length > 0) {
        console.log(`Found ${matchingBaseSets.length} potential base sets for "${validatedData.name}":`, 
          matchingBaseSets.map(set => ({ id: set.id, name: set.name, mainSetId: set.mainSetId })));
        
        // Auto-assign exact matches that are unassigned
        for (const baseSet of matchingBaseSets) {
          const isExactMatch = baseSet.name.toLowerCase().trim() === validatedData.name.toLowerCase().trim();
          
          if (isExactMatch && !baseSet.mainSetId) {
            await storage.updateCardSet(baseSet.id, { mainSetId: mainSet.id });
            suggestedAssignments.push(baseSet);
            console.log(`AUTO-ASSIGNED: Base set "${baseSet.name}" (ID: ${baseSet.id}) to main set "${mainSet.name}" (ID: ${mainSet.id})`);
          } else if (isExactMatch && baseSet.mainSetId) {
            conflictingSets.push({ ...baseSet, reason: `Already assigned to main set ID ${baseSet.mainSetId}` });
            console.warn(`CONFLICT: Base set "${baseSet.name}" (ID: ${baseSet.id}) already assigned to main set ID ${baseSet.mainSetId}`);
          }
        }
      } else {
        console.log(`No matching base sets found for main set: "${validatedData.name}"`);
      }
      
      res.status(201).json({ 
        mainSet, 
        suggestedAssignments,
        conflictingSets,
        matchingBaseSets: matchingBaseSets.filter(set => set.mainSetId !== null)
      });
    } catch (error) {
      console.error('Create main set error:', error);
      res.status(500).json({ message: "Failed to create main set" });
    }
  });

  const updateMainSetHandler = async (req: any, res: any) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const validatedData = insertMainSetSchema.partial().parse(req.body);
      
      // Prevent empty thumbnailImageUrl from overwriting existing values
      // Only update thumbnail if it's actually provided with a non-empty value
      if (validatedData.thumbnailImageUrl !== undefined) {
        if (!validatedData.thumbnailImageUrl || validatedData.thumbnailImageUrl.trim() === '') {
          // Empty value - remove from update to preserve existing thumbnail
          delete validatedData.thumbnailImageUrl;
          console.log(`Ignoring empty thumbnailImageUrl for main set ${id} to preserve existing value`);
        } else if (!isCloudinaryUrl(validatedData.thumbnailImageUrl)) {
          // External URL - download and upload to Cloudinary
          console.log(`Downloading external thumbnail for main set ${id}: ${validatedData.thumbnailImageUrl}`);
          try {
            const cloudinaryUrl = await downloadAndUploadToCloudinary(validatedData.thumbnailImageUrl, id);
            validatedData.thumbnailImageUrl = cloudinaryUrl;
            console.log(`Successfully converted external URL to Cloudinary: ${cloudinaryUrl}`);
          } catch (downloadError) {
            console.error('Failed to download external image, keeping original URL:', downloadError);
            // Keep the original URL if download fails
          }
        }
      }
      
      const mainSet = await storage.updateMainSet(id, validatedData);
      
      if (!mainSet) {
        return res.status(404).json({ message: "Main set not found" });
      }
      
      res.json(mainSet);
    } catch (error) {
      console.error('Update main set error:', error);
      res.status(500).json({ message: "Failed to update main set" });
    }
  };
  
  app.put("/api/main-sets/:id", authenticateUser, updateMainSetHandler);
  app.patch("/api/main-sets/:id", authenticateUser, updateMainSetHandler);

  app.delete("/api/main-sets/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      await storage.deleteMainSet(id);
      res.json({ message: "Main set deleted successfully" });
    } catch (error) {
      console.error('Delete main set error:', error);
      res.status(500).json({ message: "Failed to delete main set" });
    }
  });

  // Debug endpoint to analyze set assignment exclusions
  app.get("/api/main-sets/:id/assignable-debug", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const mainSetId = parseInt(req.params.id);
      const { search } = req.query;
      
      const allSets = await storage.getCardSets();
      const mainSet = await storage.getMainSet(mainSetId);
      
      if (!mainSet) {
        return res.status(404).json({ message: "Main set not found" });
      }
      
      console.log(`\n=== ASSIGNMENT DEBUG for Main Set: "${mainSet.name}" (ID: ${mainSetId}) ===`);
      
      const analysis = allSets.map(set => {
        const isExactMatch = set.name.toLowerCase().trim() === mainSet.name.toLowerCase().trim();
        const matchesSearch = !search || set.name.toLowerCase().includes((search as string).toLowerCase());
        
        const status = !set.mainSetId ? 'unassigned' : 
                      set.mainSetId === mainSetId ? 'assigned_to_this' : 'assigned_to_other';
        
        const exclusionReasons = [];
        if (!matchesSearch) exclusionReasons.push('search_filter');
        if (set.mainSetId && set.mainSetId !== mainSetId) exclusionReasons.push('assigned_elsewhere');
        
        const result = {
          id: set.id,
          name: set.name,
          mainSetId: set.mainSetId,
          status,
          isExactMatch,
          matchesSearch,
          exclusionReasons,
          isBaseSetsCandidate: isExactMatch || (
            set.name.toLowerCase().includes(mainSet.name.toLowerCase()) && 
            set.name.length <= mainSet.name.length + 20
          )
        };
        
        // Log exact matches and their status
        if (isExactMatch) {
          console.log(`EXACT MATCH: "${set.name}" (ID: ${set.id}) - Status: ${status.toUpperCase()}${exclusionReasons.length > 0 ? ` - Excluded: ${exclusionReasons.join(', ')}` : ''}`);
        }
        
        return result;
      });
      
      const exactMatches = analysis.filter(s => s.isExactMatch);
      const availableForAssignment = analysis.filter(s => s.status === 'unassigned' && s.matchesSearch);
      
      console.log(`Total sets: ${allSets.length}`);
      console.log(`Exact name matches: ${exactMatches.length}`);
      console.log(`Available for assignment: ${availableForAssignment.length}`);
      console.log(`=== END DEBUG ===\n`);
      
      res.json({
        mainSet,
        searchTerm: search || null,
        totalSets: allSets.length,
        exactMatches: exactMatches.length,
        unassigned: analysis.filter(s => s.status === 'unassigned').length,
        assignedToThis: analysis.filter(s => s.status === 'assigned_to_this').length,
        assignedToOther: analysis.filter(s => s.status === 'assigned_to_other').length,
        availableForAssignment: availableForAssignment.length,
        baseSetsCandidate: analysis.filter(s => s.isBaseSetsCandidate),
        analysis
      });
    } catch (error) {
      console.error('Debug assignable sets error:', error);
      res.status(500).json({ message: "Failed to analyze assignable sets" });
    }
  });

  // Update card set assignments to main set
  app.patch("/api/main-sets/:id/assign-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const mainSetId = parseInt(req.params.id);
      const { cardSetIds } = req.body;
      
      if (!Array.isArray(cardSetIds)) {
        return res.status(400).json({ message: "cardSetIds must be an array" });
      }
      
      // Update all provided card sets to reference this main set
      for (const cardSetId of cardSetIds) {
        await storage.updateCardSet(cardSetId, { mainSetId });
      }
      
      res.json({ message: "Card sets assigned successfully" });
    } catch (error) {
      console.error('Assign sets error:', error);
      res.status(500).json({ message: "Failed to assign sets" });
    }
  });

  // Remove card set assignments from main set
  app.patch("/api/main-sets/:id/unassign-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { cardSetIds } = req.body;
      
      if (!Array.isArray(cardSetIds)) {
        return res.status(400).json({ message: "cardSetIds must be an array" });
      }
      
      // Remove main set reference from provided card sets
      for (const cardSetId of cardSetIds) {
        await storage.updateCardSet(cardSetId, { mainSetId: null });
      }
      
      res.json({ message: "Card sets unassigned successfully" });
    } catch (error) {
      console.error('Unassign sets error:', error);
      res.status(500).json({ message: "Failed to unassign sets" });
    }
  });

  // Upload main set thumbnail image
  app.post("/api/main-sets/:id/upload-thumbnail", authenticateUser, upload.single('image'), async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const mainSetId = parseInt(req.params.id);
      
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }
      
      // Upload to Cloudinary
      const cloudinaryUrl = await uploadMainSetThumbnail(req.file.buffer, mainSetId);
      
      // Update main set with new thumbnail URL
      const updatedMainSet = await storage.updateMainSet(mainSetId, { 
        thumbnailImageUrl: cloudinaryUrl 
      });
      
      if (!updatedMainSet) {
        return res.status(404).json({ message: "Main set not found" });
      }
      
      console.log(`Uploaded thumbnail for main set ${mainSetId}: ${cloudinaryUrl}`);
      res.json({ 
        message: "Thumbnail uploaded successfully", 
        thumbnailImageUrl: cloudinaryUrl,
        mainSet: updatedMainSet
      });
    } catch (error) {
      console.error('Upload main set thumbnail error:', error);
      res.status(500).json({ message: "Failed to upload thumbnail" });
    }
  });

  // ADMIN: Get all main sets including archived and legacy (for admin tools)
  app.get("/api/admin/main-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const allMainSets = await storage.getMainSets();
      res.json(allMainSets);
    } catch (error) {
      console.error('Get admin main sets error:', error);
      res.status(500).json({ message: "Failed to fetch main sets" });
    }
  });

  // Get all card sets with optimized counting
  app.get("/api/card-sets", async (req, res) => {
    try {
      const cardSets = await storage.getCardSets();
      res.json(cardSets);
    } catch (error) {
      console.error('Get card sets error:', error);
      res.status(500).json({ message: "Failed to fetch card sets" });
    }
  });

  // Get first card images for multiple sets (for thumbnails)
  app.get("/api/card-sets/first-images", async (req, res) => {
    try {
      const setIdsParam = req.query.setIds as string;
      if (!setIdsParam) {
        return res.json({});
      }
      const setIds = setIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      if (setIds.length === 0) {
        return res.json({});
      }
      
      const result = await db.execute(sql`
        SELECT DISTINCT ON (set_id) 
          set_id as "setId", 
          front_image_url as "frontImageUrl"
        FROM cards 
        WHERE set_id = ANY(${sql.raw(`ARRAY[${setIds.join(',')}]::int[]`)}) 
          AND front_image_url IS NOT NULL 
          AND front_image_url != ''
          AND front_image_url NOT LIKE '%placeholder%'
          AND front_image_url NOT LIKE '%superhero-fallback%'
        ORDER BY set_id, 
          CASE WHEN card_number ~ '^[0-9]+$' THEN card_number::integer ELSE 999999 END,
          card_number, id
      `);
      
      const imageMap: Record<number, string> = {};
      for (const row of result.rows as any[]) {
        imageMap[row.setId] = row.frontImageUrl;
      }
      
      res.json(imageMap);
    } catch (error) {
      console.error('Get first card images error:', error);
      res.status(500).json({ message: "Failed to fetch first card images" });
    }
  });

  // Get card sets by main set ID (for edit dialog - only loads assigned sets)
  app.get("/api/card-sets/by-main-set/:mainSetId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const mainSetId = parseInt(req.params.mainSetId);
      const assignedSets = await db.select()
        .from(cardSets)
        .where(eq(cardSets.mainSetId, mainSetId))
        .orderBy(desc(cardSets.year), cardSets.name);
      
      res.json(assignedSets);
    } catch (error) {
      console.error('Get card sets by main set error:', error);
      res.status(500).json({ message: "Failed to fetch card sets" });
    }
  });

  // Search card sets with pagination for assignment (admin only)
  app.get("/api/card-sets/search-for-assignment", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { q, limit = "50" } = req.query as { q?: string; limit?: string };
      
      if (!q || q.length < 2) {
        return res.json([]);
      }
      
      const searchPattern = `%${q}%`;
      const searchResults = await db.select()
        .from(cardSets)
        .where(
          or(
            ilike(cardSets.name, searchPattern),
            sql`${cardSets.year}::text LIKE ${searchPattern}`
          )
        )
        .orderBy(desc(cardSets.year), cardSets.name)
        .limit(parseInt(limit));
      
      res.json(searchResults);
    } catch (error) {
      console.error('Search card sets for assignment error:', error);
      res.status(500).json({ message: "Failed to search card sets" });
    }
  });

  // Get unassigned card sets (mainSetId IS NULL)
  app.get("/api/card-sets/unassigned", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const unassignedSets = await storage.getUnassignedCardSets();
      console.log(`DEBUG: Found ${unassignedSets.length} unassigned sets:`, unassignedSets.slice(0, 5).map(s => ({id: s.id, name: s.name, year: s.year})));
      res.json(unassignedSets);
    } catch (error) {
      console.error('Get unassigned card sets error:', error);
      res.status(500).json({ message: "Failed to fetch unassigned card sets" });
    }
  });

  // Debug endpoint to check set assignments by name pattern
  app.get("/api/debug/sets-by-name/:pattern", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const pattern = req.params.pattern;
      const sets = await db.select({
        id: cardSets.id,
        name: cardSets.name,
        year: cardSets.year,
        mainSetId: cardSets.mainSetId,
        totalCards: sql<number>`COALESCE(COUNT(${cards.id}), 0)`
      })
      .from(cardSets)
      .leftJoin(cards, eq(cardSets.id, cards.setId))
      .where(ilike(cardSets.name, `%${pattern}%`))
      .groupBy(cardSets.id, cardSets.name, cardSets.year, cardSets.mainSetId)
      .orderBy(cardSets.name);
      
      res.json(sets);
    } catch (error) {
      console.error('Debug sets by name error:', error);
      res.status(500).json({ message: "Failed to fetch sets by name" });
    }
  });

  // Search card sets
  app.get("/api/card-sets/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }
      
      const cardSets = await storage.searchCardSets(query);
      res.json(cardSets);
    } catch (error) {
      console.error('Search card sets error:', error);
      res.status(500).json({ message: "Failed to search card sets" });
    }
  });

  // Get card set by ID or slug
  app.get("/api/card-sets/:identifier", async (req, res) => {
    try {
      const identifier = req.params.identifier;
      let cardSet;
      
      // Check if identifier is numeric (ID) or slug
      if (/^\d+$/.test(identifier)) {
        const id = parseInt(identifier);
        cardSet = await storage.getCardSet(id);
      } else {
        cardSet = await storage.getCardSetBySlug(identifier);
      }
      
      if (!cardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }
      
      res.json(cardSet);
    } catch (error) {
      console.error('Get card set error:', error);
      res.status(500).json({ message: "Failed to fetch card set" });
    }
  });

  // Create card set (admin only)
  app.post("/api/card-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const validatedData = insertCardSetSchema.parse(req.body);
      const cardSet = await storage.createCardSet(validatedData);
      res.status(201).json(cardSet);
    } catch (error) {
      console.error('Create card set error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create card set" });
    }
  });

  // Update card set (admin only) - supports both PUT and PATCH
  const updateCardSetHandler = async (req: any, res: any) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const updatedCardSet = await storage.updateCardSet(id, updates);
      if (!updatedCardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }
      
      res.json(updatedCardSet);
    } catch (error) {
      console.error('Update card set error:', error);
      res.status(500).json({ message: "Failed to update card set" });
    }
  };
  
  app.put("/api/card-sets/:id", authenticateUser, updateCardSetHandler);
  app.patch("/api/card-sets/:id", authenticateUser, updateCardSetHandler);

  // Get all cards with filters - ULTRA-OPTIMIZED
  app.get("/api/cards", async (req, res) => {
    const startTime = Date.now();
    try {
      const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const lightweight = req.query.lightweight === 'true';
      
      const filters: any = {};
      if (req.query.setId) filters.setId = parseInt(req.query.setId as string);
      if (req.query.rarity) filters.rarity = req.query.rarity as string;
      if (req.query.isInsert) filters.isInsert = req.query.isInsert === 'true';
      if (req.query.hasImage !== undefined) filters.hasImage = req.query.hasImage === 'true';
      if (req.query.search) filters.search = req.query.search as string;
      
      const result = lightweight 
        ? await ultraOptimizedStorage.getLightweightCardsPaginated(page, pageSize, filters)
        : await ultraOptimizedStorage.getCardsPaginated(page, pageSize, filters);
      
      // Add performance header
      const duration = Date.now() - startTime;
      res.set('X-Query-Time', `${duration}ms`);
      
      res.json(result);
    } catch (error) {
      console.error('Get cards error:', error);
      res.status(500).json({ message: "Failed to fetch cards" });
    }
  });

  // Get cards by set ID
  app.get("/api/sets/:setId/cards", async (req, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 36, 100); // Max 100
      const offset = (page - 1) * limit;
      
      // Use paginated query for performance with large sets
      const result = await db.execute(sql`
        SELECT 
          c.id, c.set_id as "setId", c.card_number as "cardNumber", c.name, 
          c.variation, c.is_insert as "isInsert", c.front_image_url as "frontImageUrl",
          c.back_image_url as "backImageUrl", c.description, c.rarity, 
          c.estimated_value as "estimatedValue", c.created_at as "createdAt",
          cs.name as "setName", cs.slug as "setSlug", cs.year as "setYear",
          cs.description as "setDescription", cs.image_url as "setImageUrl",
          cs.total_cards as "setTotalCards", cs.main_set_id as "setMainSetId"
        FROM cards c
        LEFT JOIN card_sets cs ON c.set_id = cs.id
        WHERE c.set_id = ${setId}
        ORDER BY 
          CASE WHEN c.card_number ~ '^[0-9]+$' THEN c.card_number::integer ELSE 999999 END,
          c.card_number, c.id
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int as total FROM cards WHERE set_id = ${setId}
      `);
      
      const cards = result.rows.map((row: any) => ({
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: {
          id: row.setId,
          name: row.setName,
          slug: row.setSlug,
          year: row.setYear,
          description: row.setDescription,
          imageUrl: row.setImageUrl,
          totalCards: row.setTotalCards,
          mainSetId: row.setMainSetId
        }
      }));
      
      res.json({
        cards,
        total: countResult.rows[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult.rows[0].total / limit)
      });
    } catch (error) {
      console.error('Get cards by set error:', error);
      res.status(500).json({ message: "Failed to fetch cards for set" });
    }
  });

  // Get single card
  app.get("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const card = await storage.getCard(id);
      
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      res.json(card);
    } catch (error) {
      console.error('Get card error:', error);
      res.status(500).json({ message: "Failed to fetch card" });
    }
  });

  // Create card (admin only)
  app.post("/api/cards", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const validatedData = insertCardSchema.parse(req.body);
      const card = await storage.createCard(validatedData);
      
      // Clear cache when cards are created
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {
        console.log('Cache clear skipped:', e);
      }
      
      res.status(201).json(card);
    } catch (error) {
      console.error('Create card error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create card" });
    }
  });

  // CSV Upload for cards (admin only)
  app.post("/api/cards/upload-csv", authenticateUser, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No CSV file provided' });
      }

      const setId = parseInt(req.body.setId);
      if (!setId) {
        return res.status(400).json({ message: 'Set ID is required' });
      }

      // Use csv-parser with streams for proper CSV handling
      const rows: any[] = [];
      const errors: string[] = [];
      
      // Strip BOM if present
      let csvBuffer = req.file.buffer;
      if (csvBuffer[0] === 0xEF && csvBuffer[1] === 0xBB && csvBuffer[2] === 0xBF) {
        csvBuffer = csvBuffer.slice(3);
      }
      
      await new Promise<void>((resolve, reject) => {
        const stream = Readable.from(csvBuffer);
        stream
          .pipe(csv({
            mapHeaders: ({ header }: { header: string }) => {
              // Normalize header: trim, lowercase, remove spaces/underscores
              const normalized = header.trim().toLowerCase().replace(/[\s_-]/g, '');
              console.log(`CSV Header mapping: "${header}" -> "${normalized}"`);
              return normalized;
            },
            skipEmptyLines: true
          }))
          .on('data', (row: any) => {
            rows.push(row);
          })
          .on('error', (error: Error) => {
            reject(error);
          })
          .on('end', () => {
            resolve();
          });
      });

      console.log(`CSV parsed ${rows.length} rows`);
      if (rows.length > 0) {
        console.log('First row keys:', Object.keys(rows[0]));
        console.log('First row data:', rows[0]);
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: 'CSV file is empty or has no data rows' });
      }

      // Check required columns - try multiple variations
      const firstRow = rows[0];
      const keys = Object.keys(firstRow);
      
      // Find name column (could be 'name', 'cardname', etc)
      const nameKey = keys.find(k => k === 'name' || k === 'cardname');
      // Find card number column (could be 'cardnumber', 'number', 'card_number', etc)
      const cardNumberKey = keys.find(k => k === 'cardnumber' || k === 'number' || k === 'card#' || k === 'no');

      console.log(`Found name column: "${nameKey}", card number column: "${cardNumberKey}"`);

      if (!nameKey || !cardNumberKey) {
        return res.status(400).json({ 
          message: `CSV must have name and cardNumber columns. Found columns: ${keys.join(', ')}` 
        });
      }

      let successCount = 0;

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          
          const name = row[nameKey]?.trim();
          const cardNumber = row[cardNumberKey]?.trim();
          
          if (!name || !cardNumber) {
            errors.push(`Row ${i + 2}: Missing name or cardNumber`);
            continue;
          }

          const isInsert = (row.isinsert || row.insert)?.toLowerCase() === 'true';
          const rarity = (row.rarity)?.trim() || 'Common';
          const frontImageUrl = (row.frontimageurl || row.frontimage || row.imageurl || row.image)?.trim() || null;
          const backImageUrl = (row.backimageurl || row.backimage)?.trim() || null;
          const description = (row.description || row.desc)?.trim() || null;

          const cardData = {
            name,
            cardNumber,
            setId,
            isInsert,
            rarity,
            frontImageUrl,
            backImageUrl,
            description,
          };

          await storage.createCard(cardData);
          successCount++;
        } catch (rowError: any) {
          console.error(`Row ${i + 2} error:`, rowError);
          errors.push(`Row ${i + 2}: ${rowError.message || 'Unknown error'}`);
        }
      }

      // Log errors before response
      if (errors.length > 0) {
        console.log(`CSV upload had ${errors.length} errors. First 5:`, errors.slice(0, 5));
      }

      // Update the card count for the set
      try {
        const cardCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(cards)
          .where(eq(cards.setId, setId));
        
        await db
          .update(cardSets)
          .set({ totalCards: cardCount[0]?.count || 0 })
          .where(eq(cardSets.id, setId));
        
        console.log(`Updated set ${setId} card count to ${cardCount[0]?.count}`);
      } catch (e) {
        console.log('Card count update skipped:', e);
      }

      // Clear cache after bulk insert
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {
        console.log('Cache clear skipped:', e);
      }

      res.json({
        message: `Successfully uploaded ${successCount} cards`,
        successCount,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ message: "Failed to process CSV upload" });
    }
  });

  // BULK CATALOG IMPORT - Batched processing for large imports (200k+ cards)
  // Processes in batches to avoid blocking the event loop and allows resuming
  app.post("/api/admin/bulk-card-import", authenticateUser, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No CSV file provided' });
      }

      const BATCH_SIZE = parseInt(req.body.batchSize) || 2000;
      const startOffset = parseInt(req.body.startOffset) || 0;
      const dryRun = req.body.dryRun === 'true';

      console.log(`[BULK IMPORT] Starting. Batch size: ${BATCH_SIZE}, Start offset: ${startOffset}, Dry run: ${dryRun}`);

      // Parse CSV
      const rows: any[] = [];
      let csvBuffer = req.file.buffer;
      if (csvBuffer[0] === 0xEF && csvBuffer[1] === 0xBB && csvBuffer[2] === 0xBF) {
        csvBuffer = csvBuffer.slice(3);
      }

      await new Promise<void>((resolve, reject) => {
        const stream = Readable.from(csvBuffer);
        stream
          .pipe(csv({
            mapHeaders: ({ header }: { header: string }) => header.trim().toLowerCase().replace(/[\s_-]/g, ''),
            skipEmptyLines: true
          }))
          .on('data', (row: any) => rows.push(row))
          .on('error', reject)
          .on('end', resolve);
      });

      console.log(`[BULK IMPORT] Parsed ${rows.length} total rows`);

      if (rows.length === 0) {
        return res.status(400).json({ message: 'CSV file is empty' });
      }

      // Find column mappings
      const keys = Object.keys(rows[0]);
      const nameKey = keys.find(k => k === 'name' || k === 'cardname' || k === 'cardtitle');
      const cardNumberKey = keys.find(k => k === 'cardnumber' || k === 'number' || k === 'card#' || k === 'no');
      const setIdKey = keys.find(k => k === 'setid' || k === 'set');
      const subsetKey = keys.find(k => k === 'subsetid' || k === 'subset' || k === 'subsetname');
      const fullComboKey = keys.find(k => k === 'fullcombo');
      const mainSetKey = keys.find(k => k === 'mainset');
      const yearKey = keys.find(k => k === 'year');

      if (!nameKey || !cardNumberKey) {
        return res.status(400).json({ 
          message: `CSV must have name/cardtitle and cardNumber columns. Found: ${keys.join(', ')}` 
        });
      }

      // If no setId column, we need fullCombo or mainset+subset to lookup sets
      const useSetLookup = !setIdKey && (fullComboKey || (mainSetKey && subsetKey));
      
      console.log(`[BULK IMPORT] Columns: name="${nameKey}", cardNumber="${cardNumberKey}", setId="${setIdKey || 'N/A'}", fullCombo="${fullComboKey || 'N/A'}", mainSet="${mainSetKey || 'N/A'}", subset="${subsetKey || 'N/A'}"`);
      console.log(`[BULK IMPORT] Set lookup mode: ${useSetLookup ? 'by name' : 'by ID'}`);

      // Pre-build set lookup cache if using name-based matching
      let setCache: Map<string, number> = new Map();
      if (useSetLookup) {
        console.log(`[BULK IMPORT] Building set name lookup cache...`);
        const allSets = await db.select({ id: cardSets.id, name: cardSets.name }).from(cardSets).where(eq(cardSets.isActive, true));
        for (const set of allSets) {
          // Normalize: lowercase, trim, remove extra spaces
          const normalizedName = set.name.toLowerCase().trim().replace(/\s+/g, ' ');
          setCache.set(normalizedName, set.id);
        }
        console.log(`[BULK IMPORT] Cached ${setCache.size} active sets for lookup`);
      }

      // Process rows in batches starting from offset
      const rowsToProcess = rows.slice(startOffset);
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];
      const setIdsUpdated = new Set<number>();

      for (let batchStart = 0; batchStart < rowsToProcess.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, rowsToProcess.length);
        const batch = rowsToProcess.slice(batchStart, batchEnd);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(rowsToProcess.length / BATCH_SIZE);

        console.log(`[BULK IMPORT] Processing batch ${batchNum}/${totalBatches} (rows ${startOffset + batchStart + 1}-${startOffset + batchEnd})`);

        if (dryRun) {
          // Just validate, don't insert
          for (const row of batch) {
            const name = row[nameKey]?.trim();
            const cardNumber = row[cardNumberKey]?.trim();
            if (name && cardNumber) successCount++;
            else errorCount++;
          }
        } else {
          // Prepare batch insert data
          const insertData: any[] = [];
          
          for (let i = 0; i < batch.length; i++) {
            try {
              const row = batch[i];
              const name = row[nameKey]?.trim();
              const cardNumber = row[cardNumberKey]?.trim();
              
              // Determine setId - either from direct ID column or by name lookup
              let setId: number | null = null;
              
              if (setIdKey && row[setIdKey]?.trim()) {
                setId = parseInt(row[setIdKey]);
              } else if (useSetLookup) {
                // Try fullCombo first, then construct from mainset + subset
                let lookupName = '';
                if (fullComboKey && row[fullComboKey]?.trim()) {
                  lookupName = row[fullComboKey].trim();
                } else if (mainSetKey && row[mainSetKey]?.trim()) {
                  const mainSet = row[mainSetKey].trim();
                  const subset = subsetKey && row[subsetKey]?.trim() ? row[subsetKey].trim() : 'Base';
                  lookupName = `${mainSet} - ${subset}`;
                }
                
                if (lookupName) {
                  const normalized = lookupName.toLowerCase().trim().replace(/\s+/g, ' ');
                  setId = setCache.get(normalized) || null;
                  
                  if (!setId) {
                    // Log first 10 missing sets to help debug
                    if (errors.length < 10) {
                      errors.push(`Row ${startOffset + batchStart + i + 2}: Set not found: "${lookupName}"`);
                    }
                    errorCount++;
                    continue;
                  }
                }
              }

              if (!name || !cardNumber) {
                errors.push(`Row ${startOffset + batchStart + i + 2}: Missing name or cardNumber`);
                errorCount++;
                continue;
              }

              if (!setId) {
                if (errors.length < 10) {
                  errors.push(`Row ${startOffset + batchStart + i + 2}: Missing setId`);
                }
                errorCount++;
                continue;
              }

              setIdsUpdated.add(setId);

              insertData.push({
                name,
                cardNumber,
                setId,
                isInsert: (row.isinsert || row.insert)?.toLowerCase() === 'true',
                rarity: row.rarity?.trim() || 'Common',
                frontImageUrl: (row.frontimageurl || row.frontimage || row.imageurl || row.image)?.trim() || null,
                backImageUrl: (row.backimageurl || row.backimage)?.trim() || null,
                description: (row.description || row.desc)?.trim() || null,
                variation: row.variation?.trim() || null,
              });
            } catch (rowError: any) {
              errors.push(`Row ${startOffset + batchStart + i + 2}: ${rowError.message}`);
              errorCount++;
            }
          }

          // Batch insert using Drizzle
          if (insertData.length > 0) {
            try {
              await db.insert(cards).values(insertData);
              successCount += insertData.length;
              console.log(`[BULK IMPORT] Batch ${batchNum} committed: ${insertData.length} cards`);
            } catch (batchError: any) {
              console.error(`[BULK IMPORT] Batch ${batchNum} failed:`, batchError.message);
              // Fall back to individual inserts for this batch
              for (const cardData of insertData) {
                try {
                  await storage.createCard(cardData);
                  successCount++;
                } catch (e: any) {
                  errors.push(`Card ${cardData.cardNumber} "${cardData.name}": ${e.message}`);
                  errorCount++;
                }
              }
            }
          }
        }

        // Yield to event loop between batches to keep server responsive
        await new Promise(resolve => setImmediate(resolve));
      }

      // Update card counts for affected sets
      if (!dryRun && setIdsUpdated.size > 0) {
        console.log(`[BULK IMPORT] Updating card counts for ${setIdsUpdated.size} sets`);
        for (const setId of setIdsUpdated) {
          try {
            const cardCount = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(cards)
              .where(eq(cards.setId, setId));
            
            await db
              .update(cardSets)
              .set({ totalCards: cardCount[0]?.count || 0 })
              .where(eq(cardSets.id, setId));
          } catch (e) {
            console.log(`[BULK IMPORT] Failed to update count for set ${setId}`);
          }
        }
      }

      // Clear cache
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {}

      console.log(`[BULK IMPORT] Complete. Success: ${successCount}, Errors: ${errorCount}`);

      res.json({
        message: dryRun ? 'Dry run complete' : `Imported ${successCount} cards`,
        successCount,
        errorCount,
        totalRows: rows.length,
        processedFrom: startOffset,
        processedTo: startOffset + rowsToProcess.length,
        errors: errors.slice(0, 50), // First 50 errors only
        resumeOffset: errorCount > 0 ? startOffset + successCount + errorCount : null
      });
    } catch (error: any) {
      console.error('[BULK IMPORT] Fatal error:', error);
      res.status(500).json({ message: `Bulk import failed: ${error.message}` });
    }
  });

  // BULK IMAGE IMPORT - Update card images from CSV with image_url column
  // Matches cards by FULL COMBO (set name) + card number, only updates cards without images
  app.post("/api/admin/bulk-image-import", authenticateUser, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No CSV file provided' });
      }

      const BATCH_SIZE = parseInt(req.body.batchSize) || 500;
      const dryRun = req.body.dryRun === 'true';
      const forceUpdate = req.body.forceUpdate === 'true'; // Update even if card already has image

      console.log(`[BULK IMAGE IMPORT] Starting. Batch size: ${BATCH_SIZE}, Dry run: ${dryRun}, Force update: ${forceUpdate}`);

      // Parse CSV
      const rows: any[] = [];
      let csvBuffer = req.file.buffer;
      if (csvBuffer[0] === 0xEF && csvBuffer[1] === 0xBB && csvBuffer[2] === 0xBF) {
        csvBuffer = csvBuffer.slice(3);
      }

      await new Promise<void>((resolve, reject) => {
        const stream = Readable.from(csvBuffer);
        stream
          .pipe(csv({
            mapHeaders: ({ header }: { header: string }) => header.trim().toLowerCase().replace(/[\s_-]/g, ''),
            skipEmptyLines: true
          }))
          .on('data', (row: any) => rows.push(row))
          .on('error', reject)
          .on('end', resolve);
      });

      console.log(`[BULK IMAGE IMPORT] Parsed ${rows.length} total rows`);

      // Find column mappings
      const keys = Object.keys(rows[0] || {});
      const cardNumberKey = keys.find(k => k === 'cardnumber' || k === 'number' || k === 'card#' || k === 'no');
      const imageUrlKey = keys.find(k => k === 'imageurl' || k === 'image' || k === 'frontimageurl');
      const fullComboKey = keys.find(k => k === 'fullcombo');

      console.log(`[BULK IMAGE IMPORT] Columns found: cardNumber="${cardNumberKey}", imageUrl="${imageUrlKey}", fullCombo="${fullComboKey}"`);

      if (!cardNumberKey || !imageUrlKey || !fullComboKey) {
        return res.status(400).json({ 
          message: `CSV must have Card Number, image_url, and FULL COMBO columns. Found: ${keys.join(', ')}` 
        });
      }

      // Filter only rows with image URLs
      const rowsWithImages = rows.filter(row => {
        const url = row[imageUrlKey]?.trim();
        return url && url.startsWith('http');
      });

      console.log(`[BULK IMAGE IMPORT] Found ${rowsWithImages.length} rows with image URLs`);

      if (rowsWithImages.length === 0) {
        return res.json({ message: 'No rows with image URLs found', successCount: 0 });
      }

      // Build set name lookup cache
      console.log(`[BULK IMAGE IMPORT] Building set name lookup cache...`);
      const allSets = await db.select({ id: cardSets.id, name: cardSets.name }).from(cardSets).where(eq(cardSets.isActive, true));
      const setCache: Map<string, number> = new Map();
      for (const set of allSets) {
        const normalizedName = set.name.toLowerCase().trim().replace(/\s+/g, ' ');
        setCache.set(normalizedName, set.id);
      }
      console.log(`[BULK IMAGE IMPORT] Cached ${setCache.size} active sets`);

      let successCount = 0;
      let skippedCount = 0;
      let notFoundCount = 0;
      let alreadyHasImageCount = 0;
      const errors: string[] = [];

      // Process in batches
      for (let batchStart = 0; batchStart < rowsWithImages.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, rowsWithImages.length);
        const batch = rowsWithImages.slice(batchStart, batchEnd);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(rowsWithImages.length / BATCH_SIZE);

        console.log(`[BULK IMAGE IMPORT] Processing batch ${batchNum}/${totalBatches} (${batchStart + 1}-${batchEnd})`);

        for (const row of batch) {
          try {
            const fullCombo = row[fullComboKey]?.trim();
            const cardNumber = row[cardNumberKey]?.toString().trim();
            const imageUrl = row[imageUrlKey]?.trim();

            if (!fullCombo || !cardNumber || !imageUrl) {
              skippedCount++;
              continue;
            }

            // Normalize full combo to match set name
            const normalizedCombo = fullCombo.toLowerCase().trim().replace(/\s+/g, ' ');
            const setId = setCache.get(normalizedCombo);

            if (!setId) {
              notFoundCount++;
              if (errors.length < 20) {
                errors.push(`Set not found: "${fullCombo}"`);
              }
              continue;
            }

            // Find card by set ID and card number
            const existingCards = await db.select()
              .from(cards)
              .where(and(
                eq(cards.setId, setId),
                eq(cards.cardNumber, cardNumber)
              ))
              .limit(1);

            if (existingCards.length === 0) {
              notFoundCount++;
              if (errors.length < 50) {
                errors.push(`Card not found: ${fullCombo} #${cardNumber}`);
              }
              continue;
            }

            const card = existingCards[0];

            // Check if card already has an image (unless force update)
            const PLACEHOLDER_URL = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';
            if (!forceUpdate && card.frontImageUrl && card.frontImageUrl !== PLACEHOLDER_URL) {
              alreadyHasImageCount++;
              continue;
            }

            // Update card with new image URL
            if (!dryRun) {
              await db.update(cards)
                .set({ frontImageUrl: imageUrl })
                .where(eq(cards.id, card.id));
            }

            successCount++;
          } catch (e: any) {
            if (errors.length < 50) {
              errors.push(`Error: ${e.message}`);
            }
          }
        }

        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      console.log(`[BULK IMAGE IMPORT] Complete. Updated: ${successCount}, Skipped: ${skippedCount}, Not found: ${notFoundCount}, Already has image: ${alreadyHasImageCount}`);

      res.json({
        message: dryRun ? 'Dry run complete' : `Updated ${successCount} card images`,
        successCount,
        skippedCount,
        notFoundCount,
        alreadyHasImageCount,
        totalRowsWithImages: rowsWithImages.length,
        errors: errors.slice(0, 50)
      });
    } catch (error: any) {
      console.error('[BULK IMAGE IMPORT] Fatal error:', error);
      res.status(500).json({ message: `Bulk image import failed: ${error.message}` });
    }
  });

  // Update card (admin only)
  app.put("/api/cards/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const id = parseInt(req.params.id);
      const validatedData = insertCardSchema.parse(req.body);
      
      const updatedCard = await storage.updateCard(id, validatedData);
      if (!updatedCard) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      // Clear cache when cards are updated
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {
        console.log('Cache clear skipped:', e);
      }
      
      res.json(updatedCard);
    } catch (error) {
      console.error('Update card error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update card" });
    }
  });

  // Patch card (admin only) - partial update
  app.patch("/api/cards/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const id = parseInt(req.params.id);
      const existingCard = await storage.getCard(id);
      if (!existingCard) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      const updatedCard = await storage.updateCard(id, req.body);
      if (!updatedCard) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      // Clear cache when cards are updated
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {
        console.log('Cache clear skipped:', e);
      }
      
      res.json(updatedCard);
    } catch (error) {
      console.error('Patch card error:', error);
      res.status(500).json({ message: "Failed to update card" });
    }
  });

  // Delete card (admin only)
  app.delete("/api/cards/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const id = parseInt(req.params.id);
      await storage.deleteCard(id);
      
      // Clear cache when cards are deleted
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {
        console.log('Cache clear skipped:', e);
      }
      
      res.json({ message: "Card deleted successfully" });
    } catch (error) {
      console.error('Delete card error:', error);
      res.status(500).json({ message: "Failed to delete card" });
    }
  });

  // User collection routes - FIXED to use proper nested structure
  app.get("/api/collection", authenticateUser, async (req: any, res) => {
    try {
      const collection = await storage.getUserCollection(req.user.id);
      res.json(collection);
    } catch (error) {
      console.error('Get collection error:', error);
      res.status(500).json({ message: "Failed to fetch collection" });
    }
  });

  app.post("/api/collection", authenticateUser, async (req: any, res) => {
    try {
      const COLLECTION_LIMIT = 250;
      
      const [userData] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, req.user.id)).limit(1);
      
      if (userData?.plan !== 'SUPER_HERO') {
        const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(userCollections)
          .where(eq(userCollections.userId, req.user.id));
        
        if ((countResult?.count || 0) >= COLLECTION_LIMIT) {
          return res.status(403).json({ 
            message: `You've reached the ${COLLECTION_LIMIT} card limit for Side Kick plans. Upgrade to Super Hero for unlimited cards.`,
            code: 'COLLECTION_LIMIT_REACHED',
            currentCount: countResult?.count || 0,
            limit: COLLECTION_LIMIT
          });
        }
      }

      const validatedData = insertUserCollectionSchema.parse({
        ...req.body,
        userId: req.user.id
      });
      
      const collectionItem = await storage.addToCollection(validatedData);
      
      // Check badges when collection changes (fire-and-forget for instant response)
      badgeService.checkBadgesOnCollectionChange(req.user.id).catch(err => 
        console.error('Background badge check failed:', err)
      );
      
      res.status(201).json(collectionItem);
    } catch (error) {
      console.error('Add to collection error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add card to collection" });
    }
  });

  app.patch("/api/collection/:id", authenticateUser, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      console.log('PATCH /api/collection/:id - updating collection item:', id, 'with:', updates);
      
      // Check if user is trying to list for sale - require shipping address
      if (updates.isForSale === true) {
        const [user] = await db.select({ shippingAddressJson: users.shippingAddressJson })
          .from(users).where(eq(users.id, req.user.id)).limit(1);
        if (!user?.shippingAddressJson) {
          return res.status(400).json({ 
            message: "Please add your shipping address in your profile before listing items for sale",
            requiresShippingAddress: true
          });
        }
      }
      
      const updatedItem = await storage.updateCollectionItem(id, updates);
      if (!updatedItem) {
        return res.status(404).json({ message: "Collection item not found" });
      }
      
      // Award First Listing badge if item was successfully listed for sale
      if (updatedItem.isForSale === true) {
        badgeService.checkBadgesOnMarketplaceListing(req.user.id).catch(err => 
          console.error('Background marketplace badge check failed:', err)
        );
      }
      
      console.log('Collection item updated successfully:', updatedItem);
      res.json(updatedItem);
    } catch (error) {
      console.error('Update collection item error:', error);
      res.status(500).json({ message: "Failed to update collection item" });
    }
  });
  
  // Also support PUT for backwards compatibility
  app.put("/api/collection/:id", authenticateUser, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      // Check if user is trying to list for sale - require shipping address
      if (updates.isForSale === true) {
        const [user] = await db.select({ shippingAddressJson: users.shippingAddressJson })
          .from(users).where(eq(users.id, req.user.id)).limit(1);
        if (!user?.shippingAddressJson) {
          return res.status(400).json({ 
            message: "Please add your shipping address in your profile before listing items for sale",
            requiresShippingAddress: true
          });
        }
      }
      
      const updatedItem = await storage.updateCollectionItem(id, updates);
      if (!updatedItem) {
        return res.status(404).json({ message: "Collection item not found" });
      }
      
      // Award First Listing badge if item was successfully listed for sale
      if (updatedItem.isForSale === true) {
        badgeService.checkBadgesOnMarketplaceListing(req.user.id).catch(err => 
          console.error('Background marketplace badge check failed:', err)
        );
      }
      
      res.json(updatedItem);
    } catch (error) {
      console.error('Update collection item error:', error);
      res.status(500).json({ message: "Failed to update collection item" });
    }
  });

  app.delete("/api/collection/:id", authenticateUser, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.removeFromCollection(id);
      
      // Check badges when collection changes (fire-and-forget for instant response)
      badgeService.checkBadgesOnCollectionChange(req.user.id).catch(err => 
        console.error('Background badge check failed:', err)
      );
      
      res.json({ message: "Card removed from collection" });
    } catch (error) {
      console.error('Remove from collection error:', error);
      res.status(500).json({ message: "Failed to remove card from collection" });
    }
  });

  // Get missing cards for a specific set (paginated)
  app.get("/api/missing-cards/:setId", authenticateUser, async (req: any, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const userId = req.user.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 36, 100); // Max 100
      const offset = (page - 1) * limit;
      
      const result = await db.execute(sql`
        SELECT 
          cards.id,
          cards.name,
          cards.card_number,
          cards.front_image_url,
          cards.estimated_value,
          cards.is_insert,
          cards.rarity,
          cards.description,
          card_sets.name as set_name,
          card_sets.year,
          card_sets.id as set_id
        FROM cards
        JOIN card_sets ON cards.set_id = card_sets.id
        WHERE cards.set_id = ${setId}
        AND cards.id NOT IN (
          SELECT card_id FROM user_collections WHERE user_id = ${userId}
        )
        ORDER BY 
          CASE 
            WHEN cards.card_number ~ '^[0-9]+$' THEN cards.card_number::integer
            ELSE 999999
          END ASC,
          cards.card_number ASC
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM cards
        WHERE cards.set_id = ${setId}
        AND cards.id NOT IN (
          SELECT card_id FROM user_collections WHERE user_id = ${userId}
        )
      `);
      
      const missingCards = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        cardNumber: row.card_number,
        frontImageUrl: row.front_image_url,
        estimatedValue: row.estimated_value,
        isInsert: row.is_insert,
        rarity: row.rarity,
        description: row.description,
        set: {
          id: row.set_id,
          name: row.set_name,
          year: row.year
        }
      }));
      
      res.json({
        cards: missingCards,
        total: countResult.rows[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult.rows[0].total / limit)
      });
    } catch (error) {
      console.error('Missing cards fetch error:', error);
      res.status(500).json({ message: "Failed to fetch missing cards" });
    }
  });

  // User wishlist routes - OPTIMIZED  
  app.get("/api/wishlist", authenticateUser, async (req: any, res) => {
    try {
      const wishlist = await storage.getUserWishlist(req.user.id);
      res.json(wishlist);
    } catch (error) {
      console.error('Get wishlist error:', error);
      res.status(500).json({ message: "Failed to fetch wishlist" });
    }
  });

  app.post("/api/wishlist", authenticateUser, async (req: any, res) => {
    try {
      const validatedData = insertUserWishlistSchema.parse({
        ...req.body,
        userId: req.user.id
      });
      
      const wishlistItem = await storage.addToWishlist(validatedData);
      res.status(201).json(wishlistItem);
    } catch (error) {
      console.error('Add to wishlist error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to add card to wishlist" });
    }
  });

  app.delete("/api/wishlist/:id", authenticateUser, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.removeFromWishlist(id);
      res.json({ message: "Card removed from wishlist" });
    } catch (error) {
      console.error('Remove from wishlist error:', error);
      res.status(500).json({ message: "Failed to remove card from wishlist" });
    }
  });

  // Stats and analytics - OPTIMIZED
  app.get("/api/stats", authenticateUser, async (req: any, res) => {
    const performanceStart = Date.now();
    
    try {
      const { optimizedStorage } = await import('./optimized-storage');
      const stats = await optimizedStorage.getUserStatsOptimized(req.user.id);
      
      const performanceDuration = Date.now() - performanceStart;
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(stats);
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/recent-cards", authenticateUser, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 24;
      
      const { optimizedStorage } = await import('./optimized-storage');
      const recentCards = await optimizedStorage.getRecentCardsOptimized(req.user.id, limit);
      
      res.json(recentCards);
    } catch (error) {
      console.error('Get recent cards error:', error);
      // Return empty array instead of error to prevent UI breaking
      res.json([]);
    }
  });

  app.get("/api/trending-cards", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      
      // Use optimized storage with pricing data
      try {
        const { optimizedStorage } = await import('./optimized-storage');
        const trendingCards = await optimizedStorage.getTrendingCardsOptimized(limit);
        res.json(trendingCards);
      } catch (dbError) {
        console.error('Database connection failed for trending cards:', dbError);
        
        // Temporary sample data while database connection is being fixed
        const sampleTrendingCards = [
          {
            id: 1,
            setId: 1,
            cardNumber: "001",
            name: "Spider-Man Origin",
            variation: null,
            isInsert: false,
            frontImageUrl: "https://via.placeholder.com/200x280/DC143C/FFFFFF?text=Spider-Man",
            backImageUrl: null,
            description: "The amazing origin story of Spider-Man",
            rarity: "Common",
            estimatedValue: "2.50",
            createdAt: new Date(),
            set: {
              id: 1,
              name: "Amazing Spider-Man 1990",
              year: 1990,
              mainSetId: 1,
              slug: "amazing-spider-man-1990"
            }
          },
          {
            id: 2,
            setId: 1,
            cardNumber: "002",
            name: "Green Goblin",
            variation: null,
            isInsert: false,
            frontImageUrl: "https://via.placeholder.com/200x280/228B22/FFFFFF?text=Green+Goblin",
            backImageUrl: null,
            description: "Spider-Man's greatest enemy",
            rarity: "Rare",
            estimatedValue: "8.50",
            createdAt: new Date(),
            set: {
              id: 1,
              name: "Amazing Spider-Man 1990",
              year: 1990,
              mainSetId: 1,
              slug: "amazing-spider-man-1990"
            }
          },
          {
            id: 3,
            setId: 1,
            cardNumber: "003",
            name: "Spider-Man Hologram",
            variation: "Foil Variant",
            isInsert: true,
            frontImageUrl: "https://via.placeholder.com/200x280/4169E1/FFFFFF?text=Hologram",
            backImageUrl: null,
            description: "Rare holographic Spider-Man card",
            rarity: "Insert",
            estimatedValue: "25.00",
            createdAt: new Date(),
            set: {
              id: 1,
              name: "Amazing Spider-Man 1990",
              year: 1990,
              mainSetId: 1,
              slug: "amazing-spider-man-1990"
            }
          },
          {
            id: 4,
            setId: 2,
            cardNumber: "001",
            name: "Wolverine",
            variation: null,
            isInsert: false,
            frontImageUrl: "https://via.placeholder.com/200x280/FFD700/000000?text=Wolverine",
            backImageUrl: null,
            description: "The best there is at what he does",
            rarity: "Rare",
            estimatedValue: "12.50",
            createdAt: new Date(),
            set: {
              id: 2,
              name: "Uncanny X-Men 1991",
              year: 1991,
              mainSetId: 2,
              slug: "uncanny-x-men-1991"
            }
          }
        ].slice(0, limit);
        
        res.json(sampleTrendingCards);
      }
    } catch (error) {
      console.error('Get trending cards error:', error);
      res.status(500).json({ message: "Failed to fetch trending cards" });
    }
  });

  // Marketplace - requires SUPER_HERO plan
  app.get("/api/marketplace", authenticateUser, async (req: any, res) => {
    try {
      // Check if user has SUPER_HERO plan
      if (req.user.plan !== 'SUPER_HERO') {
        return res.status(403).json({ 
          message: "Marketplace access requires SUPER_HERO subscription",
          upgradeRequired: true
        });
      }
      
      const marketplaceItems = await storage.getMarketplaceItems();
      res.json(marketplaceItems);
    } catch (error) {
      console.error('Get marketplace error:', error);
      res.status(500).json({ message: "Failed to fetch marketplace items" });
    }
  });

  // Missing cards in set
  app.get("/api/sets/:setId/missing", authenticateUser, async (req: any, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const missingCards = await storage.getMissingCardsInSet(req.user.id, setId);
      res.json(missingCards);
    } catch (error) {
      console.error('Get missing cards error:', error);
      res.status(500).json({ message: "Failed to fetch missing cards" });
    }
  });

  // Image proxy for CORS bypass
  app.get("/api/proxy-image", async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).json({ message: "URL parameter is required" });
      }
      
      await proxyImage(req, res);
    } catch (error) {
      console.error('Image proxy error:', error);
      res.status(500).json({ message: "Failed to proxy image" });
    }
  });

  // Card pricing endpoint
  app.get("/api/card-pricing/:cardId", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      if (isNaN(cardId)) {
        return res.status(400).json({ message: "Invalid card ID" });
      }

      const pricing = await storage.getCardPricing(cardId);
      if (!pricing) {
        return res.status(404).json({ message: "No pricing data found" });
      }

      res.json({
        avgPrice: parseFloat(pricing.avgPrice.toString() || "0"),
        salesCount: pricing.salesCount || 0,
        lastFetched: pricing.lastFetched || new Date()
      });
    } catch (error) {
      console.error("Error fetching card pricing:", error);
      res.status(500).json({ message: "Failed to fetch pricing data" });
    }
  });

  // Refresh card pricing endpoint
  app.post("/api/card-pricing/:cardId/refresh", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      if (isNaN(cardId)) {
        return res.status(400).json({ message: "Invalid card ID" });
      }

      console.log(`Refreshing pricing for card ${cardId}`);
      const result = await ebayPricingService.forceRefreshCardPricing(cardId);
      
      if (result) {
        res.json({
          avgPrice: result.avgPrice,
          salesCount: result.salesCount,
          lastFetched: result.lastFetched
        });
      } else {
        res.json({
          avgPrice: 0,
          salesCount: 0,
          lastFetched: new Date()
        });
      }
    } catch (error) {
      console.error("Error refreshing card pricing:", error);
      res.status(500).json({ message: "Failed to refresh pricing data" });
    }
  });

  // Batch pricing endpoint for performance optimization
  app.post("/api/card-pricing/batch", async (req, res) => {
    try {
      const { cardIds } = req.body;
      
      if (!Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ message: "cardIds array is required" });
      }

      if (cardIds.length > 50) {
        return res.status(400).json({ message: "Maximum 50 cards per batch request" });
      }

      const pricingResults: Record<number, any> = {};
      
      // Process all pricing requests in parallel
      await Promise.all(
        cardIds.map(async (cardId: number) => {
          try {
            const pricing = await ebayPricingService.getCardPricing(cardId);
            pricingResults[cardId] = {
              avgPrice: pricing?.avgPrice || 0,
              salesCount: pricing?.salesCount || 0,
              lastFetched: pricing?.lastFetched || new Date()
            };
          } catch (error) {
            console.error(`Error fetching pricing for card ${cardId}:`, error);
            pricingResults[cardId] = {
              avgPrice: 0,
              salesCount: 0,
              lastFetched: new Date()
            };
          }
        })
      );

      res.json(pricingResults);
    } catch (error) {
      console.error("Error in batch pricing:", error);
      res.status(500).json({ message: "Failed to fetch batch pricing data" });
    }
  });

  // Find and update card image endpoint
  app.post("/api/admin/find-card-image/:cardId", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      if (isNaN(cardId)) {
        return res.status(400).json({ message: "Invalid card ID" });
      }

      // Get card details
      const card = await storage.getCard(cardId);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      console.log(`Finding image for card ${cardId}: ${card.name}`);
      
      const result = await findAndUpdateCardImage(
        cardId,
        card.set.name,
        card.name,
        card.cardNumber,
        card.description || undefined
      );

      res.json({ 
        success: result.success,
        message: result.success ? "Image updated successfully" : "Failed to find image",
        result 
      });
    } catch (error) {
      console.error('Find card image error:', error);
      res.status(500).json({ message: "Failed to find card image" });
    }
  });

  // Test eBay integration with simplified logic
  app.post("/api/admin/test-ebay-integration", async (req, res) => {
    try {
      const { testSingleCard, checkConfiguration } = await import('./ebay-image-finder');
      
      // Check configuration first
      checkConfiguration();
      
      // Run the test
      const result = await testSingleCard();
      
      res.json({
        success: result.success,
        message: result.success ? "eBay integration test successful" : "eBay integration test failed",
        details: result
      });
    } catch (error) {
      console.error('eBay integration test error:', error);
      res.status(500).json({ 
        success: false,
        message: "eBay integration test failed with error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Optimized API endpoints - v2
  
  // Paginated cards with lightweight payload
  app.get("/api/v2/cards", async (req, res) => {
    const performanceStart = Date.now();
    
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const setId = req.query.setId ? parseInt(req.query.setId as string) : undefined;
      const rarity = req.query.rarity as string;
      const isInsert = req.query.isInsert ? req.query.isInsert === 'true' : undefined;
      const hasImage = req.query.hasImage ? req.query.hasImage === 'true' : undefined;
      const search = req.query.search as string;

      const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
      
      const result = await ultraOptimizedStorage.getCardsPaginated(page, pageSize, {
        setId,
        rarity,
        isInsert,
        hasImage,
        search
      });

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(result);
    } catch (error) {
      console.error('Get cards v2 error:', error);
      res.status(500).json({ message: "Failed to fetch cards" });
    }
  });

  // Optimized user collection with pagination
  app.get("/api/v2/collection", authenticateUser, async (req: any, res) => {
    const performanceStart = Date.now();
    
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);

      const { optimizedStorage } = await import('./optimized-storage');
      
      const result = await optimizedStorage.getUserCollectionPaginated(
        req.user.id,
        page,
        pageSize
      );

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(result);
    } catch (error) {
      console.error('Get collection v2 error:', error);
      res.status(500).json({ message: "Failed to fetch collection" });
    }
  });

  // Optimized dashboard stats
  app.get("/api/v2/stats", authenticateUser, async (req: any, res) => {
    const performanceStart = Date.now();
    
    try {
      const { optimizedStorage } = await import('./optimized-storage');
      
      const stats = await optimizedStorage.getUserStatsOptimized(req.user.id);

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(stats);
    } catch (error) {
      console.error('Get stats v2 error:', error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Main search endpoint (for frontend compatibility)
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      
      if (!query || query.length < 2) {
        return res.json({ sets: [], cards: [] });
      }

      // Search card sets
      const sets = await storage.searchCardSets(query);
      
      // Enhanced search with fuzzy matching for space/dash variations
      const baseCards = await storage.getCards({ search: query });
      
      // Additional search with space-dash variations
      let additionalCards: any[] = [];
      const normalizedQuery = query.toLowerCase().trim();
      
      // If query has spaces, also search with dashes
      if (normalizedQuery.includes(' ')) {
        const dashQuery = normalizedQuery.replace(/\s+/g, '-');
        additionalCards = await storage.getCards({ search: dashQuery });
      }
      // If query has dashes, also search with spaces
      else if (normalizedQuery.includes('-')) {
        const spaceQuery = normalizedQuery.replace(/-/g, ' ');
        additionalCards = await storage.getCards({ search: spaceQuery });
      }
      
      // Combine and deduplicate results
      const allCards = [...baseCards, ...additionalCards];
      const uniqueCards = allCards.filter((card, index, self) => 
        index === self.findIndex(c => c.id === card.id)
      );
      
      const limitedCards = uniqueCards.slice(0, 100); // Show up to 100 results for better UX

      res.json({ sets, cards: limitedCards });
    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ message: "Failed to search" });
    }
  });

  // Optimized search endpoint
  app.get("/api/v2/search", async (req, res) => {
    const performanceStart = Date.now();
    
    try {
      const query = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const setId = req.query.setId ? parseInt(req.query.setId as string) : undefined;
      const isInsert = req.query.isInsert ? req.query.isInsert === 'true' : undefined;

      if (!query || query.length < 2) {
        return res.json([]);
      }

      const { optimizedStorage } = await import('./optimized-storage');
      
      const results = await optimizedStorage.searchCardsOptimized(query, limit, {
        setId,
        isInsert
      });

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(results);
    } catch (error) {
      console.error('Search v2 error:', error);
      res.status(500).json({ message: "Failed to search cards" });
    }
  });

  // Optimized trending cards
  app.get("/api/v2/trending", async (req, res) => {
    const performanceStart = Date.now();
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

      const { optimizedStorage } = await import('./optimized-storage');
      
      const results = await optimizedStorage.getTrendingCardsOptimized(limit);

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(results);
    } catch (error) {
      console.error('Trending v2 error:', error);
      res.status(500).json({ message: "Failed to fetch trending cards" });
    }
  });

  // Optimized recent cards for user
  app.get("/api/v2/recent", authenticateUser, async (req: any, res) => {
    const performanceStart = Date.now();
    
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

      const { optimizedStorage } = await import('./optimized-storage');
      
      const results = await optimizedStorage.getRecentCardsOptimized(req.user.id, limit);

      const performanceDuration = Date.now() - performanceStart;
      
      res.setHeader('X-Performance-Time', performanceDuration.toString());
      res.json(results);
    } catch (error) {
      console.error('Recent v2 error:', error);
      res.status(500).json({ message: "Failed to fetch recent cards" });
    }
  });

  // PriceCharting background import endpoints
  app.post("/api/admin/pricecharting-import/start", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Background import module temporarily disabled
      // const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      // await priceChartingImporter.startImport();
      
      res.json({ 
        message: "PriceCharting import temporarily disabled", 
        status: "disabled" 
      });
    } catch (error) {
      console.error('Start PriceCharting import error:', error);
      res.status(500).json({ 
        message: "Failed to start import", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/admin/pricecharting-import/stop", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Background import module temporarily disabled
      // const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      // priceChartingImporter.stopImport();
      
      res.json({ 
        message: "PriceCharting import stopped successfully", 
        status: "stopped" 
      });
    } catch (error) {
      console.error('Stop PriceCharting import error:', error);
      res.status(500).json({ message: "Failed to stop import" });
    }
  });

  app.get("/api/admin/pricecharting-import/status", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Background import module temporarily disabled
      // const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      const progress = { isRunning: false, message: "Import disabled", setsProcessed: 0, totalSets: 0 };
      
      res.json(progress);
    } catch (error) {
      console.error('Get PriceCharting import status error:', error);
      res.status(500).json({ message: "Failed to get import status" });
    }
  });

  // Price refresh endpoint for users to trigger price updates
  app.post("/api/cards/:id/refresh-price", authenticateUser, async (req: any, res) => {
    try {
      const cardId = parseInt(req.params.id);
      
      // Trigger price refresh (this would normally call eBay API)
      // For now, we'll just award the badge for the action
      await badgeService.checkBadgesOnPriceRefresh(req.user.id);
      
      res.json({ message: "Price refresh triggered", cardId });
    } catch (error) {
      console.error('Price refresh error:', error);
      res.status(500).json({ message: "Failed to refresh price" });
    }
  });

  // Background image processing endpoints
  app.post("/api/admin/background-images/start", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { batchUpdateCardImages } = await import('./ebay-image-finder');
      
      // Start background processing with limit of 2000 cards
      console.log('Starting background image processing for up to 2000 cards...');
      
      // Run asynchronously
      batchUpdateCardImages(2000).then((results) => {
        console.log(`Background processing complete: ${results.length} cards processed`);
        console.log(`Successful: ${results.filter(r => r.success).length}`);
        console.log(`Failed: ${results.filter(r => !r.success).length}`);
      }).catch((error) => {
        console.error('Background processing error:', error);
      });
      
      res.json({ 
        message: "Background image processing started", 
        maxCards: 2000,
        status: "running" 
      });
    } catch (error) {
      console.error('Start background processing error:', error);
      res.status(500).json({ message: "Failed to start background processing" });
    }
  });

  app.get("/api/admin/background-images/status", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Check current status by querying missing images
      const missingImagesResult = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM cards 
        WHERE front_image_url IS NULL OR front_image_url = ''
      `);
      
      const missingCount = missingImagesResult.rows[0]?.count || 0;
      
      res.json({
        missingImages: missingCount,
        totalCards: await db.execute(sql`SELECT COUNT(*) as count FROM cards`).then(r => r.rows[0]?.count || 0),
        status: "Available for processing"
      });
    } catch (error) {
      console.error('Background status error:', error);
      res.status(500).json({ message: "Failed to get processing status" });
    }
  });

  // Bulk image update endpoints
  app.post("/api/admin/update-missing-images", authenticateUser, async (req: any, res) => {
    console.log(`[DEBUG] Bulk update endpoint hit with body:`, req.body);
    console.log(`[DEBUG] Authenticated user:`, req.user);
    
    try {
      if (!req.user.isAdmin) {
        console.log(`[DEBUG] Admin check failed for user:`, req.user);
        return res.status(403).json({ message: "Admin access required" });
      }

      console.log(`[DEBUG] Admin check passed, importing COMC finder...`);
      const { searchCOMCForCard } = await import('./comc-image-finder');
      
      // Check COMC configuration
      const ebayAppId = process.env.EBAY_APP_ID;
      const cloudinaryUrl = process.env.CLOUDINARY_URL;
      console.log(`[DEBUG] Environment check - EBAY_APP_ID: ${!!ebayAppId}, CLOUDINARY_URL: ${!!cloudinaryUrl}`);
      
      if (!ebayAppId || !cloudinaryUrl) {
        console.log(`[DEBUG] Missing config detected`);
        return res.status(400).json({ 
          message: "Configuration error", 
          missingConfig: ['EBAY_APP_ID', 'CLOUDINARY_URL'].filter(key => !process.env[key])
        });
      }

      const { limit, rateLimitMs, skipRecentlyFailed = true, randomOrder = false } = req.body;
      console.log(`[DEBUG] Request parameters - limit: ${limit}, rateLimitMs: ${rateLimitMs}, skipRecentlyFailed: ${skipRecentlyFailed}, randomOrder: ${randomOrder}`);
      const actualLimit = limit ? Math.min(parseInt(limit), 1000) : 50; // Max 1000 cards per request
      const actualRateLimit = rateLimitMs ? Math.max(parseInt(rateLimitMs), 500) : 1000; // Min 500ms
      
      console.log(`[DEBUG] Starting COMC bulk image update with limit: ${actualLimit}, rate limit: ${actualRateLimit}ms`);
      
      // Smart ordering logic: never-searched first, then oldest attempts
      let orderClause = 'ORDER BY c.last_image_search_attempt ASC NULLS FIRST, c.id DESC';
      if (randomOrder) {
        orderClause = 'ORDER BY RANDOM()'; // Random order to avoid failed card clusters
        console.log(`[DEBUG] Using random order`);
      } else {
        console.log(`[DEBUG] Using smart priority: never-searched first, then oldest attempts`);
      }
      
      // Get cards needing images - SKIP RECENTLY PROCESSED CARDS
      console.log(`[DEBUG] Executing database query for cards needing images (skipping recently processed)...`);
      let whereClause = `WHERE (c.front_image_url IS NULL OR c.front_image_url = '' OR c.front_image_url = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png')`;
      
      if (skipRecentlyFailed) {
        // Skip cards that have been processed recently using a different approach
        // Use the last_image_search_attempt field instead of updated_at to avoid auto-update issues
        whereClause += ` AND (c.last_image_search_attempt IS NULL OR c.last_image_search_attempt < NOW() - INTERVAL '30 days')`;
        console.log(`[DEBUG] Skipping cards with image search attempts in the last 30 days`);
      }
      
      const cardsNeedingImages = await db.execute(sql`
        SELECT c.id, c.name, c.card_number, cs.name as set_name
        FROM cards c
        JOIN card_sets cs ON c.set_id = cs.id  
        ${sql.raw(whereClause)}
        ${sql.raw(orderClause)}
        LIMIT ${actualLimit}
      `);
      
      const totalCards = cardsNeedingImages.rows.length;
      console.log(`[DEBUG] Database query completed. Found ${totalCards} cards needing images`);
      console.log(`[DEBUG] Raw SQL query executed:`, whereClause + ' ' + orderClause);
      console.log(`[DEBUG] First few results:`, cardsNeedingImages.rows.slice(0, 3));
      
      if (totalCards === 0) {
        console.log(`[DEBUG] No cards found, returning early`);
        return res.json({
          totalProcessed: 0,
          successCount: 0,
          failureCount: 0,
          message: "No cards found needing images"
        });
      }
      
      
      let successCount = 0;
      let failureCount = 0;
      
      console.log(`[DEBUG] Starting to process ${totalCards} cards sequentially...`);
      
      // Process cards sequentially with rate limiting
      for (let i = 0; i < totalCards; i++) {
        const card = cardsNeedingImages.rows[i];
        
        try {
          console.log(`Processing card ${i + 1}/${totalCards}: ${card.name} (${card.card_number}) from ${card.set_name}`);
          
          const result = await searchCOMCForCard(
            Number(card.id),
            card.set_name,
            card.name,
            card.card_number
          );
          
          // Always update the last_image_search_attempt timestamp, regardless of success/failure
          await db.execute(sql`
            UPDATE cards 
            SET last_image_search_attempt = NOW() 
            WHERE id = ${Number(card.id)}
          `);
          
          if (result.success) {
            successCount++;
            console.log(`✅ Success: Found image for ${card.name}`);
          } else {
            failureCount++;
            console.log(`❌ Failed: ${result.error} for ${card.name}`);
          }
          
        } catch (error) {
          failureCount++;
          console.error(`❌ Error processing ${card.name}:`, error);
        }
        
        // Rate limiting delay
        if (i < totalCards - 1) {
          await new Promise(resolve => setTimeout(resolve, actualRateLimit));
        }
      }
      
      const result = {
        totalProcessed: totalCards,
        successCount,
        failureCount,
        message: `Processed ${totalCards} cards. ${successCount} images found, ${failureCount} failures.`
      };
      
      console.log('COMC bulk update complete:', result);
      res.json(result);
      
    } catch (error) {
      console.error('[DEBUG] FATAL ERROR in bulk update endpoint:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        name: error instanceof Error ? error.name : 'Unknown error type'
      });
      res.status(500).json({ 
        message: "Failed to update missing images",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Migrate comc.com images to Cloudinary in batches
  app.post("/api/admin/migrate-comc-to-cloudinary", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const batchSize = Math.min(req.body.batchSize || 50, 100);
      
      // Get cards with comc.com images
      const cardsToMigrate = await db
        .select({ id: cards.id, frontImageUrl: cards.frontImageUrl })
        .from(cards)
        .where(like(cards.frontImageUrl, '%comc.com%'))
        .limit(batchSize);

      if (cardsToMigrate.length === 0) {
        return res.json({ message: "No comc.com images remaining", migrated: 0, failed: 0, remaining: 0 });
      }

      const { v2: cloudinary } = await import('cloudinary');
      
      let migrated = 0;
      let failed = 0;

      for (const card of cardsToMigrate) {
        try {
          const response = await fetch(card.frontImageUrl!, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'image/*,*/*;q=0.8',
            },
          });

          if (!response.ok) {
            failed++;
            continue;
          }

          const contentType = response.headers.get('content-type') || 'image/jpeg';
          if (!contentType.startsWith('image/')) {
            failed++;
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 10 * 1024 * 1024) {
            failed++;
            continue;
          }

          const result = await cloudinary.uploader.upload(
            `data:${contentType};base64,${buffer.toString('base64')}`,
            {
              folder: 'marvel-cards',
              public_id: `card_${card.id}_${Date.now()}`,
              resource_type: 'image',
              transformation: [
                { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
                { format: 'auto' }
              ]
            }
          );

          await db.update(cards)
            .set({ frontImageUrl: result.secure_url })
            .where(eq(cards.id, card.id));
          
          migrated++;
        } catch (error) {
          failed++;
          console.error(`[COMC MIGRATE] Card ${card.id} failed:`, error);
        }
      }

      // Count remaining
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(cards)
        .where(like(cards.frontImageUrl, '%comc.com%'));

      console.log(`[COMC MIGRATE] Batch complete: ${migrated} migrated, ${failed} failed, ${count} remaining`);
      
      res.json({ 
        message: "Batch complete", 
        migrated, 
        failed, 
        remaining: count,
        batchSize
      });
    } catch (error) {
      console.error('[COMC MIGRATE] Error:', error);
      res.status(500).json({ 
        message: "Migration failed",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Add stop endpoint for bulk update
  app.post("/api/admin/stop-bulk-update", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      console.log('[DEBUG] Stop bulk update request received');
      // For now, just acknowledge the stop request
      // In a production system, you'd set a global stop flag
      res.json({ message: "Stop request received" });
    } catch (error) {
      console.error('Stop bulk update error:', error);
      res.status(500).json({ message: "Failed to stop bulk update" });
    }
  });

  // Process images for a specific set
  app.post("/api/admin/sets/:setId/process-images", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      if (isNaN(setId)) {
        return res.status(400).json({ message: "Invalid set ID" });
      }

      // Get set details
      const cardSet = await storage.getCardSet(setId);
      if (!cardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }

      // Get cards in this set that are missing images
      const cardsInSet = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          description: cards.description
        })
        .from(cards)
        .where(
          and(
            eq(cards.setId, setId),
            or(
              isNull(cards.frontImageUrl),
              eq(cards.frontImageUrl, ''),
              eq(cards.frontImageUrl, '/images/image-coming-soon.png'),
              eq(cards.frontImageUrl, '/images/placeholder.png')
            )
          )
        );

      if (cardsInSet.length === 0) {
        return res.json({ 
          message: "All cards in this set already have images",
          setName: cardSet.name,
          totalCards: 0,
          processed: 0
        });
      }

      console.log(`Starting image processing for set ${cardSet.name} (${cardsInSet.length} cards need images)`);

      // Import the image finder
      const { findAndUpdateCardImage } = await import('./ebay-image-finder');
      
      // Process cards (start async, return immediately)
      const processCards = async () => {
        let successCount = 0;
        let failCount = 0;
        
        for (const card of cardsInSet) {
          try {
            const result = await findAndUpdateCardImage(
              card.id,
              cardSet.name,
              card.name,
              card.cardNumber,
              card.description || undefined
            );
            
            if (result.success) {
              successCount++;
              console.log(`✅ Image found for ${card.name} (#${card.cardNumber})`);
            } else {
              failCount++;
              console.log(`❌ No image for ${card.name}: ${result.error}`);
            }
            
            // Rate limiting - wait 2 seconds between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            failCount++;
            console.error(`Error processing ${card.name}:`, error);
          }
        }
        
        console.log(`Image processing complete for set ${cardSet.name}: ${successCount} success, ${failCount} failed`);
      };

      // Start processing in background
      processCards().catch(console.error);

      res.json({ 
        message: `Image processing started for ${cardSet.name}`,
        setName: cardSet.name,
        setId: setId,
        totalCards: cardsInSet.length,
        status: "processing"
      });
    } catch (error) {
      console.error('Set image processing error:', error);
      res.status(500).json({ message: "Failed to start image processing for set" });
    }
  });

  // Process pricing for a specific set  
  app.post("/api/admin/sets/:setId/process-pricing", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      if (isNaN(setId)) {
        return res.status(400).json({ message: "Invalid set ID" });
      }

      // Get set details
      const cardSet = await storage.getCardSet(setId);
      if (!cardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }

      // Get all cards in this set
      const cardsInSet = await db
        .select({ id: cards.id, name: cards.name })
        .from(cards)
        .where(eq(cards.setId, setId));

      if (cardsInSet.length === 0) {
        return res.json({ 
          message: "No cards found in this set",
          setName: cardSet.name,
          totalCards: 0
        });
      }

      console.log(`Starting pricing update for set ${cardSet.name} (${cardsInSet.length} cards)`);

      // Import the pricing service
      const { ebayPricingService } = await import('./ebay-pricing');
      
      // Get card IDs
      const cardIds = cardsInSet.map(c => c.id);
      
      // Start processing in background
      ebayPricingService.updatePricingForCards(cardIds)
        .then(() => {
          console.log(`Pricing update complete for set ${cardSet.name}`);
        })
        .catch((error) => {
          console.error(`Pricing update failed for set ${cardSet.name}:`, error);
        });

      res.json({ 
        message: `Pricing update started for ${cardSet.name}`,
        setName: cardSet.name,
        setId: setId,
        totalCards: cardsInSet.length,
        status: "processing"
      });
    } catch (error) {
      console.error('Set pricing processing error:', error);
      res.status(500).json({ message: "Failed to start pricing update for set" });
    }
  });

  app.get("/api/admin/missing-images-count", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { findCardsNeedingImages, checkBulkUpdateConfiguration } = await import('./bulk-image-updater');
      
      const config = checkBulkUpdateConfiguration();
      const cardsNeedingImages = await findCardsNeedingImages();
      
      res.json({
        count: cardsNeedingImages.length,
        configReady: config.ready,
        missingConfig: config.missingConfig,
        rateLimitMs: config.rateLimitMs,
        sampleCards: cardsNeedingImages.slice(0, 5).map(card => ({
          id: card.id,
          name: card.name,
          setName: card.setName,
          cardNumber: card.cardNumber
        }))
      });
    } catch (error) {
      console.error('Missing images count error:', error);
      res.status(500).json({ message: "Failed to get missing images count" });
    }
  });

  // Background scheduler endpoints
  app.get("/api/admin/scheduler/status", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { backgroundScheduler } = await import('./background-scheduler');
      const status = backgroundScheduler.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Scheduler status error:', error);
      res.status(500).json({ message: "Failed to get scheduler status" });
    }
  });

  app.post("/api/admin/scheduler/config", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { backgroundScheduler } = await import('./background-scheduler');
      const config = req.body;
      
      backgroundScheduler.updateConfig(config);
      res.json({ success: true, message: "Scheduler configuration updated" });
    } catch (error) {
      console.error('Scheduler config error:', error);
      res.status(500).json({ message: "Failed to update scheduler configuration" });
    }
  });

  app.post("/api/admin/scheduler/stop", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { backgroundScheduler } = await import('./background-scheduler');
      backgroundScheduler.stopAllJobs();
      res.json({ success: true, message: "All scheduled jobs stopped" });
    } catch (error) {
      console.error('Scheduler stop error:', error);
      res.status(500).json({ message: "Failed to stop scheduler" });
    }
  });

  // PriceCharting import endpoint
  app.post("/api/admin/import-pricecharting", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { limit = 50, rateLimitMs = 2000 } = req.body;
      
      // Validate parameters
      if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
        return res.status(400).json({ message: "Limit must be between 1 and 1000" });
      }
      
      if (typeof rateLimitMs !== 'number' || rateLimitMs < 1000) {
        return res.status(400).json({ message: "Rate limit must be at least 1000ms" });
      }

      // Import the complete PriceCharting module
      // const { importPriceChartingCards } = await import('../scripts/complete-pricecharting-import.ts');
      
      // Execute the import for ALL sets
      // const result = await importPriceChartingCards();
      const result = { message: "Import temporarily disabled" };

      res.json({
        success: true,
        message: "PriceCharting import completed",
        result
      });

    } catch (error) {
      console.error('PriceCharting import error:', error);
      res.status(500).json({ 
        message: "Failed to import PriceCharting data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // PriceCharting import status endpoint
  app.get("/api/admin/pricecharting-config", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const missingConfig = [];
      
      if (!process.env.PRICECHARTING_API_TOKEN) {
        missingConfig.push('PRICECHARTING_API_TOKEN');
      }
      
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        missingConfig.push('CLOUDINARY_CLOUD_NAME');
      }
      
      if (!process.env.CLOUDINARY_API_KEY) {
        missingConfig.push('CLOUDINARY_API_KEY');
      }
      
      if (!process.env.CLOUDINARY_API_SECRET) {
        missingConfig.push('CLOUDINARY_API_SECRET');
      }

      res.json({
        ready: missingConfig.length === 0,
        missingConfig,
        hasToken: !!process.env.PRICECHARTING_API_TOKEN,
        hasCloudinary: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
      });

    } catch (error) {
      console.error('PriceCharting config error:', error);
      res.status(500).json({ message: "Failed to check PriceCharting configuration" });
    }
  });

  // ========== BREVO EMAIL & CONTACT SYNC ROUTES ==========

  // Test email sending route (development only)
  app.post("/api/test-email", async (req, res) => {
    try {
      const { to, subject, html } = req.body;

      if (!to || !subject || !html) {
        return res.status(400).json({ 
          message: "Missing required fields: to, subject, html" 
        });
      }

      await sendEmail(to, subject, html);
      res.json({ 
        success: true, 
        message: `Email sent successfully to ${to}` 
      });
    } catch (error) {
      console.error('Test email error:', error);
      res.status(500).json({ 
        message: "Failed to send test email",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin-only: Sync Firebase users to Brevo contacts
  app.post("/api/admin/sync-contacts", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      await syncFirebaseUsersToBrevo();
      res.json({ 
        success: true, 
        message: "Firebase users synced to Brevo successfully" 
      });
    } catch (error) {
      console.error('Contact sync error:', error);
      res.status(500).json({ 
        message: "Failed to sync contacts to Brevo",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin-only: Preview email templates
  app.get("/api/admin/email-preview", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { template } = req.query;
      const templates = await import('./services/emailTemplates');
      
      // Mock data for each template type
      const mockUser = { displayName: 'John Collector', username: 'johncollector' };
      const mockBadge = { name: 'First Card', description: 'Added your first card to the collection' };
      const mockTrade = { 
        id: 123, 
        offeredCards: ['Iron Man #1', 'Spider-Man #2', 'Hulk #3'],
        requestedCards: ['Captain America #1'],
        partnerUsername: 'traderbob'
      };
      const mockCard = { name: 'Iron Man #1', imageUrl: 'https://via.placeholder.com/200' };
      const mockSet = { name: 'Marvel Masterpieces 2024', releaseDate: 'December 2024', imageUrl: 'https://via.placeholder.com/600x300' };
      const mockMilestone = { count: 100, type: 'Cards' };
      const mockSets = [
        { name: 'Marvel Masterpieces 2024', cardCount: 150 },
        { name: 'Topps Chrome 2024', cardCount: 200 }
      ];

      let html: string;
      
      switch (template) {
        case 'welcome':
          html = templates.welcomeTemplate(mockUser);
          break;
        case 'password-reset':
          html = templates.passwordResetTemplate({ email: 'user@example.com' }, 'https://marvelcardvault.com/reset');
          break;
        case 'password-reset-confirmation':
          html = templates.passwordResetConfirmationTemplate(mockUser);
          break;
        case 'badge-unlocked':
          html = templates.badgeUnlockedTemplate(mockUser, mockBadge);
          break;
        case 'trade-proposed':
          html = templates.tradeProposedTemplate(
            { displayName: 'Bob Trader', username: 'traderbob' },
            mockUser,
            mockTrade
          );
          break;
        case 'trade-accepted':
          html = templates.tradeAcceptedTemplate(mockUser, mockTrade);
          break;
        case 'trade-declined':
          html = templates.tradeDeclinedTemplate(mockUser, mockTrade);
          break;
        case 'card-image-approved':
          html = templates.cardImageApprovedTemplate(mockUser, mockCard);
          break;
        case 'card-image-rejected':
          html = templates.cardImageRejectedTemplate(mockUser, { ...mockCard, reason: 'Image quality too low' });
          break;
        case 'new-set-notification':
          html = templates.newSetNotificationTemplate(mockUser, mockSet);
          break;
        case 'add-first-card':
          html = templates.addFirstCardTemplate(mockUser);
          break;
        case 'finish-setup':
          html = templates.finishSetupTemplate(mockUser);
          break;
        case 'inactive-user':
          html = templates.inactiveUserTemplate(mockUser);
          break;
        case 'collection-milestone':
          html = templates.collectionMilestoneTemplate(mockUser, mockMilestone);
          break;
        case 'weekly-digest':
          html = templates.weeklyDigestTemplate(mockUser, mockSets);
          break;
        default:
          return res.status(400).json({ 
            message: "Invalid template name. Available templates: welcome, password-reset, password-reset-confirmation, badge-unlocked, trade-proposed, trade-accepted, trade-declined, card-image-approved, card-image-rejected, new-set-notification, add-first-card, finish-setup, inactive-user, collection-milestone, weekly-digest"
          });
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Email preview error:', error);
      res.status(500).json({ 
        message: "Failed to generate email preview",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin-only: Email cron status and statistics
  app.get("/api/admin/email-cron-status", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { getEmailCronStatus } = await import('./jobs/emailCron');
      const cronStatus = getEmailCronStatus();

      // Get email stats from last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentEmails = await db
        .select({
          template: emailLogs.template,
          count: sql<number>`count(*)`,
        })
        .from(emailLogs)
        .where(sql`${emailLogs.sentAt} >= ${sevenDaysAgo}`)
        .groupBy(emailLogs.template);

      const totalEmailsLast7Days = recentEmails.reduce(
        (sum, row) => sum + Number(row.count),
        0
      );

      const emailsByTemplate = recentEmails.map(row => ({
        template: row.template,
        count: Number(row.count)
      }));

      res.json({
        cron: cronStatus,
        stats: {
          totalEmailsLast7Days,
          emailsByTemplate,
          period: '7 days'
        }
      });
    } catch (error) {
      console.error('Email cron status error:', error);
      res.status(500).json({ 
        message: "Failed to get email cron status",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ========== SOCIAL FEATURES API ROUTES ==========
  
  // Friends API
  app.get("/api/social/friends", authenticateUser, async (req: any, res) => {
    try {
      const friends = await storage.getFriends(req.user.id);
      res.json(friends);
    } catch (error) {
      console.error('Get friends error:', error);
      res.status(500).json({ message: "Failed to fetch friends" });
    }
  });

  app.get("/api/social/friend-requests", authenticateUser, async (req: any, res) => {
    try {
      const requests = await storage.getFriendRequests(req.user.id);
      res.json(requests);
    } catch (error) {
      console.error('Get friend requests error:', error);
      res.status(500).json({ message: "Failed to fetch friend requests" });
    }
  });

  app.get("/api/social/pending-invitations", authenticateUser, async (req: any, res) => {
    try {
      const invitations = await storage.getPendingInvitations(req.user.id);
      res.json(invitations);
    } catch (error) {
      console.error('Get pending invitations error:', error);
      res.status(500).json({ message: "Failed to fetch pending invitations" });
    }
  });

  app.post("/api/social/friend-request", authenticateUser, async (req: any, res) => {
    try {
      const { recipientId } = req.body;
      
      if (!recipientId || recipientId === req.user.id) {
        return res.status(400).json({ message: "Invalid recipient ID" });
      }

      // Check if friendship already exists
      const existingFriendship = await storage.getFriendshipStatus(req.user.id, recipientId);
      if (existingFriendship) {
        return res.status(400).json({ message: "Friend request already exists" });
      }

      const friendship = await storage.sendFriendRequest(req.user.id, recipientId);
      
      // Check badges when friend relationships change
      await badgeService.checkBadgesOnFriendChange(req.user.id);
      
      res.status(201).json(friendship);
    } catch (error) {
      console.error('Send friend request error:', error);
      res.status(500).json({ message: "Failed to send friend request" });
    }
  });

  app.post("/api/social/friend-request/:id/respond", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (!["accepted", "declined"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const friendship = await storage.respondToFriendRequest(friendId, status);
      if (!friendship) {
        return res.status(404).json({ message: "Friend request not found" });
      }

      // Check badges when friend relationships change (only if accepted)
      if (status === 'accepted') {
        await badgeService.checkBadgesOnFriendChange(req.user.id);
      }

      res.json(friendship);
    } catch (error) {
      console.error('Respond to friend request error:', error);
      res.status(500).json({ message: "Failed to respond to friend request" });
    }
  });

  app.delete("/api/social/friend/:id", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.id);
      await storage.removeFriend(friendId);
      res.json({ message: "Friend removed successfully" });
    } catch (error) {
      console.error('Remove friend error:', error);
      res.status(500).json({ message: "Failed to remove friend" });
    }
  });

  // Messages API
  app.get("/api/social/messages/:userId", authenticateUser, async (req: any, res) => {
    try {
      const otherUserId = parseInt(req.params.userId);
      const messages = await storage.getMessages(req.user.id, otherUserId);
      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/social/messages", authenticateUser, async (req: any, res) => {
    try {
      const { recipientId, content } = req.body;
      
      if (!recipientId || !content || content.trim().length === 0) {
        return res.status(400).json({ message: "Recipient ID and content are required" });
      }

      const message = await storage.sendMessage(req.user.id, recipientId, content.trim());
      
      // Check badge unlocks when user sends a message
      await badgeService.checkBadgesOnMessage(req.user.id, content.trim());
      
      res.status(201).json(message);
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Image upload for messages
  app.post("/api/social/messages/image", authenticateUser, upload.single('image'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const recipientId = parseInt(req.body.recipientId);
      if (!recipientId) {
        return res.status(400).json({ message: "Recipient ID is required" });
      }

      // For now, save to uploads directory
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const fileExtension = path.extname(req.file.originalname);
      const filename = `${crypto.randomUUID()}${fileExtension}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, req.file.buffer);

      // Create message with image
      const imageUrl = `/uploads/${filename}`;
      const messageData = {
        senderId: req.user.id,
        recipientId,
        content: `[Image: ${req.file.originalname}]`,
        imageUrl
      };

      const message = await storage.sendMessage(req.user.id, recipientId, `[Image: ${req.file.originalname}]`, imageUrl);
      res.status(201).json({ ...message, imageUrl });
    } catch (error) {
      console.error('Send image message error:', error);
      res.status(500).json({ message: "Failed to send image message" });
    }
  });

  app.post("/api/social/messages/:id/read", authenticateUser, async (req: any, res) => {
    try {
      const messageId = parseInt(req.params.id);
      await storage.markMessageAsRead(messageId);
      res.json({ message: "Message marked as read" });
    } catch (error) {
      console.error('Mark message as read error:', error);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  app.get("/api/social/message-threads", authenticateUser, async (req: any, res) => {
    try {
      const threads = await storage.getMessageThreads(req.user.id);
      res.json(threads);
    } catch (error) {
      console.error('Get message threads error:', error);
      res.status(500).json({ message: "Failed to fetch message threads" });
    }
  });

  app.get("/api/social/unread-count", authenticateUser, async (req: any, res) => {
    try {
      const count = await storage.getUnreadMessageCount(req.user.id);
      res.json({ count });
    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // Badges API
  app.get("/api/social/badges", async (req, res) => {
    try {
      const badges = await storage.getBadges();
      res.json(badges);
    } catch (error) {
      console.error('Get badges error:', error);
      res.status(500).json({ message: "Failed to fetch badges" });
    }
  });

  app.get("/api/badges", authenticateUser, async (req, res) => {
    try {
      const badges = await storage.getBadges();
      res.json(badges);
    } catch (error) {
      console.error('Get badges error:', error);
      res.status(500).json({ message: "Failed to fetch badges" });
    }
  });

  app.get("/api/social/user-badges", authenticateUser, async (req: any, res) => {
    try {
      const userBadges = await storage.getUserBadges(req.user.id);
      res.json(userBadges);
    } catch (error) {
      console.error('Get user badges error:', error);
      res.status(500).json({ message: "Failed to fetch user badges" });
    }
  });

  app.post("/api/social/check-badges", authenticateUser, async (req: any, res) => {
    try {
      const newBadges = await storage.checkAndAwardBadges(req.user.id);
      res.json({ newBadges });
    } catch (error) {
      console.error('Check badges error:', error);
      res.status(500).json({ message: "Failed to check badges" });
    }
  });

  // Profiles API
  app.get("/api/social/profile/:userId", authenticateUser, async (req: any, res) => {
    try {
      const targetUserId = parseInt(req.params.userId);
      
      // Check if user can view this profile
      const canView = await storage.canViewProfile(req.user.id, targetUserId);
      if (!canView) {
        return res.status(403).json({ message: "You don't have permission to view this profile" });
      }

      const stats = await storage.getProfileStats(targetUserId);
      res.json(stats);
    } catch (error) {
      console.error('Get profile stats error:', error);
      res.status(500).json({ message: "Failed to fetch profile stats" });
    }
  });

  app.put("/api/social/profile/visibility", authenticateUser, async (req: any, res) => {
    try {
      const { visibility } = req.body;
      
      if (!["public", "friends", "private"].includes(visibility)) {
        return res.status(400).json({ message: "Invalid visibility setting" });
      }

      await storage.updateProfileVisibility(req.user.id, visibility);
      res.json({ message: "Profile visibility updated successfully" });
    } catch (error) {
      console.error('Update profile visibility error:', error);
      res.status(500).json({ message: "Failed to update profile visibility" });
    }
  });

  // Friend Collection Sharing API
  app.get("/api/social/friends/:friendId/profile", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      const profile = await storage.getFriendProfile(req.user.id, friendId);
      res.json(profile);
    } catch (error) {
      console.error('Get friend profile error:', error);
      res.status(500).json({ message: error.message || "Failed to fetch friend profile" });
    }
  });

  app.get("/api/social/friends/:friendId/collection", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      const collection = await storage.getFriendCollection(req.user.id, friendId);
      res.json(collection);
    } catch (error) {
      console.error('Get friend collection error:', error);
      res.status(500).json({ message: error.message || "Failed to fetch friend collection" });
    }
  });

  app.get("/api/social/friends/:friendId/wishlist", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      const wishlist = await storage.getFriendWishlist(req.user.id, friendId);
      res.json(wishlist);
    } catch (error) {
      console.error('Get friend wishlist error:', error);
      res.status(500).json({ message: error.message || "Failed to fetch friend wishlist" });
    }
  });

  app.get("/api/social/friends/:friendId/badges", authenticateUser, async (req: any, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      
      // Check if user can view this friend's badges
      const canView = await storage.canViewProfile(req.user.id, friendId);
      if (!canView) {
        return res.status(403).json({ message: "You don't have permission to view this friend's badges" });
      }
      
      const badges = await storage.getUserBadges(friendId);
      res.json(badges);
    } catch (error) {
      console.error('Get friend badges error:', error);
      res.status(500).json({ message: "Failed to fetch friend badges" });
    }
  });

  // Notification API endpoints
  app.get("/api/notifications", authenticateUser, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const notifications = await storage.getUserNotifications(req.user.id, limit);
      res.json(notifications);
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", authenticateUser, async (req: any, res) => {
    try {
      const count = await storage.getUnreadNotificationCount(req.user.id);
      res.json({ count });
    } catch (error) {
      console.error('Get unread notification count error:', error);
      res.status(500).json({ message: "Failed to fetch unread notification count" });
    }
  });

  app.put("/api/notifications/:id/read", authenticateUser, async (req: any, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      await storage.markNotificationAsRead(notificationId);
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error('Mark notification as read error:', error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.put("/api/notifications/mark-all-read", authenticateUser, async (req: any, res) => {
    try {
      await storage.markAllNotificationsAsRead(req.user.id);
      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error('Mark all notifications as read error:', error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // User Search API
  app.get("/api/social/search-users", authenticateUser, async (req: any, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string' || q.trim().length < 2) {
        return res.status(400).json({ message: "Search query must be at least 2 characters long" });
      }

      const users = await storage.searchUsers(q.trim(), req.user.id);
      res.json(users);
    } catch (error) {
      console.error('Search users error:', error);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  // Admin Badge Management
  app.post("/api/admin/badges", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = insertBadgeSchema.parse(req.body);
      const badge = await storage.createBadge(validatedData);
      res.status(201).json(badge);
    } catch (error) {
      console.error('Create badge error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create badge" });
    }
  });

  app.post("/api/admin/badges/:badgeId/award/:userId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const badgeId = parseInt(req.params.badgeId);
      const userId = parseInt(req.params.userId);
      
      const userBadge = await storage.awardBadge(userId, badgeId);
      
      // Send badge achievement email (non-blocking)
      const user = await storage.getUserById(userId);
      const badge = await storage.getBadgeById(badgeId);
      if (user && badge) {
        emailTriggers.onBadgeUnlocked(
          {
            email: user.email,
            displayName: user.displayName || user.username,
          },
          {
            name: badge.name,
            description: badge.description,
            icon: badge.icon || undefined
          }
        ).catch(error => {
          console.error('Failed to send badge achievement email:', error);
        });
      }
      
      res.status(201).json(userBadge);
    } catch (error) {
      console.error('Award badge error:', error);
      res.status(500).json({ message: "Failed to award badge" });
    }
  });

  // Admin retroactive badge check for all users
  app.post("/api/admin/badges/retroactive-check", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Get all users with at least one card
      const usersWithCards = await db.select({ userId: userCollections.userId })
        .from(userCollections)
        .groupBy(userCollections.userId);

      let processed = 0;
      let badgesAwarded = 0;

      for (const { userId } of usersWithCards) {
        try {
          // Count badges before
          const beforeBadges = await db.select({ count: count() })
            .from(userBadges)
            .where(eq(userBadges.userId, userId));
          
          await badgeService.runRetroactiveBadgeChecks(userId);
          
          // Count badges after
          const afterBadges = await db.select({ count: count() })
            .from(userBadges)
            .where(eq(userBadges.userId, userId));
          
          badgesAwarded += Number(afterBadges[0].count) - Number(beforeBadges[0].count);
          processed++;
        } catch (error) {
          console.error(`Failed to check badges for user ${userId}:`, error);
        }
      }

      console.log(`[ADMIN] Retroactive badge check complete: ${processed} users processed, ${badgesAwarded} badges awarded`);
      res.json({ 
        message: `Retroactive badge check complete`,
        usersProcessed: processed,
        badgesAwarded
      });
    } catch (error) {
      console.error('Retroactive badge check error:', error);
      res.status(500).json({ message: "Failed to run retroactive badge check" });
    }
  });

  // Performance testing and cache management endpoints
  app.get("/api/admin/cache/clear", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
      ultraOptimizedStorage.clearCache();
      
      res.json({ message: "Cache cleared successfully" });
    } catch (error) {
      console.error('Cache clear error:', error);
      res.status(500).json({ message: "Failed to clear cache" });
    }
  });

  // Performance benchmark endpoint
  app.get("/api/admin/performance/benchmark", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
      
      // Clear cache to get cold performance
      ultraOptimizedStorage.clearCache();
      
      const results = [];
      
      // Test 1: Cold cache performance
      const coldStart = Date.now();
      await ultraOptimizedStorage.getCardsPaginated(1, 50, {});
      const coldTime = Date.now() - coldStart;
      results.push({ test: "Cold cache (page 1)", time: coldTime });
      
      // Test 2: Warm cache performance
      const warmStart = Date.now();
      await ultraOptimizedStorage.getCardsPaginated(1, 50, {});
      const warmTime = Date.now() - warmStart;
      results.push({ test: "Warm cache (page 1)", time: warmTime });
      
      // Test 3: Lightweight query
      const lightStart = Date.now();
      await ultraOptimizedStorage.getLightweightCardsPaginated(1, 50, {});
      const lightTime = Date.now() - lightStart;
      results.push({ test: "Lightweight query", time: lightTime });
      
      // Test 4: Filtered query
      const filterStart = Date.now();
      await ultraOptimizedStorage.getCardsPaginated(1, 50, { hasImage: true });
      const filterTime = Date.now() - filterStart;
      results.push({ test: "Filtered query (has image)", time: filterTime });
      
      const summary = {
        totalTests: results.length,
        averageTime: Math.round(results.reduce((sum, r) => sum + r.time, 0) / results.length),
        fastest: Math.min(...results.map(r => r.time)),
        slowest: Math.max(...results.map(r => r.time)),
        results
      };
      
      res.json(summary);
    } catch (error) {
      console.error('Performance benchmark error:', error);
      res.status(500).json({ message: "Failed to run performance benchmark" });
    }
  });

  // Firebase User Recovery Endpoint
  app.get("/api/admin/firebase-users", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      console.log('Fetching Firebase users for comparison...');
      
      // Get all Firebase users
      const firebaseUsers = [];
      let nextPageToken;
      
      do {
        const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
        firebaseUsers.push(...listUsersResult.users);
        nextPageToken = listUsersResult.pageToken;
      } while (nextPageToken);

      // Get all database users
      const dbUsers = await storage.getAllUsers();
      
      // Compare Firebase vs Database
      const firebaseUIDs = firebaseUsers.map(u => u.uid);
      const dbUIDs = dbUsers.map(u => u.firebaseUid);
      
      const missingInDB = firebaseUsers.filter(u => !dbUIDs.includes(u.uid));
      const missingInFirebase = dbUsers.filter(u => !firebaseUIDs.includes(u.firebaseUid));
      
      const comparison = {
        firebaseCount: firebaseUsers.length,
        databaseCount: dbUsers.length,
        missingInDatabase: missingInDB.length,
        missingInFirebase: missingInFirebase.length,
        missingUsers: missingInDB.map(u => ({
          uid: u.uid,
          email: u.email || 'No email',
          displayName: u.displayName || 'No display name',
          createdTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime || 'Never'
        })),
        dbUsers: dbUsers.map(u => ({
          id: u.id,
          firebaseUid: u.firebaseUid,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt
        }))
      };
      
      res.json(comparison);
    } catch (error) {
      console.error('Firebase users fetch error:', error);
      res.status(500).json({ message: "Failed to fetch Firebase users" });
    }
  });

  // Restore Missing Firebase Users Endpoint
  app.post("/api/admin/restore-firebase-users", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      console.log('Starting Firebase user restoration...');
      
      // Get all Firebase users
      const firebaseUsers = [];
      let nextPageToken;
      
      do {
        const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
        firebaseUsers.push(...listUsersResult.users);
        nextPageToken = listUsersResult.pageToken;
      } while (nextPageToken);

      // Get current database users
      const dbUsers = await storage.getAllUsers();
      const dbUIDs = dbUsers.map(u => u.firebaseUid);
      
      // Find users missing from database
      const missingUsers = firebaseUsers.filter(u => !dbUIDs.includes(u.uid));
      
      console.log(`Found ${missingUsers.length} Firebase users missing from database`);
      
      const restoredUsers = [];
      const errors = [];
      
      for (const firebaseUser of missingUsers) {
        try {
          const isAdminEmail = firebaseUser.email === 'joshdlange045@gmail.com';
          const userData = {
            firebaseUid: firebaseUser.uid,
            username: firebaseUser.email ? firebaseUser.email.split('@')[0] : `user_${firebaseUser.uid.slice(0, 8)}`,
            email: firebaseUser.email || `${firebaseUser.uid}@unknown.com`,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Restored User',
            isAdmin: isAdminEmail,
            plan: 'SIDE_KICK',
            subscriptionStatus: 'active'
          };
          
          const user = await storage.createUser(userData);
          restoredUsers.push({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            firebaseUid: user.firebaseUid
          });
          
          console.log(`Restored user: ${user.email} (ID: ${user.id})`);
        } catch (error) {
          console.error(`Failed to restore user ${firebaseUser.uid}:`, error);
          errors.push({
            uid: firebaseUser.uid,
            email: firebaseUser.email || 'No email',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      const result = {
        firebaseTotal: firebaseUsers.length,
        databaseBefore: dbUsers.length,
        missingFound: missingUsers.length,
        restored: restoredUsers.length,
        errors: errors.length,
        restoredUsers,
        errorDetails: errors.slice(0, 5) // Only show first 5 errors
      };
      
      console.log('Firebase user restoration complete:', result);
      res.json(result);
    } catch (error) {
      console.error('Firebase user restoration error:', error);
      res.status(500).json({ 
        message: "Failed to restore Firebase users",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Market Trends API
  app.get("/api/market-trends", async (req, res) => {
    try {
      const trendsData = await marketTrendsService.getMarketTrendsResponse();
      res.json(trendsData);
    } catch (error) {
      console.error('Get market trends error:', error);
      res.status(500).json({ message: "Failed to fetch market trends" });
    }
  });

  // Admin route to manually trigger market trends update
  app.post("/api/admin/market-trends/update", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      await marketTrendsService.runDailyUpdate();
      res.json({ message: "Market trends updated successfully" });
    } catch (error) {
      console.error('Update market trends error:', error);
      res.status(500).json({ message: "Failed to update market trends" });
    }
  });

  // Check eBay API access status
  app.get("/api/ebay-api-status", async (req, res) => {
    try {
      const [browseAccess, insightsAccess] = await Promise.all([
        // Check Browse API (should always work with valid credentials)
        ebayBrowseApi.getMarvelCardTrends().then(() => ({ hasAccess: true, message: 'Browse API accessible' }))
          .catch((error) => ({ hasAccess: false, message: `Browse API error: ${error.message}` })),
        
        // Check Marketplace Insights API (requires business approval)
        ebayMarketplaceInsights.checkApiAccess()
      ]);

      res.json({
        browseApi: browseAccess,
        marketplaceInsights: insightsAccess,
        recommendations: [
          !browseAccess.hasAccess && "Add eBay Browse API credentials",
          !insightsAccess.hasAccess && "Apply for Marketplace Insights API access at https://developer.ebay.com/api-docs/buy/static/api-insights.html"
        ].filter(Boolean)
      });
    } catch (error) {
      console.error('API status check error:', error);
      res.status(500).json({ message: "Failed to check API status" });
    }
  });

  // Get historical Marvel card sales data (requires Marketplace Insights API)
  app.get("/api/market-trends/historical", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required for historical data' });
      }

      const historicalData = await ebayMarketplaceInsights.getMarvelCardSalesHistory();
      
      res.json({
        dataSource: 'eBay Marketplace Insights API',
        timeWindow: 'Last 90 days',
        totalSales: historicalData.totalSales,
        averagePrice: historicalData.averagePrice,
        priceRange: historicalData.priceRange,
        dailySales: historicalData.salesByDate,
        topSellers: historicalData.topSellers.slice(0, 5), // Limit to top 5
        note: historicalData.totalSales === 0 ? 
          'No historical data available. This requires Marketplace Insights API access from eBay.' : 
          'Historical sales data from eBay Marketplace Insights API'
      });
    } catch (error) {
      console.error('Historical data error:', error);
      res.status(500).json({ 
        message: "Failed to fetch historical data",
        note: "This feature requires eBay Marketplace Insights API access"
      });
    }
  });

  // Public: Get active upcoming sets
  app.get("/api/upcoming-sets", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      let sets = await storage.getUpcomingSets();
      
      // Filter to only upcoming and delayed (not released)
      sets = sets.filter(set => set.status === 'upcoming' || set.status === 'delayed');
      
      // Sort by release date
      sets.sort((a, b) => {
        if (!a.releaseDateEstimated) return 1;
        if (!b.releaseDateEstimated) return -1;
        return new Date(a.releaseDateEstimated).getTime() - new Date(b.releaseDateEstimated).getTime();
      });
      
      // Apply limit if specified
      if (limit) {
        sets = sets.slice(0, limit);
      }
      
      res.json(sets);
    } catch (error) {
      console.error('Get upcoming sets error:', error);
      res.status(500).json({ message: "Failed to fetch upcoming sets" });
    }
  });

  // Public: Express interest in an upcoming set
  app.post("/api/upcoming-sets/:id/interest", authenticateUser, async (req: any, res) => {
    try {
      const setId = parseInt(req.params.id);
      const userId = req.user.id;

      const updatedSet = await storage.incrementSetInterest(setId, userId);

      if (!updatedSet) {
        return res.status(404).json({ message: "Upcoming set not found" });
      }

      res.json({ 
        message: "Interest recorded successfully",
        interestCount: updatedSet.interestCount 
      });
    } catch (error) {
      console.error('Record interest error:', error);
      res.status(500).json({ message: "Failed to record interest" });
    }
  });

  // Admin: Get all upcoming sets
  app.get("/api/admin/upcoming-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const sets = await storage.getAllUpcomingSets();
      res.json(sets);
    } catch (error) {
      console.error('Get admin upcoming sets error:', error);
      res.status(500).json({ message: "Failed to fetch upcoming sets" });
    }
  });

  app.post("/api/admin/upcoming-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const setData = req.body;
      const newSet = await storage.createUpcomingSet(setData);
      res.json(newSet);
    } catch (error) {
      console.error('Create upcoming set error:', error);
      res.status(500).json({ message: "Failed to create upcoming set" });
    }
  });

  app.patch("/api/admin/upcoming-sets/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const setId = parseInt(req.params.id);
      const updates = req.body;
      const updatedSet = await storage.updateUpcomingSet(setId, updates);
      
      if (!updatedSet) {
        return res.status(404).json({ message: "Upcoming set not found" });
      }
      
      res.json(updatedSet);
    } catch (error) {
      console.error('Update upcoming set error:', error);
      res.status(500).json({ message: "Failed to update upcoming set" });
    }
  });

  // Admin: Import upcoming set from URL (OpenGraph scraping)
  app.post("/api/admin/upcoming-sets/import", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const { sourceUrl } = req.body;
      
      if (!sourceUrl) {
        return res.status(400).json({ message: 'sourceUrl is required' });
      }

      // Import the scraper utilities
      const { scrapeSetDataFromUrl } = await import('./utils/openGraphScraper');
      const { cacheImageToCloudinary } = await import('./utils/imageCacher');

      // Scrape the URL for metadata
      const scrapedData = await scrapeSetDataFromUrl(sourceUrl);

      // If there's an image, cache it to Cloudinary
      if (scrapedData.thumbnailUrl) {
        try {
          scrapedData.thumbnailUrl = await cacheImageToCloudinary(scrapedData.thumbnailUrl);
        } catch (imageError) {
          console.error('Failed to cache image, using original URL:', imageError);
          // Continue with original URL if caching fails
        }
      }

      // Return the scraped data as a preview for admin to confirm/edit
      res.json({
        preview: scrapedData,
        message: 'Successfully scraped metadata. Please review and confirm before saving.'
      });
    } catch (error) {
      console.error('Import URL error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to import from URL'
      });
    }
  });

  // Admin: Mark upcoming set as released
  app.post("/api/admin/upcoming-sets/:id/mark-released", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const setId = parseInt(req.params.id);
      const updatedSet = await storage.markSetAsReleased(setId);

      if (!updatedSet) {
        return res.status(404).json({ message: "Upcoming set not found" });
      }

      res.json(updatedSet);
    } catch (error) {
      console.error('Mark set as released error:', error);
      res.status(500).json({ message: "Failed to mark set as released" });
    }
  });

  app.delete("/api/admin/upcoming-sets/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      
      const setId = parseInt(req.params.id);
      await storage.deleteUpcomingSet(setId);
      res.json({ message: "Upcoming set deleted successfully" });
    } catch (error) {
      console.error('Delete upcoming set error:', error);
      res.status(500).json({ message: "Failed to delete upcoming set" });
    }
  });

  // Stripe Subscription Routes
  app.post("/api/create-checkout-session", authenticateUser, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Don't allow already subscribed users to create new sessions
      if (user.plan === 'SUPER_HERO' && user.subscriptionStatus === 'active') {
        return res.status(400).json({ message: "User already has an active subscription" });
      }

      // Use the actual Stripe Price ID for Super Hero Plan ($5/month)
      const SUPER_HERO_PRICE_ID = 'price_1ShZCvHUwjq8stIzSBgrMa10';
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: SUPER_HERO_PRICE_ID, // Use pre-defined Stripe price
            quantity: 1,
          },
        ],
        mode: 'subscription',
        allow_promotion_codes: true, // Enable promo codes at checkout
        success_url: `${req.headers.origin}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}/subscription-cancelled`,
        metadata: {
          userId: user.id.toString(),
          userEmail: user.email,
        },
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error: any) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ message: 'Failed to create checkout session' });
    }
  });

  // Diagnostic endpoint to test if webhook route is reachable
  app.get('/api/stripe/webhook', (req, res) => {
    console.log('🔍 Stripe webhook route test (GET)');
    res.json({ status: 'ok', message: 'Stripe webhook route is reachable', timestamp: new Date().toISOString() });
  });
  
  app.get('/api/stripe-webhook', (req, res) => {
    console.log('🔍 Stripe webhook route test (GET)');
    res.json({ status: 'ok', message: 'Stripe webhook route is reachable', timestamp: new Date().toISOString() });
  });

  // Stripe webhook endpoint to handle successful payments
  app.post('/api/stripe-webhook', async (req, res) => {
    console.log('🔔 Stripe webhook received at /api/stripe-webhook');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    const sig = req.headers['stripe-signature'];
    let event;

    if (!sig) {
      console.error('❌ Webhook Error: Missing stripe-signature header');
      return res.status(400).send('Webhook Error: Missing signature');
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('❌ Webhook Error: STRIPE_WEBHOOK_SECRET not configured');
      return res.status(500).send('Webhook Error: Server configuration issue');
    }

    try {
      event = stripe.webhooks.constructEvent(req.body, sig as string, process.env.STRIPE_WEBHOOK_SECRET);
      console.log(`✅ Webhook verified - Event type: ${event.type}`);
    } catch (err: any) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = parseInt(session.metadata?.userId || '0');
          
          // Check if this is a marketplace purchase
          if (session.metadata?.type === 'marketplace_purchase') {
            // Handle marketplace payment confirmation directly (no HTTP call for reliability)
            try {
              const { orders, listings, userCollections, notifications } = await import('../shared/schema');
              const { eq } = await import('drizzle-orm');
              
              const order = await db.select().from(orders)
                .where(eq(orders.stripeCheckoutSessionId, session.id))
                .limit(1);
              
              if (order.length) {
                // Race condition protection: check if item already sold
                const listing = await db.select().from(listings).where(eq(listings.id, order[0].listingId)).limit(1);
                if (listing.length && listing[0].status === 'sold') {
                  console.log(`Race condition: Item already sold, refunding order ${order[0].orderNumber}`);
                  if (session.payment_intent) {
                    try {
                      await stripe.refunds.create({ payment_intent: session.payment_intent as string });
                      console.log(`Refund issued for payment intent ${session.payment_intent}`);
                    } catch (refundErr) {
                      console.error('Failed to issue refund:', refundErr);
                    }
                  }
                  await db.update(orders).set({
                    status: 'cancelled',
                    paymentStatus: 'refunded',
                    updatedAt: new Date(),
                  }).where(eq(orders.id, order[0].id));
                } else {
                  // Normal flow: update order and mark as sold
                  let shippingAddress = order[0].shippingAddress;
                  if (session.shipping_details?.address) {
                    const addr = session.shipping_details.address;
                    shippingAddress = JSON.stringify({
                      name: session.shipping_details.name || '',
                      street1: addr.line1 || '',
                      street2: addr.line2 || '',
                      city: addr.city || '',
                      state: addr.state || '',
                      zip: addr.postal_code || '',
                      country: addr.country || 'US',
                    });
                  }
                  
                  await db.update(orders).set({
                    status: 'needs_shipping',
                    paymentStatus: 'succeeded',
                    stripePaymentIntentId: session.payment_intent as string,
                    shippingAddress,
                    updatedAt: new Date(),
                  }).where(eq(orders.id, order[0].id));
                  
                  if (listing.length) {
                    await db.update(listings).set({ quantityAvailable: 0, status: 'sold', updatedAt: new Date() }).where(eq(listings.id, order[0].listingId));
                    if (listing[0].userCollectionId) {
                      await db.update(userCollections).set({ isForSale: false }).where(eq(userCollections.id, listing[0].userCollectionId));
                    }
                  }
                  
                  await db.insert(notifications).values({
                    userId: order[0].sellerId,
                    type: 'sale_made',
                    title: 'You made a sale!',
                    message: `Order #${order[0].orderNumber} is ready to ship.`,
                    data: JSON.stringify({ orderId: order[0].id, orderNumber: order[0].orderNumber, total: order[0].total }),
                    isRead: false,
                  });
                  console.log(`✅ Marketplace payment confirmed for order ${order[0].orderNumber}`);
                }
              }
            } catch (err) {
              console.error('Failed to confirm marketplace payment:', err);
            }
          } else if (userId && session.subscription) {
            // Update user to Super Hero plan
            await storage.updateUser(userId, {
              plan: 'SUPER_HERO',
              subscriptionStatus: 'active',
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: session.subscription as string
            });
            console.log(`User ${userId} upgraded to Super Hero plan`);
          }
          break;

        case 'checkout.session.expired':
          const expiredSession = event.data.object as Stripe.Checkout.Session;
          // Handle expired marketplace checkout sessions
          if (expiredSession.metadata?.type === 'marketplace_purchase') {
            const collectionItemId = parseInt(expiredSession.metadata.collectionItemId || '0');
            if (collectionItemId) {
              // Release the reservation
              try {
                const { listings, orders, userCollections } = await import('../shared/schema');
                const { eq, and } = await import('drizzle-orm');
                
                // Find and cancel the pending order
                const pendingOrder = await db
                  .select({ order: orders, listing: listings })
                  .from(orders)
                  .innerJoin(listings, eq(orders.listingId, listings.id))
                  .where(and(
                    eq(orders.stripeCheckoutSessionId, expiredSession.id),
                    eq(orders.status, 'payment_pending')
                  ))
                  .limit(1);
                
                if (pendingOrder.length) {
                  await db.update(orders).set({
                    status: 'cancelled',
                    paymentStatus: 'expired',
                    updatedAt: new Date(),
                  }).where(eq(orders.id, pendingOrder[0].order.id));
                  
                  await db.update(listings).set({
                    status: 'active',
                    quantityAvailable: 1,
                    updatedAt: new Date(),
                  }).where(eq(listings.id, pendingOrder[0].listing.id));
                  
                  await db.update(userCollections).set({
                    isForSale: true,
                  }).where(eq(userCollections.id, collectionItemId));
                  
                  console.log(`Released expired reservation for collection item ${collectionItemId}`);
                }
              } catch (err) {
                console.error('Failed to release expired reservation:', err);
              }
            }
          }
          break;

        case 'customer.subscription.deleted':
          const subscription = event.data.object as Stripe.Subscription;
          // Find user by subscription ID and downgrade to free plan
          const users = await storage.getAllUsers();
          const subscribedUser = users.find(u => u.stripeSubscriptionId === subscription.id);
          
          if (subscribedUser) {
            await storage.updateUser(subscribedUser.id, {
              plan: 'SIDE_KICK',
              subscriptionStatus: 'cancelled',
              stripeSubscriptionId: null
            });
            console.log(`User ${subscribedUser.id} downgraded to Side Kick plan`);
          }
          break;

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  });

  // Get current subscription status
  app.get("/api/subscription-status", authenticateUser, async (req: any, res) => {
    try {
      const user = req.user;
      res.json({
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch subscription status" });
    }
  });

  // Verify checkout session and upgrade user (fallback if webhook fails)
  app.post("/api/verify-checkout-session", authenticateUser, async (req: any, res) => {
    try {
      const { sessionId } = req.body;
      const user = req.user;
      
      if (!sessionId) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      // Check if user is already upgraded
      if (user.plan === 'SUPER_HERO' && user.subscriptionStatus === 'active') {
        console.log(`User ${user.id} already upgraded to SUPER_HERO`);
        return res.json({ 
          success: true, 
          message: "Already upgraded",
          plan: user.plan,
          subscriptionStatus: user.subscriptionStatus
        });
      }

      // Retrieve the checkout session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Verify the session belongs to this user
      if (session.metadata?.userId !== user.id.toString()) {
        console.error(`Session ${sessionId} userId mismatch: expected ${user.id}, got ${session.metadata?.userId}`);
        return res.status(403).json({ message: "Session does not belong to this user" });
      }

      // Check if payment was successful
      if (session.payment_status !== 'paid') {
        console.log(`Session ${sessionId} payment status: ${session.payment_status}`);
        return res.status(400).json({ message: "Payment not completed", paymentStatus: session.payment_status });
      }

      // Upgrade the user to Super Hero plan
      const updatedUser = await storage.updateUser(user.id, {
        plan: 'SUPER_HERO',
        subscriptionStatus: 'active',
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string
      });

      console.log(`User ${user.id} upgraded to Super Hero via verify-checkout-session fallback`);
      
      res.json({ 
        success: true, 
        message: "Successfully upgraded to Super Hero!",
        plan: 'SUPER_HERO',
        subscriptionStatus: 'active'
      });
    } catch (error: any) {
      console.error('Error verifying checkout session:', error);
      res.status(500).json({ message: 'Failed to verify checkout session', error: error.message });
    }
  });

  // Create customer portal session for billing management
  app.post("/api/create-portal-session", authenticateUser, async (req: any, res) => {
    try {
      const user = req.user;
      
      if (!user.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer ID found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.headers.origin}/profile`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error('Error creating portal session:', error);
      res.status(500).json({ message: 'Failed to create portal session' });
    }
  });

  // Admin: Manually upgrade user (for compensation/webhook issues)
  app.post("/api/admin/upgrade-user", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { userId, plan = 'SUPER_HERO', months = 2, reason } = req.body;
      
      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      // Calculate expiration date
      const expirationDate = new Date();
      expirationDate.setMonth(expirationDate.getMonth() + months);
      
      // Update user plan
      const updatedUser = await storage.updateUser(userId, {
        plan,
        subscriptionStatus: 'active',
        // Note: Not setting stripeCustomerId since this is manual compensation
      });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      console.log(`Admin ${req.user.id} manually upgraded user ${userId} to ${plan} for ${months} months. Reason: ${reason || 'No reason provided'}`);
      
      res.json({
        success: true,
        message: `User ${userId} upgraded to ${plan} plan for ${months} months`,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          plan: updatedUser.plan,
          subscriptionStatus: updatedUser.subscriptionStatus
        },
        expirationDate: expirationDate.toISOString()
      });
    } catch (error) {
      console.error('Manual upgrade error:', error);
      res.status(500).json({ message: "Failed to upgrade user" });
    }
  });

  // Admin: Get affected users during outage period
  app.get("/api/admin/outage-affected-users", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Get users who signed up recently but are still on free plan
      const users = await storage.getAllUsers();
      
      // Filter for potentially affected users (adjust dates as needed)
      const outageStartDate = new Date('2025-01-17'); // Adjust this date
      const outageEndDate = new Date('2025-01-19');   // Adjust this date
      
      const affectedUsers = users.filter(user => {
        const createdDate = new Date(user.createdAt);
        return (
          createdDate >= outageStartDate &&
          createdDate <= outageEndDate &&
          user.plan === 'SIDE_KICK' && // Still on free plan
          !user.stripeCustomerId // No successful payment
        );
      });

      res.json({
        outageStartDate: outageStartDate.toISOString(),
        outageEndDate: outageEndDate.toISOString(),
        affectedUsers: affectedUsers.map(user => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          createdAt: user.createdAt,
          plan: user.plan,
          subscriptionStatus: user.subscriptionStatus,
          hasStripeCustomer: !!user.stripeCustomerId
        })),
        count: affectedUsers.length
      });
    } catch (error) {
      console.error('Get affected users error:', error);
      res.status(500).json({ message: "Failed to get affected users" });
    }
  });

  // ===== USER IMAGE UPLOAD ROUTES =====
  
  // User uploads card image (front and/or back)
  app.post("/api/cards/:cardId/upload", authenticateUser, upload.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 }
  ]), async (req: any, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      const files = req.files as { frontImage?: Express.Multer.File[], backImage?: Express.Multer.File[] };
      
      if (!files.frontImage && !files.backImage) {
        return res.status(400).json({ message: "At least one image (front or back) is required" });
      }
      
      // Validate file sizes (5MB max)
      const MAX_SIZE = 5 * 1024 * 1024;
      if (files.frontImage && files.frontImage[0].size > MAX_SIZE) {
        return res.status(400).json({ message: "Front image exceeds 5MB limit" });
      }
      if (files.backImage && files.backImage[0].size > MAX_SIZE) {
        return res.status(400).json({ message: "Back image exceeds 5MB limit" });
      }
      
      // Validate file types
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (files.frontImage && !allowedTypes.includes(files.frontImage[0].mimetype)) {
        return res.status(400).json({ message: "Front image must be JPEG, PNG, or WebP" });
      }
      if (files.backImage && !allowedTypes.includes(files.backImage[0].mimetype)) {
        return res.status(400).json({ message: "Back image must be JPEG, PNG, or WebP" });
      }
      
      // Check if card exists
      const card = await storage.getCard(cardId);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      // Upload images to Cloudinary
      let frontImageUrl: string | null = null;
      let backImageUrl: string | null = null;
      
      if (files.frontImage) {
        frontImageUrl = await uploadUserCardImage(
          files.frontImage[0].buffer,
          req.user.id,
          cardId,
          'front'
        );
      }
      
      if (files.backImage) {
        backImageUrl = await uploadUserCardImage(
          files.backImage[0].buffer,
          req.user.id,
          cardId,
          'back'
        );
      }
      
      // Create pending image record
      const pendingImage = await storage.createPendingCardImage({
        userId: req.user.id,
        cardId,
        frontImageUrl,
        backImageUrl,
      });
      
      // Auto-add card to user's collection if they don't own it
      const existingCollection = await storage.getUserCollectionItem(req.user.id, cardId);
      if (!existingCollection) {
        await storage.addToCollection({
          userId: req.user.id,
          cardId,
          condition: "Near Mint",
          acquiredVia: "image-upload",
        });
      }
      
      res.json({
        message: "Thanks! Your image is pending approval.",
        pendingImage
      });
    } catch (error) {
      console.error('Upload card image error:', error);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });
  
  // Admin: Get all pending card images
  app.get("/api/admin/pending-images", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const pendingImages = await storage.getPendingCardImages();
      res.json(pendingImages);
    } catch (error) {
      console.error('Get pending images error:', error);
      res.status(500).json({ message: "Failed to fetch pending images" });
    }
  });
  
  // Admin: Approve pending card image
  app.post("/api/admin/pending-images/:id/approve", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const imageId = parseInt(req.params.id);
      const pendingImage = await storage.getPendingCardImage(imageId);
      
      if (!pendingImage) {
        return res.status(404).json({ message: "Pending image not found" });
      }
      
      if (pendingImage.status !== 'pending') {
        return res.status(400).json({ message: "Image has already been reviewed" });
      }
      
      // Get the card
      const card = await storage.getCard(pendingImage.cardId);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      
      // Update card image
      const cardUpdates: any = {};
      
      // Always replace frontImageUrl with approved user-submitted image (overrides placeholder)
      if (pendingImage.frontImageUrl) {
        cardUpdates.frontImageUrl = pendingImage.frontImageUrl;
      }
      
      // Always replace backImageUrl with approved user-submitted image
      if (pendingImage.backImageUrl) {
        cardUpdates.backImageUrl = pendingImage.backImageUrl;
      }
      
      if (Object.keys(cardUpdates).length > 0) {
        await storage.updateCard(pendingImage.cardId, cardUpdates);
      }
      
      // Mark image as approved
      await storage.updatePendingCardImage(imageId, {
        status: 'approved',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      });
      
      // Check if user has earned Contributor badge (3+ approved images)
      const userApprovedCount = await storage.getUserApprovedImageCount(pendingImage.userId);
      if (userApprovedCount >= 3) {
        await badgeService.awardBadge(pendingImage.userId, 'contributor');
      }
      
      res.json({ message: "Image approved successfully" });
    } catch (error) {
      console.error('Approve image error:', error);
      res.status(500).json({ message: "Failed to approve image" });
    }
  });
  
  // Admin: Reject pending card image
  app.post("/api/admin/pending-images/:id/reject", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const imageId = parseInt(req.params.id);
      const { rejectionReason } = req.body;
      
      const pendingImage = await storage.getPendingCardImage(imageId);
      if (!pendingImage) {
        return res.status(404).json({ message: "Pending image not found" });
      }
      
      if (pendingImage.status !== 'pending') {
        return res.status(400).json({ message: "Image has already been reviewed" });
      }
      
      await storage.updatePendingCardImage(imageId, {
        status: 'rejected',
        rejectionReason: rejectionReason || 'No reason provided',
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
      });
      
      res.json({ message: "Image rejected successfully" });
    } catch (error) {
      console.error('Reject image error:', error);
      res.status(500).json({ message: "Failed to reject image" });
    }
  });

  // ============================================
  // MIGRATION CONSOLE ROUTES (Admin Only)
  // ============================================

  // Get card sets for migration (with filters)
  app.get("/api/admin/migration/sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { type, hasCards, year, mainSetId, search, showArchived } = req.query;
      
      // Get LEGACY sets only (canonical_source IS NULL) with card counts
      const setsWithCounts = await db.execute(sql`
        SELECT 
          cs.id,
          cs.name,
          cs.year,
          cs.slug,
          cs.main_set_id as "mainSetId",
          cs.image_url as "imageUrl",
          cs.is_active as "isActive",
          cs.is_canonical as "isCanonical",
          cs.is_insert_subset as "isInsertSubset",
          cs.canonical_source as "canonicalSource",
          cs.created_at as "createdAt",
          ms.name as "mainSetName",
          ms.thumbnail_image_url as "mainSetThumbnail",
          COUNT(c.id)::int as "cardCount"
        FROM card_sets cs
        LEFT JOIN main_sets ms ON cs.main_set_id = ms.id
        LEFT JOIN cards c ON c.set_id = cs.id
        WHERE cs.canonical_source IS NULL
          ${showArchived !== 'true' ? sql`AND cs.is_active = true` : sql``}
          ${hasCards === 'true' ? sql`AND EXISTS (SELECT 1 FROM cards WHERE set_id = cs.id)` : sql``}
          ${year ? sql`AND cs.year = ${parseInt(year as string)}` : sql``}
          ${mainSetId ? sql`AND cs.main_set_id = ${parseInt(mainSetId as string)}` : sql``}
          ${search ? sql`AND cs.name ILIKE ${'%' + search + '%'}` : sql``}
        GROUP BY cs.id, ms.id
        ORDER BY cs.year DESC, cs.name ASC
        LIMIT 500
      `);

      res.json({ sets: setsWithCounts.rows });
    } catch (error) {
      console.error('Get migration sets error:', error);
      res.status(500).json({ message: "Failed to fetch sets" });
    }
  });

  // Get canonical (CSV-defined) sets - now uses isCanonical flag
  app.get("/api/admin/migration/canonical-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { year, mainSetId, search, showArchived } = req.query;
      
      // Canonical sets are those with canonical_source='csv_master' (from CSV import)
      const canonicalSets = await db.execute(sql`
        SELECT 
          cs.id,
          cs.name,
          cs.year,
          cs.slug,
          cs.main_set_id as "mainSetId",
          cs.image_url as "imageUrl",
          cs.is_active as "isActive",
          cs.is_canonical as "isCanonical",
          cs.is_insert_subset as "isInsertSubset",
          cs.canonical_source as "canonicalSource",
          ms.name as "mainSetName",
          ms.thumbnail_image_url as "mainSetThumbnail",
          COUNT(c.id)::int as "cardCount"
        FROM card_sets cs
        LEFT JOIN main_sets ms ON cs.main_set_id = ms.id
        LEFT JOIN cards c ON c.set_id = cs.id
        WHERE cs.canonical_source = 'csv_master'
          ${showArchived !== 'true' ? sql`AND cs.is_active = true` : sql``}
          ${year ? sql`AND cs.year = ${parseInt(year as string)}` : sql``}
          ${mainSetId ? sql`AND cs.main_set_id = ${parseInt(mainSetId as string)}` : sql``}
          ${search ? sql`AND cs.name ILIKE ${'%' + search + '%'}` : sql``}
        GROUP BY cs.id, ms.id
        ORDER BY cs.year DESC, cs.name ASC
        LIMIT 500
      `);

      res.json({ sets: canonicalSets.rows });
    } catch (error) {
      console.error('Get canonical sets error:', error);
      res.status(500).json({ message: "Failed to fetch canonical sets" });
    }
  });

  // Get sample cards for a set
  app.get("/api/admin/migration/sets/:setId/sample-cards", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      
      const sampleCards = await db.execute(sql`
        SELECT 
          id,
          card_number as "cardNumber",
          name,
          variation,
          is_insert as "isInsert",
          front_image_url as "frontImageUrl",
          estimated_value as "estimatedValue"
        FROM cards
        WHERE set_id = ${setId}
        ORDER BY card_number ASC
        LIMIT 12
      `);

      res.json({ cards: sampleCards.rows });
    } catch (error) {
      console.error('Get sample cards error:', error);
      res.status(500).json({ message: "Failed to fetch sample cards" });
    }
  });

  // Preview migration (shows conflicts and card count)
  app.post("/api/admin/migration/preview", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { sourceSetId, destinationSetId } = req.body;
      
      if (!sourceSetId || !destinationSetId) {
        return res.status(400).json({ message: "Source and destination set IDs required" });
      }

      // Get destination set info (for isInsertSubset check)
      const [destSet] = await db.select({
        isInsertSubset: cardSets.isInsertSubset,
        isCanonical: cardSets.isCanonical,
      }).from(cardSets).where(eq(cardSets.id, destinationSetId));

      // Get source cards with details for conflict reporting
      const sourceCards = await db.execute(sql`
        SELECT id, card_number as "cardNumber", name, front_image_url as "frontImageUrl"
        FROM cards WHERE set_id = ${sourceSetId}
      `);

      // Get destination cards with details
      const destCards = await db.execute(sql`
        SELECT id, card_number as "cardNumber", name, front_image_url as "frontImageUrl"
        FROM cards WHERE set_id = ${destinationSetId}
      `);

      // Build destination card map for conflict detection
      const destCardMap = new Map(destCards.rows.map((c: any) => [c.cardNumber, c]));
      
      // Find conflicts with detailed info
      const conflicts = sourceCards.rows
        .filter((c: any) => destCardMap.has(c.cardNumber))
        .map((sourceCard: any) => ({
          cardNumber: sourceCard.cardNumber,
          sourceCardId: sourceCard.id,
          sourceCardName: sourceCard.name,
          destCardId: destCardMap.get(sourceCard.cardNumber)?.id,
          destCardName: destCardMap.get(sourceCard.cardNumber)?.name,
        }));

      res.json({
        sourceCardCount: sourceCards.rows.length,
        destinationCardCount: destCards.rows.length,
        conflictCount: conflicts.length,
        conflicts: conflicts.slice(0, 50), // Show first 50 conflicts
        canMigrate: sourceCards.rows.length > 0,
        destinationIsInsertSubset: destSet?.isInsertSubset || false,
        destinationIsCanonical: destSet?.isCanonical || false,
      });
    } catch (error) {
      console.error('Preview migration error:', error);
      res.status(500).json({ message: "Failed to preview migration" });
    }
  });

  // Execute migration (move cards from source to destination)
  app.post("/api/admin/migration/execute", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { sourceSetId, destinationSetId, forceInsert, notes, allowConflicts, newMainSetId, newSetName } = req.body;
      
      if (!sourceSetId || !destinationSetId) {
        return res.status(400).json({ message: "Source and destination set IDs required" });
      }

      if (sourceSetId === destinationSetId) {
        return res.status(400).json({ message: "Source and destination cannot be the same" });
      }

      // Get source set info (to check if non-canonical for auto-archive)
      const [sourceSet] = await db.select({
        isCanonical: cardSets.isCanonical,
        isActive: cardSets.isActive,
      }).from(cardSets).where(eq(cardSets.id, sourceSetId));

      // Get destination set info (for isInsertSubset enforcement)
      const [destSet] = await db.select({
        isInsertSubset: cardSets.isInsertSubset,
        name: cardSets.name,
        mainSetId: cardSets.mainSetId,
      }).from(cardSets).where(eq(cardSets.id, destinationSetId));

      // Determine if we should force insert (explicit forceInsert OR destination.isInsertSubset)
      const shouldForceInsert = forceInsert || destSet?.isInsertSubset || false;

      // Get all cards from source set
      const cardsToMove = await db.select().from(cards).where(eq(cards.setId, sourceSetId));

      if (cardsToMove.length === 0) {
        return res.status(400).json({ message: "No cards to migrate in source set" });
      }

      // Check for conflicts
      const destCards = await db.select({ cardNumber: cards.cardNumber }).from(cards).where(eq(cards.setId, destinationSetId));
      const destCardNumbers = new Set(destCards.map(c => c.cardNumber));
      const conflicts = cardsToMove.filter(c => destCardNumbers.has(c.cardNumber));
      const conflictCount = conflicts.length;

      // Block migration if conflicts exist and not explicitly allowed
      // Server-side enforcement: allowConflicts must be the exact phrase
      if (conflictCount > 0 && allowConflicts !== 'MIGRATE WITH CONFLICTS') {
        return res.status(400).json({ 
          message: `${conflictCount} card number conflicts exist. Type "MIGRATE WITH CONFLICTS" to proceed.`,
          conflictCount: conflictCount,
        });
      }

      // Determine migration status
      const migrationStatus = conflictCount > 0 ? 'completed_with_conflicts' : 'completed';

      // Execute migration in a transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Create migration log with enhanced fields
        const [migrationLog] = await tx.insert(migrationLogs).values({
          adminUserId: req.user.id,
          sourceSetId: sourceSetId,
          destinationSetId: destinationSetId,
          movedCardCount: cardsToMove.length,
          insertForced: shouldForceInsert,
          conflictCount: conflictCount,
          sourceArchived: false, // Will update after checking
          notes: notes || null,
          status: migrationStatus,
        }).returning();

        // Record each card movement for rollback capability
        const cardLogEntries = cardsToMove.map(card => ({
          migrationLogId: migrationLog.id,
          cardId: card.id,
          oldSetId: sourceSetId,
          newSetId: destinationSetId,
          oldIsInsert: card.isInsert,
          newIsInsert: shouldForceInsert ? true : card.isInsert,
        }));

        await tx.insert(migrationLogCards).values(cardLogEntries);

        // Update cards: move to destination set
        if (shouldForceInsert) {
          await tx.update(cards)
            .set({ setId: destinationSetId, isInsert: true })
            .where(eq(cards.setId, sourceSetId));
        } else {
          await tx.update(cards)
            .set({ setId: destinationSetId })
            .where(eq(cards.setId, sourceSetId));
        }

        // Update card counts for both sets
        await tx.execute(sql`
          UPDATE card_sets SET total_cards = (
            SELECT COUNT(*) FROM cards WHERE set_id = card_sets.id
          ) WHERE id IN (${sourceSetId}, ${destinationSetId})
        `);

        // Update destination set name and/or main set if provided
        const destSetUpdates: { name?: string; mainSetId?: number } = {};
        if (newSetName && newSetName.trim()) {
          destSetUpdates.name = newSetName.trim();
        }
        if (newMainSetId) {
          destSetUpdates.mainSetId = newMainSetId;
        }
        if (Object.keys(destSetUpdates).length > 0) {
          await tx.update(cardSets)
            .set(destSetUpdates)
            .where(eq(cardSets.id, destinationSetId));
        }

        // AUTO-ARCHIVE: If source set is now empty AND is non-canonical, archive it
        const sourceCardCountResult = await tx.execute(sql`
          SELECT COUNT(*) as count FROM cards WHERE set_id = ${sourceSetId}
        `);
        const sourceCardCount = sourceCardCountResult.rows[0] as { count: string };
        
        let sourceArchived = false;
        if (parseInt(sourceCardCount.count) === 0 && sourceSet && !sourceSet.canonicalSource) {
          await tx.update(cardSets)
            .set({ isActive: false })
            .where(eq(cardSets.id, sourceSetId));
          
          // Update the log to reflect archival
          await tx.update(migrationLogs)
            .set({ sourceArchived: true })
            .where(eq(migrationLogs.id, migrationLog.id));
          
          sourceArchived = true;
        }

        return { ...migrationLog, sourceArchived };
      });

      res.json({
        success: true,
        message: `Successfully migrated ${cardsToMove.length} cards${result.sourceArchived ? ' (source set auto-archived)' : ''}`,
        migrationLogId: result.id,
        movedCardCount: cardsToMove.length,
        conflictCount: conflictCount,
        insertForced: shouldForceInsert,
        sourceArchived: result.sourceArchived,
        status: migrationStatus,
      });
    } catch (error) {
      console.error('Execute migration error:', error);
      res.status(500).json({ message: "Failed to execute migration" });
    }
  });

  // Migrate selected cards only
  app.post("/api/admin/migration/execute-selected", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { cardIds, sourceSetId, destinationSetId, forceInsert, notes } = req.body;
      
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ message: "Card IDs required" });
      }

      if (!destinationSetId) {
        return res.status(400).json({ message: "Destination set ID required" });
      }

      // Get the cards to move
      const cardsToMove = await db.select().from(cards)
        .where(sql`id = ANY(${cardIds})`);

      if (cardsToMove.length === 0) {
        return res.status(400).json({ message: "No valid cards found" });
      }

      // Execute in a transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Create migration log
        const [migrationLog] = await tx.insert(migrationLogs).values({
          adminUserId: req.user.id,
          sourceSetId: sourceSetId || cardsToMove[0].setId,
          destinationSetId: destinationSetId,
          movedCardCount: cardsToMove.length,
          insertForced: forceInsert || false,
          notes: notes || `Selected ${cardsToMove.length} cards`,
          status: 'completed',
        }).returning();

        // Record each card movement
        const cardLogEntries = cardsToMove.map(card => ({
          migrationLogId: migrationLog.id,
          cardId: card.id,
          oldSetId: card.setId,
          newSetId: destinationSetId,
          oldIsInsert: card.isInsert,
          newIsInsert: forceInsert ? true : card.isInsert,
        }));

        await tx.insert(migrationLogCards).values(cardLogEntries);

        // Update cards
        for (const card of cardsToMove) {
          await tx.update(cards)
            .set({ 
              setId: destinationSetId, 
              isInsert: forceInsert ? true : card.isInsert 
            })
            .where(eq(cards.id, card.id));
        }

        // Update card counts
        const affectedSetIds = [...new Set([...cardsToMove.map(c => c.setId), destinationSetId])];
        for (const setId of affectedSetIds) {
          await tx.execute(sql`
          UPDATE card_sets SET total_cards = (
            SELECT COUNT(*) FROM cards WHERE set_id = ${setId}
          ) WHERE id = ${setId}
        `);
        }

        return migrationLog;
      });

      res.json({
        success: true,
        message: `Successfully migrated ${cardsToMove.length} cards`,
        migrationLogId: result.id,
        movedCardCount: cardsToMove.length,
      });
    } catch (error) {
      console.error('Execute selected migration error:', error);
      res.status(500).json({ message: "Failed to execute migration" });
    }
  });

  // Archive a set (hide from UI)
  app.post("/api/admin/migration/archive-set/:setId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      const { confirmWithCards } = req.body; // Typed "ARCHIVE WITH CARDS" confirmation
      
      // Get set info
      const [set] = await db.select({
        name: cardSets.name,
        isCanonical: cardSets.isCanonical,
      }).from(cardSets).where(eq(cardSets.id, setId));

      if (!set) {
        return res.status(404).json({ message: "Set not found" });
      }

      // Check if set has cards
      const cardCount = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM cards WHERE set_id = ${setId}
      `);

      const hasCards = cardCount.rows[0].count > 0;

      // If set has cards, check if any user has these cards in their collection
      if (hasCards) {
        const userCollectionCount = await db.execute(sql`
          SELECT 
            COUNT(DISTINCT uc.user_id)::int as user_count,
            COUNT(uc.id)::int as entry_count
          FROM user_collections uc
          JOIN cards c ON uc.card_id = c.id
          WHERE c.set_id = ${setId}
        `);
        
        const userCount = userCollectionCount.rows[0].user_count || 0;
        const entryCount = userCollectionCount.rows[0].entry_count || 0;
        
        if (userCount > 0) {
          return res.status(400).json({ 
            message: `Cannot archive: ${userCount} user${userCount === 1 ? ' has' : 's have'} ${entryCount} cards from this set in their collection. Migrate cards first.`,
            userCount,
            entryCount,
            blocked: true,
          });
        }
        
        // No users have these cards, require explicit confirmation
        if (confirmWithCards !== 'ARCHIVE WITH CARDS') {
          return res.status(400).json({ 
            message: `Set has ${cardCount.rows[0].count} cards (no users have them). Type "ARCHIVE WITH CARDS" to confirm.`,
            cardCount: cardCount.rows[0].count,
            requiresConfirmation: true,
          });
        }
      }

      // Archive the set
      await db.update(cardSets)
        .set({ isActive: false })
        .where(eq(cardSets.id, setId));

      // Log the action
      await db.insert(adminAuditLogs).values({
        adminUserId: req.user.id,
        actionType: 'archive_set',
        entityType: 'card_set',
        entityId: setId,
        entityName: set.name,
        notes: hasCards ? `Archived with ${cardCount.rows[0].count} cards` : 'Archived empty set',
      });

      res.json({ 
        success: true, 
        message: hasCards 
          ? `Set archived successfully (contained ${cardCount.rows[0].count} cards)` 
          : "Set archived successfully" 
      });
    } catch (error) {
      console.error('Archive set error:', error);
      res.status(500).json({ message: "Failed to archive set" });
    }
  });

  // Unarchive a set
  app.post("/api/admin/migration/unarchive-set/:setId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);

      // Get set info for audit log
      const [set] = await db.select({ name: cardSets.name }).from(cardSets).where(eq(cardSets.id, setId));

      await db.update(cardSets)
        .set({ isActive: true })
        .where(eq(cardSets.id, setId));

      // Log the action
      await db.insert(adminAuditLogs).values({
        adminUserId: req.user.id,
        actionType: 'unarchive_set',
        entityType: 'card_set',
        entityId: setId,
        entityName: set?.name || null,
        notes: null,
      });

      res.json({ success: true, message: "Set unarchived successfully" });
    } catch (error) {
      console.error('Unarchive set error:', error);
      res.status(500).json({ message: "Failed to unarchive set" });
    }
  });

  // Promote a legacy set to canonical/master set status
  app.post("/api/admin/migration/promote-to-canonical/:setId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      const { confirmPromotion, year, mainSetId, newName } = req.body; // Require confirmation phrase, year, and optional main set/name

      // Get set info
      const [set] = await db.select({
        id: cardSets.id,
        name: cardSets.name,
        isCanonical: cardSets.isCanonical,
        canonicalSource: cardSets.canonicalSource,
        year: cardSets.year,
        mainSetId: cardSets.mainSetId,
      }).from(cardSets).where(eq(cardSets.id, setId));

      if (!set) {
        return res.status(404).json({ message: "Set not found" });
      }

      if (set.isCanonical || set.canonicalSource === 'csv_master') {
        return res.status(400).json({ message: "This set is already canonical" });
      }

      // Check for existing canonical set with same name
      const existingCanonical = await db.select({ id: cardSets.id, name: cardSets.name })
        .from(cardSets)
        .where(and(
          eq(cardSets.name, set.name),
          eq(cardSets.isCanonical, true),
          ne(cardSets.id, setId)
        ));

      if (existingCanonical.length > 0) {
        return res.status(400).json({ 
          message: `A canonical set with this name already exists (ID: ${existingCanonical[0].id})`,
          existingSetId: existingCanonical[0].id,
        });
      }

      // Require confirmation
      if (confirmPromotion !== 'PROMOTE TO CANONICAL') {
        return res.status(400).json({ 
          message: 'Type "PROMOTE TO CANONICAL" to confirm.',
          requiresConfirmation: true,
        });
      }

      // Get card count for logging
      const cardCount = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM cards WHERE set_id = ${setId}
      `);

      // Get count of subsets (sets that have this set as parent)
      const subsetCount = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM card_sets WHERE main_set_id = ${setId}
      `);

      // Validate and coerce year if provided
      let finalYear = set.year;
      if (year !== undefined && year !== null && year !== '') {
        const parsedYear = parseInt(year, 10);
        if (!isNaN(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
          finalYear = parsedYear;
        }
        // If invalid year provided, just keep existing year
      }

      // Build update object
      const updateData: any = {
        isCanonical: true,
        canonicalSource: 'promoted',
        year: finalYear,
        isActive: true, // Ensure it's active
      };
      
      // Add main set assignment if provided
      if (mainSetId) {
        updateData.mainSetId = mainSetId;
      }
      
      // Add name change if provided
      if (newName && newName.trim()) {
        updateData.name = newName.trim();
      }

      // Promote to canonical (and optionally assign to main set / rename)
      await db.update(cardSets)
        .set(updateData)
        .where(eq(cardSets.id, setId));

      // Log the action
      await db.insert(adminAuditLogs).values({
        adminUserId: req.user.id,
        actionType: 'promote_to_canonical',
        entityType: 'card_set',
        entityId: setId,
        entityName: set.name,
        notes: `Promoted to canonical with ${cardCount.rows[0].count} cards and ${subsetCount.rows[0].count} subsets`,
      });

      res.json({ 
        success: true, 
        message: `"${newName?.trim() || set.name}" promoted to canonical${mainSetId ? ' (assigned to main set)' : ''}`,
        cardCount: cardCount.rows[0].count,
        subsetCount: subsetCount.rows[0].count,
        mainSetAssigned: !!mainSetId,
        renamed: !!(newName?.trim()),
      });
    } catch (error) {
      console.error('Promote to canonical error:', error);
      res.status(500).json({ message: "Failed to promote set to canonical" });
    }
  });

  // Delete a set permanently (dangerous - requires typing confirmation)
  app.delete("/api/admin/migration/delete-set/:setId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      const { confirmDelete } = req.body; // Must be "DELETE SET"

      // Get set info
      const [set] = await db.select({
        name: cardSets.name,
        isCanonical: cardSets.isCanonical,
      }).from(cardSets).where(eq(cardSets.id, setId));

      if (!set) {
        return res.status(404).json({ message: "Set not found" });
      }

      // Check if set has cards - MUST be 0 to delete
      const cardCount = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM cards WHERE set_id = ${setId}
      `);

      if (cardCount.rows[0].count > 0) {
        return res.status(400).json({ 
          message: `Cannot delete set with ${cardCount.rows[0].count} cards. Migrate all cards first.`,
          cardCount: cardCount.rows[0].count,
        });
      }

      // Require exact confirmation phrase
      if (confirmDelete !== 'DELETE SET') {
        return res.status(400).json({ 
          message: 'Type "DELETE SET" to permanently delete this set.',
          requiresConfirmation: true,
        });
      }

      // Check for references in other tables (migration logs, etc.)
      const migrationRefs = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM migration_logs 
        WHERE source_set_id = ${setId} OR destination_set_id = ${setId}
      `);

      // Delete the set
      await db.delete(cardSets).where(eq(cardSets.id, setId));

      // Log the action
      await db.insert(adminAuditLogs).values({
        adminUserId: req.user.id,
        actionType: 'delete_set',
        entityType: 'card_set',
        entityId: setId,
        entityName: set.name,
        notes: `Permanently deleted. Had ${migrationRefs.rows[0].count} migration log references.`,
      });

      res.json({ 
        success: true, 
        message: `Set "${set.name}" permanently deleted`,
        deletedSetName: set.name,
      });
    } catch (error) {
      console.error('Delete set error:', error);
      res.status(500).json({ message: "Failed to delete set" });
    }
  });

  // Get migration logs
  app.get("/api/admin/migration/logs", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const logs = await db.execute(sql`
        SELECT 
          ml.id,
          ml.admin_user_id as "adminUserId",
          ml.source_set_id as "sourceSetId",
          ml.destination_set_id as "destinationSetId",
          ml.moved_card_count as "movedCardCount",
          ml.insert_forced as "insertForced",
          ml.notes,
          ml.status,
          ml.rolled_back_at as "rolledBackAt",
          ml.created_at as "createdAt",
          ss.name as "sourceSetName",
          ds.name as "destinationSetName",
          u.username as "adminUsername"
        FROM migration_logs ml
        LEFT JOIN card_sets ss ON ml.source_set_id = ss.id
        LEFT JOIN card_sets ds ON ml.destination_set_id = ds.id
        LEFT JOIN users u ON ml.admin_user_id = u.id
        ORDER BY ml.created_at DESC
        LIMIT 100
      `);

      res.json({ logs: logs.rows });
    } catch (error) {
      console.error('Get migration logs error:', error);
      res.status(500).json({ message: "Failed to fetch migration logs" });
    }
  });

  // Rollback a migration
  app.post("/api/admin/migration/rollback/:logId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const logId = parseInt(req.params.logId);

      // Get the migration log
      const [migrationLog] = await db.select().from(migrationLogs).where(eq(migrationLogs.id, logId));

      if (!migrationLog) {
        return res.status(404).json({ message: "Migration log not found" });
      }

      if (migrationLog.status === 'rolled_back') {
        return res.status(400).json({ message: "Migration already rolled back" });
      }

      // Get all card movements from this migration
      const cardMovements = await db.select().from(migrationLogCards)
        .where(eq(migrationLogCards.migrationLogId, logId));

      if (cardMovements.length === 0) {
        return res.status(400).json({ message: "No card movements found for this migration" });
      }

      // Execute rollback in a transaction for atomicity
      await db.transaction(async (tx) => {
        // Rollback each card to its original set and isInsert state
        for (const movement of cardMovements) {
          await tx.update(cards)
            .set({ 
              setId: movement.oldSetId,
              isInsert: movement.oldIsInsert,
            })
            .where(eq(cards.id, movement.cardId));
        }

        // If source set was auto-archived during migration, restore it
        if (migrationLog.sourceArchived) {
          await tx.update(cardSets)
            .set({ isActive: true })
            .where(eq(cardSets.id, migrationLog.sourceSetId));
        }

        // Update card counts for affected sets
        const affectedSetIds = [...new Set([
          ...cardMovements.map(m => m.oldSetId),
          ...cardMovements.map(m => m.newSetId),
        ])];

        for (const setId of affectedSetIds) {
          await tx.execute(sql`
            UPDATE card_sets SET total_cards = (
              SELECT COUNT(*) FROM cards WHERE set_id = ${setId}
            ) WHERE id = ${setId}
          `);
        }

        // Update migration log status
        await tx.update(migrationLogs)
          .set({ status: 'rolled_back', rolledBackAt: new Date() })
          .where(eq(migrationLogs.id, logId));
      });

      res.json({ 
        success: true, 
        message: `Successfully rolled back ${cardMovements.length} cards${migrationLog.sourceArchived ? ' (source set restored)' : ''}`,
        rolledBackCount: cardMovements.length,
        sourceRestored: migrationLog.sourceArchived || false,
      });
    } catch (error) {
      console.error('Rollback migration error:', error);
      res.status(500).json({ message: "Failed to rollback migration" });
    }
  });

  // Get main sets (for filter dropdown)
  app.get("/api/admin/migration/main-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const allMainSets = await db.select({
        id: mainSets.id,
        name: mainSets.name,
        thumbnailImageUrl: mainSets.thumbnailImageUrl,
      }).from(mainSets).orderBy(mainSets.name);

      res.json({ mainSets: allMainSets });
    } catch (error) {
      console.error('Get main sets error:', error);
      res.status(500).json({ message: "Failed to fetch main sets" });
    }
  });

  // Get all cards from a set (for selective migration)
  app.get("/api/admin/migration/sets/:setId/all-cards", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const setId = parseInt(req.params.setId);
      const { page = '1', limit = '50' } = req.query;
      const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
      
      const allCards = await db.execute(sql`
        SELECT 
          id,
          card_number as "cardNumber",
          name,
          variation,
          is_insert as "isInsert",
          front_image_url as "frontImageUrl",
          estimated_value as "estimatedValue"
        FROM cards
        WHERE set_id = ${setId}
        ORDER BY card_number ASC
        LIMIT ${parseInt(limit as string)}
        OFFSET ${offset}
      `);

      const totalResult = await db.execute(sql`
        SELECT COUNT(*)::int as count FROM cards WHERE set_id = ${setId}
      `);

      res.json({ 
        cards: allCards.rows,
        total: totalResult.rows[0].count,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });
    } catch (error) {
      console.error('Get all cards error:', error);
      res.status(500).json({ message: "Failed to fetch cards" });
    }
  });

  // Canonical taxonomy CSV import - ADD ONLY (no updates)
  app.post("/api/admin/canonical-taxonomy-import", authenticateUser, upload.single('csv'), async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const dryRun = req.body.dryRun === 'true';
      
      if (!req.file) {
        return res.status(400).json({ message: "CSV file required" });
      }

      // Slug generation function - deterministic and normalized
      const generateSlug = (text: string): string => {
        return text
          .toLowerCase()
          .trim()
          .replace(/['']/g, '')           // Remove apostrophes
          .replace(/[&]/g, 'and')         // Replace & with and
          .replace(/[^\w\s-]/g, '')       // Remove special chars except spaces/hyphens
          .replace(/\s+/g, '-')           // Replace spaces with hyphens
          .replace(/-+/g, '-')            // Collapse multiple hyphens
          .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
      };

      // Parse CSV
      const csvContent = req.file.buffer.toString('utf-8');
      const lines = csvContent.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      
      // Find column indices
      const yearIdx = headers.findIndex(h => h.toLowerCase().includes('year'));
      const mainSetIdx = headers.findIndex(h => h.toLowerCase().includes('main set'));
      const subsetIdx = headers.findIndex(h => h.toLowerCase().includes('sub set'));
      
      if (yearIdx === -1 || mainSetIdx === -1 || subsetIdx === -1) {
        return res.status(400).json({ 
          message: "CSV must have columns: Set Year, Main Set Name, Sub Set Name",
          foundHeaders: headers,
        });
      }

      // Parse CSV rows (handle quoted fields with commas)
      const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      // Collect unique main sets and subsets from CSV
      const mainSetsFromCSV = new Map<string, { name: string; slug: string }>();
      const subsetsFromCSV: Array<{ year: number; mainSetName: string; mainSetSlug: string; subsetName: string; subsetSlug: string }> = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < Math.max(yearIdx, mainSetIdx, subsetIdx) + 1) continue;
        
        const year = parseInt(cols[yearIdx]);
        const mainSetName = cols[mainSetIdx]?.trim();
        const subsetName = cols[subsetIdx]?.trim();
        
        if (!year || !mainSetName) continue;
        
        const mainSetSlug = generateSlug(mainSetName);
        
        // Track unique main sets
        if (!mainSetsFromCSV.has(mainSetSlug)) {
          mainSetsFromCSV.set(mainSetSlug, { name: mainSetName, slug: mainSetSlug });
        }
        
        // For subsets, create a compound slug: year-mainsetslug-subsetslug
        // If subset is empty, use "base" as the subset name
        const actualSubsetName = subsetName || 'Base';
        const subsetSlug = `${year}-${mainSetSlug}-${generateSlug(actualSubsetName)}`;
        
        subsetsFromCSV.push({
          year,
          mainSetName,
          mainSetSlug,
          subsetName: actualSubsetName,
          subsetSlug,
        });
      }

      // Get existing main sets by slug
      const existingMainSets = await db.execute(sql`
        SELECT id, slug, name FROM main_sets
      `);
      const existingMainSetSlugs = new Set(existingMainSets.rows.map((r: any) => r.slug));
      const mainSetIdBySlug = new Map(existingMainSets.rows.map((r: any) => [r.slug, r.id]));

      // Get existing card_sets by slug
      const existingCardSets = await db.execute(sql`
        SELECT id, slug, name FROM card_sets
      `);
      const existingCardSetSlugs = new Set(existingCardSets.rows.map((r: any) => r.slug));

      // Determine what to ADD (not update)
      const mainSetsToAdd: Array<{ name: string; slug: string }> = [];
      for (const [slug, data] of mainSetsFromCSV) {
        if (!existingMainSetSlugs.has(slug)) {
          mainSetsToAdd.push(data);
        }
      }

      const subsetsToAdd: Array<{ year: number; mainSetSlug: string; subsetName: string; subsetSlug: string }> = [];
      const seenSubsetSlugs = new Set<string>();
      for (const subset of subsetsFromCSV) {
        if (!existingCardSetSlugs.has(subset.subsetSlug) && !seenSubsetSlugs.has(subset.subsetSlug)) {
          subsetsToAdd.push(subset);
          seenSubsetSlugs.add(subset.subsetSlug);
        }
      }

      // DRY RUN: Return report without making changes
      if (dryRun) {
        return res.json({
          dryRun: true,
          summary: {
            totalMainSetsInCSV: mainSetsFromCSV.size,
            totalSubsetsInCSV: subsetsFromCSV.length,
            mainSetsToAdd: mainSetsToAdd.length,
            subsetsToAdd: subsetsToAdd.length,
            mainSetsSkipped: mainSetsFromCSV.size - mainSetsToAdd.length,
            subsetsSkipped: subsetsFromCSV.length - subsetsToAdd.length,
          },
          mainSetsToAdd: mainSetsToAdd.slice(0, 50), // Sample
          subsetsToAdd: subsetsToAdd.slice(0, 100), // Sample
        });
      }

      // APPLY: Insert new entries
      let mainSetsAdded = 0;
      let subsetsAdded = 0;
      const newMainSetIds = new Map<string, number>();

      // Insert new main sets
      for (const ms of mainSetsToAdd) {
        const result = await db.execute(sql`
          INSERT INTO main_sets (name, slug, created_at)
          VALUES (${ms.name}, ${ms.slug}, NOW())
          RETURNING id
        `);
        newMainSetIds.set(ms.slug, result.rows[0].id as number);
        mainSetsAdded++;
      }

      // Combine existing + new main set IDs
      for (const [slug, id] of mainSetIdBySlug) {
        if (!newMainSetIds.has(slug)) {
          newMainSetIds.set(slug, id as number);
        }
      }

      // Insert new subsets
      for (const sub of subsetsToAdd) {
        const mainSetId = newMainSetIds.get(sub.mainSetSlug);
        if (!mainSetId) {
          console.warn(`Main set not found for slug: ${sub.mainSetSlug}`);
          continue;
        }

        await db.execute(sql`
          INSERT INTO card_sets (name, year, slug, main_set_id, is_active, is_canonical, canonical_source, total_cards, created_at)
          VALUES (${sub.subsetName}, ${sub.year}, ${sub.subsetSlug}, ${mainSetId}, true, true, 'csv_master', 0, NOW())
        `);
        subsetsAdded++;
      }

      // Log the import
      await db.insert(adminAuditLogs).values({
        adminUserId: req.user.id,
        actionType: 'canonical_taxonomy_import',
        entityType: 'taxonomy',
        entityId: null,
        entityName: req.file.originalname || 'taxonomy_import.csv',
        notes: `Added ${mainSetsAdded} main sets, ${subsetsAdded} subsets. Skipped ${mainSetsFromCSV.size - mainSetsAdded} existing main sets, ${subsetsFromCSV.length - subsetsAdded} existing subsets.`,
      });

      // Verification counts
      const finalCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM main_sets) as total_main_sets,
          (SELECT COUNT(*) FROM card_sets WHERE canonical_source = 'csv_master') as canonical_subsets
      `);

      res.json({
        success: true,
        applied: {
          mainSetsAdded,
          subsetsAdded,
          mainSetsSkipped: mainSetsFromCSV.size - mainSetsAdded,
          subsetsSkipped: subsetsFromCSV.length - subsetsAdded,
        },
        verification: {
          totalMainSets: finalCounts.rows[0].total_main_sets,
          totalCanonicalSubsets: finalCounts.rows[0].canonical_subsets,
        },
      });

    } catch (error) {
      console.error('Canonical taxonomy import error:', error);
      res.status(500).json({ message: "Failed to import taxonomy", error: String(error) });
    }
  });

  // Register marketplace routes
  registerMarketplaceRoutes(app, authenticateUser);

  // ============================================
  // LEGACY SET ARCHIVE SYSTEM
  // ============================================

  // DRY RUN - Generate report of legacy sets/subsets that would be archived
  app.get("/api/admin/archive-legacy/dry-run", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const cutoffDate = '2026-01-25';
      console.log(`[ARCHIVE DRY RUN] Analyzing legacy sets created before ${cutoffDate}`);

      // Get candidate main_sets (non-canonical only)
      const mainSetCandidates = await db.execute(sql`
        SELECT 
          ms.id,
          ms.name,
          ms.created_at,
          ms.is_active,
          (SELECT COUNT(*) FROM card_sets cs WHERE cs.main_set_id = ms.id) as child_set_count,
          (SELECT COUNT(*) FROM cards c JOIN card_sets cs ON c.set_id = cs.id WHERE cs.main_set_id = ms.id) as total_cards,
          (SELECT COUNT(DISTINCT uc.card_id) FROM user_collections uc 
           JOIN cards c ON uc.card_id = c.id 
           JOIN card_sets cs ON c.set_id = cs.id 
           WHERE cs.main_set_id = ms.id) as cards_in_collections,
          (SELECT COUNT(*) FROM card_sets cs WHERE cs.main_set_id = ms.id 
           AND (cs.canonical_source IS NOT NULL OR cs.is_canonical = true)) as canonical_child_count
        FROM main_sets ms
        WHERE ms.created_at < ${cutoffDate}::timestamp
        AND ms.is_active = true
        ORDER BY ms.created_at ASC
      `);

      // Filter out main sets that have canonical children
      const archivableMainSets = mainSetCandidates.rows.filter((row: any) => 
        parseInt(row.canonical_child_count) === 0
      );

      // Get candidate card_sets (non-canonical only)
      const cardSetCandidates = await db.execute(sql`
        SELECT 
          cs.id,
          cs.name,
          cs.year,
          cs.main_set_id,
          cs.created_at,
          cs.is_active,
          cs.canonical_source,
          cs.is_canonical,
          (SELECT COUNT(*) FROM cards c WHERE c.set_id = cs.id) as card_count,
          (SELECT COUNT(*) FROM user_collections uc 
           JOIN cards c ON uc.card_id = c.id 
           WHERE c.set_id = cs.id) as cards_in_collections
        FROM card_sets cs
        WHERE cs.created_at < ${cutoffDate}::timestamp
        AND cs.is_active = true
        AND cs.canonical_source IS NULL
        AND cs.is_canonical = false
        ORDER BY cs.created_at ASC
      `);

      // Calculate summary
      const summary = {
        cutoffDate,
        mainSetCandidates: archivableMainSets.length,
        cardSetCandidates: cardSetCandidates.rows.length,
        totalCardsUnderMainSets: archivableMainSets.reduce((sum: number, r: any) => sum + parseInt(r.total_cards || 0), 0),
        totalCardsUnderCardSets: cardSetCandidates.rows.reduce((sum: number, r: any) => sum + parseInt(r.card_count || 0), 0),
        userCollectionsAffectedFromMainSets: archivableMainSets.reduce((sum: number, r: any) => sum + parseInt(r.cards_in_collections || 0), 0),
        userCollectionsAffectedFromCardSets: cardSetCandidates.rows.reduce((sum: number, r: any) => sum + parseInt(r.cards_in_collections || 0), 0),
        skippedMainSetsWithCanonicalChildren: mainSetCandidates.rows.length - archivableMainSets.length,
      };

      // Generate CSV content
      const mainSetsCsv = [
        'main_set_id,name,created_at,child_set_count,total_cards,cards_in_collections,has_canonical_children,archive_candidate',
        ...mainSetCandidates.rows.map((row: any) => {
          const hasCanonical = parseInt(row.canonical_child_count) > 0;
          return `${row.id},"${(row.name || '').replace(/"/g, '""')}",${row.created_at},${row.child_set_count},${row.total_cards},${row.cards_in_collections},${hasCanonical},${!hasCanonical}`;
        })
      ].join('\n');

      const cardSetsCsv = [
        'set_id,name,year,main_set_id,created_at,card_count,cards_in_collections,canonical_source,is_canonical,archive_candidate',
        ...cardSetCandidates.rows.map((row: any) => 
          `${row.id},"${(row.name || '').replace(/"/g, '""')}",${row.year},${row.main_set_id || ''},${row.created_at},${row.card_count},${row.cards_in_collections},${row.canonical_source || ''},${row.is_canonical},true`
        )
      ].join('\n');

      console.log(`[ARCHIVE DRY RUN] Complete. Main sets: ${summary.mainSetCandidates}, Card sets: ${summary.cardSetCandidates}`);

      res.json({
        summary,
        mainSets: archivableMainSets,
        cardSets: cardSetCandidates.rows,
        csvData: {
          mainSets: mainSetsCsv,
          cardSets: cardSetsCsv
        }
      });
    } catch (error: any) {
      console.error('[ARCHIVE DRY RUN] Error:', error);
      res.status(500).json({ message: `Dry run failed: ${error.message}` });
    }
  });

  // APPLY ARCHIVE - Actually archive the legacy sets (soft delete)
  app.post("/api/admin/archive-legacy/apply", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { confirmationText } = req.body;
      if (confirmationText !== 'ARCHIVE LEGACY SETS') {
        return res.status(400).json({ 
          message: "Confirmation required. Please type 'ARCHIVE LEGACY SETS' to proceed." 
        });
      }

      const cutoffDate = '2026-01-25';
      const now = new Date();
      console.log(`[ARCHIVE APPLY] Starting archive of legacy sets created before ${cutoffDate}`);

      // Archive main_sets that have no canonical children
      const mainSetResult = await db.execute(sql`
        UPDATE main_sets ms
        SET is_active = false, archived_at = ${now}
        WHERE ms.created_at < ${cutoffDate}::timestamp
        AND ms.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM card_sets cs 
          WHERE cs.main_set_id = ms.id 
          AND (cs.canonical_source IS NOT NULL OR cs.is_canonical = true)
        )
        RETURNING id, name
      `);

      // Archive card_sets that are non-canonical
      const cardSetResult = await db.execute(sql`
        UPDATE card_sets
        SET is_active = false, archived_at = ${now}
        WHERE created_at < ${cutoffDate}::timestamp
        AND is_active = true
        AND canonical_source IS NULL
        AND is_canonical = false
        RETURNING id, name
      `);

      // Log the archive action
      console.log(`[ARCHIVE APPLY] Archived ${mainSetResult.rows.length} main sets, ${cardSetResult.rows.length} card sets`);

      // Clear caches
      try {
        const { ultraOptimizedStorage } = await import('./ultra-optimized-storage');
        ultraOptimizedStorage.clearCache();
      } catch (e) {}

      res.json({
        success: true,
        message: `Archived ${mainSetResult.rows.length} main sets and ${cardSetResult.rows.length} card sets`,
        archivedMainSets: mainSetResult.rows.length,
        archivedCardSets: cardSetResult.rows.length,
        cutoffDate,
        archivedAt: now.toISOString()
      });
    } catch (error: any) {
      console.error('[ARCHIVE APPLY] Error:', error);
      res.status(500).json({ message: `Archive failed: ${error.message}` });
    }
  });

  // ============ BASE SET POPULATION TOOL ============
  
  // Get all main sets with empty base subsets
  app.get("/api/admin/empty-base-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Find main sets where the base subset (name = mainSetName - mainSetName) has 0 cards
      const result = await db.execute(sql`
        SELECT 
          ms.id as main_set_id,
          ms.name as main_set_name,
          cs.id as base_set_id,
          cs.name as base_set_name,
          cs.total_cards as base_card_count,
          cs.year,
          (
            SELECT json_agg(json_build_object(
              'id', sibling.id,
              'name', sibling.name,
              'total_cards', sibling.total_cards,
              'is_insert_subset', sibling.is_insert_subset
            ) ORDER BY sibling.total_cards DESC NULLS LAST)
            FROM card_sets sibling
            WHERE sibling.main_set_id = ms.id
              AND sibling.is_active = true
              AND sibling.id != cs.id
              AND (sibling.total_cards > 0 OR sibling.total_cards IS NOT NULL)
          ) as sibling_sets
        FROM main_sets ms
        JOIN card_sets cs ON cs.main_set_id = ms.id
        WHERE ms.is_active = true
          AND cs.is_active = true
          AND cs.name = CONCAT(ms.name, ' - ', ms.name)
          AND (cs.total_cards = 0 OR cs.total_cards IS NULL)
        ORDER BY cs.year DESC, ms.name
      `);

      // For each result, suggest the best source subset
      const resultsWithSuggestions = result.rows.map((row: any) => {
        const siblings = row.sibling_sets || [];
        let suggestedSource = null;
        let suggestionReason = '';

        // Find the best source - prefer largest non-insert subset
        const nonInserts = siblings.filter((s: any) => !s.is_insert_subset && s.total_cards > 0);
        const inserts = siblings.filter((s: any) => s.is_insert_subset && s.total_cards > 0);
        
        // Check for common parallel names that typically match base
        const parallelNames = ['Black Foil', 'Blue Foil', 'Chrome', 'Base Chrome', 'Silver', 'Gold'];
        
        for (const name of parallelNames) {
          const match = siblings.find((s: any) => 
            s.name.toLowerCase().includes(name.toLowerCase()) && s.total_cards >= 50
          );
          if (match) {
            suggestedSource = match;
            suggestionReason = `Common parallel "${name}" with ${match.total_cards} cards`;
            break;
          }
        }
        
        // If no parallel found, use largest non-insert
        if (!suggestedSource && nonInserts.length > 0) {
          suggestedSource = nonInserts[0];
          suggestionReason = `Largest non-insert subset with ${suggestedSource.total_cards} cards`;
        }
        
        // Fallback to largest insert if no non-insert available
        if (!suggestedSource && inserts.length > 0) {
          suggestedSource = inserts[0];
          suggestionReason = `Largest subset (insert) with ${suggestedSource.total_cards} cards`;
        }

        // Count siblings that have cards (usable sources)
        const siblingsWithCards = siblings.filter((s: any) => s.total_cards > 0);

        return {
          mainSetId: row.main_set_id,
          mainSetName: row.main_set_name,
          baseSetId: row.base_set_id,
          baseSetName: row.base_set_name,
          year: row.year,
          siblingCount: siblings.length,
          siblingsWithCardsCount: siblingsWithCards.length,
          siblings: siblings, // Show all subsets
          suggestedSourceId: suggestedSource?.id || null,
          suggestedSourceName: suggestedSource?.name || null,
          suggestedSourceCardCount: suggestedSource?.total_cards || 0,
          suggestionReason
        };
      });

      // Filter out sets with no usable subsets (no siblings with cards)
      const filteredResults = resultsWithSuggestions.filter((set: any) => set.siblingsWithCardsCount > 0);

      res.json({
        total: filteredResults.length,
        sets: filteredResults
      });
    } catch (error: any) {
      console.error('[EMPTY BASE SETS] Error:', error);
      res.status(500).json({ message: `Failed to get empty base sets: ${error.message}` });
    }
  });

  // Preview copying cards from source to base set
  app.get("/api/admin/base-set-population/preview", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const sourceSetId = parseInt(req.query.sourceSetId as string);
      const baseSetId = parseInt(req.query.baseSetId as string);

      if (!sourceSetId || !baseSetId) {
        return res.status(400).json({ message: "sourceSetId and baseSetId are required" });
      }

      // Get source cards
      const sourceCards = await db.execute(sql`
        SELECT id, card_number, name, variation
        FROM cards
        WHERE set_id = ${sourceSetId}
        ORDER BY card_number
      `);

      // Get existing base cards (should be empty but check anyway)
      const existingBaseCards = await db.execute(sql`
        SELECT id, card_number, name
        FROM cards
        WHERE set_id = ${baseSetId}
      `);

      // Get set info
      const sourceSet = await db.execute(sql`
        SELECT cs.name, cs.total_cards, ms.name as main_set_name
        FROM card_sets cs
        JOIN main_sets ms ON cs.main_set_id = ms.id
        WHERE cs.id = ${sourceSetId}
      `);

      const baseSet = await db.execute(sql`
        SELECT cs.name, cs.total_cards
        FROM card_sets cs
        WHERE cs.id = ${baseSetId}
      `);

      res.json({
        sourceSetId,
        sourceSetName: sourceSet.rows[0]?.name || 'Unknown',
        sourceCardCount: sourceCards.rows.length,
        baseSetId,
        baseSetName: baseSet.rows[0]?.name || 'Unknown',
        existingBaseCardCount: existingBaseCards.rows.length,
        sampleCards: sourceCards.rows.slice(0, 10).map((c: any) => ({
          cardNumber: c.card_number,
          name: c.name
        }))
      });
    } catch (error: any) {
      console.error('[BASE SET PREVIEW] Error:', error);
      res.status(500).json({ message: `Preview failed: ${error.message}` });
    }
  });

  // Execute: Copy card names/numbers from source to base set
  app.post("/api/admin/base-set-population/execute", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { sourceSetId, baseSetId } = req.body;

      if (!sourceSetId || !baseSetId) {
        return res.status(400).json({ message: "sourceSetId and baseSetId are required" });
      }

      console.log(`[BASE SET POPULATE] Copying cards from set ${sourceSetId} to base set ${baseSetId}`);

      // Validate source and base belong to same main set
      const validation = await db.execute(sql`
        SELECT 
          s.main_set_id as source_main_set_id,
          b.main_set_id as base_main_set_id,
          ms.name as main_set_name,
          b.name as base_set_name
        FROM card_sets s
        JOIN card_sets b ON b.id = ${baseSetId}
        JOIN main_sets ms ON ms.id = b.main_set_id
        WHERE s.id = ${sourceSetId}
      `);

      if (validation.rows.length === 0) {
        return res.status(400).json({ message: "Source or base set not found" });
      }

      const { source_main_set_id, base_main_set_id, main_set_name, base_set_name } = validation.rows[0] as any;
      
      if (source_main_set_id !== base_main_set_id) {
        return res.status(400).json({ message: "Source and base sets must belong to the same main set" });
      }

      // Verify base set is the canonical base subset (name = "MainSetName - MainSetName")
      const expectedBaseName = `${main_set_name} - ${main_set_name}`;
      if (base_set_name !== expectedBaseName) {
        return res.status(400).json({ message: "Target set is not the canonical base subset for this main set" });
      }

      // Get source cards
      const sourceCards = await db.execute(sql`
        SELECT card_number, name, description, rarity
        FROM cards
        WHERE set_id = ${sourceSetId}
        ORDER BY card_number
      `);

      if (sourceCards.rows.length === 0) {
        return res.status(400).json({ message: "Source set has no cards to copy" });
      }

      // Check if base set already has cards
      const existingCount = await db.execute(sql`
        SELECT COUNT(*) as count FROM cards WHERE set_id = ${baseSetId}
      `);

      if (parseInt(existingCount.rows[0].count) > 0) {
        return res.status(400).json({ 
          message: `Base set already has ${existingCount.rows[0].count} cards. Clear them first or use a different approach.` 
        });
      }

      // Use transaction for atomic insert
      await db.execute(sql`BEGIN`);
      
      try {
        // Bulk insert using VALUES clause
        const cardRows = sourceCards.rows as any[];
        const batchSize = 100;
        let insertedCount = 0;

        for (let i = 0; i < cardRows.length; i += batchSize) {
          const batch = cardRows.slice(i, i + batchSize);
          
          for (const card of batch) {
            await db.execute(sql`
              INSERT INTO cards (set_id, card_number, name, description, rarity, is_insert)
              VALUES (${baseSetId}, ${card.card_number}, ${card.name}, ${card.description}, ${card.rarity}, false)
            `);
            insertedCount++;
          }
        }

        // Update base set card count
        await db.execute(sql`
          UPDATE card_sets SET total_cards = ${insertedCount} WHERE id = ${baseSetId}
        `);

        await db.execute(sql`COMMIT`);

        console.log(`[BASE SET POPULATE] Inserted ${insertedCount} cards into base set ${baseSetId}`);

        res.json({
          success: true,
          message: `Populated base set with ${insertedCount} cards`,
          insertedCount,
          sourceSetId,
          baseSetId
        });
      } catch (txError: any) {
        await db.execute(sql`ROLLBACK`);
        throw txError;
      }
    } catch (error: any) {
      console.error('[BASE SET POPULATE] Error:', error);
      res.status(500).json({ message: `Population failed: ${error.message}` });
    }
  });

  // Batch execute: Populate multiple base sets at once
  app.post("/api/admin/base-set-population/batch-execute", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { items } = req.body; // Array of { sourceSetId, baseSetId }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required" });
      }

      console.log(`[BATCH BASE SET POPULATE] Processing ${items.length} sets`);

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const item of items) {
        const { sourceSetId, baseSetId } = item;
        
        try {
          // Validate source and base belong to same main set
          const validation = await db.execute(sql`
            SELECT 
              s.main_set_id as source_main_set_id,
              b.main_set_id as base_main_set_id,
              ms.name as main_set_name,
              b.name as base_set_name
            FROM card_sets s
            JOIN card_sets b ON b.id = ${baseSetId}
            JOIN main_sets ms ON ms.id = b.main_set_id
            WHERE s.id = ${sourceSetId}
          `);

          if (validation.rows.length === 0) {
            results.push({ baseSetId, success: false, error: 'Source or base set not found' });
            errorCount++;
            continue;
          }

          const { source_main_set_id, base_main_set_id, main_set_name, base_set_name } = validation.rows[0] as any;
          
          if (source_main_set_id !== base_main_set_id) {
            results.push({ baseSetId, success: false, error: 'Source and base sets must belong to the same main set' });
            errorCount++;
            continue;
          }

          // Verify base set is the canonical base subset
          const expectedBaseName = `${main_set_name} - ${main_set_name}`;
          if (base_set_name !== expectedBaseName) {
            results.push({ baseSetId, success: false, error: 'Target set is not the canonical base subset' });
            errorCount++;
            continue;
          }

          // Get source cards
          const sourceCards = await db.execute(sql`
            SELECT card_number, name, description, rarity
            FROM cards
            WHERE set_id = ${sourceSetId}
            ORDER BY card_number
          `);

          if (sourceCards.rows.length === 0) {
            results.push({ baseSetId, success: false, error: 'Source set has no cards' });
            errorCount++;
            continue;
          }

          // Check if base set already has cards
          const existingCount = await db.execute(sql`
            SELECT COUNT(*) as count FROM cards WHERE set_id = ${baseSetId}
          `);

          if (parseInt(existingCount.rows[0].count) > 0) {
            results.push({ baseSetId, success: false, error: 'Base set already has cards' });
            errorCount++;
            continue;
          }

          // Use transaction for each set's population
          await db.execute(sql`BEGIN`);
          
          try {
            // Insert cards
            let insertedCount = 0;
            for (const card of sourceCards.rows as any[]) {
              await db.execute(sql`
                INSERT INTO cards (set_id, card_number, name, description, rarity, is_insert)
                VALUES (${baseSetId}, ${card.card_number}, ${card.name}, ${card.description}, ${card.rarity}, false)
              `);
              insertedCount++;
            }

            // Update card count
            await db.execute(sql`
              UPDATE card_sets SET total_cards = ${insertedCount} WHERE id = ${baseSetId}
            `);

            await db.execute(sql`COMMIT`);
            results.push({ baseSetId, success: true, insertedCount });
            successCount++;
          } catch (txError: any) {
            await db.execute(sql`ROLLBACK`);
            throw txError;
          }
        } catch (err: any) {
          results.push({ baseSetId, success: false, error: err.message });
          errorCount++;
        }
      }

      console.log(`[BATCH BASE SET POPULATE] Complete: ${successCount} success, ${errorCount} errors`);

      res.json({
        success: true,
        message: `Processed ${items.length} sets: ${successCount} successful, ${errorCount} errors`,
        successCount,
        errorCount,
        results
      });
    } catch (error: any) {
      console.error('[BATCH BASE SET POPULATE] Error:', error);
      res.status(500).json({ message: `Batch population failed: ${error.message}` });
    }
  });

  // Assign a subset as the base set (rename it to the canonical base set name)
  app.post("/api/admin/assign-base-set", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { items } = req.body; // Array of { mainSetId, sourceSetId, currentBaseSetId }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required" });
      }

      console.log(`[ASSIGN BASE SET] Processing ${items.length} sets`);

      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (const item of items) {
        const { mainSetId, sourceSetId, currentBaseSetId } = item;
        
        try {
          // Get main set name
          const mainSetInfo = await db.execute(sql`
            SELECT name FROM main_sets WHERE id = ${mainSetId}
          `);

          if (mainSetInfo.rows.length === 0) {
            results.push({ mainSetId, success: false, error: 'Main set not found' });
            errorCount++;
            continue;
          }

          const mainSetName = (mainSetInfo.rows[0] as any).name;
          const canonicalBaseName = `${mainSetName} - ${mainSetName}`;

          // Use transaction
          await db.execute(sql`BEGIN`);
          
          try {
            // Archive the current empty base set
            const now = new Date();
            await db.execute(sql`
              UPDATE card_sets 
              SET is_active = false, archived_at = ${now}
              WHERE id = ${currentBaseSetId}
            `);

            // Rename the source set to be the canonical base set
            await db.execute(sql`
              UPDATE card_sets 
              SET name = ${canonicalBaseName}
              WHERE id = ${sourceSetId}
            `);

            await db.execute(sql`COMMIT`);
            
            console.log(`[ASSIGN BASE SET] Assigned set ${sourceSetId} as base for "${mainSetName}"`);
            results.push({ mainSetId, success: true, newBaseSetId: sourceSetId });
            successCount++;
          } catch (txError: any) {
            await db.execute(sql`ROLLBACK`);
            throw txError;
          }
        } catch (err: any) {
          results.push({ mainSetId, success: false, error: err.message });
          errorCount++;
        }
      }

      console.log(`[ASSIGN BASE SET] Complete: ${successCount} success, ${errorCount} errors`);

      res.json({
        success: true,
        message: `Assigned ${successCount} sets as base, ${errorCount} errors`,
        successCount,
        errorCount,
        results
      });
    } catch (error: any) {
      console.error('[ASSIGN BASE SET] Error:', error);
      res.status(500).json({ message: `Assignment failed: ${error.message}` });
    }
  });

  // Archive a single main set and all its subsets
  app.post("/api/admin/archive-main-set/:mainSetId", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const mainSetId = parseInt(req.params.mainSetId);
      if (!mainSetId) {
        return res.status(400).json({ message: "mainSetId is required" });
      }

      const now = new Date();

      // Get main set info for logging
      const mainSetInfo = await db.execute(sql`
        SELECT name FROM main_sets WHERE id = ${mainSetId}
      `);

      if (mainSetInfo.rows.length === 0) {
        return res.status(404).json({ message: "Main set not found" });
      }

      const mainSetName = (mainSetInfo.rows[0] as any).name;
      console.log(`[ARCHIVE] Archiving main set: ${mainSetName} (ID: ${mainSetId})`);

      // Use transaction
      await db.execute(sql`BEGIN`);
      
      try {
        // Archive all card_sets under this main set
        const subsetResult = await db.execute(sql`
          UPDATE card_sets 
          SET is_active = false, archived_at = ${now}
          WHERE main_set_id = ${mainSetId} AND is_active = true
          RETURNING id
        `);

        // Archive the main set
        await db.execute(sql`
          UPDATE main_sets 
          SET is_active = false, archived_at = ${now}
          WHERE id = ${mainSetId}
        `);

        await db.execute(sql`COMMIT`);

        console.log(`[ARCHIVE] Archived main set ${mainSetName} and ${subsetResult.rows.length} subsets`);

        res.json({
          success: true,
          message: `Archived "${mainSetName}" and ${subsetResult.rows.length} subsets`,
          mainSetId,
          archivedSubsets: subsetResult.rows.length
        });
      } catch (txError: any) {
        await db.execute(sql`ROLLBACK`);
        throw txError;
      }
    } catch (error: any) {
      console.error('[ARCHIVE] Error:', error);
      res.status(500).json({ message: `Archive failed: ${error.message}` });
    }
  });

  // ==================== PHASE A: SN NORMALIZE ====================
  app.post("/api/admin/sn-normalize", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { mode, batchSize } = req.body;
      if (!mode || !["dry-run", "apply"].includes(mode)) {
        return res.status(400).json({ message: "mode must be 'dry-run' or 'apply'" });
      }

      const batch = batchSize || 1000;
      const snRegex = /^(.*?)(SN)(\d+)$/i;

      console.log(`[SN-NORMALIZE] Starting ${mode} mode, batchSize=${batch}`);

      const snCards = await db.execute(sql`
        SELECT c.id, c.set_id, c.card_number, c.name, c.description
        FROM cards c
        WHERE c.name ~* 'SN[0-9]+$'
        ORDER BY c.set_id, c.card_number
      `);

      console.log(`[SN-NORMALIZE] Found ${snCards.rows.length} cards with SN pattern`);

      const csvHeader = (obj: any) => Object.keys(obj).join(',');
      const csvRow = (obj: any) => Object.values(obj).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');

      const report: any[] = [];
      let wouldUpdateName = 0;
      let wouldUpdateDesc = 0;

      for (const row of snCards.rows as any[]) {
        const match = row.name.match(snRegex);
        if (!match) continue;

        const cleanName = match[1].trim();
        const digits = match[3];
        const serialTag = `/${digits}`;

        const oldDesc = row.description || '';
        let newDesc = oldDesc;
        const nameChanged = cleanName !== row.name;

        if (!oldDesc || oldDesc.trim() === '') {
          newDesc = serialTag;
        } else if (oldDesc.includes(serialTag)) {
          newDesc = oldDesc;
        } else {
          newDesc = oldDesc + ' ' + serialTag;
        }

        const descChanged = newDesc !== oldDesc;
        if (nameChanged) wouldUpdateName++;
        if (descChanged) wouldUpdateDesc++;

        report.push({
          card_id: row.id,
          set_id: row.set_id,
          card_number: row.card_number,
          old_name: row.name,
          new_name: cleanName,
          old_description: oldDesc,
          new_description: newDesc,
          serialTag,
        });
      }

      console.log(`[SN-NORMALIZE] ${report.length} cards matched. would_update_name=${wouldUpdateName}, would_update_description=${wouldUpdateDesc}`);

      if (mode === 'dry-run') {
        if (report.length > 0) {
          const csvLines = [csvHeader(report[0]), ...report.map(csvRow)];
          fs.writeFileSync('/tmp/sn-normalize-dryrun.csv', csvLines.join('\n'), 'utf-8');
          console.log(`[SN-NORMALIZE] Saved /tmp/sn-normalize-dryrun.csv (${report.length} rows)`);
        }

        return res.json({
          mode: 'dry-run',
          matched: report.length,
          would_update_name: wouldUpdateName,
          would_update_description: wouldUpdateDesc,
          sample: report.slice(0, 20),
          csvFile: '/tmp/sn-normalize-dryrun.csv',
          message: `Dry run complete. ${report.length} cards matched SN pattern. ${wouldUpdateName} name updates, ${wouldUpdateDesc} description updates would be applied.`,
        });
      }

      // === APPLY MODE ===
      console.log(`[SN-NORMALIZE APPLY] Updating ${report.length} cards in batches of ${batch}`);
      let totalUpdated = 0;

      for (let i = 0; i < report.length; i += batch) {
        const batchItems = report.slice(i, i + batch);
        const batchNum = Math.floor(i / batch) + 1;

        await db.execute(sql`BEGIN`);
        try {
          for (const item of batchItems) {
            await db.execute(sql`
              UPDATE cards
              SET name = ${item.new_name}, description = ${item.new_description}
              WHERE id = ${item.card_id}
            `);
          }
          await db.execute(sql`COMMIT`);
          totalUpdated += batchItems.length;
          console.log(`[SN-NORMALIZE APPLY] Batch ${batchNum}: updated ${batchItems.length} rows (total: ${totalUpdated})`);
        } catch (batchErr) {
          await db.execute(sql`ROLLBACK`);
          console.error(`[SN-NORMALIZE APPLY] Batch ${batchNum} failed, rolled back:`, batchErr);
          return res.status(500).json({
            message: `Apply failed at batch ${batchNum}. Rolled back. ${totalUpdated} rows updated before failure.`,
            totalUpdatedBeforeFailure: totalUpdated,
            error: String(batchErr),
          });
        }
        if (i + batch < report.length) await new Promise(r => setTimeout(r, 10));
      }

      const applyRows = report.map(r => ({ ...r, status: 'updated' }));
      if (applyRows.length > 0) {
        const csvLines = [csvHeader(applyRows[0]), ...applyRows.map(csvRow)];
        fs.writeFileSync('/tmp/sn-normalize-apply-summary.csv', csvLines.join('\n'), 'utf-8');
        console.log(`[SN-NORMALIZE APPLY] Saved /tmp/sn-normalize-apply-summary.csv`);
      }

      const remainCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM cards WHERE name ~* 'SN[0-9]+$'`);
      const remaining = parseInt((remainCheck.rows[0] as any).cnt) || 0;

      return res.json({
        mode: 'apply',
        totalUpdated,
        remainingSN: remaining,
        sample: report.slice(0, 10),
        csvFile: '/tmp/sn-normalize-apply-summary.csv',
        message: `Apply complete. Updated ${totalUpdated} cards. ${remaining} SN cards remaining.`,
      });
    } catch (error) {
      console.error('[SN-NORMALIZE] Error:', error);
      res.status(500).json({ message: 'SN normalize failed', error: String(error) });
    }
  });

  // ==================== PHASE B: DEDUPE CARDS ====================
  app.post("/api/admin/dedupe-cards", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { mode, setId, batchSize } = req.body;
      if (!mode || !["dry-run", "apply"].includes(mode)) {
        return res.status(400).json({ message: "mode must be 'dry-run' or 'apply'" });
      }

      const batch = batchSize || 1000;
      console.log(`[DEDUPE] Starting ${mode} mode, setId=${setId || 'ALL'}, batchSize=${batch}`);

      const csvHeader = (obj: any) => Object.keys(obj).join(',');
      const csvRow = (obj: any) => Object.values(obj).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');

      const setFilter = setId ? sql`AND c.set_id = ${setId}` : sql``;
      const dupeQuery = await db.execute(sql`
        SELECT c.set_id, c.card_number, c.name, COALESCE(c.variation, '') as variation,
               ARRAY_AGG(c.id ORDER BY c.id) as card_ids,
               ARRAY_AGG(COALESCE(c.front_image_url, '') ORDER BY c.id) as front_images,
               ARRAY_AGG(COALESCE(c.back_image_url, '') ORDER BY c.id) as back_images,
               ARRAY_AGG(COALESCE(c.rarity, '') ORDER BY c.id) as rarities,
               ARRAY_AGG(COALESCE(CAST(c.estimated_value AS text), '') ORDER BY c.id) as est_values,
               ARRAY_AGG(COALESCE(c.description, '') ORDER BY c.id) as descriptions,
               COUNT(*) as cnt
        FROM cards c
        WHERE 1=1 ${setFilter}
        GROUP BY c.set_id, c.card_number, c.name, COALESCE(c.variation, '')
        HAVING COUNT(*) > 1
        ORDER BY c.set_id, c.card_number
      `);

      console.log(`[DEDUPE] Found ${dupeQuery.rows.length} duplicate groups`);

      interface DupeGroup {
        set_id: number;
        card_number: string;
        name: string;
        variation: string;
        survivor_id: number;
        duplicate_ids: number[];
        survivor_has_image: boolean;
        dupe_has_image_count: number;
      }

      const groups: DupeGroup[] = [];

      // Pre-fetch which card IDs are in user collections for survivor preference
      const allCardIds = (dupeQuery.rows as any[]).flatMap(r => r.card_ids as number[]);
      const ownedCardIds = new Set<number>();
      if (allCardIds.length > 0) {
        const chunkSize = 5000;
        for (let ci = 0; ci < allCardIds.length; ci += chunkSize) {
          const chunk = allCardIds.slice(ci, ci + chunkSize);
          const ownedResult = await db.execute(sql`
            SELECT DISTINCT card_id FROM user_collections WHERE card_id = ANY(${chunk})
          `);
          for (const r of ownedResult.rows as any[]) ownedCardIds.add(r.card_id);
        }
      }
      console.log(`[DEDUPE] ${ownedCardIds.size} unique card IDs are in user collections`);

      for (const row of dupeQuery.rows as any[]) {
        const cardIds: number[] = row.card_ids;
        const frontImages: string[] = row.front_images;
        const backImages: string[] = row.back_images;
        const rarities: string[] = row.rarities;
        const estValues: string[] = row.est_values;
        const descs: string[] = row.descriptions;

        const scored = cardIds.map((id: number, idx: number) => {
          let fieldCount = 0;
          if (frontImages[idx] && frontImages[idx] !== '') fieldCount++;
          if (backImages[idx] && backImages[idx] !== '') fieldCount++;
          if (rarities[idx] && rarities[idx] !== '') fieldCount++;
          if (estValues[idx] && estValues[idx] !== '') fieldCount++;
          if (descs[idx] && descs[idx] !== '') fieldCount++;
          const hasImage = frontImages[idx] && frontImages[idx] !== '';
          const inCollection = ownedCardIds.has(id);
          return { id, hasImage, fieldCount, idx, inCollection };
        });

        scored.sort((a, b) => {
          if (a.inCollection && !b.inCollection) return -1;
          if (!a.inCollection && b.inCollection) return 1;
          if (a.hasImage && !b.hasImage) return -1;
          if (!a.hasImage && b.hasImage) return 1;
          if (b.fieldCount !== a.fieldCount) return b.fieldCount - a.fieldCount;
          return a.id - b.id;
        });

        const survivorId = scored[0].id;
        const dupeIds = scored.slice(1).map(s => s.id);

        groups.push({
          set_id: row.set_id,
          card_number: row.card_number,
          name: row.name,
          variation: row.variation,
          survivor_id: survivorId,
          duplicate_ids: dupeIds,
          survivor_has_image: !!scored[0].hasImage,
          dupe_has_image_count: scored.slice(1).filter(s => s.hasImage).length,
        });
      }

      const allDupeIds = groups.flatMap(g => g.duplicate_ids);
      console.log(`[DEDUPE] ${groups.length} groups, ${allDupeIds.length} total duplicate cards to remove`);

      let affectedCollections: any[] = [];
      if (allDupeIds.length > 0) {
        const chunkSize = 5000;
        for (let i = 0; i < allDupeIds.length; i += chunkSize) {
          const chunk = allDupeIds.slice(i, i + chunkSize);
          const collResult = await db.execute(sql`
            SELECT uc.id as collection_id, uc.user_id, uc.card_id as duplicate_card_id,
                   uc.condition, uc.quantity, uc.notes, uc.is_favorite, uc.serial_number,
                   uc.personal_value, uc.sale_price, uc.is_for_sale, uc.acquired_date, uc.acquired_via
            FROM user_collections uc
            WHERE uc.card_id = ANY(${chunk})
          `);
          affectedCollections.push(...(collResult.rows as any[]));
        }
      }

      const dupeToSurvivor = new Map<number, number>();
      for (const g of groups) {
        for (const did of g.duplicate_ids) {
          dupeToSurvivor.set(did, g.survivor_id);
        }
      }

      const collectionMoves = affectedCollections.map((c: any) => ({
        duplicate_card_id: c.duplicate_card_id,
        user_id: c.user_id,
        will_move_to_survivor_card_id: dupeToSurvivor.get(c.duplicate_card_id) || 0,
        collection_id: c.collection_id,
        condition: c.condition,
        quantity: c.quantity,
        notes: c.notes,
      }));

      console.log(`[DEDUPE] ${collectionMoves.length} collection rows reference duplicate cards`);

      let affectedWishlists: any[] = [];
      if (allDupeIds.length > 0) {
        const chunkSize = 5000;
        for (let i = 0; i < allDupeIds.length; i += chunkSize) {
          const chunk = allDupeIds.slice(i, i + chunkSize);
          const wlResult = await db.execute(sql`
            SELECT id, user_id, card_id FROM user_wishlists WHERE card_id = ANY(${chunk})
          `);
          affectedWishlists.push(...(wlResult.rows as any[]));
        }
      }

      if (mode === 'dry-run') {
        const suffix = setId ? `-set${setId}` : '';

        if (groups.length > 0) {
          const dupeRows = groups.map(g => ({
            set_id: g.set_id,
            card_number: g.card_number,
            name: g.name,
            variation: g.variation,
            survivor_card_id: g.survivor_id,
            duplicate_card_ids: g.duplicate_ids.join(';'),
            duplicate_count: g.duplicate_ids.length,
            survivor_has_image: g.survivor_has_image ? 'y' : 'n',
            dupe_has_image_count: g.dupe_has_image_count,
          }));
          const csvLines = [csvHeader(dupeRows[0]), ...dupeRows.map(csvRow)];
          fs.writeFileSync(`/tmp/dedupe-dryrun${suffix}.csv`, csvLines.join('\n'), 'utf-8');
          console.log(`[DEDUPE] Saved /tmp/dedupe-dryrun${suffix}.csv`);
        }

        if (collectionMoves.length > 0) {
          const csvLines = [csvHeader(collectionMoves[0]), ...collectionMoves.map(csvRow)];
          fs.writeFileSync(`/tmp/dedupe-affected-collections${suffix}.csv`, csvLines.join('\n'), 'utf-8');
          console.log(`[DEDUPE] Saved /tmp/dedupe-affected-collections${suffix}.csv`);
        }

        if (affectedWishlists.length > 0) {
          const wlRows = affectedWishlists.map((w: any) => ({
            wishlist_id: w.id,
            user_id: w.user_id,
            duplicate_card_id: w.card_id,
            will_move_to_survivor_card_id: dupeToSurvivor.get(w.card_id) || 0,
          }));
          const csvLines = [csvHeader(wlRows[0]), ...wlRows.map(csvRow)];
          fs.writeFileSync(`/tmp/dedupe-affected-wishlists${suffix}.csv`, csvLines.join('\n'), 'utf-8');
          console.log(`[DEDUPE] Saved /tmp/dedupe-affected-wishlists${suffix}.csv`);
        }

        return res.json({
          mode: 'dry-run',
          setId: setId || 'ALL',
          duplicateGroups: groups.length,
          totalDuplicateCards: allDupeIds.length,
          affectedCollectionRows: collectionMoves.length,
          affectedWishlistRows: affectedWishlists.length,
          sampleGroups: groups.slice(0, 20),
          sampleCollectionMoves: collectionMoves.slice(0, 20),
          csvFiles: [
            `/tmp/dedupe-dryrun${suffix}.csv`,
            `/tmp/dedupe-affected-collections${suffix}.csv`,
            `/tmp/dedupe-affected-wishlists${suffix}.csv`,
          ],
          message: `Dry run complete. ${groups.length} duplicate groups found with ${allDupeIds.length} cards to remove. ${collectionMoves.length} collection rows and ${affectedWishlists.length} wishlist rows would be migrated.`,
        });
      }

      // === APPLY MODE ===
      if (!setId && groups.length > 200) {
        return res.status(400).json({
          message: `Global apply blocked: ${groups.length} groups is too many without setId. Run per-set first, then explicitly confirm global apply.`,
        });
      }

      console.log(`[DEDUPE APPLY] Processing ${groups.length} groups, ${allDupeIds.length} duplicates`);
      let totalDeleted = 0;
      let totalCollectionsMoved = 0;
      let totalCollectionsMerged = 0;
      let totalWishlistsMoved = 0;
      let totalWishlistsMerged = 0;
      const applySummary: any[] = [];

      for (let i = 0; i < groups.length; i += batch) {
        const batchGroups = groups.slice(i, i + batch);
        const batchNum = Math.floor(i / batch) + 1;

        await db.execute(sql`BEGIN`);
        try {
          for (const g of batchGroups) {
            for (const dupeId of g.duplicate_ids) {
              const survivorId = g.survivor_id;

              // 0) Merge description/details from duplicate into survivor
              const dupeCard = await db.execute(sql`
                SELECT description, back_image_url, rarity, estimated_value
                FROM cards WHERE id = ${dupeId}
              `);
              const survCard = await db.execute(sql`
                SELECT description, back_image_url, rarity, estimated_value
                FROM cards WHERE id = ${survivorId}
              `);
              if (dupeCard.rows.length > 0 && survCard.rows.length > 0) {
                const dc = dupeCard.rows[0] as any;
                const sc = survCard.rows[0] as any;
                const updates: string[] = [];
                const updateVals: any = {};

                // Merge description: append unique parts from duplicate
                if (dc.description && dc.description.trim()) {
                  const survDesc = sc.description || '';
                  if (!survDesc.includes(dc.description.trim())) {
                    const merged = survDesc ? survDesc + ' ' + dc.description.trim() : dc.description.trim();
                    updateVals.description = merged;
                  }
                }
                // Fill in missing fields from duplicate
                if (!sc.back_image_url && dc.back_image_url) updateVals.backImage = dc.back_image_url;
                if ((!sc.rarity || sc.rarity === 'Common') && dc.rarity && dc.rarity !== 'Common') updateVals.rarity = dc.rarity;
                if (!sc.estimated_value && dc.estimated_value) updateVals.estValue = dc.estimated_value;

                if (updateVals.description !== undefined) {
                  await db.execute(sql`UPDATE cards SET description = ${updateVals.description} WHERE id = ${survivorId}`);
                }
                if (updateVals.backImage) {
                  await db.execute(sql`UPDATE cards SET back_image_url = ${updateVals.backImage} WHERE id = ${survivorId}`);
                }
                if (updateVals.rarity) {
                  await db.execute(sql`UPDATE cards SET rarity = ${updateVals.rarity} WHERE id = ${survivorId}`);
                }
                if (updateVals.estValue) {
                  await db.execute(sql`UPDATE cards SET estimated_value = ${updateVals.estValue} WHERE id = ${survivorId}`);
                }
              }

              // 1) Migrate user_collections
              const ucRows = await db.execute(sql`
                SELECT id, user_id, quantity, notes, is_favorite, serial_number,
                       personal_value, sale_price, is_for_sale, condition, acquired_date, acquired_via
                FROM user_collections WHERE card_id = ${dupeId}
              `);

              for (const uc of ucRows.rows as any[]) {
                const existing = await db.execute(sql`
                  SELECT id, quantity, notes, is_favorite, serial_number,
                         personal_value, sale_price, is_for_sale
                  FROM user_collections
                  WHERE user_id = ${uc.user_id} AND card_id = ${survivorId}
                `);

                if (existing.rows.length > 0) {
                  const surv = existing.rows[0] as any;
                  const mergedQty = (surv.quantity || 1) + (uc.quantity || 1);
                  const mergedNotes = surv.notes || uc.notes || null;
                  const mergedFav = surv.is_favorite || uc.is_favorite;
                  const mergedSerial = surv.serial_number || uc.serial_number || null;

                  await db.execute(sql`
                    UPDATE user_collections
                    SET quantity = ${mergedQty},
                        notes = ${mergedNotes},
                        is_favorite = ${mergedFav},
                        serial_number = ${mergedSerial}
                    WHERE id = ${surv.id}
                  `);
                  await db.execute(sql`DELETE FROM user_collections WHERE id = ${uc.id}`);
                  totalCollectionsMerged++;
                } else {
                  await db.execute(sql`
                    UPDATE user_collections SET card_id = ${survivorId} WHERE id = ${uc.id}
                  `);
                  totalCollectionsMoved++;
                }
              }

              // 2) Migrate user_wishlists
              const wlRows = await db.execute(sql`
                SELECT id, user_id FROM user_wishlists WHERE card_id = ${dupeId}
              `);

              for (const wl of wlRows.rows as any[]) {
                const existingWl = await db.execute(sql`
                  SELECT id FROM user_wishlists
                  WHERE user_id = ${(wl as any).user_id} AND card_id = ${survivorId}
                `);

                if (existingWl.rows.length > 0) {
                  await db.execute(sql`DELETE FROM user_wishlists WHERE id = ${(wl as any).id}`);
                  totalWishlistsMerged++;
                } else {
                  await db.execute(sql`
                    UPDATE user_wishlists SET card_id = ${survivorId} WHERE id = ${(wl as any).id}
                  `);
                  totalWishlistsMoved++;
                }
              }

              // 3) Migrate card_price_cache (cascade delete handles this, but migrate if valuable)
              await db.execute(sql`DELETE FROM card_price_cache WHERE card_id = ${dupeId}`);

              // 4) Migrate pending_card_images
              await db.execute(sql`
                UPDATE pending_card_images SET card_id = ${survivorId} WHERE card_id = ${dupeId}
              `);

              // 5) Handle listings referencing duplicate card
              const listingRows = await db.execute(sql`
                SELECT id FROM listings WHERE card_id = ${dupeId}
              `);
              if (listingRows.rows.length > 0) {
                await db.execute(sql`
                  UPDATE listings SET card_id = ${survivorId} WHERE card_id = ${dupeId}
                `);
              }

              // 6) Handle migration_log_cards
              await db.execute(sql`
                DELETE FROM migration_log_cards WHERE card_id = ${dupeId}
              `);

              // 7) Delete the duplicate card
              await db.execute(sql`DELETE FROM cards WHERE id = ${dupeId}`);
              totalDeleted++;

              applySummary.push({
                set_id: g.set_id,
                card_number: g.card_number,
                name: g.name,
                survivor_card_id: survivorId,
                deleted_duplicate_card_id: dupeId,
                collections_moved: totalCollectionsMoved,
                collections_merged: totalCollectionsMerged,
                status: 'deleted',
              });
            }
          }
          await db.execute(sql`COMMIT`);
          console.log(`[DEDUPE APPLY] Batch ${batchNum}: processed ${batchGroups.length} groups (total deleted: ${totalDeleted})`);
        } catch (batchErr) {
          await db.execute(sql`ROLLBACK`);
          console.error(`[DEDUPE APPLY] Batch ${batchNum} failed, rolled back:`, batchErr);
          return res.status(500).json({
            message: `Dedupe apply failed at batch ${batchNum}. Rolled back. ${totalDeleted} cards deleted before failure.`,
            totalDeletedBeforeFailure: totalDeleted,
            error: String(batchErr),
          });
        }
        if (i + batch < groups.length) await new Promise(r => setTimeout(r, 10));
      }

      const suffix = setId ? `-set${setId}` : '';
      if (applySummary.length > 0) {
        const csvLines = [csvHeader(applySummary[0]), ...applySummary.map(csvRow)];
        fs.writeFileSync(`/tmp/dedupe-apply-summary${suffix}.csv`, csvLines.join('\n'), 'utf-8');
        console.log(`[DEDUPE APPLY] Saved /tmp/dedupe-apply-summary${suffix}.csv`);
      }

      // Post-apply integrity checks
      const orphanCheck = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM user_collections uc
        LEFT JOIN cards c ON uc.card_id = c.id
        WHERE c.id IS NULL
      `);
      const orphanCount = parseInt((orphanCheck.rows[0] as any).cnt) || 0;

      const remainingDupes = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM (
          SELECT c.set_id, c.card_number, c.name, COALESCE(c.variation, '')
          FROM cards c
          WHERE 1=1 ${setFilter}
          GROUP BY c.set_id, c.card_number, c.name, COALESCE(c.variation, '')
          HAVING COUNT(*) > 1
        ) sub
      `);
      const remainingDupeCount = parseInt((remainingDupes.rows[0] as any).cnt) || 0;

      console.log(`[DEDUPE APPLY] Integrity: ${orphanCount} orphaned collections, ${remainingDupeCount} remaining dupe groups`);

      return res.json({
        mode: 'apply',
        setId: setId || 'ALL',
        groups_processed: groups.length,
        cards_deleted: totalDeleted,
        collections_moved: totalCollectionsMoved,
        collections_merged: totalCollectionsMerged,
        wishlists_moved: totalWishlistsMoved,
        wishlists_merged: totalWishlistsMerged,
        orphaned_collections: orphanCount,
        remaining_duplicate_groups: remainingDupeCount,
        csvFile: `/tmp/dedupe-apply-summary${suffix}.csv`,
        message: `Dedupe complete. ${totalDeleted} duplicates deleted across ${groups.length} groups. ${totalCollectionsMoved} collections moved, ${totalCollectionsMerged} merged. ${orphanCount} orphaned collection rows. ${remainingDupeCount} duplicate groups remaining.`,
      });
    } catch (error) {
      console.error('[DEDUPE] Error:', error);
      res.status(500).json({ message: 'Dedupe failed', error: String(error) });
    }
  });

  // ==================== SHARE BINDER ROUTES ====================
  const shareLinkCache = new Map<string, { data: any; timestamp: number }>();
  const SHARE_CACHE_TTL = 60_000; // 60 seconds

  function invalidateShareCache(token: string) {
    shareLinkCache.delete(token);
  }

  // POST /api/share-links — create or return existing share link
  app.post("/api/share-links", authenticateUser, async (req: any, res) => {
    try {
      const { cardSetId } = req.body;
      if (!cardSetId) return res.status(400).json({ message: "cardSetId is required" });

      const userId = req.user.id;

      // Check if active link already exists
      const existing = await db
        .select()
        .from(shareLinks)
        .where(and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.cardSetId, cardSetId),
          eq(shareLinks.isActive, true)
        ))
        .limit(1);

      if (existing.length > 0) {
        const link = existing[0];
        const baseUrl = req.headers['x-forwarded-host']
          ? `https://${req.headers['x-forwarded-host']}`
          : `${req.protocol}://${req.get('host')}`;
        return res.json({
          token: link.token,
          url: `${baseUrl}/share/${link.token}`,
          cardSetId: link.cardSetId,
          id: link.id,
        });
      }

      // Create new share link
      const token = crypto.randomBytes(32).toString('hex');
      const [newLink] = await db
        .insert(shareLinks)
        .values({ userId, cardSetId, token, isActive: true })
        .returning();

      const baseUrl = req.headers['x-forwarded-host']
        ? `https://${req.headers['x-forwarded-host']}`
        : `${req.protocol}://${req.get('host')}`;

      res.json({
        token: newLink.token,
        url: `${baseUrl}/share/${newLink.token}`,
        cardSetId: newLink.cardSetId,
        id: newLink.id,
      });
    } catch (error) {
      console.error("Error creating share link:", error);
      res.status(500).json({ message: "Failed to create share link" });
    }
  });

  // POST /api/share-links/:cardSetId/regenerate — revoke old + create new
  app.post("/api/share-links/:cardSetId/regenerate", authenticateUser, async (req: any, res) => {
    try {
      const cardSetId = parseInt(req.params.cardSetId);
      const userId = req.user.id;

      // Revoke existing active links and get their tokens for cache invalidation
      const oldLinks = await db
        .select({ token: shareLinks.token })
        .from(shareLinks)
        .where(and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.cardSetId, cardSetId),
          eq(shareLinks.isActive, true)
        ));

      if (oldLinks.length > 0) {
        for (const old of oldLinks) invalidateShareCache(old.token);
        await db
          .update(shareLinks)
          .set({ isActive: false, revokedAt: new Date() })
          .where(and(
            eq(shareLinks.userId, userId),
            eq(shareLinks.cardSetId, cardSetId),
            eq(shareLinks.isActive, true)
          ));
      }

      // Create new token
      const token = crypto.randomBytes(32).toString('hex');
      const [newLink] = await db
        .insert(shareLinks)
        .values({ userId, cardSetId, token, isActive: true })
        .returning();

      const baseUrl = req.headers['x-forwarded-host']
        ? `https://${req.headers['x-forwarded-host']}`
        : `${req.protocol}://${req.get('host')}`;

      res.json({
        token: newLink.token,
        url: `${baseUrl}/share/${newLink.token}`,
        cardSetId: newLink.cardSetId,
        id: newLink.id,
      });
    } catch (error) {
      console.error("Error regenerating share link:", error);
      res.status(500).json({ message: "Failed to regenerate share link" });
    }
  });

  // DELETE /api/share-links/:cardSetId — revoke active link
  app.delete("/api/share-links/:cardSetId", authenticateUser, async (req: any, res) => {
    try {
      const cardSetId = parseInt(req.params.cardSetId);
      const userId = req.user.id;

      const oldLinks = await db
        .select({ token: shareLinks.token })
        .from(shareLinks)
        .where(and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.cardSetId, cardSetId),
          eq(shareLinks.isActive, true)
        ));

      for (const old of oldLinks) invalidateShareCache(old.token);

      await db
        .update(shareLinks)
        .set({ isActive: false, revokedAt: new Date() })
        .where(and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.cardSetId, cardSetId),
          eq(shareLinks.isActive, true)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("Error revoking share link:", error);
      res.status(500).json({ message: "Failed to revoke share link" });
    }
  });

  // GET /api/share-links/:cardSetId — get current user's active share link for a set
  app.get("/api/share-links/:cardSetId", authenticateUser, async (req: any, res) => {
    try {
      const cardSetId = parseInt(req.params.cardSetId);
      const userId = req.user.id;

      const existing = await db
        .select()
        .from(shareLinks)
        .where(and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.cardSetId, cardSetId),
          eq(shareLinks.isActive, true)
        ))
        .limit(1);

      if (existing.length === 0) {
        return res.json({ shareLink: null });
      }

      const link = existing[0];
      const baseUrl = req.headers['x-forwarded-host']
        ? `https://${req.headers['x-forwarded-host']}`
        : `${req.protocol}://${req.get('host')}`;

      res.json({
        shareLink: {
          token: link.token,
          url: `${baseUrl}/share/${link.token}`,
          cardSetId: link.cardSetId,
          id: link.id,
          createdAt: link.createdAt,
        },
      });
    } catch (error) {
      console.error("Error fetching share link:", error);
      res.status(500).json({ message: "Failed to fetch share link" });
    }
  });

  // GET /api/share/:token — PUBLIC endpoint, returns binder data for share page
  app.get("/api/share/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Check cache first
      const cached = shareLinkCache.get(token);
      if (cached && Date.now() - cached.timestamp < SHARE_CACHE_TTL) {
        return res.json(cached.data);
      }

      // 1) Find share link by token
      const [link] = await db
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.token, token))
        .limit(1);

      if (!link) {
        return res.status(404).json({ message: "Share link not found" });
      }

      if (!link.isActive) {
        return res.status(410).json({ message: "This share link has been revoked" });
      }

      // Update last_accessed_at (fire and forget)
      db.update(shareLinks)
        .set({ lastAccessedAt: new Date() })
        .where(eq(shareLinks.id, link.id))
        .then(() => {})
        .catch(() => {});

      // 2) Get card_set + main_set info
      const [setInfo] = await db
        .select({
          setId: cardSets.id,
          setName: cardSets.name,
          setSlug: cardSets.slug,
          setYear: cardSets.year,
          setImageUrl: cardSets.imageUrl,
          setTotalCards: cardSets.totalCards,
          mainSetId: mainSets.id,
          mainSetName: mainSets.name,
          mainSetSlug: mainSets.slug,
        })
        .from(cardSets)
        .leftJoin(mainSets, eq(cardSets.mainSetId, mainSets.id))
        .where(eq(cardSets.id, link.cardSetId))
        .limit(1);

      if (!setInfo) {
        return res.status(404).json({ message: "Card set not found" });
      }

      // 3) Get all cards in the set (ordered by card_number)
      const allCards = await db
        .select({
          id: cards.id,
          cardNumber: cards.cardNumber,
          name: cards.name,
          frontImageUrl: cards.frontImageUrl,
          isInsert: cards.isInsert,
          rarity: cards.rarity,
          variation: cards.variation,
        })
        .from(cards)
        .where(eq(cards.setId, link.cardSetId))
        .orderBy(cards.cardNumber);

      // 4) Get owned card IDs for this user in this set
      const ownedRows = await db
        .select({ cardId: userCollections.cardId })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(and(
          eq(userCollections.userId, link.userId),
          eq(cards.setId, link.cardSetId)
        ));

      const ownedCardIds = ownedRows.map(r => r.cardId);

      const responseData = {
        setInfo: {
          id: setInfo.setId,
          name: setInfo.setName,
          slug: setInfo.setSlug,
          year: setInfo.setYear,
          imageUrl: setInfo.setImageUrl,
          totalCards: setInfo.setTotalCards,
          mainSetId: setInfo.mainSetId,
          mainSetName: setInfo.mainSetName,
          mainSetSlug: setInfo.mainSetSlug,
        },
        cards: allCards,
        ownedCardIds,
        stats: {
          totalCards: allCards.length,
          ownedCount: ownedCardIds.length,
        },
      };

      // Cache the response
      shareLinkCache.set(token, { data: responseData, timestamp: Date.now() });

      res.json(responseData);
    } catch (error) {
      console.error("Error fetching share page data:", error);
      res.status(500).json({ message: "Failed to load shared binder" });
    }
  });

  // Register performance routes (includes background jobs and optimized endpoints)
  registerPerformanceRoutes(app);

  // Serve uploaded images
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Initialize email automation cron jobs
  startEmailCronJobs();
  console.log('Email automation jobs initialized');

  const httpServer = createServer(app);
  return httpServer;
}