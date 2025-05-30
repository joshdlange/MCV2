import { 
  users, cardSets, cards, userCollections, userWishlists,
  type User, type InsertUser, type CardSet, type InsertCardSet,
  type Card, type InsertCard, type CardWithSet, type CollectionItem,
  type WishlistItem, type UserCollection, type InsertUserCollection,
  type UserWishlist, type InsertUserWishlist, type CollectionStats
} from "@shared/schema";
import { db } from "./db";
import { eq, and, like, desc, count, sum, gte, lt } from "drizzle-orm";

interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(insertUser: InsertUser): Promise<User>;
  
  // Card Sets
  getCardSets(): Promise<CardSet[]>;
  getCardSet(id: number): Promise<CardSet | undefined>;
  createCardSet(insertCardSet: InsertCardSet): Promise<CardSet>;
  
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
  
  // User Wishlists
  getUserWishlist(userId: number): Promise<WishlistItem[]>;
  addToWishlist(insertUserWishlist: InsertUserWishlist): Promise<UserWishlist>;
  removeFromWishlist(id: number): Promise<void>;
  
  // Stats
  getCollectionStats(userId: number): Promise<CollectionStats>;
  getRecentCards(userId: number, limit: number): Promise<CollectionItem[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getCardSets(): Promise<CardSet[]> {
    return await db.select().from(cardSets).orderBy(desc(cardSets.year));
  }

  async getCardSet(id: number): Promise<CardSet | undefined> {
    const [cardSet] = await db.select().from(cardSets).where(eq(cardSets.id, id));
    return cardSet || undefined;
  }

  async createCardSet(insertCardSet: InsertCardSet): Promise<CardSet> {
    const [cardSet] = await db
      .insert(cardSets)
      .values(insertCardSet)
      .returning();
    return cardSet;
  }

  async getCards(filters?: { setId?: number; search?: string; rarity?: string; isInsert?: boolean }): Promise<CardWithSet[]> {
    const baseQuery = db
      .select({
        id: cards.id,
        setId: cards.setId,
        cardNumber: cards.cardNumber,
        name: cards.name,
        variation: cards.variation,
        isInsert: cards.isInsert,
        imageUrl: cards.imageUrl,
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
    if (filters?.setId) conditions.push(eq(cards.setId, filters.setId));
    if (filters?.search) conditions.push(like(cards.name, `%${filters.search}%`));
    if (filters?.rarity) conditions.push(eq(cards.rarity, filters.rarity));
    if (filters?.isInsert !== undefined) conditions.push(eq(cards.isInsert, filters.isInsert));

    if (conditions.length > 0) {
      return await baseQuery.where(and(...conditions)).orderBy(cards.cardNumber);
    }

    return await baseQuery.orderBy(cards.cardNumber);
  }

  async getCard(id: number): Promise<CardWithSet | undefined> {
    const [card] = await db
      .select({
        id: cards.id,
        setId: cards.setId,
        cardNumber: cards.cardNumber,
        name: cards.name,
        variation: cards.variation,
        isInsert: cards.isInsert,
        imageUrl: cards.imageUrl,
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
    return card || undefined;
  }

  async createCard(insertCard: InsertCard): Promise<Card> {
    const [card] = await db
      .insert(cards)
      .values(insertCard)
      .returning();
    return card;
  }

  async updateCard(id: number, insertCard: InsertCard): Promise<Card | undefined> {
    const [card] = await db
      .update(cards)
      .set(insertCard)
      .where(eq(cards.id, id))
      .returning();
    return card || undefined;
  }

  async deleteCard(id: number): Promise<void> {
    await db.delete(cards).where(eq(cards.id, id));
  }

  async getUserCollection(userId: number): Promise<CollectionItem[]> {
    const result = await db
      .select()
      .from(userCollections)
      .leftJoin(cards, eq(userCollections.cardId, cards.id))
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(eq(userCollections.userId, userId))
      .orderBy(desc(userCollections.acquiredDate));

    return result.map(row => ({
      id: row.user_collections.id,
      userId: row.user_collections.userId,
      cardId: row.user_collections.cardId,
      condition: row.user_collections.condition,
      acquiredDate: row.user_collections.acquiredDate,
      personalValue: row.user_collections.personalValue,
      notes: row.user_collections.notes,
      card: {
        id: row.cards?.id || 0,
        setId: row.cards?.setId || 0,
        cardNumber: row.cards?.cardNumber || '',
        name: row.cards?.name || '',
        variation: row.cards?.variation,
        isInsert: row.cards?.isInsert || false,
        imageUrl: row.cards?.imageUrl,
        rarity: row.cards?.rarity || '',
        estimatedValue: row.cards?.estimatedValue,
        createdAt: row.cards?.createdAt || new Date(),
        set: {
          id: row.card_sets?.id || 0,
          name: row.card_sets?.name || '',
          year: row.card_sets?.year || 0,
          description: row.card_sets?.description,
          totalCards: row.card_sets?.totalCards || 0,
          createdAt: row.card_sets?.createdAt || new Date(),
        }
      }
    }));
  }

  async addToCollection(insertUserCollection: InsertUserCollection): Promise<UserCollection> {
    const [item] = await db
      .insert(userCollections)
      .values(insertUserCollection)
      .returning();
    return item;
  }

  async removeFromCollection(id: number): Promise<void> {
    await db.delete(userCollections).where(eq(userCollections.id, id));
  }

  async getUserWishlist(userId: number): Promise<WishlistItem[]> {
    const result = await db
      .select()
      .from(userWishlists)
      .leftJoin(cards, eq(userWishlists.cardId, cards.id))
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(eq(userWishlists.userId, userId))
      .orderBy(userWishlists.priority, desc(userWishlists.addedDate));

    return result.map(row => ({
      id: row.user_wishlists.id,
      userId: row.user_wishlists.userId,
      cardId: row.user_wishlists.cardId,
      priority: row.user_wishlists.priority,
      maxPrice: row.user_wishlists.maxPrice,
      addedDate: row.user_wishlists.addedDate,
      card: {
        id: row.cards?.id || 0,
        setId: row.cards?.setId || 0,
        cardNumber: row.cards?.cardNumber || '',
        name: row.cards?.name || '',
        variation: row.cards?.variation,
        isInsert: row.cards?.isInsert || false,
        imageUrl: row.cards?.imageUrl,
        rarity: row.cards?.rarity || '',
        estimatedValue: row.cards?.estimatedValue,
        createdAt: row.cards?.createdAt || new Date(),
        set: {
          id: row.card_sets?.id || 0,
          name: row.card_sets?.name || '',
          year: row.card_sets?.year || 0,
          description: row.card_sets?.description,
          totalCards: row.card_sets?.totalCards || 0,
          createdAt: row.card_sets?.createdAt || new Date(),
        }
      }
    }));
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
    const [collectionCount] = await db
      .select({ count: count() })
      .from(userCollections)
      .where(eq(userCollections.userId, userId));

    const [insertCount] = await db
      .select({ count: count() })
      .from(userCollections)
      .leftJoin(cards, eq(userCollections.cardId, cards.id))
      .where(and(eq(userCollections.userId, userId), eq(cards.isInsert, true)));

    const [valueSum] = await db
      .select({ total: sum(cards.estimatedValue) })
      .from(userCollections)
      .leftJoin(cards, eq(userCollections.cardId, cards.id))
      .where(eq(userCollections.userId, userId));

    const [wishlistCount] = await db
      .select({ count: count() })
      .from(userWishlists)
      .where(eq(userWishlists.userId, userId));

    return {
      totalCards: collectionCount.count || 0,
      insertCards: insertCount.count || 0,
      totalValue: parseFloat(valueSum.total || "0"),
      wishlistItems: wishlistCount.count || 0,
      completedSets: 0,
      recentAdditions: 0,
      totalCardsGrowth: "+12.5%",
      insertCardsGrowth: "+3.2%",
      totalValueGrowth: "+18.7%",
      wishlistGrowth: "-5.1%",
    };
  }

  async getRecentCards(userId: number, limit: number): Promise<CollectionItem[]> {
    return await db
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
          imageUrl: cards.imageUrl,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: cardSets
        }
      })
      .from(userCollections)
      .leftJoin(cards, eq(userCollections.cardId, cards.id))
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(eq(userCollections.userId, userId))
      .orderBy(desc(userCollections.acquiredDate))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();