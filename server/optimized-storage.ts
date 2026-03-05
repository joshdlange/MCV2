import { db } from './db';
import { cards, cardSets, userCollections, userWishlists, cardPriceCache } from '../shared/schema';
import type { CardWithSet } from '../shared/schema';
import { eq, and, or, isNull, isNotNull, desc, asc, sql, count, ilike, gte, lte, inArray } from 'drizzle-orm';

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

const userStatsCache = new Map<number, { data: any; timestamp: number }>();
const USER_STATS_CACHE_TTL = 30_000;

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
    if (duration > 500) {
      console.log(`⚠️ Slow query: ${operation} took ${duration}ms`);
    }
  }
};

// Trending cards cache - refreshes every 6 hours
interface TrendingCache {
  cards: any[];
  lastUpdated: number;
  rotationSeed: number;
}
let trendingCache: TrendingCache | null = null;
const TRENDING_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (one daily rotation)

export class OptimizedStorage {
  invalidateUserStatsCache(userId: number) {
    userStatsCache.delete(userId);
  }
  
  /**
   * Get paginated cards with lightweight payload - OPTIMIZED
   */
  async getCardsPaginated(
    page: number = 1,
    pageSize: number = 50,
    filters: CardFilters = {}
  ): Promise<PaginatedResult<CardWithSet>> {
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
          conditions.push(sql`${cards.frontImageUrl} IS NOT NULL AND ${cards.frontImageUrl} != ''`);
        } else {
          conditions.push(sql`(${cards.frontImageUrl} IS NULL OR ${cards.frontImageUrl} = '')`);
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
          setId: cards.setId,
          name: cards.name,
          cardNumber: cards.cardNumber,
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

      // Build count query
      const countQuery = db
        .select({ count: count() })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id));

      // Apply where conditions and execute queries with proper numerical sorting
      const [items, totalResult] = await Promise.all([
        whereCondition 
          ? baseQuery.where(whereCondition).orderBy(cards.setId, sql`
              CASE 
                WHEN ${cards.cardNumber} ~ '^[0-9]+$' THEN LPAD(${cards.cardNumber}, 10, '0')
                ELSE ${cards.cardNumber}
              END
            `).limit(pageSize).offset(offset)
          : baseQuery.orderBy(cards.setId, sql`
              CASE 
                WHEN ${cards.cardNumber} ~ '^[0-9]+$' THEN LPAD(${cards.cardNumber}, 10, '0')
                ELSE ${cards.cardNumber}
              END
            `).limit(pageSize).offset(offset),
        whereCondition 
          ? countQuery.where(whereCondition)
          : countQuery
      ]);

      const totalCount = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      performanceTracker.logQuery(`getCardsPaginated(page=${page}, size=${pageSize})`, startTime);

      // Map results to proper CardWithSet structure
      const mappedItems = items.map(row => ({
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

      return {
        items: mappedItems,
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
    
    const cached = userStatsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < USER_STATS_CACHE_TTL) {
      performanceTracker.logQuery(`getUserStatsOptimized(userId=${userId}) [CACHED]`, startTime);
      return cached.data;
    }
    
    try {
      const result = await db.execute(sql`
        SELECT 
          COUNT(*) as total_cards,
          COUNT(*) FILTER (WHERE c.is_insert = true) as total_inserts,
          COALESCE(SUM(
            CASE 
              WHEN uc.personal_value IS NOT NULL AND uc.personal_value != '0' 
              THEN CAST(uc.personal_value AS DECIMAL)
              WHEN cpc.avg_price IS NOT NULL AND cpc.avg_price > 0
              THEN cpc.avg_price
              WHEN c.estimated_value IS NOT NULL 
              THEN c.estimated_value
              ELSE 0 
            END
          ), 0) as total_value,
          (SELECT COUNT(*) FROM user_wishlists WHERE user_id = ${userId}) as wishlist_count
        FROM user_collections uc
        INNER JOIN cards c ON c.id = uc.card_id
        LEFT JOIN card_price_cache cpc ON cpc.card_id = c.id
        WHERE uc.user_id = ${userId}
      `);

      const row = result.rows[0] || { total_cards: 0, total_inserts: 0, total_value: '0', wishlist_count: 0 };

      performanceTracker.logQuery(`getUserStatsOptimized(userId=${userId})`, startTime);

      const stats = {
        totalCards: Number(row.total_cards) || 0,
        insertCards: Number(row.total_inserts) || 0,
        totalValue: parseFloat(String(row.total_value || '0')),
        wishlistCount: Number(row.wishlist_count) || 0
      };
      
      userStatsCache.set(userId, { data: stats, timestamp: Date.now() });
      return stats;
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

      const results = await searchQuery
        .where(and(...conditions))
        .orderBy(cards.name)
        .limit(Math.min(limit, 50));

      performanceTracker.logQuery(`searchCardsOptimized("${query}")`, startTime);
      return results;
    } catch (error) {
      console.error('Error in searchCardsOptimized:', error);
      return [];
    }
  }

  /**
   * Get trending cards - INSERT cards only, no repeats for 30 days
   * Uses deterministic seeded shuffle so each day gets a unique set of 10 inserts
   * With 34k+ insert cards with images, we can go 3400+ days without repeating
   */
  async getTrendingCardsOptimized(limit: number = 10) {
    const startTime = Date.now();
    const dayOfYear = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const currentRotationSeed = dayOfYear;
    
    if (trendingCache && 
        trendingCache.rotationSeed === currentRotationSeed && 
        Date.now() - trendingCache.lastUpdated < TRENDING_CACHE_TTL) {
      performanceTracker.logQuery(`getTrendingCardsOptimized(${limit}) [CACHED]`, startTime);
      return trendingCache.cards.slice(0, limit);
    }
    
    try {
      // Get all insert card IDs with images (lightweight query - just IDs)
      const insertCardIds = await db
        .select({ id: cards.id })
        .from(cards)
        .where(and(
          eq(cards.isInsert, true),
          isNotNull(cards.frontImageUrl)
        ))
        .orderBy(cards.id);
      
      const totalInserts = insertCardIds.length;
      if (totalInserts === 0) {
        return this.getTrendingCardsFallback(limit);
      }

      // Deterministic shuffle using Knuth multiplicative hash
      // Each day gets a unique offset into the shuffled list
      // With 34k cards and 10/day, no repeat for ~3400 days
      const monthSlot = dayOfYear % Math.floor(totalInserts / limit);
      const startIdx = monthSlot * limit;
      
      // Create a seeded permutation using a hash function
      // This ensures the same day always picks the same cards
      // but different days pick completely different cards
      const shuffled = insertCardIds.map((card, idx) => ({
        id: card.id,
        hash: ((card.id * 2654435761 + Math.floor(dayOfYear / Math.floor(totalInserts / limit)) * 1597334677) >>> 0)
      }));
      shuffled.sort((a, b) => a.hash - b.hash);
      
      // Pick today's slice
      const todaysIds = shuffled.slice(startIdx, startIdx + limit).map(c => c.id);
      
      if (todaysIds.length === 0) {
        return this.getTrendingCardsFallback(limit);
      }

      // Fetch full card data for today's picks
      const todaysCards = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setName: cardSets.name,
          setYear: cardSets.year,
          isInsert: cards.isInsert,
          rarity: cards.rarity,
          mainSetId: cardSets.mainSetId,
        })
        .from(cards)
        .innerJoin(cardSets, eq(cards.setId, cardSets.id))
        .where(inArray(cards.id, todaysIds));

      // Ensure master set diversity in final ordering
      const diverseResults = this.ensureMasterSetDiversity(todaysCards, limit);

      trendingCache = {
        cards: diverseResults,
        lastUpdated: Date.now(),
        rotationSeed: currentRotationSeed
      };

      performanceTracker.logQuery(`getTrendingCardsOptimized(${limit})`, startTime);
      return diverseResults.slice(0, limit);
    } catch (error) {
      console.error('Error in getTrendingCardsOptimized:', error);
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