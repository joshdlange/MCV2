import { 
  users, 
  cardSets, 
  cards, 
  userCollections, 
  userWishlists,
  cardPriceCache,
  type User, 
  type InsertUser,
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
  type CollectionStats
} from "@shared/schema";
import { db } from "./db";
import { eq, ilike, and, count, sum, desc, sql, isNull } from "drizzle-orm";

interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByFirebaseUid(firebaseUid: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: number, insertUser: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;
  
  // Card Sets
  getCardSets(): Promise<CardSet[]>;
  getCardSet(id: number): Promise<CardSet | undefined>;
  createCardSet(insertCardSet: InsertCardSet): Promise<CardSet>;
  updateCardSet(id: number, updates: Partial<InsertCardSet>): Promise<CardSet | undefined>;
  
  // Cards
  getCards(filters?: { setId?: number; search?: string; rarity?: string; isInsert?: boolean }): Promise<CardWithSet[]>;
  getCard(id: number): Promise<CardWithSet | undefined>;
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
    if (!pricing) return null;
    return {
      avgPrice: parseFloat(pricing.avgPrice.toString()),
      salesCount: pricing.salesCount,
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

  async getCardSets(): Promise<CardSet[]> {
    try {
      const sets = await db.select().from(cardSets);
      
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
      console.error('Error getting card sets:', error);
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

  async createCardSet(insertCardSet: InsertCardSet): Promise<CardSet> {
    const [cardSet] = await db
      .insert(cardSets)
      .values(insertCardSet)
      .returning();
    return cardSet;
  }

  async updateCardSet(id: number, updates: Partial<InsertCardSet>): Promise<CardSet | undefined> {
    const [cardSet] = await db
      .update(cardSets)
      .set(updates)
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
            year: cardSets.year,
            description: cardSets.description,
            totalCards: cardSets.totalCards,
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
        conditions.push(ilike(cards.name, `%${filters.search}%`));
      }

      if (filters?.rarity) {
        conditions.push(eq(cards.rarity, filters.rarity));
      }

      if (filters?.isInsert !== undefined) {
        conditions.push(eq(cards.isInsert, filters.isInsert));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Sort by card number when filtering by set, otherwise by creation date
      if (filters?.setId) {
        // Use SQL to cast cardNumber to integer for proper numerical sorting
        query = query.orderBy(sql`CAST(REGEXP_REPLACE(${cards.cardNumber}, '[^0-9]', '', 'g') AS INTEGER)`);
      } else {
        query = query.orderBy(cards.createdAt);
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
            year: cardSets.year,
            description: cardSets.description,
            totalCards: cardSets.totalCards,
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
        .where(eq(userCollections.userId, userId));

      return results.map(row => ({
        id: row.id,
        userId: row.userId,
        cardId: row.cardId,
        condition: row.condition,
        acquiredDate: row.acquiredDate,
        personalValue: row.personalValue,
        salePrice: row.salePrice,
        isForSale: row.isForSale,
        serialNumber: row.serialNumber,
        quantity: row.quantity,
        isFavorite: row.isFavorite,
        notes: row.notes,
        card: row.card
      }));
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
            year: cardSets.year,
            description: cardSets.description,
            totalCards: cardSets.totalCards,
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
        id: row.id,
        userId: row.userId,
        cardId: row.cardId,
        priority: row.priority,
        maxPrice: row.maxPrice,
        notes: row.notes,
        createdAt: row.createdAt,
        card: row.card
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
      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

      // Current counts
      const totalCardsResult = await db
        .select({ count: count() })
        .from(userCollections)
        .where(eq(userCollections.userId, userId));

      const insertCardsResult = await db
        .select({ count: count() })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(and(eq(userCollections.userId, userId), eq(cards.isInsert, true)));

      const totalValueResult = await db
        .select({ total: sum(cards.estimatedValue) })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(eq(userCollections.userId, userId));

      const wishlistResult = await db
        .select({ count: count() })
        .from(userWishlists)
        .where(eq(userWishlists.userId, userId));

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

      // Calculate growth percentages
      const currentTotal = totalCardsResult[0]?.count || 0;
      const previousTotal = totalCardsLastMonth[0]?.count || 0;
      const totalGrowth = this.calculateGrowthPercentage(currentTotal, previousTotal);

      const currentInserts = insertCardsResult[0]?.count || 0;
      const previousInserts = insertCardsLastMonth[0]?.count || 0;
      const insertGrowth = this.calculateGrowthPercentage(currentInserts, previousInserts);

      const currentWishlist = wishlistResult[0]?.count || 0;
      const previousWishlist = wishlistLastMonth[0]?.count || 0;
      const wishlistGrowth = this.calculateGrowthPercentage(currentWishlist, previousWishlist);

      return {
        totalCards: currentTotal,
        insertCards: currentInserts,
        totalValue: parseFloat(totalValueResult[0]?.total || '0'),
        wishlistItems: currentWishlist,
        completedSets: 0,
        recentAdditions: 0,
        totalCardsGrowth: totalGrowth,
        insertCardsGrowth: insertGrowth,
        totalValueGrowth: '0%', // Will implement when pricing data is available
        wishlistGrowth: wishlistGrowth
      };
    } catch (error) {
      console.error('Error getting collection stats:', error);
      return {
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
      // Get cards ordered by how many times they've been added to collections
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
          collectionCount: count(userCollections.id),
          set: {
            id: cardSets.id,
            name: cardSets.name,
            year: cardSets.year,
            description: cardSets.description,
            totalCards: cardSets.totalCards,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .leftJoin(userCollections, eq(cards.id, userCollections.cardId))
        .groupBy(cards.id, cardSets.id)
        .orderBy(desc(count(userCollections.id)))
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
      console.error('Error getting trending cards:', error);
      return [];
    }
  }

  async getMissingCardsInSet(userId: number, setId: number): Promise<CardWithSet[]> {
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
            year: cardSets.year,
            description: cardSets.description,
            imageUrl: cardSets.imageUrl,
            totalCards: cardSets.totalCards,
            createdAt: cardSets.createdAt,
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .leftJoin(userCollections, and(
          eq(userCollections.cardId, cards.id),
          eq(userCollections.userId, userId)
        ))
        .where(and(
          eq(cards.setId, setId),
          isNull(userCollections.id)
        ))
        .orderBy(sql`CAST(${cards.cardNumber} AS INTEGER)`);
      
      return results as CardWithSet[];
    } catch (error) {
      console.error('Error getting missing cards:', error);
      return [];
    }
  }
}

export const storage = new DatabaseStorage();