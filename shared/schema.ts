import { pgTable, text, serial, integer, boolean, timestamp, decimal, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Collection card limit for Side Kick (non-Super Hero) plans.
// Single source of truth — used by server enforcement and all client checks/copy.
export const SIDE_KICK_CARD_LIMIT = 500;

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
  trustedUploader: boolean("trusted_uploader").default(false).notNull(),
  plan: text("plan").default("SIDE_KICK").notNull(), // SIDE_KICK or SUPER_HERO
  subscriptionStatus: text("subscription_status").default("active").notNull(), // active, cancelled, expired
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  appleOriginalTransactionId: text("apple_original_transaction_id"),
  appleUserId: text("apple_user_id").unique(),
  showEmail: boolean("show_email").default(true).notNull(),
  showCollection: boolean("show_collection").default(true).notNull(),
  showWishlist: boolean("show_wishlist").default(true).notNull(),
  showImageAttribution: boolean("show_image_attribution").default(true).notNull(),
  emailUpdates: boolean("email_updates").default(true).notNull(),
  priceAlerts: boolean("price_alerts").default(true).notNull(),
  friendActivity: boolean("friend_activity").default(true).notNull(),
  profileVisibility: text("profile_visibility").default("public").notNull(), // public, friends, private
  onboardingComplete: boolean("onboarding_complete").default(false).notNull(),
  heardAbout: text("heard_about"),
  favoriteSets: text("favorite_sets").array(),
  marketingOptIn: boolean("marketing_opt_in").default(true).notNull(),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  // Organic-funnel attribution: the PC binder share token that brought this
  // user in, captured at account creation only (never user-editable — must
  // NOT be added to the PUT /api/users allowlist).
  signupShareToken: text("signup_share_token"),
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
  // Collector Profile Customization v1 (social/feed foundation).
  // Reuses displayName, bio (tagline) and profileVisibility; these are additive.
  collectorAvatarKey: text("collector_avatar_key"),
  collectorFocus: text("collector_focus"),
  allowFollowers: boolean("allow_followers").default(true).notNull(),
  showActivityInFeed: boolean("show_activity_in_feed").default(true).notNull(),
  profileCustomizationCompletedAt: timestamp("profile_customization_completed_at"),
  profileCustomizationDismissedAt: timestamp("profile_customization_dismissed_at"),
  profileCustomizationSkips: integer("profile_customization_skips").notNull().default(0),
  // First time the user became a paying subscriber (set by DB trigger on plan
  // transition to SUPER_HERO; backfilled from Stripe for pre-existing subs).
  upgradedAt: timestamp("upgraded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  email: text("email").notNull(),
  template: text("template").notNull(),
  subject: text("subject").notNull(),
  jobName: text("job_name"),
  // Lifecycle email tracking (Aug 2026): status lifecycle for claim-then-send
  // ('sending' → 'sent' | 'failed'), provider message id, and failure detail.
  // Legacy rows default to 'sent'. A partial unique index on
  // (job_name, lower(trim(email))) WHERE job_name LIKE 'lifecycle-%' makes
  // lifecycle sends duplicate-proof at the database level.
  status: text("status").default("sent").notNull(),
  lifecycleStage: text("lifecycle_stage"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
}, (table) => ({
  providerMessageIdIdx: index("email_logs_provider_msg_idx")
    .on(table.providerMessageId)
    .where(sql`${table.providerMessageId} IS NOT NULL`),
}));

// One-time service recovery for accounts blocked by the pre-August-2026
// Unicode-in-request-headers onboarding bug. The exact cohort is frozen by
// user ID in the worker; one row owns both the Stripe grant and email state so
// production restarts can safely resume without duplicating either.
export const onboardingCompensationGrants = pgTable("onboarding_compensation_grants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  campaign: text("campaign").notNull(),
  offerMonths: integer("offer_months").notNull(),
  promotionCode: text("promotion_code").notNull(),
  stripeCouponId: text("stripe_coupon_id"),
  stripePromotionCodeId: text("stripe_promotion_code_id"),
  status: text("status").default("pending").notNull(),
  emailLogId: integer("email_log_id"),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  recipientCampaignIdx: uniqueIndex("onboarding_comp_grant_user_campaign_idx")
    .on(table.userId, table.campaign),
  promotionCodeIdx: uniqueIndex("onboarding_comp_grant_promo_code_idx")
    .on(table.promotionCode),
}));

// Resend webhook engagement events (opened / clicked / bounced / complained).
// One row per (provider message id, event type) — repeat opens don't inflate
// counts. Joined to email_logs.provider_message_id for per-template stats.
// Table is created at startup via CREATE TABLE IF NOT EXISTS (db:push is
// blocked in this repo).
export const emailEvents = pgTable("email_events", {
  id: serial("id").primaryKey(),
  providerMessageId: text("provider_message_id").notNull(),
  eventType: text("event_type").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Durable account-deletion saga. Identity fields exist only while deletion or
// its required notifications are pending; they are nulled when the job
// completes. There is deliberately no FK to users so the job survives removal.
export const accountDeletionJobs = pgTable("account_deletion_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  firebaseUid: text("firebase_uid"),
  username: text("username"),
  email: text("email"),
  displayName: text("display_name"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  appleOriginalTransactionId: text("apple_original_transaction_id"),
  source: text("source").notNull(),
  actorUserId: integer("actor_user_id"),
  actorEmail: text("actor_email"),
  status: text("status").default("pending").notNull(),
  stripeCancelledAt: timestamp("stripe_cancelled_at"),
  firebaseDeletedAt: timestamp("firebase_deleted_at"),
  dataDeletedAt: timestamp("data_deleted_at"),
  userConfirmationSentAt: timestamp("user_confirmation_sent_at"),
  adminNoticeSentAt: timestamp("admin_notice_sent_at"),
  lastError: text("last_error"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// HMAC hashes only, never raw deleted addresses. Suppression is permanent
// because delayed/replayed provider events must never recreate deleted PII.
export const accountDeletionEmailSuppressions = pgTable(
  "account_deletion_email_suppressions",
  {
    recipientHash: text("recipient_hash").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export const mainSets = pgTable("main_sets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  notes: text("notes"),
  thumbnailImageUrl: text("thumbnail_image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  isCanonical: boolean("is_canonical").default(false).notNull(),
  canonicalSource: text("canonical_source"),
  archivedAt: timestamp("archived_at"),
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
  isActive: boolean("is_active").default(true).notNull(),
  isCanonical: boolean("is_canonical").default(false).notNull(),
  isInsertSubset: boolean("is_insert_subset").default(false).notNull(),
  canonicalSource: text("canonical_source"),
  archivedAt: timestamp("archived_at"),
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
  archivedAt: timestamp("archived_at"),
  archiveReason: text("archive_reason"),
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

// XP ledger — decoupled append-only event log (no FK refs so it never blocks
// card/user deletion). Source of truth for card_added / set_completed XP.
// Badge & image XP stay derived (see server/services/xpService.ts). The unique
// index makes card_added farm-proof: re-adding the same card is a no-op insert.
export const xpEvents = pgTable("xp_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(), // card_added | image_approved | badge_earned | set_completed | subset_binder_share_first | subset_binder_share_daily
  cardId: integer("card_id"),
  cardSetId: integer("card_set_id"), // metadata for binder-share events (no FK — ledger stays decoupled)
  imageSubmissionId: integer("image_submission_id"),
  badgeId: integer("badge_id"),
  feedEventId: integer("feed_event_id"), // set for feed_reaction XP claims
  points: integer("points").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("xp_events_user_id_idx").on(table.userId),
  userCreatedIdx: index("xp_events_user_created_idx").on(table.userId, table.createdAt),
  userEventCardIdx: uniqueIndex("xp_events_user_event_card_idx").on(table.userId, table.eventType, table.cardId),
  // Lifetime dedupe for the one-time first-share bonus (card_id is NULL for
  // share events, so the index above cannot dedupe them — NULLs are distinct).
  shareFirstIdx: uniqueIndex("xp_events_share_first_idx")
    .on(table.userId)
    .where(sql`event_type = 'subset_binder_share_first'`),
  // One feed_reaction XP claim per (user, feed event) — ever. Toggling or
  // changing a reaction can never earn XP twice.
  feedReactionIdx: uniqueIndex("xp_events_feed_reaction_idx")
    .on(table.userId, table.feedEventId)
    .where(sql`event_type = 'feed_reaction'`),
}));

// Feed v1 — app-generated activity events (no freeform posts/comments).
// Decoupled like xp_events: no FKs so it never blocks user/card deletion.
// dedupe_key makes emission + backfill idempotent (unique, ON CONFLICT DO NOTHING).
export const feedEvents = pgTable("feed_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  eventType: text("event_type").notNull(), // first_card | collection_milestone | binder_created | binder_shared | badge_earned | level_milestone | image_approved
  title: text("title").notNull(),
  metadata: text("metadata"), // JSON string (milestone number, badge name, binder name, etc.)
  relatedType: text("related_type"), // badge | binder | card | share_link
  relatedId: integer("related_id"),
  visibility: text("visibility").notNull().default("public"),
  hidden: boolean("hidden").notNull().default(false), // admin archive
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdIdx: index("feed_events_created_idx").on(table.createdAt),
  userIdx: index("feed_events_user_idx").on(table.userId),
  dedupeIdx: uniqueIndex("feed_events_dedupe_idx").on(table.dedupeKey),
}));

// One active reaction per user per feed event (change = update reaction_type).
export const feedReactions = pgTable("feed_reactions", {
  id: serial("id").primaryKey(),
  feedEventId: integer("feed_event_id").notNull(),
  userId: integer("user_id").notNull(),
  reactionType: text("reaction_type").notNull(), // fire_pull | hero_move | need_this | vault_worthy
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  eventUserIdx: uniqueIndex("feed_reactions_event_user_idx").on(table.feedEventId, table.userId),
  eventIdx: index("feed_reactions_event_idx").on(table.feedEventId),
  userIdx: index("feed_reactions_user_idx").on(table.userId),
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
  source: text("source").default("manual_upload").notNull(), // manual_upload, scan_to_add
  rejectionReason: text("rejection_reason"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Follow system v1 — one-way follows; mutual follows = Friends.
// Created via idempotent startup DDL in server/index.ts (db:push is unusable).
export const follows = pgTable("follows", {
  id: serial("id").primaryKey(),
  followerUserId: integer("follower_user_id").references(() => users.id).notNull(),
  followingUserId: integer("following_user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  followerIdx: index("follows_follower_idx").on(table.followerUserId),
  followingIdx: index("follows_following_idx").on(table.followingUserId),
  createdAtIdx: index("follows_created_at_idx").on(table.createdAt),
  uniqueFollow: uniqueIndex("follows_unique_idx").on(table.followerUserId, table.followingUserId),
}));

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
  // TRUE when the badge was granted by a bulk/retro startup seed rather than
  // earned live. Retro awards must stay quiet: feed backfill skips them.
  retro: boolean("retro").default(false).notNull(),
}, (table) => [
  // Matches the existing DB index user_badges_unique_user_badge; awardBadge's
  // ON CONFLICT (user_id, badge_id) depends on it.
  uniqueIndex("user_badges_unique_user_badge").on(table.userId, table.badgeId),
]);

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

export const insertXpEventSchema = createInsertSchema(xpEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertXpEvent = z.infer<typeof insertXpEventSchema>;
export type XpEvent = typeof xpEvents.$inferSelect;

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

// Upcoming Set Intelligence: admin-only detection candidates. Rows here are
// NEVER user-facing — an admin must approve a candidate into upcoming_sets.
export const upcomingSetCandidates = pgTable("upcoming_set_candidates", {
  id: serial("id").primaryKey(),
  detectedSetName: text("detected_set_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  manufacturer: text("manufacturer"),
  year: integer("year"),
  estimatedReleaseDate: timestamp("estimated_release_date"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(), // rss | shop | blog | checklist
  confidence: integer("confidence").notNull(), // 0-100
  checklistUrl: text("checklist_url"),
  imageUrl: text("image_url"),
  description: text("description"),
  possibleDuplicateOf: text("possible_duplicate_of"), // matched existing upcoming set / card set name
  status: text("status", { enum: ['pending', 'approved', 'ignored', 'duplicate', 'needs_review'] }).default('pending').notNull(),
  adminNotes: text("admin_notes"),
  approvedUpcomingSetId: integer("approved_upcoming_set_id"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("upcoming_set_candidates_normalized_name_idx").on(table.normalizedName),
]);

export const setIntelScanLogs = pgTable("set_intel_scan_logs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  trigger: text("trigger").default('manual').notNull(),
  sourceResults: text("source_results"), // JSON: per-source {source, ok, itemsSeen, marvelMatches, created, error}
  candidatesCreated: integer("candidates_created").default(0).notNull(),
  sourceFailures: integer("source_failures").default(0).notNull(),
});

export const upcomingSetInterests = pgTable("upcoming_set_interests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  upcomingSetId: integer("upcoming_set_id").references(() => upcomingSets.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --------------------------------------------
// MARKETPLACE TABLES
// --------------------------------------------

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

export const migrationLogs = pgTable("migration_logs", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").references(() => users.id),
  sourceSetId: integer("source_set_id").references(() => cardSets.id).notNull(),
  destinationSetId: integer("destination_set_id").references(() => cardSets.id).notNull(),
  movedCardCount: integer("moved_card_count").notNull(),
  insertForced: boolean("insert_forced").default(false).notNull(),
  conflictCount: integer("conflict_count").default(0).notNull(),
  sourceArchived: boolean("source_archived").default(false).notNull(),
  notes: text("notes"),
  status: text("status").default("completed").notNull(), // completed, completed_with_conflicts, failed, rolled_back
  rolledBackAt: timestamp("rolled_back_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  adminUserIdIdx: index("migration_logs_admin_user_id_idx").on(table.adminUserId),
  sourceSetIdIdx: index("migration_logs_source_set_id_idx").on(table.sourceSetId),
  destinationSetIdIdx: index("migration_logs_destination_set_id_idx").on(table.destinationSetId),
}));

export const migrationLogCards = pgTable("migration_log_cards", {
  id: serial("id").primaryKey(),
  migrationLogId: integer("migration_log_id").references(() => migrationLogs.id).notNull(),
  cardId: integer("card_id").references(() => cards.id).notNull(),
  oldSetId: integer("old_set_id").references(() => cardSets.id).notNull(),
  newSetId: integer("new_set_id").references(() => cardSets.id).notNull(),
  oldIsInsert: boolean("old_is_insert").notNull(),
  newIsInsert: boolean("new_is_insert").notNull(),
}, (table) => ({
  migrationLogIdIdx: index("migration_log_cards_migration_log_id_idx").on(table.migrationLogId),
  cardIdIdx: index("migration_log_cards_card_id_idx").on(table.cardId),
}));

// Admin Audit Log for tracking administrative actions (archives, deletes, etc.)
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").references(() => users.id),
  actionType: text("action_type").notNull(), // archive_set, delete_set, unarchive_set, etc.
  entityType: text("entity_type").notNull(), // card_set, main_set, card, etc.
  entityId: integer("entity_id").notNull(),
  entityName: text("entity_name"), // for reference after deletion
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  adminUserIdIdx: index("admin_audit_logs_admin_user_id_idx").on(table.adminUserId),
  actionTypeIdx: index("admin_audit_logs_action_type_idx").on(table.actionType),
  createdAtIdx: index("admin_audit_logs_created_at_idx").on(table.createdAt),
}));

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;

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

export const insertMigrationLogSchema = createInsertSchema(migrationLogs).omit({
  id: true,
  createdAt: true,
  rolledBackAt: true,
});

export const insertMigrationLogCardSchema = createInsertSchema(migrationLogCards).omit({
  id: true,
});

// Migration Types
export type MigrationLog = typeof migrationLogs.$inferSelect;
export type InsertMigrationLog = z.infer<typeof insertMigrationLogSchema>;
export type MigrationLogCard = typeof migrationLogCards.$inferSelect;
export type InsertMigrationLogCard = z.infer<typeof insertMigrationLogCardSchema>;

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

// Share Links for sharing binder/subset views
export const shareLinks = pgTable("share_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  cardSetId: integer("card_set_id").references(() => cardSets.id).notNull(),
  token: text("token").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
}, (table) => ({
  tokenIdx: uniqueIndex("share_links_token_idx").on(table.token),
  userSetIdx: index("share_links_user_set_idx").on(table.userId, table.cardSetId),
}));

export const insertShareLinkSchema = createInsertSchema(shareLinks).omit({
  id: true,
  createdAt: true,
  revokedAt: true,
  lastAccessedAt: true,
});

export type InsertShareLink = z.infer<typeof insertShareLinkSchema>;
export type ShareLink = typeof shareLinks.$inferSelect;

// PC Binders — user-created custom binders (character/artist/theme/chase lists).
// Cards in a PC Binder are independent of ownership: users may add cards they
// don't own (rendered as "chase" cards). Never mutates user_collections.
export const pcBinders = pgTable("pc_binders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").default("Other").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("pc_binders_user_id_idx").on(table.userId),
}));

export const pcBinderCards = pgTable("pc_binder_cards", {
  id: serial("id").primaryKey(),
  binderId: integer("binder_id").references(() => pcBinders.id, { onDelete: "cascade" }).notNull(),
  cardId: integer("card_id").references(() => cards.id, { onDelete: "cascade" }).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  binderIdIdx: index("pc_binder_cards_binder_id_idx").on(table.binderId),
  binderCardIdx: uniqueIndex("pc_binder_cards_binder_card_idx").on(table.binderId, table.cardId),
}));

// Public share links for PC binders. Deliberately a SEPARATE table from
// share_links (which is keyed by cardSetId NOT NULL); owner is derived via
// pc_binders.user_id, and FK cascade kills tokens when a binder is deleted.
export const pcBinderShareLinks = pgTable("pc_binder_share_links", {
  id: serial("id").primaryKey(),
  binderId: integer("binder_id").references(() => pcBinders.id, { onDelete: "cascade" }).notNull(),
  token: text("token").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  lastAccessedAt: timestamp("last_accessed_at"),
  // Organic-funnel analytics: raw counters (every visit / every share tap).
  viewCount: integer("view_count").default(0).notNull(),
  shareCount: integer("share_count").default(0).notNull(),
}, (table) => ({
  tokenIdx: uniqueIndex("pc_binder_share_links_token_idx").on(table.token),
  binderIdx: index("pc_binder_share_links_binder_idx").on(table.binderId),
}));

export const PC_BINDER_CATEGORIES = ["Character", "Artist", "Theme", "Chase List", "Other"] as const;

export const insertPcBinderSchema = createInsertSchema(pcBinders).omit({
  id: true,
  createdAt: true,
});

export const insertPcBinderCardSchema = createInsertSchema(pcBinderCards).omit({
  id: true,
  addedAt: true,
});

export type InsertPcBinder = z.infer<typeof insertPcBinderSchema>;
export type PcBinder = typeof pcBinders.$inferSelect;
export type InsertPcBinderCard = z.infer<typeof insertPcBinderCardSchema>;
export type PcBinderCard = typeof pcBinderCards.$inferSelect;
export type PcBinderShareLink = typeof pcBinderShareLinks.$inferSelect;

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

// ── Analytics Events ─────────────────────────────────────────────────────────
export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  eventType: text("event_type").notNull(), // upgrade_modal_shown, upgrade_clicked, upgrade_dismissed, upgrade_completed
  platform: text("platform"), // ios, android, web
  trigger: text("trigger"), // limit_reached, sidebar, profile, marketplace, card_limit_warning, manual
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEvents.$inferInsert;

// ── User Platforms (which app surface each user has been seen on) ────────────
// One row per (user, platform). Populated automatically from the x-app-platform
// request header on authenticated requests; lets us segment web vs ios vs
// android vs multi-platform users in the admin funnel.
export const userPlatforms = pgTable(
  "user_platforms",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // web | ios | android
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => ({
    userPlatformUnique: uniqueIndex("user_platforms_user_platform_idx").on(t.userId, t.platform),
  }),
);

export type UserPlatform = typeof userPlatforms.$inferSelect;

// ── Scan Usage Logs ───────────────────────────────────────────────────────────
export const userScanLogs = pgTable("user_scan_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UserScanLog = typeof userScanLogs.$inferSelect;

// ── Drive Image Imports (Drive → Cloudinary import history; idempotency ledger) ──
export const driveImageImports = pgTable("drive_image_imports", {
  id: serial("id").primaryKey(),
  driveFileId: text("drive_file_id").notNull(),
  driveFileName: text("drive_file_name").notNull(),
  driveModifiedTime: text("drive_modified_time"),
  driveFolderPath: text("drive_folder_path").notNull(),
  cardId: integer("card_id").notNull(),
  imageType: text("image_type").notNull(), // front | back
  cloudinaryPublicId: text("cloudinary_public_id"),
  cloudinaryUrl: text("cloudinary_url"),
  importBatchId: text("import_batch_id").notNull(),
  status: text("status").notNull(), // uploaded | failed_upload | failed_db_update
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DriveImageImport = typeof driveImageImports.$inferSelect;

// ── Drive Sync Jobs (durable, DB-backed job status/progress) ─────────────────
// Survives autoscale instance changes / restarts. The report endpoint reads
// from here rather than only from process memory. A stale "running" job (no
// heartbeat) is recoverable and gets marked "interrupted" on next inspection.
export const driveSyncJobs = pgTable("drive_sync_jobs", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  jobType: text("job_type").notNull(), // dry_run | import
  mode: text("mode").notNull().default("incremental"), // incremental | full_audit
  status: text("status").notNull(), // running | completed | failed | interrupted
  stage: text("stage"), // e.g. scanning | listing | matching | uploading | done
  // Progress counters
  folderListings: integer("folder_listings").notNull().default(0),
  totalSetFolders: integer("total_set_folders").notNull().default(0),
  processedSetFolders: integer("processed_set_folders").notNull().default(0),
  currentSet: text("current_set"),
  cardFoldersProcessed: integer("card_folders_processed").notNull().default(0),
  imagesUploaded: integer("images_uploaded").notNull().default(0),
  cardsUpdated: integer("cards_updated").notNull().default(0),
  scanErrorsCount: integer("scan_errors_count").notNull().default(0),
  skippedSetsUnchanged: integer("skipped_sets_unchanged").notNull().default(0),
  latestError: text("latest_error"),
  // Structured detail (final report summary, scan errors, options)
  detail: jsonb("detail"),
  options: jsonb("options"),
  // Timestamps / heartbeat for stale detection
  startedAt: timestamp("started_at").defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

export type DriveSyncJob = typeof driveSyncJobs.$inferSelect;

// ── Drive Sync Set Checkpoints (set-level cache to avoid rescanning) ─────────
// One row per top-level "set" folder. Records the folder's latest observed
// modifiedTime and a lightweight content signature so a normal (incremental)
// sync can skip a top-level set folder whose subtree is unchanged since the
// last completed pass, instead of re-crawling every descendant.
export const driveSyncSetCheckpoints = pgTable("drive_sync_set_checkpoints", {
  id: serial("id").primaryKey(),
  driveFolderId: text("drive_folder_id").notNull().unique(),
  folderName: text("folder_name").notNull(),
  // Latest modifiedTime seen anywhere in this set's subtree (RFC3339 string).
  lastModifiedTime: text("last_modified_time"),
  // Cheap structural signature (child folder ids + modifiedTimes hash).
  contentSignature: text("content_signature"),
  // true once a full clean pass completed for this set with no scan errors.
  completed: boolean("completed").notNull().default(false),
  lastScannedAt: timestamp("last_scanned_at").defaultNow().notNull(),
  lastBatchId: text("last_batch_id"),
});

export type DriveSyncSetCheckpoint = typeof driveSyncSetCheckpoints.$inferSelect;

// ── Drive Sync State (durable singleton: Changes API cursor / baseline) ──────
export const driveSyncState = pgTable("drive_sync_state", {
  id: integer("id").primaryKey().default(1),
  // Google Drive Changes API startPageToken captured at baseline.
  changesPageToken: text("changes_page_token"),
  baselineCompletedAt: timestamp("baseline_completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DriveSyncState = typeof driveSyncState.$inferSelect;

// ── Scan Uploads (Scan to Add matching history) ───────────────────────────────
export const scanUploads = pgTable("scan_uploads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  imageUrl: text("image_url"),
  ocrText: text("ocr_text"),
  parsed: text("parsed"), // JSON string of parsed OCR fields
  candidates: text("candidates"), // JSON string snapshot of top match candidates
  confidenceLevel: text("confidence_level").notNull(), // high, medium, low, none
  topMatchCardId: integer("top_match_card_id").references(() => cards.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertScanUploadSchema = createInsertSchema(scanUploads).omit({
  id: true,
  createdAt: true,
});

export type ScanUpload = typeof scanUploads.$inferSelect;
export type InsertScanUpload = z.infer<typeof insertScanUploadSchema>;

// ── Scan Feedback (user-reported match accuracy, used to improve matching) ────
export const scanFeedback = pgTable("scan_feedback", {
  id: serial("id").primaryKey(),
  scanUploadId: integer("scan_upload_id").notNull().references(() => scanUploads.id),
  userId: integer("user_id").notNull().references(() => users.id),
  feedbackType: text("feedback_type").notNull(), // correct, wrong, not_found
  selectedCardId: integer("selected_card_id").references(() => cards.id),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertScanFeedbackSchema = createInsertSchema(scanFeedback).omit({
  id: true,
  createdAt: true,
});

export type ScanFeedback = typeof scanFeedback.$inferSelect;
export type InsertScanFeedback = z.infer<typeof insertScanFeedbackSchema>;
