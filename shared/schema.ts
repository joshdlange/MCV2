import { pgTable, text, serial, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  username: text("username").notNull(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  photoURL: text("photo_url"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  address: text("address"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  plan: text("plan").default("SIDE_KICK").notNull(), // SIDE_KICK or SUPER_HERO
  subscriptionStatus: text("subscription_status").default("active").notNull(), // active, cancelled, expired
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  showEmail: boolean("show_email").default(false).notNull(),
  showCollection: boolean("show_collection").default(true).notNull(),
  showWishlist: boolean("show_wishlist").default(true).notNull(),
  emailUpdates: boolean("email_updates").default(true).notNull(),
  priceAlerts: boolean("price_alerts").default(true).notNull(),
  friendActivity: boolean("friend_activity").default(true).notNull(),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cardSets = pgTable("card_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  totalCards: integer("total_cards").default(0).notNull(),
  parentSetId: integer("parent_set_id"),
  isMainSet: boolean("is_main_set").default(true).notNull(),
  subsetType: text("subset_type"), // e.g., "Gold Refractor", "Laser Refractor", etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  setId: integer("set_id").references(() => cardSets.id).notNull(),
  cardNumber: text("card_number").notNull(),
  name: text("name").notNull(),
  variation: text("variation"),
  subsetName: text("subset_name"),
  isInsert: boolean("is_insert").default(false).notNull(),
  frontImageUrl: text("front_image_url"),
  backImageUrl: text("back_image_url"),
  description: text("description"),
  rarity: text("rarity").notNull(),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userCollections = pgTable("user_collections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  condition: text("condition").default("Near Mint").notNull(),
  acquiredDate: timestamp("acquired_date").defaultNow().notNull(),
  personalValue: decimal("personal_value", { precision: 10, scale: 2 }),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
  isForSale: boolean("is_for_sale").default(false).notNull(),
  serialNumber: text("serial_number"),
  quantity: integer("quantity").default(1).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  notes: text("notes"),
});

export const userWishlists = pgTable("user_wishlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  priority: integer("priority").default(1).notNull(),
  maxPrice: decimal("max_price", { precision: 10, scale: 2 }),
  addedDate: timestamp("added_date").defaultNow().notNull(),
});

export const cardPriceCache = pgTable("card_price_cache", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  avgPrice: decimal("avg_price", { precision: 10, scale: 2 }),
  recentSales: text("recent_sales").array(),
  salesCount: integer("sales_count").default(0),
  lastFetched: timestamp("last_fetched").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const cardSetsRelations = relations(cardSets, ({ one, many }) => ({
  cards: many(cards),
  parentSet: one(cardSets, {
    fields: [cardSets.parentSetId],
    references: [cardSets.id],
  }),
  subsets: many(cardSets, {
    relationName: "parentSubset",
  }),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  set: one(cardSets, {
    fields: [cards.setId],
    references: [cardSets.id],
  }),
  userCollections: many(userCollections),
  userWishlists: many(userWishlists),
  priceCache: one(cardPriceCache, {
    fields: [cards.id],
    references: [cardPriceCache.cardId],
  }),
}));

export const cardPriceCacheRelations = relations(cardPriceCache, ({ one }) => ({
  card: one(cards, {
    fields: [cardPriceCache.cardId],
    references: [cards.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  collections: many(userCollections),
  wishlists: many(userWishlists),
}));

export const userCollectionsRelations = relations(userCollections, ({ one }) => ({
  user: one(users, {
    fields: [userCollections.userId],
    references: [users.id],
  }),
  card: one(cards, {
    fields: [userCollections.cardId],
    references: [cards.id],
  }),
}));

export const userWishlistsRelations = relations(userWishlists, ({ one }) => ({
  user: one(users, {
    fields: [userWishlists.userId],
    references: [users.id],
  }),
  card: one(cards, {
    fields: [userWishlists.cardId],
    references: [cards.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertCardSetSchema = createInsertSchema(cardSets).omit({
  id: true,
  createdAt: true,
  totalCards: true,
});

export const insertCardSchema = createInsertSchema(cards).omit({
  id: true,
  createdAt: true,
});

export const insertUserCollectionSchema = createInsertSchema(userCollections).omit({
  id: true,
  acquiredDate: true,
});

export const insertUserWishlistSchema = createInsertSchema(userWishlists).omit({
  id: true,
  addedDate: true,
});

export const insertCardPriceCacheSchema = createInsertSchema(cardPriceCache).omit({
  id: true,
  createdAt: true,
  lastFetched: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type CardSet = typeof cardSets.$inferSelect;
export type InsertCardSet = z.infer<typeof insertCardSetSchema>;

export type Card = typeof cards.$inferSelect;
export type InsertCard = z.infer<typeof insertCardSchema>;

export type UserCollection = typeof userCollections.$inferSelect;
export type InsertUserCollection = z.infer<typeof insertUserCollectionSchema>;

export type UserWishlist = typeof userWishlists.$inferSelect;
export type InsertUserWishlist = z.infer<typeof insertUserWishlistSchema>;

export type CardPriceCache = typeof cardPriceCache.$inferSelect;
export type InsertCardPriceCache = z.infer<typeof insertCardPriceCacheSchema>;

// Extended types for API responses
export type CardWithSet = Card & {
  set: CardSet;
};

export type CollectionItem = UserCollection & {
  card: CardWithSet;
};

export type WishlistItem = UserWishlist & {
  card: CardWithSet;
};

export type CollectionStats = {
  totalCards: number;
  insertCards: number;
  totalValue: number;
  wishlistItems: number;
  completedSets: number;
  recentAdditions: number;
  totalCardsGrowth: string;
  insertCardsGrowth: string;
  totalValueGrowth: string;
  wishlistGrowth: string;
};
