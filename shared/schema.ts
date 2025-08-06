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
  profileVisibility: text("profile_visibility").default("public").notNull(), // public, friends, private
  lastLogin: timestamp("last_login"),
  loginStreak: integer("login_streak").default(0).notNull(),
  totalLogins: integer("total_logins").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mainSets = pgTable("main_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  thumbnailImageUrl: text("thumbnail_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cardSets = pgTable("card_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  year: integer("year").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  totalCards: integer("total_cards").default(0).notNull(),
  mainSetId: integer("main_set_id").references(() => mainSets.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  setId: integer("set_id").references(() => cardSets.id).notNull(),
  cardNumber: text("card_number").notNull(),
  name: text("name").notNull(),
  variation: text("variation"),
  isInsert: boolean("is_insert").default(false).notNull(),
  frontImageUrl: text("front_image_url"),
  backImageUrl: text("back_image_url"),
  description: text("description"),
  rarity: text("rarity").notNull(),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  lastImageSearchAttempt: timestamp("last_image_search_attempt"),
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

// Friends system
export const friends = pgTable("friends", {
  id: serial("id").primaryKey(),
  requesterId: integer("requester_id").references(() => users.id).notNull(),
  recipientId: integer("recipient_id").references(() => users.id).notNull(),
  status: text("status").default("pending").notNull(), // pending, accepted, declined
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Messages system
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").references(() => users.id).notNull(),
  recipientId: integer("recipient_id").references(() => users.id).notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Notifications system
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  type: text("type").notNull(), // 'badge_earned', 'friend_request', 'message', etc.
  title: text("title").notNull(),
  message: text("message").notNull(),
  data: text("data"), // JSON string for additional data
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Badges system
export const badges = pgTable("badges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  iconUrl: text("icon_url"),
  category: text("category").notNull(), // Collection, Social, Event, Achievement
  requirement: text("requirement").notNull(), // JSON string describing unlock condition
  rarity: text("rarity").default("bronze").notNull(), // bronze, silver, gold, platinum
  points: integer("points").default(10).notNull(),
  unlockHint: text("unlock_hint"), // User-friendly description of how to unlock
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User badges (earned badges)
export const userBadges = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  badgeId: integer("badge_id").references(() => badges.id).notNull(),
  earnedAt: timestamp("earned_at").defaultNow().notNull(),
});

// Relations
export const cardSetsRelations = relations(cardSets, ({ many }) => ({
  cards: many(cards),
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
  friendRequestsSent: many(friends, { relationName: "requester" }),
  friendRequestsReceived: many(friends, { relationName: "recipient" }),
  messagesSent: many(messages, { relationName: "sender" }),
  messagesReceived: many(messages, { relationName: "recipient" }),
  badges: many(userBadges),
}));

export const friendsRelations = relations(friends, ({ one }) => ({
  requester: one(users, {
    fields: [friends.requesterId],
    references: [users.id],
    relationName: "requester",
  }),
  recipient: one(users, {
    fields: [friends.recipientId],
    references: [users.id],
    relationName: "recipient",
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: "sender",
  }),
  recipient: one(users, {
    fields: [messages.recipientId],
    references: [users.id],
    relationName: "recipient",
  }),
}));

export const badgesRelations = relations(badges, ({ many }) => ({
  userBadges: many(userBadges),
}));

export const userBadgesRelations = relations(userBadges, ({ one }) => ({
  user: one(users, {
    fields: [userBadges.userId],
    references: [users.id],
  }),
  badge: one(badges, {
    fields: [userBadges.badgeId],
    references: [badges.id],
  }),
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

export const insertMainSetSchema = createInsertSchema(mainSets).omit({
  id: true,
  slug: true,
  createdAt: true,
});

export const insertCardSetSchema = createInsertSchema(cardSets).omit({
  id: true,
  slug: true,
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

export const insertFriendSchema = createInsertSchema(friends).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertBadgeSchema = createInsertSchema(badges).omit({
  id: true,
  createdAt: true,
});

export const insertUserBadgeSchema = createInsertSchema(userBadges).omit({
  id: true,
  earnedAt: true,
});

// Market Trends Tables
export const marketTrends = pgTable("market_trends", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(), // YYYY-MM-DD format
  averagePrice: decimal("average_price", { precision: 10, scale: 2 }).notNull(),
  totalSold: integer("total_sold").notNull(),
  highestSale: decimal("highest_sale", { precision: 10, scale: 2 }).notNull(),
  lowestSale: decimal("lowest_sale", { precision: 10, scale: 2 }).notNull(),
  percentChange: decimal("percent_change", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const marketTrendItems = pgTable("market_trend_items", {
  id: serial("id").primaryKey(),
  trendId: integer("trend_id").references(() => marketTrends.id).notNull(),
  title: text("title").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull(),
  imageUrl: text("image_url"),
  itemWebUrl: text("item_web_url"),
  category: text("category"),
  dayOverDayChange: decimal("day_over_day_change", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMarketTrendSchema = createInsertSchema(marketTrends).omit({
  id: true,
  createdAt: true,
});

export const insertMarketTrendItemSchema = createInsertSchema(marketTrendItems).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type MainSet = typeof mainSets.$inferSelect;
export type InsertMainSet = z.infer<typeof insertMainSetSchema>;

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

export type Friend = typeof friends.$inferSelect;
export type InsertFriend = z.infer<typeof insertFriendSchema>;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type Badge = typeof badges.$inferSelect;
export type InsertBadge = z.infer<typeof insertBadgeSchema>;

export type UserBadge = typeof userBadges.$inferSelect;
export type InsertUserBadge = z.infer<typeof insertUserBadgeSchema>;

export type MarketTrend = typeof marketTrends.$inferSelect;
export type InsertMarketTrend = z.infer<typeof insertMarketTrendSchema>;

export type MarketTrendItem = typeof marketTrendItems.$inferSelect;
export type InsertMarketTrendItem = z.infer<typeof insertMarketTrendItemSchema>;

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

// Extended types for social features
export type FriendWithUser = Friend & {
  requester: User;
  recipient: User;
};

export type MessageWithUsers = Message & {
  sender: User;
  recipient: User;
};

export type UserWithBadges = User & {
  badges: (UserBadge & { badge: Badge })[];
};

export type ProfileStats = {
  totalCards: number;
  totalValue: number;
  wishlistItems: number;
  friendsCount: number;
  badgesCount: number;
  completedSets: number;
  loginStreak: number;
};
