import { 
  users, 
  mainSets,
  cardSets, 
  cards, 
  userCollections, 
  userWishlists,
  cardPriceCache,
  friends,
  messages,
  badges,
  userBadges,
  type User, 
  type InsertUser,
  type MainSet,
  type InsertMainSet,
  type CardSet,
  type InsertCardSet,
  type Card,
  type InsertCard,
  type UserCollection,
  type InsertUserCollection,
  type UserWishlist,
  type InsertUserWishlist,
  type CardWithSet,
  type CollectionItem,
  type WishlistItem,
  type CollectionStats,
  type Friend,
  type InsertFriend,
  type Message,
  type InsertMessage,
  type Badge,
  type InsertBadge,
  type UserBadge,
  type InsertUserBadge,
  type FriendWithUser,
  type MessageWithUsers,
  type UserWithBadges,
  type ProfileStats
} from "@shared/schema";
import { db, withDatabaseRetry } from "./db";
import { eq, ilike, and, count, sum, desc, sql, isNull, isNotNull, or, lt, gte, gt } from "drizzle-orm";

// Utility function to generate slugs
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: number, insertUser: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;
  
  // Main Sets
  getMainSets(): Promise<MainSet[]>;
  getMainSet(id: number): Promise<MainSet | undefined>;
  getMainSetBySlug(slug: string): Promise<MainSet | undefined>;
  createMainSet(insertMainSet: InsertMainSet): Promise<MainSet>;
  updateMainSet(id: number, updates: Partial<InsertMainSet>): Promise<MainSet | undefined>;
  deleteMainSet(id: number): Promise<void>;

  // Card Sets
  getCardSets(): Promise<CardSet[]>;
  getCardSet(id: number): Promise<CardSet | undefined>;
  getCardSetBySlug(slug: string): Promise<CardSet | undefined>;
  createCardSet(insertCardSet: InsertCardSet): Promise<CardSet>;
  updateCardSet(id: number, updates: Partial<InsertCardSet>): Promise<CardSet | undefined>;
  searchCardSets(query: string): Promise<CardSet[]>;
  getUnassignedCardSets(): Promise<CardSet[]>;
  
  // Cards
  getCards(filters?: { setId?: number; search?: string; rarity?: string; isInsert?: boolean }): Promise<CardWithSet[]>;
  getCard(id: number): Promise<CardWithSet | undefined>;
  getCardsBySet(setId: number): Promise<Card[]>;
  getCardBySetAndNumber(setId: number, cardNumber: string, name: string): Promise<Card | undefined>;
  createCard(insertCard: InsertCard): Promise<Card>;
  updateCard(id: number, insertCard: InsertCard): Promise<Card | undefined>;
  deleteCard(id: number): Promise<void>;
  
  // User Collections
  getUserCollection(userId: number): Promise<CollectionItem[]>;
  addToCollection(insertUserCollection: InsertUserCollection): Promise<UserCollection>;
  removeFromCollection(id: number): Promise<void>;
  updateCollectionItem(id: number, updates: Partial<UserCollection>): Promise<UserCollection | undefined>;
  
  // Marketplace
  getMarketplaceItems(): Promise<CollectionItem[]>;
  
  // User Wishlists
  getUserWishlist(userId: number): Promise<WishlistItem[]>;
  addToWishlist(insertUserWishlist: InsertUserWishlist): Promise<UserWishlist>;
  removeFromWishlist(id: number): Promise<void>;
  
  // Stats
  getCollectionStats(userId: number): Promise<CollectionStats>;
  getRecentCards(userId: number, limit: number): Promise<CollectionItem[]>;
  
  // Trending
  getTrendingCards(limit: number): Promise<CardWithSet[]>;
  
  // Missing Cards
  getMissingCardsInSet(userId: number, setId: number): Promise<CardWithSet[]>;
  
  // Pricing
  getCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null>;
  updateCardPricing(cardId: number, avgPrice: number, salesCount: number, recentSales: string[]): Promise<void>;
  
  // Image Management
  getCardsWithoutImages(limit: number): Promise<CardWithSet[]>;
  
  // Admin Functions
  clearAllData(): Promise<void>;

  // Social Features - Friends
  getFriends(userId: number): Promise<FriendWithUser[]>;
  getFriendRequests(userId: number): Promise<FriendWithUser[]>;
  sendFriendRequest(requesterId: number, recipientId: number): Promise<Friend>;
  respondToFriendRequest(friendId: number, status: "accepted" | "declined"): Promise<Friend | undefined>;
  getFriendshipStatus(userId1: number, userId2: number): Promise<Friend | undefined>;
  removeFriend(friendId: number): Promise<void>;

  // Social Features - Messages
  getMessages(userId1: number, userId2: number): Promise<MessageWithUsers[]>;
  sendMessage(senderId: number, recipientId: number, content: string): Promise<Message>;
  markMessageAsRead(messageId: number): Promise<void>;
  getUnreadMessageCount(userId: number): Promise<number>;
  getMessageThreads(userId: number): Promise<{ user: User; lastMessage: Message; unreadCount: number }[]>;

  // Social Features - Badges
  getBadges(): Promise<Badge[]>;
  getUserBadges(userId: number): Promise<(UserBadge & { badge: Badge })[]>;
  awardBadge(userId: number, badgeId: number): Promise<UserBadge>;
  checkAndAwardBadges(userId: number): Promise<UserBadge[]>;
  createBadge(insertBadge: InsertBadge): Promise<Badge>;

  // Social Features - Profiles
  getProfileStats(userId: number): Promise<ProfileStats>;
  updateProfileVisibility(userId: number, visibility: "public" | "friends" | "private"): Promise<void>;
  canViewProfile(viewerUserId: number, targetUserId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private calculateGrowthPercentage(current: number, previous: number): string {
    if (previous === 0) {
      return current > 0 ? '+100%' : '0%';
    }
    
    const growth = ((current - previous) / previous) * 100;
    const rounded = Math.round(growth * 10) / 10; // Round to 1 decimal place
    
    if (rounded > 0) {
      return `+${rounded}%`;
    } else if (rounded < 0) {
      return `${rounded}%`;
    } else {
      return '0%';
    }
  }

  async getCardPricing(cardId: number): Promise<{ avgPrice: number; salesCount: number; lastFetched: Date } | null> {
    const [pricing] = await db.select().from(cardPriceCache).where(eq(cardPriceCache.cardId, cardId));
    if (!pricing || pricing.avgPrice === null) return null;
    return {
      avgPrice: parseFloat(pricing.avgPrice),
      salesCount: pricing.salesCount || 0,
      lastFetched: pricing.lastFetched
    };
  }

  async updateCardPricing(cardId: number, avgPrice: number, salesCount: number, recentSales: string[]): Promise<void> {
    await db.insert(cardPriceCache)
      .values({
        cardId,
        avgPrice: avgPrice.toString(),
        salesCount,
        recentSales,
        lastFetched: new Date()
      })
      .onConflictDoUpdate({
        target: cardPriceCache.cardId,
        set: {
          avgPrice: avgPrice.toString(),
          salesCount,
          recentSales,
          lastFetched: new Date()
        }
      });
  }
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user || undefined;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
      return user || undefined;
    } catch (error) {
      console.error('Error getting user by Firebase UID:', error);
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user || undefined;
    } catch (error) {
      console.error('Error getting user by username:', error);
      return undefined;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    try {
      return await db.select().from(users);
    } catch (error) {
      console.error('Error getting all users:', error);
      return [];
    }
  }

  async updateUser(id: number, insertUser: Partial<InsertUser>): Promise<User | undefined> {
    try {
      const [user] = await db
        .update(users)
        .set(insertUser)
        .where(eq(users.id, id))
        .returning();
      return user || undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      return undefined;
    }
  }

  async deleteUser(id: number): Promise<void> {
    try {
      await db.delete(users).where(eq(users.id, id));
    } catch (error) {
      console.error('Error deleting user:', error);
      throw new Error('Failed to delete user');
    }
  }

  // Main Sets methods
  async getMainSets(): Promise<MainSet[]> {
    try {
      return await db.select().from(mainSets).orderBy(desc(mainSets.createdAt));
    } catch (error) {
      console.error('Error getting main sets:', error);
      return [];
    }
  }

  async getMainSet(id: number): Promise<MainSet | undefined> {
    try {
      const [mainSet] = await db.select().from(mainSets).where(eq(mainSets.id, id));
      return mainSet || undefined;
    } catch (error) {
      console.error('Error getting main set:', error);
      return undefined;
    }
  }

  async getMainSetBySlug(slug: string): Promise<MainSet | undefined> {
    try {
      const [mainSet] = await db.select().from(mainSets).where(eq(mainSets.slug, slug));
      return mainSet || undefined;
    } catch (error) {
      console.error('Error getting main set by slug:', error);
      return undefined;
    }
  }

  async createMainSet(insertMainSet: InsertMainSet): Promise<MainSet> {
    const dataWithSlug = {
      ...insertMainSet,
      slug: generateSlug(insertMainSet.name)
    };
    const [mainSet] = await db.insert(mainSets).values(dataWithSlug).returning();
    return mainSet;
  }

  async updateMainSet(id: number, updates: Partial<InsertMainSet>): Promise<MainSet | undefined> {
    try {
      // If name is being updated, regenerate slug
      const updatesWithSlug = updates.name 
        ? { ...updates, slug: generateSlug(updates.name) }
        : updates;
      
      const [mainSet] = await db.update(mainSets).set(updatesWithSlug).where(eq(mainSets.id, id)).returning();
      return mainSet || undefined;
    } catch (error) {
      console.error('Error updating main set:', error);
      return undefined;
    }
  }

  async findMatchingBaseSets(mainSetName: string): Promise<CardSet[]> {
    try {
      // Look for card sets that match the main set name exactly or are very similar
      // This helps identify potential base sets for auto-assignment
      const cleanName = mainSetName.toLowerCase().trim();
      
      const matchingSets = await db
        .select()
        .from(cardSets)
        .where(
          or(
            sql`LOWER(${cardSets.name}) = ${cleanName}`,
            sql`LOWER(${cardSets.name}) LIKE ${cleanName + '%'}`,
            sql`LOWER(${cardSets.name}) LIKE ${'%' + cleanName + '%'}`
          )
        )
        .orderBy(
          // Exact matches first, then by name length (shorter = more likely to be base set)
          sql`CASE WHEN LOWER(${cardSets.name}) = ${cleanName} THEN 0 ELSE 1 END`,
          sql`LENGTH(${cardSets.name})`
        );
      
      return matchingSets;
    } catch (error) {
      console.error('Error finding matching base sets:', error);
      return [];
    }
  }

  async deleteMainSet(id: number): Promise<void> {
    try {
      await db.delete(mainSets).where(eq(mainSets.id, id));
    } catch (error) {
      console.error('Error deleting main set:', error);
      throw new Error('Failed to delete main set');
    }
  }

  async getCardSets(): Promise<CardSet[]> {
    try {
      // Optimized single query with JOIN and GROUP BY instead of N+1 queries
      const setsWithCounts = await db
        .select({
          id: cardSets.id,
          name: cardSets.name,
          slug: cardSets.slug,
          year: cardSets.year,
          description: cardSets.description,
          imageUrl: cardSets.imageUrl,
          totalCards: sql<number>`COALESCE(COUNT(${cards.id}), 0)`,
          mainSetId: cardSets.mainSetId,
          createdAt: cardSets.createdAt
        })
        .from(cardSets)
        .leftJoin(cards, eq(cardSets.id, cards.setId))
        .groupBy(cardSets.id, cardSets.name, cardSets.slug, cardSets.year, cardSets.description, cardSets.imageUrl, cardSets.mainSetId, cardSets.createdAt)
        .orderBy(desc(cardSets.year), cardSets.name);
      
      return setsWithCounts;
    } catch (error) {
      console.error('Error getting card sets:', error);
      return [];
    }
  }

  async getUnassignedCardSets(): Promise<CardSet[]> {
    try {
      const unassignedSets = await db
        .select({
          id: cardSets.id,
          name: cardSets.name,
          slug: cardSets.slug,
          year: cardSets.year,
          description: cardSets.description,
          imageUrl: cardSets.imageUrl,
          totalCards: sql<number>`COALESCE(COUNT(${cards.id}), 0)`,
          mainSetId: cardSets.mainSetId,
          createdAt: cardSets.createdAt
        })
        .from(cardSets)
        .leftJoin(cards, eq(cardSets.id, cards.setId))
        .where(isNull(cardSets.mainSetId))
        .groupBy(cardSets.id, cardSets.name, cardSets.slug, cardSets.year, cardSets.description, cardSets.imageUrl, cardSets.mainSetId, cardSets.createdAt)
        .orderBy(desc(cardSets.year), cardSets.name);
      
      return unassignedSets;
    } catch (error) {
      console.error('Error getting unassigned card sets:', error);
      return [];
    }
  }

  async getCardSet(id: number): Promise<CardSet | undefined> {
    try {
      const [cardSet] = await db.select().from(cardSets).where(eq(cardSets.id, id));
      return cardSet || undefined;
    } catch (error) {
      console.error('Error getting card set:', error);
      return undefined;
    }
  }

  async getCardSetBySlug(slug: string): Promise<CardSet | undefined> {
    try {
      const [cardSet] = await db.select().from(cardSets).where(eq(cardSets.slug, slug));
      return cardSet || undefined;
    } catch (error) {
      console.error('Error getting card set by slug:', error);
      return undefined;
    }
  }

  async createCardSet(insertCardSet: InsertCardSet): Promise<CardSet> {
    const dataWithSlug = {
      ...insertCardSet,
      slug: generateSlug(insertCardSet.name)
    };
    const [cardSet] = await db
      .insert(cardSets)
      .values(dataWithSlug)
      .returning();
    return cardSet;
  }

  async updateCardSet(id: number, updates: Partial<InsertCardSet>): Promise<CardSet | undefined> {
    // If name is being updated, regenerate slug
    const updatesWithSlug = updates.name 
      ? { ...updates, slug: generateSlug(updates.name) }
      : updates;
    
    const [cardSet] = await db
      .update(cardSets)
      .set(updatesWithSlug)
      .where(eq(cardSets.id, id))
      .returning();
    return cardSet || undefined;
  }

  async getCards(filters?: { setId?: number; search?: string; rarity?: string; isInsert?: boolean }): Promise<CardWithSet[]> {
    try {
      let query = db
        .select({
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: {
            id: cardSets.id,
            name: cardSets.name,
            slug: cardSets.slug,
            year: cardSets.year,
            description: cardSets.description,
            imageUrl: cardSets.imageUrl,
            totalCards: cardSets.totalCards,
            mainSetId: cardSets.mainSetId,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id));

      const conditions = [];

      if (filters?.setId) {
        conditions.push(eq(cards.setId, filters.setId));
      }

      if (filters?.search) {
        conditions.push(
          or(
            ilike(cards.name, `%${filters.search}%`),
            ilike(cards.description, `%${filters.search}%`),
            ilike(cards.cardNumber, `%${filters.search}%`)
          )
        );
      }

      if (filters?.rarity) {
        conditions.push(eq(cards.rarity, filters.rarity));
      }

      if (filters?.isInsert !== undefined) {
        conditions.push(eq(cards.isInsert, filters.isInsert));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      // Sort by card number when filtering by set, otherwise by creation date
      if (filters?.setId) {
        // Natural sorting for card numbers - convert pure numbers to integers, keep mixed strings as-is
        query = query.orderBy(sql`
          CASE 
            WHEN ${cards.cardNumber} ~ '^[0-9]+$' THEN LPAD(${cards.cardNumber}, 10, '0')
            ELSE ${cards.cardNumber}
          END
        `) as any;
      } else {
        query = query.orderBy(cards.createdAt) as any;
      }

      const results = await query;
      return results.map(row => ({
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: row.set
      }));
    } catch (error) {
      console.error('Error getting cards:', error);
      return [];
    }
  }

  async getCard(id: number): Promise<CardWithSet | undefined> {
    try {
      const result = await db
        .select({
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: {
            id: cardSets.id,
            name: cardSets.name,
            slug: cardSets.slug,
            year: cardSets.year,
            description: cardSets.description,
            imageUrl: cardSets.imageUrl,
            totalCards: cardSets.totalCards,
            mainSetId: cardSets.mainSetId,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(cards.id, id));

      if (result.length === 0) return undefined;

      const row = result[0];
      return {
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: row.set
      };
    } catch (error) {
      console.error('Error getting card:', error);
      return undefined;
    }
  }

  async getCardsBySet(setId: number): Promise<CardWithSet[]> {
    try {
      const result = await db
        .select({
          // Card fields
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          // Set fields
          setName: cardSets.name,
          setSlug: cardSets.slug,
          setYear: cardSets.year,
          setDescription: cardSets.description,
          setImageUrl: cardSets.imageUrl,
          setTotalCards: cardSets.totalCards,
          setMainSetId: cardSets.mainSetId,
          setCreatedAt: cardSets.createdAt,
        })
        .from(cards)
        .leftJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(cards.setId, setId));
      
      // Transform the result to match CardWithSet structure
      return result.map(row => ({
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: {
          id: row.setId,
          name: row.setName,
          slug: row.setSlug,
          year: row.setYear,
          description: row.setDescription,
          imageUrl: row.setImageUrl,
          totalCards: row.setTotalCards,
          mainSetId: row.setMainSetId,
          createdAt: row.setCreatedAt,
        }
      }));
    } catch (error) {
      console.error('Error getting cards by set:', error);
      return [];
    }
  }

  async getCardBySetAndNumber(setId: number, cardNumber: string, name: string): Promise<Card | undefined> {
    try {
      const [card] = await db
        .select()
        .from(cards)
        .where(and(
          eq(cards.setId, setId),
          eq(cards.cardNumber, cardNumber),
          eq(cards.name, name)
        ));
      return card || undefined;
    } catch (error) {
      console.error('Error checking for duplicate card:', error);
      return undefined;
    }
  }

  async createCard(insertCard: InsertCard): Promise<Card> {
    const [card] = await db
      .insert(cards)
      .values(insertCard)
      .returning();
    return card;
  }

  async updateCard(id: number, insertCard: InsertCard): Promise<Card | undefined> {
    try {
      const [card] = await db
        .update(cards)
        .set(insertCard)
        .where(eq(cards.id, id))
        .returning();
      return card || undefined;
    } catch (error) {
      console.error('Error updating card:', error);
      return undefined;
    }
  }

  async updateCardImage(id: number, imageUrl: string): Promise<Card | undefined> {
    try {
      const [card] = await db
        .update(cards)
        .set({ frontImageUrl: imageUrl })
        .where(eq(cards.id, id))
        .returning();
      return card || undefined;
    } catch (error) {
      console.error('Error updating card image:', error);
      return undefined;
    }
  }

  async deleteCard(id: number): Promise<void> {
    try {
      // First, delete any user collection items that reference this card
      await db.delete(userCollections).where(eq(userCollections.cardId, id));
      
      // Then, delete any wishlist items that reference this card
      await db.delete(userWishlists).where(eq(userWishlists.cardId, id));
      
      // Finally, delete the card itself
      await db.delete(cards).where(eq(cards.id, id));
    } catch (error) {
      console.error('Error deleting card:', error);
      throw error;
    }
  }

  async getUserCollection(userId: number): Promise<CollectionItem[]> {
    try {
      const results = await db
        .select({
          id: userCollections.id,
          userId: userCollections.userId,
          cardId: userCollections.cardId,
          condition: userCollections.condition,
          acquiredDate: userCollections.acquiredDate,
          personalValue: userCollections.personalValue,
          salePrice: userCollections.salePrice,
          isForSale: userCollections.isForSale,
          serialNumber: userCollections.serialNumber,
          quantity: userCollections.quantity,
          isFavorite: userCollections.isFavorite,
          notes: userCollections.notes,
          card: {
            id: cards.id,
            setId: cards.setId,
            cardNumber: cards.cardNumber,
            name: cards.name,
            variation: cards.variation,
            isInsert: cards.isInsert,
            frontImageUrl: cards.frontImageUrl,
            backImageUrl: cards.backImageUrl,
            description: cards.description,
            rarity: cards.rarity,
            estimatedValue: cards.estimatedValue,
            createdAt: cards.createdAt,
            set: {
              id: cardSets.id,
              name: cardSets.name,
              slug: cardSets.slug,
              year: cardSets.year,
              description: cardSets.description,
              totalCards: cardSets.totalCards,
              mainSetId: cardSets.mainSetId,
              createdAt: cardSets.createdAt,
              imageUrl: cardSets.imageUrl,
            }
          }
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userCollections.userId, userId));

      return results as CollectionItem[];
    } catch (error) {
      console.error('Error getting user collection:', error);
      return [];
    }
  }

  async addToCollection(insertUserCollection: InsertUserCollection): Promise<UserCollection> {
    // Check if the card already exists in the user's collection
    const existingItem = await db
      .select()
      .from(userCollections)
      .where(
        and(
          eq(userCollections.userId, insertUserCollection.userId),
          eq(userCollections.cardId, insertUserCollection.cardId)
        )
      )
      .limit(1);

    if (existingItem.length > 0) {
      // If card exists, increase quantity
      const [updatedItem] = await db
        .update(userCollections)
        .set({ quantity: sql`${userCollections.quantity} + 1` })
        .where(eq(userCollections.id, existingItem[0].id))
        .returning();
      return updatedItem;
    }

    // If card doesn't exist, create new entry
    const [item] = await db
      .insert(userCollections)
      .values({
        ...insertUserCollection,
        acquiredDate: new Date(),
        condition: insertUserCollection.condition || 'Near Mint',
        personalValue: insertUserCollection.personalValue || null,
        salePrice: insertUserCollection.salePrice || null,
        isForSale: insertUserCollection.isForSale || false,
        serialNumber: insertUserCollection.serialNumber || null,
        quantity: insertUserCollection.quantity || 1,
        isFavorite: insertUserCollection.isFavorite || false,
        notes: insertUserCollection.notes || null,
      })
      .returning();
    return item;
  }

  async removeFromCollection(id: number): Promise<void> {
    await db.delete(userCollections).where(eq(userCollections.id, id));
  }

  async updateCollectionItem(id: number, updates: Partial<UserCollection>): Promise<UserCollection | undefined> {
    const [updated] = await db
      .update(userCollections)
      .set(updates)
      .where(eq(userCollections.id, id))
      .returning();
    return updated || undefined;
  }

  async getMarketplaceItems(): Promise<CollectionItem[]> {
    const items = await db
      .select({
        id: userCollections.id,
        userId: userCollections.userId,
        cardId: userCollections.cardId,
        condition: userCollections.condition,
        acquiredDate: userCollections.acquiredDate,
        personalValue: userCollections.personalValue,
        salePrice: userCollections.salePrice,
        isForSale: userCollections.isForSale,
        serialNumber: userCollections.serialNumber,
        notes: userCollections.notes,
        card: {
          id: cards.id,
          name: cards.name,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          variation: cards.variation,
          rarity: cards.rarity,
          isInsert: cards.isInsert,
          description: cards.description,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: {
            id: cardSets.id,
            name: cardSets.name,
            slug: cardSets.slug,
            year: cardSets.year,
            description: cardSets.description,
            totalCards: cardSets.totalCards,
            mainSetId: cardSets.mainSetId,
            createdAt: cardSets.createdAt,
          }
        }
      })
      .from(userCollections)
      .leftJoin(cards, eq(userCollections.cardId, cards.id))
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(eq(userCollections.isForSale, true));

    return items as CollectionItem[];
  }

  async getUserWishlist(userId: number): Promise<WishlistItem[]> {
    try {
      const results = await db
        .select({
          id: userWishlists.id,
          userId: userWishlists.userId,
          cardId: userWishlists.cardId,
          priority: userWishlists.priority,
          maxPrice: userWishlists.maxPrice,
          addedDate: userWishlists.addedDate,
          card: {
            id: cards.id,
            setId: cards.setId,
            cardNumber: cards.cardNumber,
            name: cards.name,
            variation: cards.variation,
            isInsert: cards.isInsert,
            frontImageUrl: cards.frontImageUrl,
            backImageUrl: cards.backImageUrl,
            description: cards.description,
            rarity: cards.rarity,
            estimatedValue: cards.estimatedValue,
            createdAt: cards.createdAt,
            set: {
              id: cardSets.id,
              name: cardSets.name,
              year: cardSets.year,
              description: cardSets.description,
              totalCards: cardSets.totalCards,
              createdAt: cardSets.createdAt,
            }
          }
        })
        .from(userWishlists)
        .innerJoin(cards, eq(userWishlists.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userWishlists.userId, userId));

      return results.map(row => ({
        id: row.id as number,
        userId: row.userId as number,
        cardId: row.cardId as number,
        priority: row.priority as number,
        maxPrice: row.maxPrice as string | null,
        addedDate: row.addedDate as Date,
        card: row.card as any
      }));
    } catch (error) {
      console.error('Error getting user wishlist:', error);
      return [];
    }
  }

  async addToWishlist(insertUserWishlist: InsertUserWishlist): Promise<UserWishlist> {
    const [item] = await db
      .insert(userWishlists)
      .values(insertUserWishlist)
      .returning();
    return item;
  }

  async removeFromWishlist(id: number): Promise<void> {
    await db.delete(userWishlists).where(eq(userWishlists.id, id));
  }

  async getCollectionStats(userId: number): Promise<CollectionStats> {
    try {
      console.log(`Calculating stats for user ${userId}`);
      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

      // Current counts with better error handling for new users
      console.log(`Fetching total cards for user ${userId}`);
      const totalCardsResult = await db
        .select({ count: count() })
        .from(userCollections)
        .where(eq(userCollections.userId, userId));
      
      console.log(`Total cards result for user ${userId}:`, totalCardsResult);

      console.log(`Fetching insert cards for user ${userId}`);
      const insertCardsResult = await db
        .select({ count: count() })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(and(eq(userCollections.userId, userId), eq(cards.isInsert, true)));
      
      console.log(`Insert cards result for user ${userId}:`, insertCardsResult);

      // Calculate total value using real eBay pricing data where available
      console.log(`Fetching total value for user ${userId}`);
      const totalValueResult = await db
        .select({ 
          totalEstimated: sum(cards.estimatedValue),
          totalReal: sum(cardPriceCache.avgPrice)
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .leftJoin(cardPriceCache, eq(cards.id, cardPriceCache.cardId))
        .where(eq(userCollections.userId, userId));
      
      console.log(`Total value result for user ${userId}:`, totalValueResult);

      console.log(`Fetching wishlist for user ${userId}`);
      const wishlistResult = await db
        .select({ count: count() })
        .from(userWishlists)
        .where(eq(userWishlists.userId, userId));
      
      console.log(`Wishlist result for user ${userId}:`, wishlistResult);

      // Previous month counts for growth calculation
      const totalCardsLastMonth = await db
        .select({ count: count() })
        .from(userCollections)
        .where(and(
          eq(userCollections.userId, userId),
          sql`${userCollections.acquiredDate} <= ${oneMonthAgo}`
        ));

      const insertCardsLastMonth = await db
        .select({ count: count() })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(and(
          eq(userCollections.userId, userId),
          eq(cards.isInsert, true),
          sql`${userCollections.acquiredDate} <= ${oneMonthAgo}`
        ));

      const wishlistLastMonth = await db
        .select({ count: count() })
        .from(userWishlists)
        .where(and(
          eq(userWishlists.userId, userId),
          sql`${userWishlists.addedDate} <= ${oneMonthAgo}`
        ));

      // Calculate growth percentages with robust null handling
      const currentTotal = Number(totalCardsResult[0]?.count) || 0;
      const previousTotal = Number(totalCardsLastMonth[0]?.count) || 0;
      const totalGrowth = this.calculateGrowthPercentage(currentTotal, previousTotal);

      const currentInserts = Number(insertCardsResult[0]?.count) || 0;
      const previousInserts = Number(insertCardsLastMonth[0]?.count) || 0;
      const insertGrowth = this.calculateGrowthPercentage(currentInserts, previousInserts);

      const currentWishlist = Number(wishlistResult[0]?.count) || 0;
      const previousWishlist = Number(wishlistLastMonth[0]?.count) || 0;
      const wishlistGrowth = this.calculateGrowthPercentage(currentWishlist, previousWishlist);

      // Calculate total value using real pricing data where available, fallback to estimated
      // Handle null/undefined values more robustly
      const realTotalStr = totalValueResult[0]?.totalReal;
      const estimatedTotalStr = totalValueResult[0]?.totalEstimated;
      
      const realTotal = realTotalStr ? parseFloat(String(realTotalStr)) : 0;
      const estimatedTotal = estimatedTotalStr ? parseFloat(String(estimatedTotalStr)) : 0;
      const totalValue = (!isNaN(realTotal) && realTotal > 0) ? realTotal : (!isNaN(estimatedTotal) ? estimatedTotal : 0);

      console.log(`Final stats calculation for user ${userId}:`, {
        currentTotal,
        currentInserts,
        currentWishlist,
        totalValue,
        realTotal,
        estimatedTotal
      });

      return {
        totalCards: currentTotal,
        insertCards: currentInserts,
        totalValue: totalValue,
        wishlistItems: currentWishlist,
        completedSets: 0,
        recentAdditions: 0,
        totalCardsGrowth: totalGrowth,
        insertCardsGrowth: insertGrowth,
        totalValueGrowth: '0%', // Will implement when pricing data is available
        wishlistGrowth: wishlistGrowth
      };
    } catch (error) {
      console.error(`Error getting collection stats for user ${userId}:`, error);
      console.error('Stack trace:', error.stack);
      
      // Return safe defaults for new users
      const safeStats = {
        totalCards: 0,
        insertCards: 0,
        totalValue: 0,
        wishlistItems: 0,
        completedSets: 0,
        recentAdditions: 0,
        totalCardsGrowth: '+0%',
        insertCardsGrowth: '+0%',
        totalValueGrowth: '+0%',
        wishlistGrowth: '+0%'
      };
      
      console.log(`Returning safe stats for user ${userId}:`, safeStats);
      return safeStats;
    }
  }

  async getRecentCards(userId: number, limit: number): Promise<CollectionItem[]> {
    try {
      const results = await db
        .select({
          id: userCollections.id,
          userId: userCollections.userId,
          cardId: userCollections.cardId,
          condition: userCollections.condition,
          acquiredDate: userCollections.acquiredDate,
          personalValue: userCollections.personalValue,
          notes: userCollections.notes,
          card: {
            id: cards.id,
            setId: cards.setId,
            cardNumber: cards.cardNumber,
            name: cards.name,
            variation: cards.variation,
            isInsert: cards.isInsert,
            frontImageUrl: cards.frontImageUrl,
            backImageUrl: cards.backImageUrl,
            description: cards.description,
            rarity: cards.rarity,
            estimatedValue: cards.estimatedValue,
            createdAt: cards.createdAt,
            set: {
              id: cardSets.id,
              name: cardSets.name,
              year: cardSets.year,
              description: cardSets.description,
              totalCards: cardSets.totalCards,
              createdAt: cardSets.createdAt,
            }
          }
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.acquiredDate))
        .limit(limit);

      return results.map(row => ({
        id: row.id,
        userId: row.userId,
        cardId: row.cardId,
        condition: row.condition,
        acquiredDate: row.acquiredDate,
        personalValue: row.personalValue,
        notes: row.notes,
        card: row.card
      }));
    } catch (error) {
      console.error('Error getting recent cards:', error);
      return [];
    }
  }

  async getTrendingCards(limit: number): Promise<CardWithSet[]> {
    try {
      // Get trending cards: cards recently added to user collections
      const results = await db
        .select({
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          // Set fields with aliases
          setId_alias: cardSets.id,
          setName: cardSets.name,
          setSlug: cardSets.slug,
          setYear: cardSets.year,
          setDescription: cardSets.description,
          setImageUrl: cardSets.imageUrl,
          setTotalCards: cardSets.totalCards,
          setMainSetId: cardSets.mainSetId,
          setCreatedAt: cardSets.createdAt,
          collectionCount: count(userCollections.id).as('collection_count'),
          latestAddition: sql<Date>`MAX(${userCollections.acquiredDate})`.as('latest_addition')
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .innerJoin(userCollections, eq(cards.id, userCollections.cardId))
        .where(
          and(
            isNotNull(cards.frontImageUrl), // Only cards with images
            gte(userCollections.acquiredDate, sql`NOW() - INTERVAL '30 days'`) // Added in last 30 days
          )
        )
        .groupBy(
          cards.id,
          cards.setId,
          cards.cardNumber,
          cards.name,
          cards.variation,
          cards.isInsert,
          cards.frontImageUrl,
          cards.backImageUrl,
          cards.description,
          cards.rarity,
          cards.estimatedValue,
          cards.createdAt,
          cardSets.id,
          cardSets.name,
          cardSets.slug,
          cardSets.year,
          cardSets.description,
          cardSets.imageUrl,
          cardSets.totalCards,
          cardSets.mainSetId,
          cardSets.createdAt
        )
        .orderBy(
          desc(sql`collection_count`), // Most collected first
          desc(sql`latest_addition`), // Most recently added
          desc(cards.isInsert), // Prioritize inserts
          desc(cardSets.year) // Newer sets
        )
        .limit(limit);

      return results.map(row => ({
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: {
          id: row.setId_alias,
          name: row.setName,
          slug: row.setSlug,
          year: row.setYear,
          description: row.setDescription,
          imageUrl: row.setImageUrl,
          totalCards: row.setTotalCards,
          mainSetId: row.setMainSetId,
          createdAt: row.setCreatedAt,
        }
      }));
    } catch (error) {
      console.error('Error getting trending cards:', error);
      return [];
    }
  }

  async getMissingCardsInSet(userId: number, setId: number): Promise<CardWithSet[]> {
    try {
      console.log(`Getting missing cards for user ${userId} in set ${setId}`);
      
      // First get all cards in the set
      const allCardsInSet = await db
        .select({
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: {
            id: cardSets.id,
            name: cardSets.name,
            year: cardSets.year,
            description: cardSets.description,
            imageUrl: cardSets.imageUrl,
            totalCards: cardSets.totalCards,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(cards.setId, setId))
        .orderBy(cards.cardNumber);

      console.log(`Found ${allCardsInSet.length} total cards in set ${setId}`);

      // Get all cards the user owns from this set
      const ownedCardsInSet = await db
        .select({
          cardId: userCollections.cardId,
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(and(
          eq(userCollections.userId, userId),
          eq(cards.setId, setId)
        ));

      console.log(`User owns ${ownedCardsInSet.length} cards in set ${setId}`);

      // Create set of owned card IDs
      const ownedCardIds = new Set(ownedCardsInSet.map(owned => owned.cardId));
      
      // Filter to get missing cards
      const missingCards = allCardsInSet.filter(card => !ownedCardIds.has(card.id));
      
      console.log(`User is missing ${missingCards.length} cards in set ${setId}`);
      
      return missingCards as CardWithSet[];
    } catch (error) {
      console.error('Error getting missing cards:', error);
      return [];
    }
  }

  /**
   * Get cards with stale pricing data (older than 24 hours) or no pricing
   */
  async getCardsWithStalePricing(): Promise<number[]> {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      // Get cards that don't have any pricing cache OR have stale pricing (older than 24 hours)
      const cardsWithoutPricing = await db
        .select({ id: cards.id })
        .from(cards)
        .leftJoin(cardPriceCache, eq(cards.id, cardPriceCache.cardId))
        .where(
          or(
            isNull(cardPriceCache.cardId), // No pricing cache at all
            lt(cardPriceCache.lastFetched, twentyFourHoursAgo) // Stale pricing
          )
        )
        .limit(50); // Conservative limit to respect API limits
      
      return cardsWithoutPricing.map(card => card.id);
    } catch (error) {
      console.error('Error getting cards with stale pricing:', error);
      return [];
    }
  }

  /**
   * Get popular cards from user collections (most collected cards)
   */
  async getPopularCardsFromCollections(): Promise<number[]> {
    try {
      const popularCards = await db
        .select({
          cardId: userCollections.cardId,
          count: sql<number>`count(*)`.as('count')
        })
        .from(userCollections)
        .groupBy(userCollections.cardId)
        .orderBy(sql`count(*) desc`)
        .limit(50); // Get top 50 most collected cards
      
      return popularCards.map(card => card.cardId);
    } catch (error) {
      console.error('Error getting popular cards from collections:', error);
      return [];
    }
  }

  async getCardsWithoutImages(limit: number): Promise<CardWithSet[]> {
    try {
      const results = await db
        .select({
          id: cards.id,
          setId: cards.setId,
          cardNumber: cards.cardNumber,
          name: cards.name,
          variation: cards.variation,
          isInsert: cards.isInsert,
          frontImageUrl: cards.frontImageUrl,
          backImageUrl: cards.backImageUrl,
          description: cards.description,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: {
            id: cardSets.id,
            name: cardSets.name,
            slug: cardSets.slug,
            year: cardSets.year,
            description: cardSets.description,
            imageUrl: cardSets.imageUrl,
            totalCards: cardSets.totalCards,
            mainSetId: cardSets.mainSetId,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(
          or(
            isNull(cards.frontImageUrl),
            eq(cards.frontImageUrl, '')
          )
        )
        .orderBy(desc(cards.createdAt))
        .limit(limit);

      return results.map(row => ({
        id: row.id,
        setId: row.setId,
        cardNumber: row.cardNumber,
        name: row.name,
        variation: row.variation,
        isInsert: row.isInsert,
        frontImageUrl: row.frontImageUrl,
        backImageUrl: row.backImageUrl,
        description: row.description,
        rarity: row.rarity,
        estimatedValue: row.estimatedValue,
        createdAt: row.createdAt,
        set: row.set
      }));
    } catch (error) {
      console.error('Error getting cards without images:', error);
      return [];
    }
  }

  async searchCardSets(query: string): Promise<CardSet[]> {
    try {
      if (!query || query.length < 2) {
        return [];
      }
      
      // Simple pattern matching for card sets
      const sets = await db.select()
        .from(cardSets)
        .where(
          or(
            ilike(cardSets.name, `%${query}%`),
            ilike(cardSets.description, `%${query}%`)
          )
        )
        .limit(10);
      
      // Calculate actual total cards for each set
      const setsWithCounts = await Promise.all(sets.map(async (set) => {
        const [{ count }] = await db.select({ count: sql<number>`count(*)` })
          .from(cards)
          .where(eq(cards.setId, set.id));
        
        return {
          ...set,
          totalCards: count || 0
        };
      }));
      
      return setsWithCounts;
    } catch (error) {
      console.error('Error searching card sets:', error);
      return [];
    }
  }

  async clearAllData(): Promise<void> {
    try {
      // Delete in order to respect foreign key constraints
      await db.delete(userWishlists);
      await db.delete(userCollections);
      await db.delete(cardPriceCache);
      await db.delete(cards);
      await db.delete(cardSets);
      await db.delete(mainSets);
      await db.delete(userBadges);
      await db.delete(messages);
      await db.delete(friends);
      await db.delete(users);
    } catch (error) {
      console.error('Error clearing all data:', error);
      throw new Error('Failed to clear all data');
    }
  }

  // Social Features - Friends
  async getFriends(userId: number): Promise<FriendWithUser[]> {
    const friendships = await db
      .select({
        id: friends.id,
        requesterId: friends.requesterId,
        recipientId: friends.recipientId,
        status: friends.status,
        createdAt: friends.createdAt,
        updatedAt: friends.updatedAt,
        requester: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
          bio: users.bio,
          location: users.location,
          profileVisibility: users.profileVisibility,
        },
        recipient: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
          bio: users.bio,
          location: users.location,
          profileVisibility: users.profileVisibility,
        }
      })
      .from(friends)
      .leftJoin(users, eq(friends.requesterId, users.id))
      .where(
        and(
          eq(friends.status, "accepted"),
          or(
            eq(friends.requesterId, userId),
            eq(friends.recipientId, userId)
          )
        )
      );

    return friendships.map(f => ({
      ...f,
      requester: f.requester as User,
      recipient: f.recipient as User
    }));
  }

  async getFriendRequests(userId: number): Promise<FriendWithUser[]> {
    const requests = await db
      .select({
        id: friends.id,
        requesterId: friends.requesterId,
        recipientId: friends.recipientId,
        status: friends.status,
        createdAt: friends.createdAt,
        updatedAt: friends.updatedAt,
        requester: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
          bio: users.bio,
          location: users.location,
          profileVisibility: users.profileVisibility,
        },
        recipient: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
          bio: users.bio,
          location: users.location,
          profileVisibility: users.profileVisibility,
        }
      })
      .from(friends)
      .leftJoin(users, eq(friends.requesterId, users.id))
      .where(
        and(
          eq(friends.recipientId, userId),
          eq(friends.status, "pending")
        )
      );

    return requests.map(r => ({
      ...r,
      requester: r.requester as User,
      recipient: r.recipient as User
    }));
  }

  async sendFriendRequest(requesterId: number, recipientId: number): Promise<Friend> {
    const [friendship] = await db
      .insert(friends)
      .values({
        requesterId,
        recipientId,
        status: "pending"
      })
      .returning();
    return friendship;
  }

  async respondToFriendRequest(friendId: number, status: "accepted" | "declined"): Promise<Friend | undefined> {
    const [updated] = await db
      .update(friends)
      .set({ status, updatedAt: new Date() })
      .where(eq(friends.id, friendId))
      .returning();
    return updated || undefined;
  }

  async getFriendshipStatus(userId1: number, userId2: number): Promise<Friend | undefined> {
    const [friendship] = await db
      .select()
      .from(friends)
      .where(
        or(
          and(eq(friends.requesterId, userId1), eq(friends.recipientId, userId2)),
          and(eq(friends.requesterId, userId2), eq(friends.recipientId, userId1))
        )
      )
      .limit(1);
    return friendship || undefined;
  }

  async removeFriend(friendId: number): Promise<void> {
    await db.delete(friends).where(eq(friends.id, friendId));
  }

  // Social Features - Messages
  async getMessages(userId1: number, userId2: number): Promise<MessageWithUsers[]> {
    const messageList = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        recipientId: messages.recipientId,
        content: messages.content,
        isRead: messages.isRead,
        createdAt: messages.createdAt,
        sender: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
        },
        recipient: {
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          photoURL: users.photoURL,
        }
      })
      .from(messages)
      .leftJoin(users, eq(messages.senderId, users.id))
      .where(
        or(
          and(eq(messages.senderId, userId1), eq(messages.recipientId, userId2)),
          and(eq(messages.senderId, userId2), eq(messages.recipientId, userId1))
        )
      )
      .orderBy(messages.createdAt);

    return messageList.map(m => ({
      ...m,
      sender: m.sender as User,
      recipient: m.recipient as User
    }));
  }

  async sendMessage(senderId: number, recipientId: number, content: string): Promise<Message> {
    const [message] = await db
      .insert(messages)
      .values({
        senderId,
        recipientId,
        content,
        isRead: false
      })
      .returning();
    return message;
  }

  async markMessageAsRead(messageId: number): Promise<void> {
    await db
      .update(messages)
      .set({ isRead: true })
      .where(eq(messages.id, messageId));
  }

  async getUnreadMessageCount(userId: number): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(messages)
      .where(
        and(
          eq(messages.recipientId, userId),
          eq(messages.isRead, false)
        )
      );
    return result.count;
  }

  async getMessageThreads(userId: number): Promise<{ user: User; lastMessage: Message; unreadCount: number }[]> {
    // This is a complex query - we'll implement a simpler version for now
    const recentMessages = await db
      .select()
      .from(messages)
      .where(
        or(
          eq(messages.senderId, userId),
          eq(messages.recipientId, userId)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(100);

    // Group by conversation partner and get most recent message
    const threads: { [key: number]: { user: User; lastMessage: Message; unreadCount: number } } = {};
    
    for (const message of recentMessages) {
      const partnerId = message.senderId === userId ? message.recipientId : message.senderId;
      
      if (!threads[partnerId]) {
        const partner = await this.getUser(partnerId);
        if (partner) {
          threads[partnerId] = {
            user: partner,
            lastMessage: message,
            unreadCount: 0
          };
        }
      }
      
      // Count unread messages from this partner
      if (message.recipientId === userId && !message.isRead) {
        threads[partnerId].unreadCount++;
      }
    }

    return Object.values(threads);
  }

  // Social Features - Badges
  async getBadges(): Promise<Badge[]> {
    return await db
      .select()
      .from(badges)
      .where(eq(badges.isActive, true))
      .orderBy(badges.category, badges.name);
  }

  async getUserBadges(userId: number): Promise<(UserBadge & { badge: Badge })[]> {
    const userBadgeList = await db
      .select({
        id: userBadges.id,
        userId: userBadges.userId,
        badgeId: userBadges.badgeId,
        earnedAt: userBadges.earnedAt,
        badge: {
          id: badges.id,
          name: badges.name,
          description: badges.description,
          iconUrl: badges.iconUrl,
          category: badges.category,
          requirement: badges.requirement,
          isActive: badges.isActive,
          createdAt: badges.createdAt,
        }
      })
      .from(userBadges)
      .innerJoin(badges, eq(userBadges.badgeId, badges.id))
      .where(eq(userBadges.userId, userId))
      .orderBy(desc(userBadges.earnedAt));

    return userBadgeList.map(ub => ({
      ...ub,
      badge: ub.badge as Badge
    }));
  }

  async awardBadge(userId: number, badgeId: number): Promise<UserBadge> {
    const [userBadge] = await db
      .insert(userBadges)
      .values({ userId, badgeId })
      .returning();
    return userBadge;
  }

  async checkAndAwardBadges(userId: number): Promise<UserBadge[]> {
    const awarded: UserBadge[] = [];
    
    try {
      // Get user's current badges
      const currentBadges = await this.getUserBadges(userId);
      const currentBadgeIds = currentBadges.map(b => b.badgeId);
      
      // Get user's collection stats
      const stats = await this.getCollectionStats(userId);
      const user = await this.getUser(userId);
      
      // Check for badge achievements
      const allBadges = await this.getBadges();
      
      for (const badge of allBadges) {
        // Skip if user already has this badge
        if (currentBadgeIds.includes(badge.id)) continue;
        
        // Parse badge requirement
        const requirement = JSON.parse(badge.requirement);
        let shouldAward = false;
        
        switch (requirement.type) {
          case 'collection_count':
            shouldAward = stats.totalCards >= requirement.value;
            break;
            
          case 'insert_count':
            const insertCount = await db.select({ count: sql`count(*)` })
              .from(userCollections)
              .leftJoin(cards, eq(userCollections.cardId, cards.id))
              .where(and(
                eq(userCollections.userId, userId),
                eq(cards.isInsert, true)
              ));
            shouldAward = Number(insertCount[0].count) >= requirement.value;
            break;
            
          case 'completed_sets':
            // For now, we'll use a simple approximation
            shouldAward = stats.completedSets >= requirement.value;
            break;
            
          case 'friend_count':
            const friendCount = await db.select({ count: sql`count(*)` })
              .from(friends)
              .where(and(
                or(
                  eq(friends.requesterId, userId),
                  eq(friends.recipientId, userId)
                ),
                eq(friends.status, 'accepted')
              ));
            shouldAward = Number(friendCount[0].count) >= requirement.value;
            break;
            
          case 'message_sent':
          case 'messages_sent':
            const messageCount = await db.select({ count: sql`count(*)` })
              .from(messages)
              .where(eq(messages.senderId, userId));
            shouldAward = Number(messageCount[0].count) >= requirement.value;
            break;
            
          case 'cards_with_notes':
            const notesCount = await db.select({ count: sql`count(*)` })
              .from(userCollections)
              .where(and(
                eq(userCollections.userId, userId),
                isNotNull(userCollections.notes)
              ));
            shouldAward = Number(notesCount[0].count) >= requirement.value;
            break;
            
          case 'login_streak':
            shouldAward = user ? user.loginStreak >= requirement.value : false;
            break;
            
          case 'launch_month':
            if (user) {
              const userCreated = new Date(user.createdAt);
              const launchMonth = new Date('2025-06-01');
              shouldAward = userCreated.getMonth() === launchMonth.getMonth() && 
                           userCreated.getFullYear() === launchMonth.getFullYear();
            }
            break;
            
          case 'user_number':
            shouldAward = user ? user.id <= requirement.value : false;
            break;
            
          case 'cards_added_daily':
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            const dailyCount = await db.select({ count: sql`count(*)` })
              .from(userCollections)
              .where(and(
                eq(userCollections.userId, userId),
                gte(userCollections.acquiredDate, today),
                lt(userCollections.acquiredDate, tomorrow)
              ));
            shouldAward = Number(dailyCount[0].count) >= requirement.value;
            break;
            
          case 'night_activity':
            const now = new Date();
            const hour = now.getHours();
            shouldAward = hour >= 0 && hour <= 6;
            break;
            
          default:
            console.log(`Unknown badge requirement type: ${requirement.type}`);
            break;
        }
        
        if (shouldAward) {
          try {
            const newBadge = await this.awardBadge(userId, badge.id);
            awarded.push(newBadge);
          } catch (error) {
            console.error('Error awarding badge:', error);
          }
        }
      }
      
      return awarded;
    } catch (error) {
      console.error('Error checking and awarding badges:', error);
      return [];
    }
  }

  async createBadge(insertBadge: InsertBadge): Promise<Badge> {
    const [badge] = await db
      .insert(badges)
      .values(insertBadge)
      .returning();
    return badge;
  }

  // Social Features - Profiles
  async getProfileStats(userId: number): Promise<ProfileStats> {
    const collectionStats = await this.getCollectionStats(userId);
    const friendsCount = (await this.getFriends(userId)).length;
    const badgesCount = (await this.getUserBadges(userId)).length;
    const user = await this.getUser(userId);
    
    return {
      totalCards: collectionStats.totalCards,
      totalValue: collectionStats.totalValue,
      wishlistItems: collectionStats.wishlistItems,
      friendsCount,
      badgesCount,
      completedSets: collectionStats.completedSets,
      loginStreak: user?.loginStreak || 0,
    };
  }

  async updateProfileVisibility(userId: number, visibility: "public" | "friends" | "private"): Promise<void> {
    await db
      .update(users)
      .set({ profileVisibility: visibility })
      .where(eq(users.id, userId));
  }

  async canViewProfile(viewerUserId: number, targetUserId: number): Promise<boolean> {
    // Users can always view their own profile
    if (viewerUserId === targetUserId) return true;
    
    const targetUser = await this.getUser(targetUserId);
    if (!targetUser) return false;
    
    // Check visibility settings
    switch (targetUser.profileVisibility) {
      case "public":
        return true;
      case "private":
        return false;
      case "friends":
        // Check if they're friends
        const friendship = await this.getFriendshipStatus(viewerUserId, targetUserId);
        return friendship?.status === "accepted";
      default:
        return false;
    }
  }
}

export const storage = new DatabaseStorage();