import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCardSetSchema, insertCardSchema, insertUserCollectionSchema, insertUserWishlistSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
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

  app.delete("/api/cards/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCard(id);
      res.json({ message: "Card deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete card" });
    }
  });

  // User Collection Routes
  app.get("/api/collection", async (req, res) => {
    try {
      // Mock user ID - in real app this would come from session
      const userId = 1;
      const collection = await storage.getUserCollection(userId);
      res.json(collection);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch collection" });
    }
  });

  app.post("/api/collection", async (req, res) => {
    try {
      const userId = 1; // Mock user ID
      const data = insertUserCollectionSchema.parse({ ...req.body, userId });
      const item = await storage.addToCollection(data);
      res.json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to add to collection" });
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
  app.get("/api/wishlist", async (req, res) => {
    try {
      const userId = 1; // Mock user ID
      const wishlist = await storage.getUserWishlist(userId);
      res.json(wishlist);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wishlist" });
    }
  });

  app.post("/api/wishlist", async (req, res) => {
    try {
      const userId = 1; // Mock user ID
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

  // Stats Route
  app.get("/api/stats", async (req, res) => {
    try {
      const userId = 1; // Mock user ID
      const stats = await storage.getCollectionStats(userId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Recent Cards Route
  app.get("/api/recent-cards", async (req, res) => {
    try {
      const userId = 1; // Mock user ID
      const limit = parseInt(req.query.limit as string) || 6;
      const recentCards = await storage.getRecentCards(userId, limit);
      res.json(recentCards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent cards" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
