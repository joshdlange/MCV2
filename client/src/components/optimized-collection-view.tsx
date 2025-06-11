import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Filter, Calendar, DollarSign } from 'lucide-react';

interface CollectionItem {
  id: number;
  cardId: number;
  condition: string;
  acquiredDate: string;
  personalValue: string | null;
  notes: string | null;
  cardName: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number;
  isInsert: boolean;
  rarity: string;
}

interface PaginatedCollectionResponse {
  items: CollectionItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function OptimizedCollectionView() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [sortBy, setSortBy] = useState('acquired_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const pageSize = 50;

  // Debounced search
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
  }, [debouncedSearch, conditionFilter, sortBy, sortOrder]);

  // Build query parameters
  const queryParams = new URLSearchParams({
    page: currentPage.toString(),
    pageSize: pageSize.toString(),
    sortBy,
    sortOrder
  });

  if (debouncedSearch.length >= 2) {
    queryParams.append('search', debouncedSearch);
  }
  if (conditionFilter) {
    queryParams.append('condition', conditionFilter);
  }

  // Fetch collection data
  const { data, isLoading, error, isFetching } = useQuery<PaginatedCollectionResponse>({
    queryKey: ['/api/v2/collection', queryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/v2/collection?${queryParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch collection');
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false
  });

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatCurrency = (value: string | null) => {
    if (!value) return 'Not set';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(parseFloat(value));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center text-red-600">
          Failed to load your collection. Please try again.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Collection Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            My Collection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters and Search */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search collection..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Conditions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Conditions</SelectItem>
                <SelectItem value="Mint">Mint</SelectItem>
                <SelectItem value="Near Mint">Near Mint</SelectItem>
                <SelectItem value="Excellent">Excellent</SelectItem>
                <SelectItem value="Good">Good</SelectItem>
                <SelectItem value="Fair">Fair</SelectItem>
                <SelectItem value="Poor">Poor</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acquired_date">Date Acquired</SelectItem>
                <SelectItem value="card_name">Card Name</SelectItem>
                <SelectItem value="set_name">Set Name</SelectItem>
                <SelectItem value="personal_value">Personal Value</SelectItem>
                <SelectItem value="condition">Condition</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger>
                <SelectValue placeholder="Order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descending</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className="flex-1"
              >
                Grid
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className="flex-1"
              >
                List
              </Button>
            </div>
          </div>

          {/* Results Summary */}
          {data && (
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm text-gray-600">
                Showing {data.items.length} of {data.totalCount.toLocaleString()} cards
                {isFetching && <span className="ml-2">• Updating...</span>}
              </div>
              <div className="text-sm text-gray-600">
                Page {data.page} of {data.totalPages}
              </div>
            </div>
          )}

          {/* Collection Grid/List */}
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
              {data?.items.map((item) => (
                <Card key={item.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                    {viewMode === 'grid' ? (
                      <>
                        <div className="aspect-[3/4] mb-3 bg-gray-100 rounded-lg overflow-hidden">
                          {item.frontImageUrl ? (
                            <img
                              src={item.frontImageUrl}
                              alt={item.cardName}
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
                          <h3 className="font-semibold text-sm line-clamp-2">{item.cardName}</h3>
                          <p className="text-xs text-gray-600">#{item.cardNumber}</p>
                          <p className="text-xs text-gray-500">{item.setName} ({item.setYear})</p>
                          <div className="flex gap-1 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              {item.condition}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {item.rarity}
                            </Badge>
                            {item.isInsert && (
                              <Badge variant="outline" className="text-xs">
                                Insert
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs space-y-1">
                            <p className="text-gray-500">Acquired: {formatDate(item.acquiredDate)}</p>
                            {item.personalValue && (
                              <p className="font-medium text-green-600">
                                {formatCurrency(item.personalValue)}
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex gap-4">
                        <div className="w-16 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                          {item.frontImageUrl ? (
                            <img
                              src={item.frontImageUrl}
                              alt={item.cardName}
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
                          <h3 className="font-semibold truncate">{item.cardName}</h3>
                          <p className="text-sm text-gray-600">#{item.cardNumber}</p>
                          <p className="text-sm text-gray-500">{item.setName} ({item.setYear})</p>
                          <div className="flex gap-2 mt-2 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              {item.condition}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {item.rarity}
                            </Badge>
                            {item.isInsert && (
                              <Badge variant="outline" className="text-xs">
                                Insert
                              </Badge>
                            )}
                          </div>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-xs text-gray-500">
                              {formatDate(item.acquiredDate)}
                            </span>
                            {item.personalValue && (
                              <span className="text-sm font-medium text-green-600">
                                {formatCurrency(item.personalValue)}
                              </span>
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
            <div className="flex justify-center gap-2 mt-6">
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
        </CardContent>
      </Card>
    </div>
  );
}