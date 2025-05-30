import { 
  users, cardSets, cards, userCollections, userWishlists,
  type User, type InsertUser, type CardSet, type InsertCardSet,
  type Card, type InsertCard, type CardWithSet, type CollectionItem,
  type WishlistItem, type UserCollection, type InsertUserCollection,
  type UserWishlist, type InsertUserWishlist, type CollectionStats
} from "@shared/schema";
import { db } from "./db";
import { eq, and, like, desc, count, sum } from "drizzle-orm";

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
    let query = db
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
        set: cardSets
      })
      .from(cards)
      .leftJoin(cardSets, eq(cards.setId, cardSets.id));

    const conditions = [];
    if (filters?.setId) conditions.push(eq(cards.setId, filters.setId));
    if (filters?.search) conditions.push(like(cards.name, `%${filters.search}%`));
    if (filters?.rarity) conditions.push(eq(cards.rarity, filters.rarity));
    if (filters?.isInsert !== undefined) conditions.push(eq(cards.isInsert, filters.isInsert));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return await query.orderBy(cards.cardNumber);
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
        set: cardSets
      })
      .from(cards)
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
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
      .orderBy(desc(userCollections.acquiredDate));
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
    return await db
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
          imageUrl: cards.imageUrl,
          rarity: cards.rarity,
          estimatedValue: cards.estimatedValue,
          createdAt: cards.createdAt,
          set: cardSets
        }
      })
      .from(userWishlists)
      .leftJoin(cards, eq(userWishlists.cardId, cards.id))
      .leftJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(eq(userWishlists.userId, userId))
      .orderBy(userWishlists.priority, desc(userWishlists.addedDate));
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
      completedSets: 0, // TODO: Implement set completion logic
      recentAdditions: 0 // TODO: Implement recent additions count
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