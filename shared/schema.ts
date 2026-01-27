import { pgTable, text, serial, integer, boolean, timestamp, decimal, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  photoURL: text("photo_url"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  instagramUrl: text("instagram_url"),
  whatnotUrl: text("whatnot_url"),
  ebayUrl: text("ebay_url"),
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
  onboardingComplete: boolean("onboarding_complete").default(false).notNull(),
  heardAbout: text("heard_about"),
  favoriteSets: text("favorite_sets").array(),
  marketingOptIn: boolean("marketing_opt_in").default(false).notNull(),
  lastLogin: timestamp("last_login"),
  loginStreak: integer("login_streak").default(0).notNull(),
  totalLogins: integer("total_logins").default(0).notNull(),
  lastInactivityEmailSent: timestamp("last_inactivity_email_sent"),
  lastWeeklyDigestSent: timestamp("last_weekly_digest_sent"),
  // Marketplace fields
  marketplaceSuspended: boolean("marketplace_suspended").default(false).notNull(),
  marketplaceSuspendedAt: timestamp("marketplace_suspended_at"),
  shippingAddressJson: text("shipping_address_json"), // JSON string for default shipping address
  sellerRating: decimal("seller_rating", { precision: 3, scale: 2 }),
  sellerReviewCount: integer("seller_review_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  email: text("email").notNull(),
  template: text("template").notNull(),
  subject: text("subject").notNull(),
  jobName: text("job_name"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
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
  alternateImages: text("alternate_images").array(),
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
  acquiredVia: text("acquired_via").default("manual").notNull(),
  personalValue: decimal("personal_value", { precision: 10, scale: 2 }),
  salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
  isForSale: boolean("is_for_sale").default(false).notNull(),
  serialNumber: text("serial_number"),
  quantity: integer("quantity").default(1).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  notes: text("notes"),
}, (table) => ({
  userIdIdx: index("user_collections_user_id_idx").on(table.userId),
  cardIdIdx: index("user_collections_card_id_idx").on(table.cardId),
  userCardIdx: uniqueIndex("user_collections_user_card_idx").on(table.userId, table.cardId),
}));

export const userWishlists = pgTable("user_wishlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  priority: integer("priority").default(1).notNull(),
  maxPrice: decimal("max_price", { precision: 10, scale: 2 }),
  addedDate: timestamp("added_date").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_wishlists_user_id_idx").on(table.userId),
  cardIdIdx: index("user_wishlists_card_id_idx").on(table.cardId),
  userCardIdx: uniqueIndex("user_wishlists_user_card_idx").on(table.userId, table.cardId),
}));

export const cardPriceCache = pgTable("card_price_cache", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  avgPrice: decimal("avg_price", { precision: 10, scale: 2 }),
  recentSales: text("recent_sales").array(),
  salesCount: integer("sales_count").default(0),
  lastFetched: timestamp("last_fetched").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User-submitted card images pending admin approval
export const pendingCardImages = pgTable("pending_card_images", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  frontImageUrl: text("front_image_url"),
  backImageUrl: text("back_image_url"),
  status: text("status").default("pending").notNull(), // pending, approved, rejected
  rejectionReason: text("rejection_reason"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
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

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({
  id: true,
  sentAt: true,
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

export const insertPendingCardImageSchema = createInsertSchema(pendingCardImages).omit({
  id: true,
  createdAt: true,
  status: true,
  reviewedAt: true,
  reviewedBy: true,
  rejectionReason: true,
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

// Upcoming Sets Table - Enhanced with full spec
export const upcomingSets = pgTable("upcoming_sets", {
  id: serial("id").primaryKey(),
  setName: text("set_name").notNull(),
  manufacturer: text("manufacturer"),
  productLine: text("product_line"),
  releaseDateEstimated: timestamp("release_date_estimated"),
  dateConfidence: text("date_confidence", { enum: ['estimated', 'confirmed'] }),
  status: text("status", { enum: ['upcoming', 'delayed', 'released'] }).default('upcoming').notNull(),
  format: text("format"),
  configuration: text("configuration"),
  msrp: decimal("msrp", { precision: 10, scale: 2 }),
  keyHighlights: text("key_highlights"),
  checklistUrl: text("checklist_url"),
  sourceUrl: text("source_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  interestCount: integer("interest_count").default(0).notNull(),
  lastVerifiedAt: timestamp("last_verified_at").defaultNow(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUpcomingSetSchema = createInsertSchema(upcomingSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  interestCount: true,
});

// ============================================
// MARKETPLACE TABLES
// ============================================

// Marketplace Listings
export const listings = pgTable("listings", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").references(() => users.id).notNull(),
  userCollectionId: integer("user_collection_id").references(() => userCollections.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  quantityAvailable: integer("quantity_available").default(1).notNull(),
  allowOffers: boolean("allow_offers").default(true).notNull(),
  description: text("description").notNull(),
  conditionSnapshot: text("condition_snapshot").notNull(),
  customImages: text("custom_images").array(),
  status: text("status").default("active").notNull(), // draft, active, sold, cancelled
  publishedAt: timestamp("published_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sellerIdIdx: index("listings_seller_id_idx").on(table.sellerId),
  cardIdIdx: index("listings_card_id_idx").on(table.cardId),
  statusIdx: index("listings_status_idx").on(table.status),
}));

// Offers on Listings
export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id").references(() => listings.id).notNull(),
  buyerId: integer("buyer_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  message: text("message"),
  status: text("status").default("pending").notNull(), // pending, accepted, declined, countered, withdrawn, expired
  counterAmount: decimal("counter_amount", { precision: 10, scale: 2 }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  listingIdIdx: index("offers_listing_id_idx").on(table.listingId),
  buyerIdIdx: index("offers_buyer_id_idx").on(table.buyerId),
  statusIdx: index("offers_status_idx").on(table.status),
}));

// Marketplace Orders
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  listingId: integer("listing_id").references(() => listings.id).notNull(),
  offerId: integer("offer_id").references(() => offers.id),
  buyerId: integer("buyer_id").references(() => users.id).notNull(),
  sellerId: integer("seller_id").references(() => users.id).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  itemPrice: decimal("item_price", { precision: 10, scale: 2 }).notNull(),
  shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }).notNull(),
  platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).notNull(),
  stripeFee: decimal("stripe_fee", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  sellerNet: decimal("seller_net", { precision: 10, scale: 2 }).notNull(),
  shippingLabelCost: decimal("shipping_label_cost", { precision: 10, scale: 2 }),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  shippingAddress: text("shipping_address").notNull(), // JSON string
  status: text("status").default("payment_pending").notNull(), // payment_pending, paid, needs_shipping, label_created, shipped, in_transit, delivered, complete, cancelled, refunded
  paymentStatus: text("payment_status").default("pending").notNull(), // pending, succeeded, failed, refunded
  payoutStatus: text("payout_status").default("not_eligible").notNull(), // not_eligible, eligible, requested, approved, paid, rejected, on_hold
  payoutRequestId: integer("payout_request_id"),
  deliveredSource: text("delivered_source"), // carrier, buyer_confirmed, auto_timeout
  cancelledReason: text("cancelled_reason"),
  shippedAt: timestamp("shipped_at"),
  deliveredAt: timestamp("delivered_at"),
  completedAt: timestamp("completed_at"),
  buyerConfirmationRequestedAt: timestamp("buyer_confirmation_requested_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  buyerIdIdx: index("orders_buyer_id_idx").on(table.buyerId),
  sellerIdIdx: index("orders_seller_id_idx").on(table.sellerId),
  statusIdx: index("orders_status_idx").on(table.status),
  listingIdIdx: index("orders_listing_id_idx").on(table.listingId),
  payoutStatusIdx: index("orders_payout_status_idx").on(table.payoutStatus),
}));

// Shipments (Shippo integration)
export const shipments = pgTable("shipments", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull().unique(),
  shippoShipmentId: text("shippo_shipment_id"),
  shippoRateId: text("shippo_rate_id"),
  shippoTransactionId: text("shippo_transaction_id"),
  labelUrl: text("label_url"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  carrier: text("carrier"),
  serviceLevel: text("service_level"),
  fromAddressSnapshot: text("from_address_snapshot").notNull(), // JSON string
  toAddressSnapshot: text("to_address_snapshot").notNull(), // JSON string
  parcelSnapshot: text("parcel_snapshot"), // JSON string (weight, dimensions)
  labelCost: decimal("label_cost", { precision: 10, scale: 2 }),
  status: text("status").default("pending").notNull(), // pending, rates_fetched, label_purchased, in_transit, delivered, exception
  purchasedAt: timestamp("purchased_at"),
  lastWebhookAt: timestamp("last_webhook_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Reviews
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => orders.id).notNull().unique(),
  reviewerId: integer("reviewer_id").references(() => users.id).notNull(),
  revieweeId: integer("reviewee_id").references(() => users.id).notNull(),
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  revieweeIdIdx: index("reviews_reviewee_id_idx").on(table.revieweeId),
}));

// Reports
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").references(() => users.id).notNull(),
  targetUserId: integer("target_user_id").references(() => users.id),
  listingId: integer("listing_id").references(() => listings.id),
  orderId: integer("order_id").references(() => orders.id),
  reason: text("reason").notNull(), // scam, inappropriate, counterfeit, harassment, other
  description: text("description"),
  status: text("status").default("open").notNull(), // open, under_review, resolved, dismissed
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  targetUserIdIdx: index("reports_target_user_id_idx").on(table.targetUserId),
  statusIdx: index("reports_status_idx").on(table.status),
}));

// Blocks
export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  blockerId: integer("blocker_id").references(() => users.id).notNull(),
  blockedUserId: integer("blocked_user_id").references(() => users.id).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  blockerIdIdx: index("blocks_blocker_id_idx").on(table.blockerId),
  blockedUserIdIdx: index("blocks_blocked_user_id_idx").on(table.blockedUserId),
  uniqueBlock: uniqueIndex("blocks_unique_idx").on(table.blockerId, table.blockedUserId),
}));

// Payout Batches
export const payoutBatches = pgTable("payout_batches", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").references(() => users.id).notNull(),
  dateRangeStart: timestamp("date_range_start").notNull(),
  dateRangeEnd: timestamp("date_range_end").notNull(),
  totalGross: decimal("total_gross", { precision: 10, scale: 2 }).notNull(),
  totalFees: decimal("total_fees", { precision: 10, scale: 2 }).notNull(),
  totalNet: decimal("total_net", { precision: 10, scale: 2 }).notNull(),
  orderCount: integer("order_count").notNull(),
  status: text("status").default("draft").notNull(), // draft, exported, paid
  csvUrl: text("csv_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Payout Batch Items (individual order payouts)
export const payoutBatchItems = pgTable("payout_batch_items", {
  id: serial("id").primaryKey(),
  payoutBatchId: integer("payout_batch_id").references(() => payoutBatches.id).notNull(),
  orderId: integer("order_id").references(() => orders.id).notNull().unique(),
  sellerId: integer("seller_id").references(() => users.id).notNull(),
  gross: decimal("gross", { precision: 10, scale: 2 }).notNull(),
  fees: decimal("fees", { precision: 10, scale: 2 }).notNull(),
  net: decimal("net", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Seller Payout Accounts (PayPal/Venmo info)
export const payoutAccounts = pgTable("payout_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  paypalEmail: text("paypal_email"),
  venmoHandle: text("venmo_handle"),
  preferredMethod: text("preferred_method").default("paypal").notNull(), // paypal, venmo
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Seller Payout Requests
export const payoutRequests = pgTable("payout_requests", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method").notNull(), // paypal, venmo
  destination: text("destination").notNull(), // email or handle
  status: text("status").default("requested").notNull(), // requested, approved, paid, rejected, on_hold
  breakdownJson: text("breakdown_json"), // JSON: list of order IDs and amounts included
  adminNotes: text("admin_notes"),
  processedBy: integer("processed_by").references(() => users.id),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sellerIdIdx: index("payout_requests_seller_id_idx").on(table.sellerId),
  statusIdx: index("payout_requests_status_idx").on(table.status),
}));

export const cardSetMigrations = pgTable("card_set_migrations", {
  id: serial("id").primaryKey(),
  legacySetId: integer("legacy_set_id").references(() => cardSets.id).notNull(),
  canonicalSetId: integer("canonical_set_id").references(() => cardSets.id).notNull(),
  confidence: integer("confidence").notNull(),
  reason: text("reason"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  legacySetIdIdx: index("card_set_migrations_legacy_set_id_idx").on(table.legacySetId),
  canonicalSetIdIdx: index("card_set_migrations_canonical_set_id_idx").on(table.canonicalSetId),
}));

// Marketplace Relations
export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  userCollection: one(userCollections, {
    fields: [listings.userCollectionId],
    references: [userCollections.id],
  }),
  card: one(cards, {
    fields: [listings.cardId],
    references: [cards.id],
  }),
  offers: many(offers),
  orders: many(orders),
}));

export const offersRelations = relations(offers, ({ one }) => ({
  listing: one(listings, {
    fields: [offers.listingId],
    references: [listings.id],
  }),
  buyer: one(users, {
    fields: [offers.buyerId],
    references: [users.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.id],
  }),
  offer: one(offers, {
    fields: [orders.offerId],
    references: [offers.id],
  }),
  buyer: one(users, {
    fields: [orders.buyerId],
    references: [users.id],
  }),
  seller: one(users, {
    fields: [orders.sellerId],
    references: [users.id],
  }),
  shipment: one(shipments),
  review: one(reviews),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  order: one(orders, {
    fields: [reviews.orderId],
    references: [orders.id],
  }),
  reviewer: one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
    relationName: "reviewer",
  }),
  reviewee: one(users, {
    fields: [reviews.revieweeId],
    references: [users.id],
    relationName: "reviewee",
  }),
}));

// Marketplace Insert Schemas
export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  quantityAvailable: true,
});

export const insertOfferSchema = createInsertSchema(offers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  orderNumber: true,
  deliveredAt: true,
  completedAt: true,
});

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  purchasedAt: true,
  lastWebhookAt: true,
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  resolvedBy: true,
  status: true,
  resolution: true,
});

export const insertBlockSchema = createInsertSchema(blocks).omit({
  id: true,
  createdAt: true,
});

export const insertPayoutBatchSchema = createInsertSchema(payoutBatches).omit({
  id: true,
  createdAt: true,
  paidAt: true,
  csvUrl: true,
});

export const insertPayoutBatchItemSchema = createInsertSchema(payoutBatchItems).omit({
  id: true,
  createdAt: true,
});

export const insertPayoutAccountSchema = createInsertSchema(payoutAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPayoutRequestSchema = createInsertSchema(payoutRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processedAt: true,
  processedBy: true,
});

// Marketplace Types
export type Listing = typeof listings.$inferSelect;
export type InsertListing = z.infer<typeof insertListingSchema>;

export type Offer = typeof offers.$inferSelect;
export type InsertOffer = z.infer<typeof insertOfferSchema>;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type Shipment = typeof shipments.$inferSelect;
export type InsertShipment = z.infer<typeof insertShipmentSchema>;

export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

export type Report = typeof reports.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;

export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;

export type PayoutBatch = typeof payoutBatches.$inferSelect;
export type InsertPayoutBatch = z.infer<typeof insertPayoutBatchSchema>;

export type PayoutBatchItem = typeof payoutBatchItems.$inferSelect;
export type InsertPayoutBatchItem = z.infer<typeof insertPayoutBatchItemSchema>;

export type PayoutAccount = typeof payoutAccounts.$inferSelect;
export type InsertPayoutAccount = z.infer<typeof insertPayoutAccountSchema>;

export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type InsertPayoutRequest = z.infer<typeof insertPayoutRequestSchema>;

// Extended Marketplace Types
export type ListingWithDetails = Listing & {
  seller: User;
  card: CardWithSet;
  userCollection: UserCollection;
};

export type OrderWithDetails = Order & {
  listing: Listing;
  buyer: User;
  seller: User;
  shipment?: Shipment;
  review?: Review;
};

export type OfferWithDetails = Offer & {
  listing: Listing;
  buyer: User;
};

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

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

export type PendingCardImage = typeof pendingCardImages.$inferSelect;
export type InsertPendingCardImage = z.infer<typeof insertPendingCardImageSchema>;

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

export type UpcomingSet = typeof upcomingSets.$inferSelect;
export type InsertUpcomingSet = z.infer<typeof insertUpcomingSetSchema>;

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
