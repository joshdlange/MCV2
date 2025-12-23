import { z } from "zod";

// User types
export type User = {
  id: number;
  firebaseUid: string;
  username: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  isAdmin: boolean;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  showEmail: boolean;
  showCollection: boolean;
  showWishlist: boolean;
  emailUpdates: boolean;
  priceAlerts: boolean;
  friendActivity: boolean;
  lastLogin: Date | null;
  createdAt: Date;
};

export type InsertUser = {
  firebaseUid: string;
  username: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  isAdmin?: boolean;
  plan?: string;
  subscriptionStatus?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  showEmail?: boolean;
  showCollection?: boolean;
  showWishlist?: boolean;
  emailUpdates?: boolean;
  priceAlerts?: boolean;
  friendActivity?: boolean;
  lastLogin?: Date | null;
};

// Card Set types
export type CardSet = {
  id: number;
  name: string;
  slug: string;
  year: number;
  description: string | null;
  imageUrl: string | null;
  totalCards: number;
  mainSetId: number | null;
  createdAt: Date;
};

export type InsertCardSet = {
  name: string;
  slug: string;
  year: number;
  description?: string | null;
  imageUrl?: string | null;
  totalCards?: number;
  mainSetId?: number | null;
};

// Card types
export type Card = {
  id: number;
  setId: number;
  cardNumber: string;
  name: string;
  variation: string | null;
  isInsert: boolean;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  description: string | null;
  rarity: string;
  estimatedValue: string | null;
  createdAt: Date;
};

export type InsertCard = {
  setId: number;
  cardNumber: string;
  name: string;
  variation?: string | null;
  isInsert?: boolean;
  frontImageUrl?: string | null;
  backImageUrl?: string | null;
  description?: string | null;
  rarity: string;
  estimatedValue?: string | null;
};

// User Collection types
export type UserCollection = {
  id: number;
  userId: number;
  cardId: number;
  condition: string;
  acquiredDate: Date;
  personalValue: string | null;
  salePrice: string | null;
  isForSale: boolean;
  serialNumber: string | null;
  quantity: number;
  isFavorite: boolean;
  notes: string | null;
};

export type InsertUserCollection = {
  userId: number;
  cardId: number;
  condition: string;
  acquiredDate?: Date;
  personalValue?: string | null;
  salePrice?: string | null;
  isForSale?: boolean;
  serialNumber?: string | null;
  quantity?: number;
  isFavorite?: boolean;
  notes?: string | null;
};

// User Wishlist types
export type UserWishlist = {
  id: number;
  userId: number;
  cardId: number;
  priority: number;
  maxPrice: string | null;
  addedDate: Date;
  notes: string | null;
};

export type InsertUserWishlist = {
  userId: number;
  cardId: number;
  priority?: number;
  maxPrice?: string | null;
  notes?: string | null;
};

// Composite types
export type CardWithSet = Card & {
  set: CardSet;
};

export type SellerInfo = {
  id: number;
  username: string;
  displayName: string | null;
  photoURL: string | null;
  sellerRating: string | null;
  sellerReviewCount: number | null;
};

export type CollectionItem = UserCollection & {
  card: CardWithSet;
  seller?: SellerInfo;
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

// Validation schemas
export const insertUserSchema = z.object({
  firebaseUid: z.string(),
  username: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
});

export const insertCardSetSchema = z.object({
  name: z.string().min(1),
  year: z.number().int(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  totalCards: z.number().int().default(0),
});

export const insertCardSchema = z.object({
  setId: z.number().int(),
  cardNumber: z.string().min(1),
  name: z.string().min(1),
  variation: z.string().optional(),
  isInsert: z.boolean().default(false),
  frontImageUrl: z.string().optional(),
  backImageUrl: z.string().optional(),
  description: z.string().optional(),
  rarity: z.string().min(1),
  estimatedValue: z.string().optional(),
});

export const insertUserCollectionSchema = z.object({
  userId: z.number().int(),
  cardId: z.number().int(),
  condition: z.string().min(1),
  acquiredDate: z.date().default(() => new Date()),
  personalValue: z.string().optional(),
  salePrice: z.string().optional(),
  isForSale: z.boolean().default(false),
  serialNumber: z.string().optional(),
  quantity: z.number().int().default(1),
  isFavorite: z.boolean().default(false),
  notes: z.string().optional(),
});

export const insertUserWishlistSchema = z.object({
  userId: z.number().int(),
  cardId: z.number().int(),
  priority: z.number().int().default(1),
  maxPrice: z.string().optional(),
  notes: z.string().optional(),
});