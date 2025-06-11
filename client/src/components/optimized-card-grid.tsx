import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, Grid, List } from 'lucide-react';

interface OptimizedCardGridProps {
  endpoint?: string;
  userId?: number;
  enableFilters?: boolean;
  pageSize?: number;
}

interface CardItem {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number;
  isInsert: boolean;
  rarity: string;
}

interface PaginatedResponse {
  items: CardItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function OptimizedCardGrid({ 
  endpoint = '/api/v2/cards',
  userId,
  enableFilters = true,
  pageSize = 50 
}: OptimizedCardGridProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSet, setSelectedSet] = useState<string>('');
  const [selectedRarity, setSelectedRarity] = useState<string>('');
  const [isInsertFilter, setIsInsertFilter] = useState<string>('');
  const [hasImageFilter, setHasImageFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Debounced search to prevent excessive API calls
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedSet, selectedRarity, isInsertFilter, hasImageFilter]);

  // Build query parameters
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      page: currentPage.toString(),
      pageSize: pageSize.toString()
    });

    if (debouncedSearch.length >= 2) {
      params.append('search', debouncedSearch);
    }
    if (selectedSet) {
      params.append('setId', selectedSet);
    }
    if (selectedRarity) {
      params.append('rarity', selectedRarity);
    }
    if (isInsertFilter) {
      params.append('isInsert', isInsertFilter);
    }
    if (hasImageFilter) {
      params.append('hasImage', hasImageFilter);
    }

    return params.toString();
  }, [currentPage, pageSize, debouncedSearch, selectedSet, selectedRarity, isInsertFilter, hasImageFilter]);

  // Fetch data with React Query
  const { data, isLoading, error, isFetching } = useQuery<PaginatedResponse>({
    queryKey: [endpoint, queryParams],
    queryFn: async () => {
      const response = await fetch(`${endpoint}?${queryParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch cards');
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false
  });

  // Get card sets for filter dropdown
  const { data: cardSets } = useQuery({
    queryKey: ['/api/card-sets'],
    queryFn: async () => {
      const response = await fetch('/api/card-sets');
      if (!response.ok) throw new Error('Failed to fetch card sets');
      return response.json();
    },
    staleTime: 1000 * 60 * 10 // 10 minutes
  });

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center text-red-600">
          Failed to load cards. Please try again.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      {enableFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search cards..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={selectedSet} onValueChange={setSelectedSet}>
              <SelectTrigger>
                <SelectValue placeholder="All Sets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Sets</SelectItem>
                {cardSets?.map((set: any) => (
                  <SelectItem key={set.id} value={set.id.toString()}>
                    {set.name} ({set.year})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedRarity} onValueChange={setSelectedRarity}>
              <SelectTrigger>
                <SelectValue placeholder="All Rarities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Rarities</SelectItem>
                <SelectItem value="Common">Common</SelectItem>
                <SelectItem value="Uncommon">Uncommon</SelectItem>
                <SelectItem value="Rare">Rare</SelectItem>
                <SelectItem value="Ultra Rare">Ultra Rare</SelectItem>
                <SelectItem value="Secret Rare">Secret Rare</SelectItem>
              </SelectContent>
            </Select>

            <Select value={isInsertFilter} onValueChange={setIsInsertFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Card Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Types</SelectItem>
                <SelectItem value="true">Inserts Only</SelectItem>
                <SelectItem value="false">Base Cards Only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={hasImageFilter} onValueChange={setHasImageFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Image Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Cards</SelectItem>
                <SelectItem value="true">With Images</SelectItem>
                <SelectItem value="false">Without Images</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className="flex-1"
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="flex-1"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Results Summary */}
      {data && (
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Showing {data.items.length} of {data.totalCount.toLocaleString()} cards
            {isFetching && <span className="ml-2">• Updating...</span>}
          </div>
          <div className="text-sm text-gray-600">
            Page {data.page} of {data.totalPages}
          </div>
        </div>
      )}

      {/* Card Grid/List */}
      {isLoading ? (
        <div className={viewMode === 'grid' 
          ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          : "space-y-4"
        }>
          {Array.from({ length: pageSize }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <div className={viewMode === 'grid'
          ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          : "space-y-4"
        }>
          {data?.items.map((card) => (
            <Card key={card.id} className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-4">
                {viewMode === 'grid' ? (
                  <>
                    <div className="aspect-[3/4] mb-3 bg-gray-100 rounded-lg overflow-hidden">
                      {card.frontImageUrl ? (
                        <img
                          src={card.frontImageUrl}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          No Image
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-semibold text-sm line-clamp-2">{card.name}</h3>
                      <p className="text-xs text-gray-600">#{card.cardNumber}</p>
                      <p className="text-xs text-gray-500">{card.setName} ({card.setYear})</p>
                      <div className="flex gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {card.rarity}
                        </Badge>
                        {card.isInsert && (
                          <Badge variant="outline" className="text-xs">
                            Insert
                          </Badge>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-4">
                    <div className="w-16 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                      {card.frontImageUrl ? (
                        <img
                          src={card.frontImageUrl}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          No Image
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{card.name}</h3>
                      <p className="text-sm text-gray-600">#{card.cardNumber}</p>
                      <p className="text-sm text-gray-500">{card.setName} ({card.setYear})</p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {card.rarity}
                        </Badge>
                        {card.isInsert && (
                          <Badge variant="outline" className="text-xs">
                            Insert
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            disabled={!data.hasPrevious}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            Previous
          </Button>
          
          {/* Page Numbers */}
          {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
            const pageNum = Math.max(1, Math.min(
              data.totalPages - 4,
              currentPage - 2
            )) + i;
            
            if (pageNum <= data.totalPages) {
              return (
                <Button
                  key={pageNum}
                  variant={pageNum === currentPage ? "default" : "outline"}
                  onClick={() => handlePageChange(pageNum)}
                  className="min-w-[40px]"
                >
                  {pageNum}
                </Button>
              );
            }
            return null;
          })}
          
          <Button
            variant="outline"
            disabled={!data.hasNext}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}