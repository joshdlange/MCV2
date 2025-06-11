/**
 * Optimized React Query client with intelligent caching and batch operations
 * Designed for high-performance handling of 60,000+ card datasets
 */

import { QueryClient, QueryKey } from '@tanstack/react-query';
import { performanceCache, cacheKeys } from './performance-cache';

// Enhanced query client configuration
export const optimizedQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Aggressive caching for card data
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes (renamed from cacheTime)
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      // Use network-first for fresh data, then fall back to cache
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
});

// Custom fetcher with performance cache integration
export async function cachedApiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  cacheKey?: string,
  cacheTTL?: number
): Promise<T> {
  // Check performance cache first
  if (cacheKey) {
    const cached = performanceCache.get<T>(cacheKey);
    if (cached) {
      performanceCache.trackHit();
      return cached;
    }
    performanceCache.trackMiss();
  }

  // Make API request
  const response = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Cache the response
  if (cacheKey && cacheTTL) {
    performanceCache.set(cacheKey, data, cacheTTL);
  }

  return data;
}

// Batch request manager for multiple API calls
class BatchRequestManager {
  private batches = new Map<string, Promise<any>>();
  private batchTimeout = 50; // 50ms batch window

  async batchRequest<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    if (this.batches.has(key)) {
      return this.batches.get(key);
    }

    const promise = new Promise<T>((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.batches.delete(key);
        }
      }, this.batchTimeout);
    });

    this.batches.set(key, promise);
    return promise;
  }
}

export const batchManager = new BatchRequestManager();

// Optimized query functions with caching
export const optimizedQueries = {
  // Card sets with intelligent caching
  cardSets: {
    queryKey: [cacheKeys.cardSets],
    queryFn: () => cachedApiRequest(
      '/api/card-sets',
      {},
      cacheKeys.cardSets,
      10 * 60 * 1000 // 10 minute cache
    ),
    staleTime: 10 * 60 * 1000,
  },

  // Paginated cards with per-page caching
  cards: (filters: Record<string, any> = {}, page = 1, pageSize = 50) => ({
    queryKey: ['cards', filters, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...filters,
      });
      return cachedApiRequest(
        `/api/v2/cards?${params}`,
        {},
        cacheKeys.cards({ ...filters, page, pageSize }),
        5 * 60 * 1000 // 5 minute cache
      );
    },
    staleTime: 5 * 60 * 1000,
    keepPreviousData: true, // For smooth pagination
  }),

  // Individual card with long cache
  card: (id: number) => ({
    queryKey: ['card', id],
    queryFn: () => cachedApiRequest(
      `/api/cards/${id}`,
      {},
      cacheKeys.card(id),
      15 * 60 * 1000 // 15 minute cache for individual cards
    ),
    staleTime: 15 * 60 * 1000,
    enabled: !!id,
  }),

  // User collection with pagination
  collection: (page = 1, pageSize = 50) => ({
    queryKey: ['collection', page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      return cachedApiRequest(
        `/api/v2/collection?${params}`,
        {},
        `collection-page-${page}`,
        3 * 60 * 1000 // 3 minute cache
      );
    },
    staleTime: 3 * 60 * 1000,
    keepPreviousData: true,
  }),

  // Stats with aggressive caching
  stats: (userId: number) => ({
    queryKey: ['stats', userId],
    queryFn: () => cachedApiRequest(
      '/api/stats',
      { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } },
      cacheKeys.stats(userId),
      5 * 60 * 1000 // 5 minute cache
    ),
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
  }),

  // Trending cards with long cache
  trending: (limit = 10) => ({
    queryKey: ['trending', limit],
    queryFn: () => cachedApiRequest(
      `/api/trending?limit=${limit}`,
      {},
      cacheKeys.trending(limit),
      15 * 60 * 1000 // 15 minute cache
    ),
    staleTime: 15 * 60 * 1000,
  }),

  // Search with short cache for fresh results
  search: (query: string, limit = 20) => ({
    queryKey: ['search', query, limit],
    queryFn: () => cachedApiRequest(
      `/api/v2/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      {},
      cacheKeys.search(query, limit),
      2 * 60 * 1000 // 2 minute cache
    ),
    staleTime: 2 * 60 * 1000,
    enabled: query.length > 2,
  }),
};

// Cache invalidation helpers
export const cacheInvalidation = {
  // Invalidate all card-related caches
  invalidateCards: () => {
    optimizedQueryClient.invalidateQueries({ queryKey: ['cards'] });
    optimizedQueryClient.invalidateQueries({ queryKey: ['card'] });
    performanceCache.delete(cacheKeys.cardSets);
  },

  // Invalidate user-specific caches
  invalidateUserData: (userId: number) => {
    optimizedQueryClient.invalidateQueries({ queryKey: ['collection'] });
    optimizedQueryClient.invalidateQueries({ queryKey: ['wishlist'] });
    optimizedQueryClient.invalidateQueries({ queryKey: ['stats'] });
    performanceCache.delete(cacheKeys.stats(userId));
  },

  // Smart invalidation based on mutation type
  smartInvalidate: (mutationType: 'card' | 'collection' | 'wishlist', userId?: number) => {
    switch (mutationType) {
      case 'card':
        cacheInvalidation.invalidateCards();
        break;
      case 'collection':
      case 'wishlist':
        if (userId) {
          cacheInvalidation.invalidateUserData(userId);
        }
        break;
    }
  },
};

// Performance monitoring
export const performanceMonitor = {
  getCacheStats: () => ({
    reactQuery: {
      queries: optimizedQueryClient.getQueryCache().getAll().length,
      mutations: optimizedQueryClient.getMutationCache().getAll().length,
    },
    performanceCache: performanceCache.getStats(),
  }),

  logPerformance: (operation: string, startTime: number) => {
    const duration = performance.now() - startTime;
    if (duration > 1000) { // Log slow operations
      console.warn(`Slow operation detected: ${operation} took ${duration.toFixed(2)}ms`);
    }
  },
};

// Preload critical data
export const preloadCriticalData = async () => {
  const startTime = performance.now();
  
  try {
    // Preload card sets (most frequently accessed)
    await optimizedQueryClient.prefetchQuery(optimizedQueries.cardSets);
    
    // Preload trending cards
    await optimizedQueryClient.prefetchQuery(optimizedQueries.trending(10));
    
    performanceMonitor.logPerformance('Critical data preload', startTime);
  } catch (error) {
    console.error('Failed to preload critical data:', error);
  }
};