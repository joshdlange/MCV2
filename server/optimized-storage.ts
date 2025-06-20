import { db } from './db';
import { cards, cardSets, userCollections, userWishlists, cardPriceCache } from '../shared/schema';
import { eq, and, or, isNull, desc, asc, sql, count, ilike, gte, lte } from 'drizzle-orm';

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface LightweightCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number;
  isInsert: boolean;
  rarity: string;
}

interface CardFilters {
  setId?: number;
  rarity?: string;
  isInsert?: boolean;
  hasImage?: boolean;
  search?: string;
}

// Performance monitoring
const performanceTracker = {
  startTime: 0,
  logQuery: (operation: string, startTime: number) => {
    const duration = Date.now() - startTime;
    if (duration > 100) {
      console.log(`⚠️ Slow query: ${operation} took ${duration}ms`);
    }
  }
};

export class OptimizedStorage {
  /**
   * Get paginated cards with lightweight payload - OPTIMIZED
   */
  async getCardsPaginated(
    page: number = 1,
    pageSize: number = 50,
    filters: CardFilters = {}
  ): Promise<PaginatedResult<LightweightCard>> {
    const startTime = Date.now();
    
    try {
      // Limit page size to prevent abuse
      pageSize = Math.min(pageSize, 100);
      const offset = (page - 1) * pageSize;

      // Build conditions array
      const conditions = [];

      if (filters.setId) {
        conditions.push(eq(cards.setId, filters.setId));
      }

      if (filters.rarity) {
        conditions.push(eq(cards.rarity, filters.rarity));
      }

      if (filters.isInsert !== undefined) {
        conditions.push(eq(cards.isInsert, filters.isInsert));
      }

      if (filters.hasImage !== undefined) {
        if (filters.hasImage) {
          conditions.push(sql`${cards.frontImageUrl} IS NOT NULL`);
        } else {
          conditions.push(sql`${cards.frontImageUrl} IS NULL`);
        }
      }

      if (filters.search && filters.search.length >= 2) {
        conditions.push(
          or(
            ilike(cards.name, `%${filters.search}%`),
            ilike(cardSets.name, `%${filters.search}%`)
          )
        );
      }

      // Build the where condition
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      // Build main query
      const baseQuery = db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id));

      // Build count query
      const countQuery = db
        .select({ count: count() })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id));

      // Apply where conditions and execute queries
      const [items, totalResult] = await Promise.all([
        whereCondition 
          ? baseQuery.where(whereCondition).orderBy(cards.setId, cards.cardNumber).limit(pageSize).offset(offset)
          : baseQuery.orderBy(cards.setId, cards.cardNumber).limit(pageSize).offset(offset),
        whereCondition 
          ? countQuery.where(whereCondition)
          : countQuery
      ]);

      const totalCount = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      performanceTracker.logQuery(`getCardsPaginated(page=${page}, size=${pageSize})`, startTime);

      return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      };
    } catch (error) {
      console.error('Error in getCardsPaginated:', error);
      return {
        items: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false
      };
    }
  }

  /**
   * Get user collection with pagination - OPTIMIZED
   */
  async getUserCollectionPaginated(
    userId: number,
    page: number = 1,
    pageSize: number = 50
  ): Promise<PaginatedResult<any>> {
    const startTime = Date.now();
    
    try {
      pageSize = Math.min(pageSize, 100);
      const offset = (page - 1) * pageSize;

      // Optimized collection query
      const itemsQuery = db
        .select({
          id: userCollections.id,
          cardId: userCollections.cardId,
          condition: userCollections.condition,
          acquiredDate: userCollections.acquiredDate,
          personalValue: userCollections.personalValue,
          notes: userCollections.notes,
          cardName: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.acquiredDate))
        .limit(pageSize)
        .offset(offset);

      // Count query
      const countQuery = db
        .select({ count: count() })
        .from(userCollections)
        .where(eq(userCollections.userId, userId));

      const [items, totalResult] = await Promise.all([
        itemsQuery,
        countQuery
      ]);

      const totalCount = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      performanceTracker.logQuery(`getUserCollectionPaginated(userId=${userId})`, startTime);

      return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1
      };
    } catch (error) {
      console.error('Error in getUserCollectionPaginated:', error);
      return {
        items: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false
      };
    }
  }

  /**
   * Get dashboard stats with optimized single query
   */
  async getUserStatsOptimized(userId: number) {
    const startTime = Date.now();
    
    try {
      // First get the basic stats without pricing
      const basicStatsQuery = await db
        .select({
          totalCards: count(),
          totalInserts: sql<number>`COUNT(*) FILTER (WHERE ${cards.isInsert} = true)`,
          wishlistCount: sql<number>`(SELECT COUNT(*) FROM ${userWishlists} WHERE user_id = ${userId})`
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .where(eq(userCollections.userId, userId));

      // Separate query for total value calculation to handle pricing properly
      const valueQuery = await db
        .select({
          totalValue: sql<string>`COALESCE(SUM(
            CASE 
              WHEN uc.personal_value IS NOT NULL AND uc.personal_value != '0' 
              THEN CAST(uc.personal_value AS DECIMAL)
              WHEN cpc.avg_price IS NOT NULL AND cpc.avg_price > 0
              THEN cpc.avg_price
              WHEN c.estimated_value IS NOT NULL 
              THEN c.estimated_value
              ELSE 0 
            END
          ), 0)`
        })
        .from(sql`user_collections uc`)
        .innerJoin(sql`cards c`, sql`uc.card_id = c.id`)
        .leftJoin(sql`card_price_cache cpc`, sql`c.id = cpc.card_id`)
        .where(sql`uc.user_id = ${userId}`);

      const basicStats = basicStatsQuery[0] || { totalCards: 0, totalInserts: 0, wishlistCount: 0 };
      const valueResult = valueQuery[0] || { totalValue: '0' };

      performanceTracker.logQuery(`getUserStatsOptimized(userId=${userId})`, startTime);

      return {
        totalCards: basicStats.totalCards,
        insertCards: basicStats.totalInserts,
        totalValue: parseFloat(valueResult.totalValue || '0'),
        wishlistCount: basicStats.wishlistCount
      };
    } catch (error) {
      console.error('Error in getUserStatsOptimized:', error);
      return {
        totalCards: 0,
        insertCards: 0,
        totalValue: 0,
        wishlistCount: 0
      };
    }
  }

  /**
   * Get cards without images in batches - OPTIMIZED
   */
  async getCardsWithoutImagesBatch(limit: number = 50, offset: number = 0) {
    const startTime = Date.now();
    
    try {
      const results = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          setId: cards.setId,
          description: cards.description,
          set: {
            id: cardSets.id,
            name: cardSets.name
          }
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(isNull(cards.frontImageUrl))
        .limit(limit)
        .offset(offset)
        .orderBy(cards.id);

      performanceTracker.logQuery(`getCardsWithoutImagesBatch(${limit}, ${offset})`, startTime);
      return results;
    } catch (error) {
      console.error('Error in getCardsWithoutImagesBatch:', error);
      return [];
    }
  }

  /**
   * Search cards with optimized text search
   */
  async searchCardsOptimized(
    query: string,
    limit: number = 20,
    filters: CardFilters = {}
  ): Promise<LightweightCard[]> {
    const startTime = Date.now();
    
    try {
      if (query.length < 2) return [];

      let searchQuery = db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id));

      const conditions = [
        or(
          ilike(cards.name, `%${query}%`),
          ilike(cardSets.name, `%${query}%`),
          ilike(cards.cardNumber, `%${query}%`)
        )
      ];

      // Apply additional filters
      if (filters.setId) {
        conditions.push(eq(cards.setId, filters.setId));
      }

      if (filters.isInsert !== undefined) {
        conditions.push(eq(cards.isInsert, filters.isInsert));
      }

      searchQuery = searchQuery
        .where(and(...conditions))
        .orderBy(cards.name)
        .limit(Math.min(limit, 50));

      const results = await searchQuery;

      performanceTracker.logQuery(`searchCardsOptimized("${query}")`, startTime);
      return results;
    } catch (error) {
      console.error('Error in searchCardsOptimized:', error);
      return [];
    }
  }

  /**
   * Get trending cards with enhanced algorithm: median pricing, quality images, insert preference, master set variety
   */
  async getTrendingCardsOptimized(limit: number = 10) {
    const startTime = Date.now();
    
    try {
      // First, get price statistics to determine median range
      const priceStats = await db
        .select({
          percentile25: sql<number>`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${cardPriceCache.avgPrice})`,
          percentile75: sql<number>`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${cardPriceCache.avgPrice})`,
          median: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${cardPriceCache.avgPrice})`
        })
        .from(cardPriceCache)
        .where(sql`${cardPriceCache.avgPrice} > 0`);

      const { percentile25, percentile75, median } = priceStats[0] || { percentile25: 1, percentile75: 10, median: 3 };

      // Time-based seed for rotation (changes every 6 hours)
      const rotationSeed = Math.floor(Date.now() / (6 * 60 * 60 * 1000));

      // Get qualified trending cards with enhanced scoring
      const results = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity,
          avgPrice: cardPriceCache.avgPrice,
          priceDate: cardPriceCache.createdAt,
          mainSetId: cardSets.mainSetId,
          // Enhanced scoring algorithm
          trendingScore: sql<number>`
            (
              -- Base collection popularity score
              COALESCE(COUNT(${userCollections.id}), 0) * 1.0 +
              
              -- Insert card bonus (2x multiplier)
              CASE WHEN ${cards.isInsert} = true THEN 10.0 ELSE 0.0 END +
              
              -- Price quality score (median range preferred)
              CASE 
                WHEN ${cardPriceCache.avgPrice} BETWEEN ${percentile25} AND ${percentile75} THEN 8.0
                WHEN ${cardPriceCache.avgPrice} IS NOT NULL THEN 4.0
                ELSE 0.0
              END +
              
              -- Image quality bonus
              CASE WHEN ${cards.frontImageUrl} IS NOT NULL THEN 5.0 ELSE 0.0 END +
              
              -- Rotation factor for variety (time-based pseudo-random)
              (CAST(${cards.id} AS FLOAT) * 0.1 * ${rotationSeed}) % 10.0
            )
          `
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .leftJoin(userCollections, eq(cards.id, userCollections.cardId))
        .leftJoin(cardPriceCache, eq(cards.id, cardPriceCache.cardId))
        .where(
          and(
            isNotNull(cards.frontImageUrl), // Must have image
            or(
              isNotNull(cardPriceCache.avgPrice), // Has pricing data
              eq(cards.isInsert, true) // Or is an insert
            )
          )
        )
        .groupBy(
          cards.id, cardSets.id, cardSets.name, cardSets.year, cards.name, 
          cards.cardNumber, cards.frontImageUrl, cards.isInsert, cards.rarity, 
          cardPriceCache.avgPrice, cardPriceCache.createdAt, cardSets.mainSetId
        )
        .orderBy(sql`trendingScore DESC`)
        .limit(Math.min(limit * 3, 50)); // Get more candidates for diversity filtering

      // Ensure master set variety - select diverse cards from different master sets
      const diverseResults = this.ensureMasterSetDiversity(results, limit);

      performanceTracker.logQuery(`getTrendingCardsOptimized(${limit})`, startTime);
      return diverseResults;
    } catch (error) {
      console.error('Error in getTrendingCardsOptimized:', error);
      // Fallback to simple query if enhanced algorithm fails
      return this.getTrendingCardsFallback(limit);
    }
  }

  /**
   * Ensure master set diversity in trending cards
   */
  private ensureMasterSetDiversity(candidates: any[], limit: number): any[] {
    const masterSetGroups = new Map<number, any[]>();
    const diverseCards: any[] = [];
    
    // Group cards by master set
    candidates.forEach(card => {
      const mainSetId = card.mainSetId || 0;
      if (!masterSetGroups.has(mainSetId)) {
        masterSetGroups.set(mainSetId, []);
      }
      masterSetGroups.get(mainSetId)!.push(card);
    });

    // Round-robin selection from different master sets
    const masterSetIds = Array.from(masterSetGroups.keys());
    let currentSetIndex = 0;
    
    while (diverseCards.length < limit && masterSetIds.length > 0) {
      const currentMasterSetId = masterSetIds[currentSetIndex];
      const cardsFromSet = masterSetGroups.get(currentMasterSetId)!;
      
      if (cardsFromSet.length > 0) {
        diverseCards.push(cardsFromSet.shift()!);
      }
      
      // Remove master set if no more cards
      if (cardsFromSet.length === 0) {
        masterSetIds.splice(currentSetIndex, 1);
        if (currentSetIndex >= masterSetIds.length) {
          currentSetIndex = 0;
        }
      } else {
        currentSetIndex = (currentSetIndex + 1) % masterSetIds.length;
      }
    }
    
    return diverseCards;
  }

  /**
   * Fallback trending cards method (original algorithm)
   */
  private async getTrendingCardsFallback(limit: number = 10) {
    try {
      const results = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity,
          avgPrice: cardPriceCache.avgPrice,
          priceDate: cardPriceCache.createdAt
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .leftJoin(userCollections, eq(cards.id, userCollections.cardId))
        .leftJoin(cardPriceCache, eq(cards.id, cardPriceCache.cardId))
        .where(isNotNull(cards.frontImageUrl))
        .groupBy(cards.id, cardSets.id, cardSets.name, cardSets.year, cards.name, cards.cardNumber, cards.frontImageUrl, cards.isInsert, cards.rarity, cardPriceCache.avgPrice, cardPriceCache.createdAt)
        .orderBy(sql`COUNT(${userCollections.id}) DESC`)
        .limit(Math.min(limit, 20));

      return results;
    } catch (error) {
      console.error('Error in getTrendingCardsFallback:', error);
      return [];
    }
  }

  /**
   * Get recent cards for user with optimization
   */
  async getRecentCardsOptimized(userId: number, limit: number = 10) {
    const startTime = Date.now();
    
    try {
      const results = await db
        .select({
          id: userCollections.id,
          cardId: cards.id,
          cardName: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          acquiredDate: userCollections.acquiredDate,
          condition: userCollections.condition
        })
        .from(userCollections)
        .innerJoin(cards, eq(userCollections.cardId, cards.id))
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.acquiredDate))
        .limit(Math.min(limit, 20));

      performanceTracker.logQuery(`getRecentCardsOptimized(userId=${userId})`, startTime);
      return results;
    } catch (error) {
      console.error('Error in getRecentCardsOptimized:', error);
      return [];
    }
  }
}

export const optimizedStorage = new OptimizedStorage();