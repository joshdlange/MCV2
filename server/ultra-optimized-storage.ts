import { db } from "./db";
import { cards, cardSets, mainSets } from "../shared/schema";
import { eq, sql, and, like, desc, ilike, or } from "drizzle-orm";

// Ultra-optimized storage with aggressive caching for sub-100ms performance
class UltraOptimizedStorage {
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  
  // Cache TTL settings
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly HOT_PAGE_TTL = 2 * 60 * 1000; // 2 minutes for page 1
  
  // Clear all cache
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Ultra-optimized cache cleared');
  }
  
  // Get from cache or execute query
  private async getCached<T>(key: string, queryFn: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();
    
    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.data;
    }
    
    const data = await queryFn();
    const cacheTtl = ttl || this.DEFAULT_TTL;
    
    this.cache.set(key, {
      data,
      timestamp: now,
      ttl: cacheTtl
    });
    
    return data;
  }
  
  // Generate cache key
  private getCacheKey(prefix: string, params: any): string {
    return `${prefix}:${JSON.stringify(params)}`;
  }
  
  // Ultra-optimized paginated cards query
  async getCardsPaginated(
    page: number = 1, 
    pageSize: number = 50, 
    filters: {
      setId?: number;
      rarity?: string;
      isInsert?: boolean;
      hasImage?: boolean;
      search?: string;
    } = {}
  ) {
    const startTime = Date.now();
    const offset = (page - 1) * pageSize;
    
    // Use hot cache for page 1 queries
    const ttl = page === 1 ? this.HOT_PAGE_TTL : this.DEFAULT_TTL;
    const cacheKey = this.getCacheKey('cards_paginated', { page, pageSize, filters });
    
    return this.getCached(cacheKey, async () => {
      // Build WHERE conditions
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
          conditions.push(sql`${cards.frontImageUrl} IS NULL OR ${cards.frontImageUrl} = ''`);
        }
      }
      
      if (filters.search) {
        // Use GIN index for fast text search
        conditions.push(
          or(
            ilike(cards.name, `%${filters.search}%`),
            ilike(cards.cardNumber, `%${filters.search}%`)
          )
        );
      }
      
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      // Execute optimized query with simplified structure
      const result = await db
        .select()
        .from(cards)
        .where(whereClause)
        .orderBy(desc(cards.id))
        .limit(pageSize)
        .offset(offset);
      
      // Get total count for pagination info
      let countQuery = db.select({ count: sql`count(*)`.mapWith(Number) }).from(cards);
      if (whereClause) {
        countQuery = countQuery.where(whereClause);
      }
      const totalResult = await countQuery;
      
      const total = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(total / pageSize);
      
      const duration = Date.now() - startTime;
      if (duration > 100) {
        console.log(`⚠️ Slow query: getCardsPaginated took ${duration}ms`);
      }
      
      return {
        items: result,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        performance: {
          queryTime: duration,
          cached: false
        }
      };
    }, ttl);
  }
  
  // Lightweight cards query with minimal data
  async getLightweightCardsPaginated(
    page: number = 1, 
    pageSize: number = 50, 
    filters: {
      setId?: number;
      rarity?: string;
      isInsert?: boolean;
      hasImage?: boolean;
      search?: string;
    } = {}
  ) {
    const startTime = Date.now();
    const offset = (page - 1) * pageSize;
    const cacheKey = this.getCacheKey('cards_lightweight', { page, pageSize, filters });
    
    return this.getCached(cacheKey, async () => {
      // Build WHERE conditions
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
          conditions.push(sql`${cards.frontImageUrl} IS NULL OR ${cards.frontImageUrl} = ''`);
        }
      }
      
      if (filters.search) {
        conditions.push(
          or(
            ilike(cards.name, `%${filters.search}%`),
            ilike(cards.cardNumber, `%${filters.search}%`)
          )
        );
      }
      
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      // Minimal data query for fast loading
      const result = await db
        .select({
          id: cards.id,
          name: cards.name,
          cardNumber: cards.cardNumber,
          frontImageUrl: cards.frontImageUrl,
          setId: cards.setId
        })
        .from(cards)
        .where(whereClause)
        .orderBy(desc(cards.id))
        .limit(pageSize)
        .offset(offset);
      
      // Quick count
      let countQuery = db.select({ count: sql`count(*)`.mapWith(Number) }).from(cards);
      if (whereClause) {
        countQuery = countQuery.where(whereClause);
      }
      const totalResult = await countQuery;
      
      const total = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(total / pageSize);
      
      const duration = Date.now() - startTime;
      
      return {
        items: result,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        performance: {
          queryTime: duration,
          cached: false,
          lightweight: true
        }
      };
    }, this.HOT_PAGE_TTL);
  }
  
  // Cache stats for monitoring
  getCacheStats() {
    const now = Date.now();
    let activeEntries = 0;
    let expiredEntries = 0;
    
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now - entry.timestamp < entry.ttl) {
        activeEntries++;
      } else {
        expiredEntries++;
      }
    }
    
    return {
      totalEntries: this.cache.size,
      activeEntries,
      expiredEntries,
      hitRate: activeEntries / (activeEntries + expiredEntries) || 0
    };
  }
  
  // Clean expired entries
  cleanExpiredEntries() {
    const now = Date.now();
    let cleaned = 0;
    
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now - entry.timestamp >= entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    return cleaned;
  }
}

// Export singleton instance
export const ultraOptimizedStorage = new UltraOptimizedStorage();

// Clean expired entries every 10 minutes
setInterval(() => {
  ultraOptimizedStorage.cleanExpiredEntries();
}, 10 * 60 * 1000);