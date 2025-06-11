/**
 * Optimized storage methods for large datasets (60,000+ cards)
 * Focus on pagination, lightweight queries, and performance
 */

import { 
  users, 
  cardSets, 
  cards, 
  userCollections, 
  userWishlists,
  cardPriceCache,
  type CardWithSet,
  type CollectionItem
} from "@shared/schema";
import { db } from "./db";
import { eq, ilike, and, count, sum, desc, sql, isNull, or, lt, gte } from "drizzle-orm";

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface LightweightCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number;
  isInsert: boolean;
}

export class OptimizedStorage {
  
  /**
   * Get cards with pagination and lightweight data
   */
  async getCardsPaginated(
    page: number = 1,
    pageSize: number = 50,
    filters?: { setId?: number; search?: string; hasImage?: boolean }
  ): Promise<PaginatedResult<LightweightCard>> {
    const offset = (page - 1) * pageSize;
    
    let baseQuery = db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        frontImageUrl: cards.frontImageUrl,
        setName: cardSets.name,
        setYear: cardSets.year,
        isInsert: cards.isInsert
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id));

    let countQuery = db
      .select({ count: count() })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id));

    const conditions = [];

    if (filters?.setId) {
      conditions.push(eq(cards.setId, filters.setId));
    }

    if (filters?.search) {
      const searchCondition = or(
        ilike(cards.name, `%${filters.search}%`),
        ilike(cards.cardNumber, `%${filters.search}%`),
        ilike(cardSets.name, `%${filters.search}%`)
      );
      conditions.push(searchCondition);
    }

    if (filters?.hasImage === false) {
      conditions.push(isNull(cards.frontImageUrl));
    } else if (filters?.hasImage === true) {
      conditions.push(sql`${cards.frontImageUrl} IS NOT NULL`);
    }

    if (conditions.length > 0) {
      baseQuery = baseQuery.where(and(...conditions));
      countQuery = countQuery.where(and(...conditions));
    }

    const [items, totalResult] = await Promise.all([
      baseQuery
        .orderBy(desc(cards.id))
        .limit(pageSize)
        .offset(offset),
      countQuery
    ]);

    const totalCount = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      items,
      totalCount,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Get user collection with pagination
   */
  async getUserCollectionPaginated(
    userId: number,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedResult<CollectionItem>> {
    const offset = (page - 1) * pageSize;

    const [items, totalResult] = await Promise.all([
      db
        .select({
          id: userCollections.id,
          userId: userCollections.userId,
          cardId: userCollections.cardId,
          condition: userCollections.condition,
          acquiredDate: userCollections.acquiredDate,
          personalValue: userCollections.personalValue,
          notes: userCollections.notes,
          salePrice: userCollections.salePrice,
          isForSale: userCollections.isForSale,
          serialNumber: userCollections.serialNumber,
          quantity: userCollections.quantity,
          isFavorite: userCollections.isFavorite,
          card: {
            id: cards.id,
            name: cards.name,
            cardNumber: cards.cardNumber,
            frontImageUrl: cards.frontImageUrl,
            isInsert: cards.isInsert,
            rarity: cards.rarity,
            estimatedValue: cards.estimatedValue,
            set: {
              id: cardSets.id,
              name: cardSets.name,
              year: cardSets.year
            }
          }
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.acquiredDate))
        .limit(pageSize)
        .offset(offset),
      
      db
        .select({ count: count() })
        .from(userCollections)
        .where(eq(userCollections.userId, userId))
    ]);

    const totalCount = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      items: items as CollectionItem[],
      totalCount,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Get cards without images efficiently (for batch processing)
   */
  async getCardsWithoutImagesBatch(
    limit: number = 100,
    offset: number = 0
  ): Promise<CardWithSet[]> {
    return await db
      .select({
        id: cards.id,
        setId: cards.setId,
        cardNumber: cards.cardNumber,
        name: cards.name,
        description: cards.description,
        frontImageUrl: cards.frontImageUrl,
        set: {
          id: cardSets.id,
          name: cardSets.name,
          year: cardSets.year
        }
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(isNull(cards.frontImageUrl))
      .limit(limit)
      .offset(offset) as CardWithSet[];
  }

  /**
   * Get card sets with counts (optimized)
   */
  async getCardSetsOptimized(): Promise<Array<{ id: number; name: string; year: number; totalCards: number }>> {
    return await db
      .select({
        id: cardSets.id,
        name: cardSets.name,
        year: cardSets.year,
        totalCards: count(cards.id)
      })
      .from(cardSets)
      .leftJoin(cards, eq(cardSets.id, cards.setId))
      .groupBy(cardSets.id, cardSets.name, cardSets.year)
      .orderBy(desc(cardSets.year), cardSets.name);
  }

  /**
   * Get collection stats efficiently (minimal queries)
   */
  async getCollectionStatsOptimized(userId: number) {
    const [stats] = await db
      .select({
        totalCards: count(),
        totalValue: sum(userCollections.personalValue),
        insertCards: sql<number>`count(*) filter (where ${cards.isInsert} = true)`
      })
      .from(userCollections)
      .innerJoin(cards, eq(userCollections.cardId, cards.id))
      .where(eq(userCollections.userId, userId));

    const [wishlistCount] = await db
      .select({ count: count() })
      .from(userWishlists)
      .where(eq(userWishlists.userId, userId));

    return {
      totalCards: stats?.totalCards || 0,
      insertCards: stats?.insertCards || 0,
      totalValue: parseFloat(stats?.totalValue?.toString() || '0'),
      wishlistItems: wishlistCount?.count || 0,
      completedSets: 0, // Calculate separately if needed
      recentAdditions: 0, // Calculate separately if needed
      totalCardsGrowth: '+0%',
      insertCardsGrowth: '+0%',
      totalValueGrowth: '+0%',
      wishlistGrowth: '+0%'
    };
  }

  /**
   * Search cards efficiently with text search
   */
  async searchCards(
    query: string,
    limit: number = 20
  ): Promise<LightweightCard[]> {
    return await db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        frontImageUrl: cards.frontImageUrl,
        setName: cardSets.name,
        setYear: cardSets.year,
        isInsert: cards.isInsert
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .where(
        or(
          ilike(cards.name, `%${query}%`),
          ilike(cards.cardNumber, `%${query}%`),
          ilike(cardSets.name, `%${query}%`)
        )
      )
      .limit(limit);
  }

  /**
   * Get trending cards efficiently
   */
  async getTrendingCardsOptimized(limit: number = 10): Promise<LightweightCard[]> {
    return await db
      .select({
        id: cards.id,
        name: cards.name,
        cardNumber: cards.cardNumber,
        frontImageUrl: cards.frontImageUrl,
        setName: cardSets.name,
        setYear: cardSets.year,
        isInsert: cards.isInsert,
        collectionCount: count(userCollections.id)
      })
      .from(cards)
      .innerJoin(cardSets, eq(cards.setId, cardSets.id))
      .leftJoin(userCollections, eq(cards.id, userCollections.cardId))
      .groupBy(cards.id, cardSets.id, cardSets.name, cardSets.year)
      .orderBy(desc(count(userCollections.id)))
      .limit(limit) as LightweightCard[];
  }
}

export const optimizedStorage = new OptimizedStorage();