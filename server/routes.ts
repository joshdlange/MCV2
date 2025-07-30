import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCardSetSchema, insertCardSchema, insertUserCollectionSchema, insertUserWishlistSchema, insertUserSchema, insertMainSetSchema, insertFriendSchema, insertMessageSchema, insertBadgeSchema, insertUserBadgeSchema } from "@shared/schema";
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
import { cards, cardSets } from "@shared/schema";
import { sql, eq, ilike } from "drizzle-orm";
import { findAndUpdateCardImage, batchUpdateCardImages } from "./ebay-image-finder";
import { registerPerformanceRoutes } from "./performance-routes";
import { badgeService } from "./badge-service";

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
        if (email === 'joshdlange045@gmail.com' && !user.isAdmin) {
          await storage.updateUser(user.id, { isAdmin: true });
          user = await storage.getUserByFirebaseUid(firebaseUid);
          console.log('Updated user admin status:', user?.isAdmin);
        }
      }
      
      // Check badges on login/sync
      await badgeService.checkBadgesOnLogin(user.id);
      
      // Run retroactive badge checks for new users
      if (!user.lastLogin) {
        await badgeService.runRetroactiveBadgeChecks(user.id);
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

  // Update card set (admin only)
  app.put("/api/card-sets/:id", authenticateUser, async (req: any, res) => {
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
  });

  // Get all cards with filters - OPTIMIZED
  app.get("/api/cards", async (req, res) => {
    try {
      const { optimizedStorage } = await import('./optimized-storage');
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      
      const filters: any = {};
      if (req.query.setId) filters.setId = parseInt(req.query.setId as string);
      if (req.query.rarity) filters.rarity = req.query.rarity as string;
      if (req.query.isInsert) filters.isInsert = req.query.isInsert === 'true';
      
      const result = await optimizedStorage.getCardsPaginated(page, pageSize, filters);
      res.json(result.items);
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
      res.status(201).json(card);
    } catch (error) {
      console.error('Create card error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create card" });
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
      
      // Check badges when collection changes
      await badgeService.checkBadgesOnCollectionChange(req.user.id);
      
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
      
      // Check badges when collection changes
      await badgeService.checkBadgesOnCollectionChange(req.user.id);
      
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

  // Marketplace
  app.get("/api/marketplace", async (req, res) => {
    try {
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

      const { optimizedStorage } = await import('./optimized-storage');
      
      const result = await optimizedStorage.getCardsPaginated(page, pageSize, {
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

      const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      await priceChartingImporter.startImport();
      
      res.json({ 
        message: "PriceCharting import started successfully", 
        status: "running" 
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

      const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      priceChartingImporter.stopImport();
      
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

      const { priceChartingImporter } = await import('./background-pricecharting-import');
      
      const progress = priceChartingImporter.getProgress();
      
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
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { findCOMCImageAndUpload } = await import('./comc-image-finder');
      
      // Check COMC configuration
      const ebayAppId = process.env.EBAY_APP_ID;
      const cloudinaryUrl = process.env.CLOUDINARY_URL;
      
      if (!ebayAppId || !cloudinaryUrl) {
        return res.status(400).json({ 
          message: "Configuration error", 
          missingConfig: ['EBAY_APP_ID', 'CLOUDINARY_URL'].filter(key => !process.env[key])
        });
      }

      const { limit, rateLimitMs } = req.body;
      const actualLimit = limit ? Math.min(parseInt(limit), 1000) : 50; // Max 1000 cards per request
      const actualRateLimit = rateLimitMs ? Math.max(parseInt(rateLimitMs), 500) : 1000; // Min 500ms
      
      console.log(`Starting COMC bulk image update with limit: ${actualLimit}, rate limit: ${actualRateLimit}ms`);
      
      // Get cards needing images
      const cardsNeedingImages = await db.execute(sql`
        SELECT c.id, c.name, c.card_number, cs.name as set_name
        FROM cards c
        JOIN card_sets cs ON c.set_id = cs.id  
        WHERE c.front_image_url IS NULL OR c.front_image_url = ''
        ORDER BY c.id
        LIMIT ${actualLimit}
      `);
      
      const totalCards = cardsNeedingImages.rows.length;
      console.log(`Found ${totalCards} cards needing images`);
      
      if (totalCards === 0) {
        return res.json({
          totalProcessed: 0,
          successCount: 0,
          failureCount: 0,
          message: "No cards found needing images"
        });
      }
      
      let successCount = 0;
      let failureCount = 0;
      
      // Process cards sequentially with rate limiting
      for (let i = 0; i < totalCards; i++) {
        const card = cardsNeedingImages.rows[i];
        
        try {
          console.log(`Processing card ${i + 1}/${totalCards}: ${card.name} (${card.card_number}) from ${card.set_name}`);
          
          const imageUrl = await findCOMCImageAndUpload(
            card.id,
            card.name,
            card.card_number,
            card.set_name
          );
          
          if (imageUrl) {
            successCount++;
            console.log(`✅ Success: Found image for ${card.name}`);
          } else {
            failureCount++;
            console.log(`❌ Failed: No image found for ${card.name}`);
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
      console.error('Bulk update error:', error);
      res.status(500).json({ message: "Failed to update missing images" });
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
      const { importPriceChartingCards } = await import('../scripts/complete-pricecharting-import.ts');
      
      // Execute the import for ALL sets
      const result = await importPriceChartingCards();

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
      res.status(201).json(userBadge);
    } catch (error) {
      console.error('Award badge error:', error);
      res.status(500).json({ message: "Failed to award badge" });
    }
  });

  // Register performance routes (includes background jobs and optimized endpoints)
  registerPerformanceRoutes(app);

  // Serve uploaded images
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  const httpServer = createServer(app);
  return httpServer;
}