/**
 * High-performance collection view with virtual scrolling and optimized rendering
 * Handles 60,000+ cards with minimal memory footprint
 */

import React, { useMemo, useState, useCallback } from 'react';
import { VirtualCardGrid } from '@/components/ui/virtual-list';
import { CardImage } from '@/components/ui/optimized-image';
import { useOptimizedCollection } from '@/hooks/use-optimized-collection';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Filter, Grid, List } from 'lucide-react';

interface CollectionItem {
  id: number;
  cardId: number;
  condition: string;
  acquiredDate: string;
  personalValue: string | null;
  card: {
    id: number;
    name: string;
    cardNumber: string;
    frontImageUrl: string | null;
    setId: number;
    isInsert: boolean;
    set: {
      name: string;
      year: number;
    };
  };
}

export function OptimizedCollectionView() {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    condition: '',
    setId: '',
    isInsert: '',
  });

  const {
    items,
    totalCount,
    isLoading,
    search,
    metrics,
  } = useOptimizedCollection({
    pageSize: 50,
    enableVirtualization: true,
    prefetchPages: 3,
    filters,
  });

  // Memoized filtered items for search
  const filteredItems = useMemo(() => {
    if (!searchTerm) return items;
    
    const term = searchTerm.toLowerCase();
    return items.filter((item: CollectionItem) =>
      item.card.name.toLowerCase().includes(term) ||
      item.card.set.name.toLowerCase().includes(term) ||
      item.card.cardNumber.includes(term)
    );
  }, [items, searchTerm]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    search(value);
  }, [search]);

  // Render individual card item
  const renderCardItem = useCallback((item: CollectionItem, index: number) => {
    if (viewMode === 'grid') {
      return (
        <Card key={item.id} className="overflow-hidden hover:shadow-lg transition-shadow">
          <CardContent className="p-4">
            <CardImage
              src={item.card.frontImageUrl}
              alt={item.card.name}
              cardNumber={item.card.cardNumber}
              setName={item.card.set.name}
              isInsert={item.card.isInsert}
              className="mb-3"
            />
            <div className="space-y-2">
              <h3 className="font-semibold text-sm truncate">{item.card.name}</h3>
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>{item.card.set.year}</span>
                <Badge variant={item.card.isInsert ? 'default' : 'secondary'}>
                  {item.card.isInsert ? 'INSERT' : 'BASE'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Condition:</span>
                <span className="font-medium">{item.condition}</span>
              </div>
              {item.personalValue && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Value:</span>
                  <span className="font-medium text-green-600">${item.personalValue}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    // List view - more compact
    return (
      <Card key={item.id} className="mb-2">
        <CardContent className="p-3">
          <div className="flex items-center space-x-4">
            <CardImage
              src={item.card.frontImageUrl}
              alt={item.card.name}
              cardNumber={item.card.cardNumber}
              isInsert={item.card.isInsert}
              className="w-16 h-20 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{item.card.name}</h3>
              <p className="text-sm text-gray-600 truncate">
                {item.card.set.name} ({item.card.set.year})
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs">
                <span>#{item.card.cardNumber}</span>
                <span>Condition: {item.condition}</span>
                {item.personalValue && (
                  <span className="text-green-600 font-medium">${item.personalValue}</span>
                )}
                {item.card.isInsert && (
                  <Badge variant="default" className="h-5">INSERT</Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }, [viewMode]);

  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-80 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with search and controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search your collection..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Performance metrics */}
          <div className="text-xs text-gray-500 hidden md:block">
            {metrics.loadedItems.toLocaleString()} of {metrics.totalItems.toLocaleString()} cards
            {metrics.cacheHitRate > 0 && (
              <span className="ml-2">• Cache: {(metrics.cacheHitRate * 100).toFixed(1)}%</span>
            )}
          </div>
          
          {/* View toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="h-8 px-3"
            >
              <Grid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="h-8 px-3"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Results summary */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {searchTerm ? `${filteredItems.length} results` : `${totalCount.toLocaleString()} total cards`}
        </span>
      </div>

      {/* Virtual scrolled collection */}
      {viewMode === 'grid' ? (
        <VirtualCardGrid
          items={filteredItems}
          itemHeight={320}
          itemsPerRow={4}
          containerHeight={600}
          renderItem={renderCardItem}
          className="bg-white dark:bg-gray-900"
        />
      ) : (
        <VirtualCardGrid
          items={filteredItems}
          itemHeight={100}
          itemsPerRow={1}
          containerHeight={600}
          renderItem={renderCardItem}
          className="bg-white dark:bg-gray-900"
        />
      )}

      {/* Loading indicator for infinite scroll */}
      {isLoading && items.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}