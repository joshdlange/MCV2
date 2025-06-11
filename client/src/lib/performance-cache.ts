/**
 * Advanced performance caching system for Marvel Card Vault
 * Implements intelligent cache management with TTL and memory optimization
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  size: number;
}

class PerformanceCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 50 * 1024 * 1024; // 50MB cache limit
  private currentSize = 0;

  set<T>(key: string, data: T, ttlMs: number = 300000): void { // 5 minute default TTL
    const size = this.estimateSize(data);
    
    // Clean up expired entries if cache is getting full
    if (this.currentSize + size > this.maxSize) {
      this.cleanup();
    }
    
    // If still too large, remove LRU entries
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.removeLRU();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
      size
    };

    // Remove existing entry if updating
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentSize -= existing.size;
    }

    this.cache.set(key, entry);
    this.currentSize += size;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key);
      return null;
    }

    // Update timestamp for LRU
    entry.timestamp = Date.now();
    return entry.data as T;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.delete(key);
      }
    }
  }

  private removeLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  private estimateSize(data: any): number {
    try {
      return JSON.stringify(data).length * 2; // Rough estimation
    } catch {
      return 1024; // Default size for non-serializable data
    }
  }

  getStats() {
    return {
      entries: this.cache.size,
      currentSize: this.currentSize,
      maxSize: this.maxSize,
      hitRate: this.calculateHitRate()
    };
  }

  private hitRate = { hits: 0, misses: 0 };

  private calculateHitRate(): number {
    const total = this.hitRate.hits + this.hitRate.misses;
    return total > 0 ? this.hitRate.hits / total : 0;
  }

  // Method to track cache performance
  trackHit(): void {
    this.hitRate.hits++;
  }

  trackMiss(): void {
    this.hitRate.misses++;
  }
}

// Singleton instance
export const performanceCache = new PerformanceCache();

// Cache key generators for consistent naming
export const cacheKeys = {
  cardSets: 'card-sets',
  cards: (filters: Record<string, any>) => `cards-${JSON.stringify(filters)}`,
  cardSet: (id: number) => `card-set-${id}`,
  card: (id: number) => `card-${id}`,
  collection: (userId: number, page?: number) => `collection-${userId}${page ? `-page-${page}` : ''}`,
  wishlist: (userId: number) => `wishlist-${userId}`,
  stats: (userId: number) => `stats-${userId}`,
  trending: (limit: number) => `trending-${limit}`,
  recentCards: (userId: number, limit: number) => `recent-${userId}-${limit}`,
  missingCards: (userId: number, setId: number) => `missing-${userId}-${setId}`,
  search: (query: string, limit?: number) => `search-${query}${limit ? `-${limit}` : ''}`
};