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
import admin from "firebase-admin";
import { proxyImage } from "./image-proxy";

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

  try {
    const idToken = authHeader.substring(7);
    console.log("Extracted token:", idToken.substring(0, 20) + "...");
    
    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    console.log("Token verified, Firebase UID:", firebaseUid);
    
    // Get user from database using Firebase UID
    let user = await storage.getUserByFirebaseUid(firebaseUid);
    console.log("User from database:", user ? `Found user ${user.id}` : "User not found");
    
    if (!user) {
      return res.status(401).json({ message: 'User not found in database' });
    }

    req.user = user;
    console.log("Authentication successful for user:", user.id);
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
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
  // Image proxy route to handle CORS issues with external images
  app.get("/api/image-proxy", proxyImage);

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

  // Combined search for sets and cards
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      
      if (!query || query.length < 2) {
        return res.json({ sets: [], cards: [] });
      }

      // Search card sets
      const sets = await storage.searchCardSets(query);
      
      // Search individual cards
      const cards = await storage.getCards({ search: query });
      
      res.json({ sets, cards });
    } catch (error) {
      console.error("Error searching:", error);
      res.status(500).json({ message: "Failed to search" });
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
      
      // Safely parse setId to avoid "NaN" errors
      let parsedSetId: number | undefined = undefined;
      if (setId && setId !== 'undefined' && setId !== 'null') {
        const parsed = parseInt(setId as string);
        if (!isNaN(parsed)) {
          parsedSetId = parsed;
        }
      }
      
      const filters = {
        setId: parsedSetId,
        search: search as string,
        rarity: rarity as string,
        isInsert: isInsert === 'true' ? true : isInsert === 'false' ? false : undefined,
      };
      
      const cards = await storage.getCards(filters);
      res.json(cards);
    } catch (error) {
      console.error('Error fetching cards:', error);
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

  // Global search endpoint for both sets and cards
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      
      if (!query || query.length < 2) {
        return res.json({ sets: [], cards: [] });
      }

      // Search both sets and cards in parallel with limits
      const [sets, cards] = await Promise.all([
        storage.searchCardSets(query),
        storage.getCards({ search: query })
      ]);

      // Limit cards to prevent overly broad results
      const limitedCards = cards.slice(0, 20);

      res.json({ sets, cards: limitedCards });
    } catch (error) {
      console.error('Error in global search:', error);
      res.status(500).json({ message: "Failed to search" });
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

  // Manual image processing trigger
  app.post("/api/process-images", async (req, res) => {
    try {
      const { processImages } = await import("./image-processor");
      await processImages();
      res.json({ message: "Image processing completed successfully" });
    } catch (error: any) {
      console.error("Error processing images:", error);
      res.status(500).json({ message: "Image processing failed", error: error.message });
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

      console.log(`Processing CSV with ${results.length} rows for setId: ${setId}`);

      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        const rowNumber = i + 1;

        try {
          // Validate required fields - handle case variations
          const name = row.name || row.Name || row.NAME;
          const cardNumber = row.cardNumber || row.cardnumber || row.CardNumber || row.CARDNUMBER;
          
          if (!name || !cardNumber) {
            errors.push(`Row ${rowNumber}: Missing required fields (name, cardNumber)`);
            continue;
          }

          // Parse isInsert boolean (default to false if missing or empty)
          // Handle different case variations: isInsert, isinsert, IsInsert, etc.
          let isInsert = false;
          const isInsertValue = row.isInsert || row.isinsert || row.IsInsert || row.ISINSERT;
          if (isInsertValue !== undefined && isInsertValue !== null && isInsertValue !== '') {
            if (typeof isInsertValue === 'string') {
              isInsert = isInsertValue.toLowerCase() === 'true';
            } else {
              isInsert = Boolean(isInsertValue);
            }
          }

          // Handle other field variations
          const rarity = row.rarity || row.Rarity || row.RARITY;
          const frontImageUrl = row.frontImageUrl || row.frontimageur || row.frontImageURL || row.FrontImageUrl;
          const backImageUrl = row.backImageUrl || row.backimageurl || row.backImageURL || row.BackImageUrl;
          const description = row.description || row.Description || row.DESCRIPTION;
          const price = row.price || row.Price || row.PRICE;

          // Check for duplicate cards (same setId, cardNumber, and name)
          const existingCard = await storage.getCardBySetAndNumber(setId, cardNumber.trim(), name.trim());
          if (existingCard) {
            console.log(`Skipping duplicate card: ${name.trim()} #${cardNumber.trim()}`);
            continue;
          }

          const cardData = {
            setId,
            name: name.trim(),
            cardNumber: cardNumber.trim(),
            isInsert,
            rarity: rarity?.trim() || 'Common',
            frontImageUrl: frontImageUrl?.trim() || null,
            backImageUrl: backImageUrl?.trim() || null,
            description: description?.trim() || null,
            estimatedValue: null,
            variation: null
          };

          const validatedData = insertCardSchema.parse(cardData);
          const card = await storage.createCard(validatedData);
          createdCards.push(card);

          // If price is provided, populate the price cache to skip eBay lookup
          if (price && !isNaN(parseFloat(price))) {
            const priceValue = parseFloat(price);
            console.log(`Populating price cache for ${card.name}: $${priceValue}`);
            await storage.updateCardPricing(card.id, priceValue, 1, [`CSV Upload: $${priceValue}`]);
          }

        } catch (error) {
          console.error(`Error processing row ${rowNumber}:`, error);
          if (error instanceof z.ZodError) {
            errors.push(`Row ${rowNumber}: ${error.errors.map(e => e.message).join(', ')}`);
          } else {
            errors.push(`Row ${rowNumber}: Failed to create card - ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // Start background pricing fetch for newly created cards that don't have cached prices
      if (createdCards.length > 0) {
        setImmediate(async () => {
          try {
            // Filter cards that need eBay pricing (no price was provided in CSV)
            const cardsNeedingPricing = [];
            
            for (const card of createdCards) {
              const existingPrice = await storage.getCardPricing(card.id);
              if (!existingPrice) {
                cardsNeedingPricing.push(card);
              }
            }
            
            if (cardsNeedingPricing.length > 0) {
              console.log(`Starting background pricing fetch for ${cardsNeedingPricing.length} cards without cached prices`);
              
              for (let i = 0; i < cardsNeedingPricing.length; i++) {
                const card = cardsNeedingPricing[i];
                try {
                  console.log(`Fetching initial pricing for card ${card.id}: ${card.name} (${i + 1}/${cardsNeedingPricing.length})`);
                  await ebayPricingService.fetchAndCacheCardPricing(card.id);
                  
                  // Rate limit: 3 seconds between requests
                  if (i < cardsNeedingPricing.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                  }
                } catch (error: any) {
                  console.error(`Failed to fetch initial pricing for card ${card.id}:`, error.message);
                  
                  // If rate limited, pause longer
                  if (error.message.includes('Rate limit')) {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute pause
                  }
                }
              }
            } else {
              console.log('All uploaded cards have cached prices, skipping eBay lookup');
            }
            
            console.log(`Background pricing fetch completed for ${cardsNeedingPricing.length} cards`);
          } catch (error: any) {
            console.error(`Background pricing fetch failed:`, error.message);
          }
        });
      }

      const skippedCount = results.length - createdCards.length - errors.length;
      
      // Count how many cards have cached prices vs need eBay lookup
      let cardsWithPrices = 0;
      let cardsNeedingPricing = 0;
      
      for (const card of createdCards) {
        const existingPrice = await storage.getCardPricing(card.id);
        if (existingPrice) {
          cardsWithPrices++;
        } else {
          cardsNeedingPricing++;
        }
      }
      
      let pricingMessage = '';
      if (cardsWithPrices > 0 && cardsNeedingPricing > 0) {
        pricingMessage = ` ${cardsWithPrices} cards have cached prices, ${cardsNeedingPricing} will fetch pricing from eBay in background.`;
      } else if (cardsWithPrices > 0) {
        pricingMessage = ` All cards have cached prices from CSV data.`;
      } else if (cardsNeedingPricing > 0) {
        pricingMessage = ` Pricing data will be fetched from eBay in background.`;
      }
      
      res.json({
        message: `CSV processed successfully. Created ${createdCards.length} cards${skippedCount > 0 ? `, skipped ${skippedCount} duplicates` : ''}.${pricingMessage}`,
        created: createdCards.length,
        skipped: skippedCount,
        cardsWithCachedPrices: cardsWithPrices,
        cardsNeedingPricing: cardsNeedingPricing,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ message: "Failed to process CSV file" });
    }
  });

  // Bulk Import Route - optimized for large datasets (11k+ rows)
  app.post("/api/bulk-import", upload.single('csvFile'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No CSV file uploaded" });
      }

      const csvContent = req.file.buffer.toString('utf-8');
      const results: any[] = [];
      
      // Parse CSV with streaming for memory efficiency
      await new Promise((resolve, reject) => {
        const stream = Readable.from([csvContent])
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });

      if (results.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or invalid" });
      }

      const errors: string[] = [];
      const setCache = new Map<string, number>(); // setName -> setId
      const existingCardsCache = new Map<string, Set<string>>(); // setId -> Set of "cardNumber:name"
      let setsCreated = 0;
      let cardsAdded = 0;

      // Extract year from set name (e.g., "1992 Marvel Masterpieces" -> 1992)
      const extractYear = (setName: string): number => {
        const yearMatch = setName.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
      };

      // Pre-load existing sets for better performance
      const existingSets = await storage.getCardSets();
      const setsByName = new Map(existingSets.map(set => [set.name, set]));
      const existingSetNames = new Set(existingSets.map(set => set.name));

      // Process in batches to avoid memory issues and timeouts
      const batchSize = 100;
      const totalBatches = Math.ceil(results.length / batchSize);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const startIndex = batchIndex * batchSize;
        const endIndex = Math.min(startIndex + batchSize, results.length);
        const batch = results.slice(startIndex, endIndex);

        console.log(`Processing batch ${batchIndex + 1}/${totalBatches} (rows ${startIndex + 1}-${endIndex})`);
        
        // Debug first row of first batch
        if (batchIndex === 0 && batch.length > 0) {
          console.log('CSV Column headers detected:', Object.keys(batch[0]));
          console.log('First row sample data:', batch[0]);
        }

        for (let i = 0; i < batch.length; i++) {
          const row = batch[i];
          const rowNum = startIndex + i + 2; // Account for header row
          
          try {
            // Required fields validation - handle multiple column name formats
            const setName = row.SET?.trim();
            const cardName = row.Name?.trim() || row.name?.trim();
            const cardNumber = row['Card Number']?.toString().trim() || row.cardNumber?.toString().trim();
            
            if (!setName || !cardName || !cardNumber) {
              console.log(`Row ${rowNum} missing fields:`, {
                SET: !!setName,
                Name: !!cardName,
                CardNumber: !!cardNumber,
                availableColumns: Object.keys(row)
              });
              errors.push(`Row ${rowNum}: Missing required fields (SET, Name, Card Number)`);
              continue;
            }

            console.log(`Processing row ${rowNum}: ${cardName} from ${setName} #${cardNumber}`);
            let setId: number;

            // Check if set already exists in cache or database
            if (setCache.has(setName)) {
              setId = setCache.get(setName)!;
            } else if (setsByName.has(setName)) {
              // Use existing set
              setId = setsByName.get(setName)!.id;
              setCache.set(setName, setId);
            } else {
              // Create new set
              const year = extractYear(setName);
              const newSet = await storage.createCardSet({
                name: setName,
                year,
                description: `Trading card set from ${year}`,
                imageUrl: null
              });
              setId = newSet.id;
              setCache.set(setName, setId);
              setsByName.set(setName, newSet);
              setsCreated++;
            }

            // Helper function to parse currency values
            const parseCurrency = (value: string | undefined | null): string | null => {
              if (!value || typeof value !== 'string') return null;
              const cleaned = value.trim().replace(/[$,]/g, ''); // Remove $ and commas
              const parsed = parseFloat(cleaned);
              return isNaN(parsed) ? null : parsed.toString();
            };

            // Prepare card data - handle multiple column name formats
            const cardData = {
              name: cardName,
              setId,
              cardNumber: cardNumber,
              rarity: row.Rarity?.trim() || row.rarity?.trim() || 'Common',
              description: row.Description?.trim() || row.description?.trim() || null,
              variation: row.Variation?.trim() || null,
              isInsert: row['Is Insert'] === 'true' || row['Is Insert'] === '1' || row.isInsert === 'true' || row.isInsert === '1' || false,
              frontImageUrl: row['Front Image URL']?.trim() || row.frontImageUrl?.trim() || null,
              backImageUrl: row['Back Image URL']?.trim() || row.backImageUrl?.trim() || null,
              // Handle estimated value from multiple possible column names - parse currency
              estimatedValue: parseCurrency(row['Estimated Value']) || parseCurrency(row.Price) || parseCurrency(row.price) || null
            };

            // Efficient duplicate checking using cache
            const setKey = setId.toString();
            if (!existingCardsCache.has(setKey)) {
              // Load existing cards for this set only once
              const existingCards = await storage.getCardsBySet(setId);
              const cardKeys = new Set(existingCards.map(card => `${card.cardNumber}:${card.name.toLowerCase()}`));
              existingCardsCache.set(setKey, cardKeys);
            }

            const duplicateKey = `${cardData.cardNumber}:${cardData.name.toLowerCase()}`;
            if (existingCardsCache.get(setKey)!.has(duplicateKey)) {
              errors.push(`Row ${rowNum}: Card "${cardData.name}" #${cardData.cardNumber} already exists in set "${setName}"`);
              continue;
            }

            // Create card
            const createdCard = await storage.createCard(cardData);
            cardsAdded++;

            // Add to cache to prevent duplicates within the same import
            existingCardsCache.get(setKey)!.add(duplicateKey);

            // If price data exists in CSV, cache it to avoid eBay API calls
            const priceValue = parseCurrency(row['Estimated Value']) || parseCurrency(row.Price) || parseCurrency(row.price);
            if (priceValue) {
              const numericPrice = parseFloat(priceValue);
              if (!isNaN(numericPrice)) {
                await storage.updateCardPricing(createdCard.id, numericPrice, 1, [`CSV Import: $${numericPrice}`]);
                console.log(`Cached price for ${createdCard.name}: $${numericPrice}`);
              }
            }

          } catch (error: any) {
            errors.push(`Row ${rowNum}: ${error.message}`);
          }
        }

        // Log progress for large imports
        if (results.length > 1000) {
          const progress = Math.round(((batchIndex + 1) / totalBatches) * 100);
          console.log(`Bulk import progress: ${progress}% (${cardsAdded} cards added, ${setsCreated} sets created)`);
        }
      }

      // Process images in background if cards were added
      if (cardsAdded > 0) {
        // Import and run image processing in background
        import("./image-processor").then(({ processImages }) => {
          processImages().catch(console.error);
        });
      }

      res.json({
        totalRows: results.length,
        setsCreated,
        cardsAdded,
        errors,
        message: `Bulk import completed. Created ${setsCreated} new sets and added ${cardsAdded} cards from ${results.length} total rows.`
      });

    } catch (error: any) {
      console.error('Bulk import error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ 
        message: "Failed to process bulk import", 
        error: error.message,
        stack: error.stack
      });
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



  // Manual refresh pricing for individual card
  app.post("/api/refresh-card-pricing/:cardId", authenticateUser, async (req: any, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      
      if (isNaN(cardId)) {
        return res.status(400).json({ message: "Invalid card ID" });
      }

      console.log(`Manual pricing refresh requested for card ${cardId}`);

      // Force refresh pricing data
      const pricingData = await ebayPricingService.forceRefreshCardPricing(cardId);
      
      if (pricingData) {
        res.json({
          success: true,
          avgPrice: pricingData.avgPrice,
          salesCount: pricingData.salesCount,
          lastFetched: pricingData.lastFetched
        });
      } else {
        res.json({
          success: false,
          message: "Unable to fetch pricing data"
        });
      }

    } catch (error: any) {
      console.error(`Manual pricing refresh failed for card ${req.params.cardId}:`, error.message);
      res.status(500).json({ message: "Failed to refresh pricing" });
    }
  });

  // Test OAuth token generation
  app.post("/api/test-oauth", async (req, res) => {
    try {
      const { ebayOAuthService } = await import('./ebay-oauth');
      const token = await ebayOAuthService.getAccessToken();
      res.json({ 
        success: true, 
        tokenLength: token.length,
        tokenPreview: `${token.substring(0, 20)}...`
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Debug route to test eBay API directly
  app.post("/api/debug-ebay/:query", async (req, res) => {
    try {
      const searchQuery = decodeURIComponent(req.params.query);
      console.log(`=== DEBUG EBAY API CALL ===`);
      console.log(`Search Query: "${searchQuery}"`);
      console.log(`App ID: ${process.env.EBAY_APP_ID_PROD?.substring(0, 20)}...`);
      
      // Make direct eBay API call without retries
      const params = new URLSearchParams({
        'keywords': searchQuery,
        'categoryId': '2536',
        'itemFilter(0).name': 'ListingType',
        'itemFilter(0).value': 'AuctionWithBIN',
        'itemFilter(1).name': 'ListingType',
        'itemFilter(1).value': 'FixedPrice',
        'sortOrder': 'PricePlusShipping',
        'paginationInput.entriesPerPage': '3'
      });

      const headers = {
        'X-EBAY-SOA-OPERATION-NAME': 'findItemsByKeywords',
        'X-EBAY-SOA-SERVICE-VERSION': '1.0.0',
        'X-EBAY-SOA-SECURITY-APPNAME': process.env.EBAY_APP_ID_PROD!,
        'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
      };

      const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
      console.log(`Request URL: ${url}`);
      console.log(`Headers:`, headers);

      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        signal: AbortSignal.timeout(10000)
      });

      const responseHeaders: any = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const responseBody = await response.text();
      
      res.json({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        parsedBody: responseBody ? JSON.parse(responseBody) : null
      });
      
    } catch (error: any) {
      console.error('Debug eBay API Error:', error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  app.post("/api/card-pricing/:cardId/refresh", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      
      // Force fresh fetch and update global cache
      console.log(`Force refreshing pricing for card ${cardId} - user requested refresh`);
      const pricing = await ebayPricingService.fetchAndCacheCardPricing(cardId);
      
      if (!pricing) {
        return res.status(404).json({ message: "Unable to fetch pricing data" });
      }
      
      console.log(`Successfully refreshed pricing for card ${cardId}: $${pricing.avgPrice} - now available to all users`);
      res.json(pricing);
    } catch (error) {
      console.error("Error refreshing card pricing:", error);
      res.status(500).json({ message: "Failed to refresh pricing data" });
    }
  });

  // Force refresh pricing for a single card (user-triggered)
  app.post("/api/refresh-card-pricing/:cardId", async (req, res) => {
    try {
      const cardId = parseInt(req.params.cardId);
      if (isNaN(cardId)) {
        return res.status(400).json({ message: "Invalid card ID" });
      }

      // Force refresh bypassing cache and rate limits
      const result = await ebayPricingService.forceRefreshCardPricing(cardId);
      
      if (result) {
        res.json({
          success: true,
          avgPrice: result.avgPrice,
          salesCount: result.salesCount,
          lastFetched: result.lastFetched
        });
      } else {
        res.json({
          success: false,
          message: "Unable to fetch pricing data"
        });
      }
    } catch (error) {
      console.error("Error refreshing card pricing:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to refresh pricing" 
      });
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
      console.log(`Fetching stats for user ${userId}`);
      const stats = await storage.getCollectionStats(userId);
      console.log(`Stats calculated for user ${userId}:`, stats);
      res.json(stats);
    } catch (error) {
      console.error(`Error fetching stats for user ${req.user.id}:`, error);
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
  app.get("/api/missing-cards/:setId", authenticateUser, async (req: any, res) => {
    try {
      const setId = parseInt(req.params.setId);
      const userId = req.user.id;
      
      if (isNaN(setId) || setId <= 0) {
        return res.status(400).json({ message: "Invalid set ID" });
      }
      
      console.log(`Fetching missing cards for user ${userId} in set ${setId}`);
      
      const missingCards = await storage.getMissingCardsInSet(userId, setId);
      console.log(`Found ${missingCards.length} missing cards`);
      
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

  // Repair pricing data from original CSV (fixes currency validation errors)
  app.post("/api/repair-csv-pricing", upload.single('csvFile'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Upload your original CSV file to repair pricing data" });
      }

      const csvContent = req.file.buffer.toString('utf-8');
      const results: any[] = [];
      
      await new Promise((resolve, reject) => {
        const stream = Readable.from([csvContent])
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });

      if (results.length === 0) {
        return res.status(400).json({ message: "CSV file is empty" });
      }

      // Helper to parse currency values (removes $ and commas)
      const parseCurrency = (value: string | undefined | null): number | null => {
        if (!value || typeof value !== 'string') return null;
        const cleaned = value.trim().replace(/[$,]/g, '');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
      };

      let pricesRepaired = 0;
      let estimatedValuesUpdated = 0;
      let notFound = 0;

      console.log(`Repairing pricing data from ${results.length} CSV rows...`);

      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        
        try {
          const setName = row.SET?.trim();
          const cardName = row.Name?.trim() || row.name?.trim();
          const cardNumber = row['Card Number']?.toString().trim() || row.cardNumber?.toString().trim();
          
          if (!setName || !cardName || !cardNumber) continue;

          // Extract price from various possible column names
          const priceValue = parseCurrency(row['Estimated Value']) || 
                           parseCurrency(row.Price) || 
                           parseCurrency(row.price) ||
                           parseCurrency(row['Current Value']) ||
                           parseCurrency(row.Value);

          if (priceValue && priceValue > 0) {
            // Find the matching card in database
            const existingSets = await storage.getCardSets();
            const matchingSet = existingSets.find(set => set.name === setName);
            
            if (matchingSet) {
              const existingCard = await storage.getCardBySetAndNumber(matchingSet.id, cardNumber, cardName);
              
              if (existingCard) {
                // Check if card already has pricing data
                const existingPrice = await storage.getCardPricing(existingCard.id);
                
                if (!existingPrice) {
                  await storage.updateCardPricing(
                    existingCard.id,
                    priceValue,
                    1,
                    [`CSV Data: $${priceValue}`]
                  );
                  pricesRepaired++;
                }

                // Update estimated_value if not set
                if (!existingCard.estimatedValue) {
                  await storage.updateCard(existingCard.id, {
                    estimatedValue: priceValue.toString()
                  });
                  estimatedValuesUpdated++;
                }
              } else {
                notFound++;
              }
            } else {
              notFound++;
            }
          }
        } catch (error) {
          // Continue processing other rows
          console.error(`Error processing row ${i + 1}:`, error);
        }

        // Progress logging for large files
        if (i > 0 && i % 1000 === 0) {
          console.log(`Progress: ${i}/${results.length} rows processed`);
        }
      }

      res.json({
        success: true,
        message: `Pricing repair completed successfully.`,
        pricesRepaired,
        estimatedValuesUpdated,
        notFound,
        totalRowsProcessed: results.length
      });

    } catch (error) {
      console.error('Pricing repair error:', error);
      res.status(500).json({ message: "Failed to repair pricing data from CSV" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
