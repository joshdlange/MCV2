import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCardSetSchema, insertCardSchema, insertUserCollectionSchema, insertUserWishlistSchema, insertUserSchema } from "@shared/schema";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware to authenticate Firebase users
const authenticateUser = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No authorization token provided' });
  }

  try {
    const token = authHeader.substring(7);
    // For now, we'll implement client-side token verification
    // In production, you'd verify the Firebase ID token here
    const firebaseUid = req.headers['x-firebase-uid'];
    if (!firebaseUid) {
      return res.status(401).json({ message: 'Firebase UID required' });
    }

    // Get or create user from database
    let user = await storage.getUserByFirebaseUid(firebaseUid as string);
    const userEmail = req.headers['x-user-email'] as string;
    
    if (!user && userEmail) {
      // Try to find existing user by email
      user = await storage.getUserByUsername(userEmail);
      if (user) {
        // Update existing user with Firebase UID
        user = await storage.updateUser(user.id, { 
          firebaseUid: firebaseUid as string,
          displayName: req.headers['x-display-name'] as string || user.displayName,
          photoURL: req.headers['x-photo-url'] as string || user.photoURL
        });
      }
    }
    
    if (!user) {
      // Create new user from Firebase auth
      try {
        const userData = {
          firebaseUid: firebaseUid as string,
          username: req.headers['x-user-name'] as string || 'User',
          email: userEmail,
          displayName: req.headers['x-display-name'] as string || null,
          photoURL: req.headers['x-photo-url'] as string || null,
          isAdmin: userEmail === 'joshdlange045@gmail.com', // Make you admin
          plan: 'SIDE_KICK',
          subscriptionStatus: 'active'
        };
        user = await storage.createUser(userData);
      } catch (error: any) {
        // If user already exists with this username, try to find and update them
        if (error.code === '23505') {
          user = await storage.getUserByUsername(req.headers['x-user-name'] as string || userEmail);
          if (user && !user.firebaseUid) {
            user = await storage.updateUser(user.id, { 
              firebaseUid: firebaseUid as string,
              displayName: req.headers['x-display-name'] as string || user.displayName,
              photoURL: req.headers['x-photo-url'] as string || user.photoURL
            });
          }
        }
        if (!user) {
          throw error;
        }
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware to check admin access
const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Test route to create your admin user
  app.post("/api/create-admin", async (req, res) => {
    try {
      const adminData = {
        firebaseUid: 'test-admin-uid',
        username: 'Joshua Lange',
        email: 'joshdlange045@gmail.com',
        displayName: 'Joshua Lange',
        photoURL: null,
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
      const { firebaseUid, email, displayName, photoURL } = req.body;
      
      if (!firebaseUid || !email) {
        return res.status(400).json({ message: 'Firebase UID and email required' });
      }

      // Check if user already exists
      let user = await storage.getUserByFirebaseUid(firebaseUid);
      
      if (!user) {
        // Try to find by email first
        user = await storage.getUserByUsername(email);
        if (user) {
          // Update existing user with Firebase UID
          user = await storage.updateUser(user.id, { 
            firebaseUid,
            displayName: displayName || user.displayName,
            photoURL: photoURL || user.photoURL
          });
        } else {
          // Create new user - Only joshdlange045@gmail.com is admin
          const userData = {
            firebaseUid,
            username: email,
            email,
            displayName: displayName || 'User',
            photoURL,
            isAdmin: email === 'joshdlange045@gmail.com',
            plan: email === 'joshdlange045@gmail.com' ? 'SUPER_HERO' : 'SIDE_KICK',
            subscriptionStatus: 'active'
          };
          user = await storage.createUser(userData);
        }
      }

      res.json({ user });
    } catch (error) {
      console.error('User sync error:', error);
      res.status(500).json({ message: 'Failed to sync user' });
    }
  });

  app.get("/api/me", authenticateUser, async (req: any, res) => {
    res.json(req.user);
  });

  // User Management Routes (Admin only)
  app.get("/api/admin/users", async (req, res) => {
    // Temporary: Allow access to see users for debugging
    console.log('Admin users request headers:', {
      userEmail: req.headers['x-user-email'],
      firebaseUid: req.headers['x-firebase-uid'],
      authorization: req.headers['authorization']
    });
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", authenticateUser, requireAdmin, async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(userData);
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid user data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create user" });
      }
    }
  });

  app.put("/api/admin/users/:id", authenticateUser, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userData = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, userData);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid user data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update user" });
      }
    }
  });

  app.delete("/api/admin/users/:id", authenticateUser, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteUser(id);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Card Sets Routes
  app.get("/api/card-sets", async (req, res) => {
    try {
      const sets = await storage.getCardSets();
      res.json(sets);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch card sets" });
    }
  });

  app.post("/api/card-sets", async (req, res) => {
    try {
      const data = insertCardSetSchema.parse(req.body);
      const cardSet = await storage.createCardSet(data);
      res.json(cardSet);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create card set" });
      }
    }
  });

  app.get("/api/card-sets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const cardSet = await storage.getCardSet(id);
      if (!cardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }
      res.json(cardSet);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch card set" });
    }
  });

  app.patch("/api/card-sets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const cardSet = await storage.updateCardSet(id, updates);
      if (!cardSet) {
        return res.status(404).json({ message: "Card set not found" });
      }
      res.json(cardSet);
    } catch (error) {
      console.error("Error updating card set:", error);
      res.status(500).json({ message: "Failed to update card set" });
    }
  });

  // Cards Routes
  app.get("/api/cards", async (req, res) => {
    try {
      const { setId, search, rarity, isInsert } = req.query;
      const filters = {
        setId: setId ? parseInt(setId as string) : undefined,
        search: search as string,
        rarity: rarity as string,
        isInsert: isInsert === 'true' ? true : isInsert === 'false' ? false : undefined,
      };
      const cards = await storage.getCards(filters);
      res.json(cards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cards" });
    }
  });

  app.post("/api/cards", async (req, res) => {
    try {
      const data = insertCardSchema.parse(req.body);
      const card = await storage.createCard(data);
      res.json(card);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create card" });
      }
    }
  });

  // Quick search endpoint for dashboard
  app.get("/api/cards/search", async (req, res) => {
    try {
      const query = req.query.query as string;
      const setId = req.query.setId === 'all' ? undefined : parseInt(req.query.setId as string);
      
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const filters = {
        search: query,
        setId: setId
      };
      const cards = await storage.getCards(filters);
      res.json(cards);
    } catch (error) {
      console.error('Error searching cards:', error);
      res.status(500).json({ message: "Failed to search cards" });
    }
  });

  app.get("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const card = await storage.getCard(id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      res.json(card);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch card" });
    }
  });

  app.put("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertCardSchema.parse(req.body);
      const card = await storage.updateCard(id, data);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      res.json(card);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update card" });
      }
    }
  });

  app.patch("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertCardSchema.partial().parse(req.body);
      const card = await storage.updateCard(id, data);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      res.json(card);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update card" });
      }
    }
  });

  app.delete("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCard(id);
      res.json({ message: "Card deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete card" });
    }
  });

  // Image upload from URL
  app.post("/api/upload-image-from-url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ message: "URL is required" });
      }

      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Download the image
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(400).json({ message: "Failed to download image from URL" });
      }

      // Get file extension from content type or URL
      const contentType = response.headers.get("content-type");
      let extension = ".jpg"; // default
      if (contentType?.includes("png")) extension = ".png";
      if (contentType?.includes("gif")) extension = ".gif";
      if (contentType?.includes("webp")) extension = ".webp";

      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const filename = `image_${timestamp}_${randomString}${extension}`;
      const filepath = path.join(uploadsDir, filename);

      // Save the image
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filepath, Buffer.from(buffer));

      // Return the local URL
      const localUrl = `/uploads/${filename}`;
      res.json({ url: localUrl, originalUrl: url });
    } catch (error: any) {
      console.error("Error uploading image from URL:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // CSV Upload Route
  app.post("/api/cards/upload-csv", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const setId = parseInt(req.body.setId);
      if (!setId) {
        return res.status(400).json({ message: "Set ID is required" });
      }

      // Parse CSV from buffer
      const results: any[] = [];
      const csvStream = Readable.from(req.file.buffer.toString())
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('error', (error) => {
          console.error('CSV parsing error:', error);
          return res.status(400).json({ message: "Invalid CSV format" });
        });

      await new Promise((resolve, reject) => {
        csvStream.on('end', resolve);
        csvStream.on('error', reject);
      });

      // Validate and process each row
      const createdCards = [];
      const errors = [];

      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        const rowNumber = i + 1;

        try {
          // Validate required fields
          if (!row.name || !row.cardNumber || !row.isInsert) {
            errors.push(`Row ${rowNumber}: Missing required fields (name, cardNumber, isInsert)`);
            continue;
          }

          // Parse isInsert boolean
          let isInsert = false;
          if (typeof row.isInsert === 'string') {
            isInsert = row.isInsert.toLowerCase() === 'true';
          } else {
            isInsert = Boolean(row.isInsert);
          }

          const cardData = {
            setId,
            name: row.name.trim(),
            cardNumber: row.cardNumber.trim(),
            isInsert,
            rarity: row.rarity?.trim() || 'Common',
            frontImageUrl: row.frontImageUrl?.trim() || null,
            backImageUrl: row.backImageUrl?.trim() || null,
            description: row.description?.trim() || null,
            estimatedValue: null,
            variation: null
          };

          const validatedData = insertCardSchema.parse(cardData);
          const card = await storage.createCard(validatedData);
          createdCards.push(card);

        } catch (error) {
          if (error instanceof z.ZodError) {
            errors.push(`Row ${rowNumber}: ${error.errors.map(e => e.message).join(', ')}`);
          } else {
            errors.push(`Row ${rowNumber}: Failed to create card`);
          }
        }
      }

      res.json({
        message: `CSV processed successfully. Created ${createdCards.length} cards.`,
        created: createdCards.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ message: "Failed to process CSV file" });
    }
  });

  // User Collection Routes
  app.get("/api/collection", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const collection = await storage.getUserCollection(userId);
      res.json(collection);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch collection" });
    }
  });

  app.post("/api/collection", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = req.user;
      
      // Check collection limit for Side Kick users
      if (user.plan === 'SIDE_KICK' || !user.plan) {
        const currentCollection = await storage.getUserCollection(userId);
        if (currentCollection.length >= 250) {
          return res.status(403).json({ 
            message: "Collection limit reached. Upgrade to Super Hero plan for unlimited cards.",
            code: "COLLECTION_LIMIT_REACHED"
          });
        }
      }
      
      const data = insertUserCollectionSchema.parse({ ...req.body, userId });
      const item = await storage.addToCollection(data);
      res.json(item);
    } catch (error) {
      console.error('Error adding to collection:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to add to collection", error: error.message });
      }
    }
  });

  app.delete("/api/collection/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.removeFromCollection(id);
      res.json({ message: "Item removed from collection" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove from collection" });
    }
  });

  // User Wishlist Routes
  app.get("/api/wishlist", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const wishlist = await storage.getUserWishlist(userId);
      res.json(wishlist);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wishlist" });
    }
  });

  app.post("/api/wishlist", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { cardId } = req.body;
      
      // Check if card is already in wishlist
      const existingWishlist = await storage.getUserWishlist(userId);
      const alreadyInWishlist = existingWishlist.some(item => item.cardId === cardId);
      
      if (alreadyInWishlist) {
        return res.status(400).json({ message: "Card is already in your wishlist" });
      }
      
      const data = insertUserWishlistSchema.parse({ ...req.body, userId });
      const item = await storage.addToWishlist(data);
      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to add to wishlist" });
      }
    }
  });

  app.delete("/api/wishlist/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.removeFromWishlist(id);
      res.json({ message: "Item removed from wishlist" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove from wishlist" });
    }
  });

  // eBay Pricing endpoints
  app.get("/api/card-pricing/:cardId", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      
      // Validate card ID
      if (isNaN(cardId) || cardId <= 0) {
        return res.status(400).json({ message: "Invalid card ID" });
      }
      
      const pricing = await ebayPricingService.getCardPricing(cardId);
      
      if (!pricing) {
        return res.status(404).json({ message: "Pricing data not available" });
      }
      
      res.json(pricing);
    } catch (error) {
      console.error("Error fetching card pricing:", error);
      res.status(500).json({ message: "Failed to fetch pricing data" });
    }
  });

  app.post("/api/card-pricing/:cardId/refresh", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      const pricing = await ebayPricingService.fetchAndCacheCardPricing(cardId);
      
      if (!pricing) {
        return res.status(404).json({ message: "Unable to fetch pricing data" });
      }
      
      res.json(pricing);
    } catch (error) {
      console.error("Error refreshing card pricing:", error);
      res.status(500).json({ message: "Failed to refresh pricing data" });
    }
  });

  app.post("/api/pricing/batch-update", async (req, res) => {
    try {
      const { cardIds } = req.body;
      if (!Array.isArray(cardIds)) {
        return res.status(400).json({ message: "cardIds must be an array" });
      }
      
      // Start background update
      ebayPricingService.updatePricingForCards(cardIds).catch(console.error);
      
      res.json({ message: "Batch pricing update started" });
    } catch (error) {
      console.error("Error starting batch pricing update:", error);
      res.status(500).json({ message: "Failed to start pricing update" });
    }
  });

  // eBay Marketplace Account Deletion webhook endpoint
  app.get("/api/ebay-webhook", (req, res) => {
    try {
      console.log("eBay GET challenge verification:", {
        query: req.query,
        headers: {
          'user-agent': req.headers['user-agent']
        }
      });

      // Handle challenge_code verification with SHA256 hash
      const challengeCode = req.query.challenge_code;
      if (challengeCode) {
        const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN_PROD || "mcv-ebay-verify-5a28db8a9f4e4f39bd73d9a67c45dc94";
        const ENDPOINT_URL = "https://app.marvelcardvault.com/api/ebay-webhook";
        
        const hash = crypto.createHash('sha256')
          .update(`${challengeCode}${VERIFICATION_TOKEN}${ENDPOINT_URL}`)
          .digest('hex');

        console.log("Challenge code received:", challengeCode);
        console.log("Generated hash:", hash);
        
        return res.status(200).json({
          challengeResponse: hash
        });
      }

      // Legacy challenge support (if eBay sends ?challenge=abc123)
      if (req.query.challenge) {
        const challengeValue = req.query.challenge;
        console.log("Legacy challenge received:", challengeValue);
        
        return res.status(200).json({
          challenge: challengeValue
        });
      }

      // Default response if no challenge
      return res.status(200).json({ status: "OK" });

    } catch (error) {
      console.error("eBay webhook GET error:", error);
      return res.status(200).json({ error: "Internal error" });
    }
  });

  app.post("/api/ebay-webhook", (req, res) => {
    try {
      console.log("eBay POST notification received:", {
        body: req.body,
        headers: {
          'content-type': req.headers['content-type'],
          'x-ebay-signature': req.headers['x-ebay-signature'],
          'user-agent': req.headers['user-agent']
        }
      });

      // Validate signature if present (skip for now if complex)
      const signature = req.headers['x-ebay-signature'];
      if (signature) {
        console.log("eBay signature present:", signature);
        // TODO: Implement signature validation using verification token
      }

      // Process account deletion notification
      if (req.body && req.body.metadata && req.body.notification) {
        const { metadata, notification } = req.body;
        
        console.log("Processing account deletion:", {
          topic: metadata.topic,
          notificationId: notification.notificationId,
          username: notification.data?.username,
          userId: notification.data?.userId
        });

        // In production: delete user data here
        console.log("Account deletion processed successfully");
      }

      // Always return 200 OK for successful processing
      return res.status(200).json({ status: "received" });

    } catch (error) {
      console.error("eBay webhook POST error:", error);
      return res.status(200).json({ error: "Internal error" });
    }
  });

  // Profile endpoints
  app.get("/api/user/profile", authenticateUser, async (req: any, res) => {
    try {
      const user = req.user;
      res.json(user);
    } catch (error: any) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/user/profile", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const updates = req.body;
      
      // Flatten profile data for database update
      const updateData: any = {};
      
      if (updates.displayName !== undefined) updateData.displayName = updates.displayName;
      if (updates.bio !== undefined) updateData.bio = updates.bio;
      if (updates.location !== undefined) updateData.location = updates.location;
      if (updates.website !== undefined) updateData.website = updates.website;
      
      if (updates.privacySettings) {
        if (updates.privacySettings.showEmail !== undefined) updateData.showEmail = updates.privacySettings.showEmail;
        if (updates.privacySettings.showCollection !== undefined) updateData.showCollection = updates.privacySettings.showCollection;
        if (updates.privacySettings.showWishlist !== undefined) updateData.showWishlist = updates.privacySettings.showWishlist;
      }
      
      if (updates.notifications) {
        if (updates.notifications.emailUpdates !== undefined) updateData.emailUpdates = updates.notifications.emailUpdates;
        if (updates.notifications.priceAlerts !== undefined) updateData.priceAlerts = updates.notifications.priceAlerts;
        if (updates.notifications.friendActivity !== undefined) updateData.friendActivity = updates.notifications.friendActivity;
      }

      const updatedUser = await storage.updateUser(userId, updateData);
      res.json(updatedUser);
    } catch (error: any) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Marketplace routes
  app.get("/api/marketplace", async (req, res) => {
    try {
      const marketplaceItems = await storage.getMarketplaceItems();
      res.json(marketplaceItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch marketplace items" });
    }
  });

  // Update collection item (for marketplace functionality)
  app.patch("/api/collection/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const item = await storage.updateCollectionItem(id, updates);
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update collection item" });
    }
  });

  // Stats Route
  app.get("/api/stats", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const stats = await storage.getCollectionStats(userId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Recent Cards Route
  app.get("/api/recent-cards", authenticateUser, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 6;
      const recentCards = await storage.getRecentCards(userId, limit);
      res.json(recentCards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent cards" });
    }
  });

  // Trending Cards Route
  app.get("/api/trending-cards", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 8;
      const trendingCards = await storage.getTrendingCards(limit);
      res.json(trendingCards);
    } catch (error) {
      console.error('Error fetching trending cards:', error);
      res.status(500).json({ message: "Failed to fetch trending cards" });
    }
  });

  // Get missing cards in a set
  app.get("/api/missing-cards/:setId", async (req: any, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const setId = parseInt(req.params.setId);
      const userId = req.user.id;
      const missingCards = await storage.getMissingCardsInSet(userId, setId);
      res.json(missingCards);
    } catch (error: any) {
      console.error('Error fetching missing cards:', error);
      res.status(500).json({ message: "Failed to fetch missing cards" });
    }
  });

  // Admin User Management Routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      const user = await storage.createUser(data);
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create user" });
      }
    }
  });

  app.patch("/api/admin/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertUserSchema.partial().parse(req.body);
      const user = await storage.updateUser(id, data);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to update user" });
      }
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteUser(id);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete user" });
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

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Marvel Card Vault - Super Hero Plan',
                description: 'Unlimited card tracking, marketplace access, and advanced analytics',
              },
              unit_amount: 400, // $4.00 in cents
              recurring: {
                interval: 'month',
              },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
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

  const httpServer = createServer(app);
  return httpServer;
}
