import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCardSetSchema, insertCardSchema, insertUserCollectionSchema, insertUserWishlistSchema, insertUserSchema, insertMainSetSchema } from "@shared/schema";
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
import { cards } from "@shared/schema";
import { sql } from "drizzle-orm";
import { findAndUpdateCardImage, batchUpdateCardImages, testImageFinder } from "./ebay-image-finder";
import { registerPerformanceRoutes } from "./performance-routes";

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
      } else {
        console.log('Found existing user:', user.id, 'isAdmin:', user.isAdmin);
        
        // Ensure admin status is correct for known admin users
        if (email === 'joshdlange045@gmail.com' && !user.isAdmin) {
          await storage.updateUser(user.id, { isAdmin: true });
          user = await storage.getUserByFirebaseUid(firebaseUid);
          console.log('Updated user admin status:', user?.isAdmin);
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

  app.get("/api/main-sets/:id", authenticateUser, async (req: any, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const id = parseInt(req.params.id);
      const mainSet = await storage.getMainSet(id);
      
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
      res.status(201).json(mainSet);
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
      res.json(unassignedSets);
    } catch (error) {
      console.error('Get unassigned card sets error:', error);
      res.status(500).json({ message: "Failed to fetch unassigned card sets" });
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

  // Get card set by ID
  app.get("/api/card-sets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cardSet = await storage.getCardSet(id);
      
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

  // Get all cards with filters
  app.get("/api/cards", async (req, res) => {
    try {
      const filters: any = {};
      
      if (req.query.setId) filters.setId = parseInt(req.query.setId as string);
      if (req.query.search) filters.search = req.query.search as string;
      if (req.query.rarity) filters.rarity = req.query.rarity as string;
      if (req.query.isInsert) filters.isInsert = req.query.isInsert === 'true';
      
      const cards = await storage.getCards(filters);
      res.json(cards);
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

  // User collection routes
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
      res.json({ message: "Card removed from collection" });
    } catch (error) {
      console.error('Remove from collection error:', error);
      res.status(500).json({ message: "Failed to remove card from collection" });
    }
  });

  // User wishlist routes
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

  // Stats and analytics
  app.get("/api/stats", authenticateUser, async (req: any, res) => {
    try {
      const stats = await storage.getCollectionStats(req.user.id);
      res.json(stats);
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/recent-cards", authenticateUser, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 24; // Increased to fill dashboard space
      const recentCards = await storage.getRecentCards(req.user.id, limit);
      res.json(recentCards);
    } catch (error) {
      console.error('Get recent cards error:', error);
      res.status(500).json({ message: "Failed to fetch recent cards" });
    }
  });

  app.get("/api/trending-cards", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const trendingCards = await storage.getTrendingCards(limit);
      res.json(trendingCards);
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
      
      await proxyImage(imageUrl, res);
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

  // Register performance routes (includes background jobs and optimized endpoints)
  registerPerformanceRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}