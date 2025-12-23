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
import { cards, cardSets, emailLogs, pendingCardImages, insertPendingCardImageSchema } from "../shared/schema";
import { sql, eq, ilike, and, or, isNull } from "drizzle-orm";
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
import { uploadUserCardImage, uploadMainSetThumbnail } from "./cloudinary";
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

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Health check endpoint for deployment
  app.get("/health", (req, res) => {
    res.json({ 
      status: "healthy",
      message: "Marvel Card Vault API is running",
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    });
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
        
        // Send welcome email to new user (non-blocking)
        emailTriggers.onUserSignup({
          email: user.email,
          displayName: user.displayName || user.username,
          username: user.username
        }).catch(error => {
          console.error('Failed to send welcome email:', error);
        });
        
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
      res.json(users);
    } catch (error) {
      console.error('Get admin users error:', error);
      res.status(500).json({ message: "Failed to fetch users" });
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

  // Main Sets Routes
  app.get("/api/main-sets", async (req, res) => {
    try {
      const mainSets = await storage.getMainSets();
      res.json(mainSets);
    } catch (error) {
      console.error('Get main sets error:', error);
      res.status(500).json({ message: "Failed to fetch main sets" });
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

  app.put("/api/main-sets/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const validatedData = insertMainSetSchema.partial().parse(req.body);
      const mainSet = await storage.updateMainSet(id, validatedData);
      
      if (!mainSet) {
        return res.status(404).json({ message: "Main set not found" });
      }
      
      res.json(mainSet);
    } catch (error) {
      console.error('Update main set error:', error);
      res.status(500).json({ message: "Failed to update main set" });
    }
  });

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

  // Get all main sets
  app.get("/api/main-sets", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const mainSets = await storage.getMainSets();
      res.json(mainSets);
    } catch (error) {
      console.error('Get main sets error:', error);
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
      const cards = await storage.getCardsBySet(setId);
      res.json(cards);
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

  app.put("/api/collection/:id", authenticateUser, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const updatedItem = await storage.updateCollectionItem(id, updates);
      if (!updatedItem) {
        return res.status(404).json({ message: "Collection item not found" });
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

  // Get missing cards for a specific set
  app.get("/api/missing-cards/:setId", authenticateUser, async (req: any, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const userId = req.user.id;
      
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
      
      res.json(missingCards);
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

      const { limit, rateLimitMs, skipRecentlyFailed = false, randomOrder = false } = req.body;
      console.log(`[DEBUG] Request parameters - limit: ${limit}, rateLimitMs: ${rateLimitMs}, skipRecentlyFailed: ${skipRecentlyFailed}, randomOrder: ${randomOrder}`);
      const actualLimit = limit ? Math.min(parseInt(limit), 1000) : 50; // Max 1000 cards per request
      const actualRateLimit = rateLimitMs ? Math.max(parseInt(rateLimitMs), 500) : 1000; // Min 500ms
      
      console.log(`[DEBUG] Starting COMC bulk image update with limit: ${actualLimit}, rate limit: ${actualRateLimit}ms`);
      
      // Smart ordering logic to avoid reprocessing failed cards
      let orderClause = 'ORDER BY c.id DESC'; // Default: newest cards first (avoids old failures)
      if (randomOrder) {
        orderClause = 'ORDER BY RANDOM()'; // Random order to avoid failed card clusters
        console.log(`[DEBUG] Using random order to avoid failed card clusters`);
      } else {
        console.log(`[DEBUG] Using DESC order to prioritize newer cards over old failures`);
      }
      
      // Get cards needing images - SKIP RECENTLY PROCESSED CARDS
      console.log(`[DEBUG] Executing database query for cards needing images (skipping recently processed)...`);
      let whereClause = `WHERE (c.front_image_url IS NULL OR c.front_image_url = '')`;
      
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

  // Stripe webhook endpoint to handle successful payments
  app.post('/api/stripe-webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      // In production, you should set STRIPE_WEBHOOK_SECRET
      event = stripe.webhooks.constructEvent(req.body, sig as string, process.env.STRIPE_WEBHOOK_SECRET || '');
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = parseInt(session.metadata?.userId || '0');
          
          if (userId && session.subscription) {
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

  // Register marketplace routes
  registerMarketplaceRoutes(app, authenticateUser);

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