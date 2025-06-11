/**
 * Optimized React hook for handling large collections with virtual scrolling
 * Designed for 60,000+ card datasets with minimal memory footprint
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { optimizedQueries, cachedApiRequest, performanceMonitor } from '@/lib/optimized-query-client';
import { performanceCache, cacheKeys } from '@/lib/performance-cache';

interface UseOptimizedCollectionOptions {
  pageSize?: number;
  enableVirtualization?: boolean;
  prefetchPages?: number;
  filters?: Record<string, any>;
}

export function useOptimizedCollection(options: UseOptimizedCollectionOptions = {}) {
  const {
    pageSize = 50,
    enableVirtualization = true,
    prefetchPages = 2,
    filters = {}
  } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Infinite query for smooth pagination
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch
  } = useInfiniteQuery({
    queryKey: ['collection-infinite', filters, searchQuery, pageSize],
    queryFn: async ({ pageParam = 1 }) => {
      const startTime = performance.now();
      
      const params = new URLSearchParams({
        page: pageParam.toString(),
        pageSize: pageSize.toString(),
        search: searchQuery,
        ...filters,
      });
      
      const result = await cachedApiRequest(
        `/api/v2/collection?${params}`,
        {},
        `collection-page-${pageParam}-${JSON.stringify(filters)}-${searchQuery}`,
        3 * 60 * 1000 // 3 minute cache
      );
      
      performanceMonitor.logPerformance(`Collection page ${pageParam}`, startTime);
      return result;
    },
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Flatten data for virtual scrolling
  const allItems = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap(page => page.items || []);
  }, [data]);

  // Prefetch next pages for smooth scrolling
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && allItems.length > 0) {
      const loadedPages = data?.pages?.length || 0;
      const totalItems = allItems.length;
      const estimatedTotalPages = Math.ceil((data?.pages?.[0]?.totalCount || 0) / pageSize);
      
      // Prefetch if we're within prefetchPages of the end
      if (loadedPages < estimatedTotalPages && loadedPages <= currentPage + prefetchPages) {
        fetchNextPage();
      }
    }
  }, [currentPage, hasNextPage, isFetchingNextPage, fetchNextPage, allItems.length, data, pageSize, prefetchPages]);

  // Optimized search with debouncing
  const debouncedSearch = useCallback(
    debounce((query: string) => {
      setSearchQuery(query);
      setCurrentPage(1);
    }, 300),
    []
  );

  // Virtual scroll helpers
  const getItemHeight = useCallback(() => 120, []); // Fixed height for performance
  
  const renderItem = useCallback((item: any, index: number) => {
    // Return lightweight card component
    return {
      id: item.id,
      key: `collection-item-${item.id}`,
      data: item,
      index
    };
  }, []);

  // Performance metrics
  const metrics = useMemo(() => ({
    totalItems: data?.pages?.[0]?.totalCount || 0,
    loadedItems: allItems.length,
    loadedPages: data?.pages?.length || 0,
    cacheHitRate: performanceCache.getStats().hitRate,
  }), [data, allItems.length]);

  return {
    // Data
    items: allItems,
    totalCount: data?.pages?.[0]?.totalCount || 0,
    
    // Loading states
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    error,
    
    // Actions
    search: debouncedSearch,
    refetch,
    fetchNextPage,
    
    // Virtual scroll helpers
    getItemHeight,
    renderItem,
    
    // Pagination
    currentPage,
    setCurrentPage,
    pageSize,
    
    // Performance
    metrics,
  };
}

// Optimized hook for card sets with aggressive caching
export function useOptimizedCardSets() {
  const startTime = performance.now();
  
  const query = useQuery({
    ...optimizedQueries.cardSets,
    select: (data) => {
      // Sort by year desc, name asc for consistent ordering
      return data.sort((a: any, b: any) => {
        if (a.year !== b.year) return b.year - a.year;
        return a.name.localeCompare(b.name);
      });
    },
  });

  useEffect(() => {
    if (query.data) {
      performanceMonitor.logPerformance('Card sets fetch', startTime);
    }
  }, [query.data, startTime]);

  return query;
}

// Optimized search hook with intelligent caching
export function useOptimizedSearch(initialQuery = '') {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery({
    ...optimizedQueries.search(debouncedQuery, 50),
    enabled: debouncedQuery.length > 2,
  });

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
  }, []);

  return {
    query,
    setQuery,
    results: searchQuery.data || [],
    isLoading: searchQuery.isLoading,
    error: searchQuery.error,
    clearSearch,
    hasResults: (searchQuery.data?.length || 0) > 0,
  };
}

// Optimized stats hook with caching
export function useOptimizedStats(userId: number) {
  return useQuery({
    ...optimizedQueries.stats(userId),
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
    refetchIntervalInBackground: false,
  });
}

// Utility function for debouncing
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Hook for managing multiple concurrent requests
export function useBatchRequests() {
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set());

  const addRequest = useCallback((key: string) => {
    setPendingRequests(prev => new Set(prev).add(key));
  }, []);

  const removeRequest = useCallback((key: string) => {
    setPendingRequests(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const isRequestPending = useCallback((key: string) => {
    return pendingRequests.has(key);
  }, [pendingRequests]);

  return {
    addRequest,
    removeRequest,
    isRequestPending,
    pendingCount: pendingRequests.size,
  };
}