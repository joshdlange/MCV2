import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { OptimizedCardGrid } from './optimized-card-grid';
import { TrendingUp, Star, Clock, Target } from 'lucide-react';

interface DashboardStats {
  totalCards: number;
  insertCards: number;
  totalValue: number;
  wishlistCount: number;
}

interface RecentCard {
  id: number;
  cardId: number;
  cardName: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  acquiredDate: string;
  condition: string;
}

interface TrendingCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number;
  isInsert: boolean;
  rarity: string;
  collectionCount: number;
}

export function OptimizedDashboard() {
  // Fetch dashboard stats with optimized endpoint
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/v2/stats'],
    queryFn: async () => {
      const response = await fetch('/api/v2/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false
  });

  // Fetch recent cards with optimized endpoint
  const { data: recentCards, isLoading: recentLoading } = useQuery<RecentCard[]>({
    queryKey: ['/api/v2/recent'],
    queryFn: async () => {
      const response = await fetch('/api/v2/recent?limit=10');
      if (!response.ok) throw new Error('Failed to fetch recent cards');
      return response.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false
  });

  // Fetch trending cards with optimized endpoint
  const { data: trendingCards, isLoading: trendingLoading } = useQuery<TrendingCard[]>({
    queryKey: ['/api/v2/trending'],
    queryFn: async () => {
      const response = await fetch('/api/v2/trending?limit=8');
      if (!response.ok) throw new Error('Failed to fetch trending cards');
      return response.json();
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
    refetchOnWindowFocus: false
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cards</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalCards.toLocaleString() || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Insert Cards</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.insertCards.toLocaleString() || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collection Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{formatCurrency(stats?.totalValue || 0)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wishlist Items</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{stats?.wishlistCount.toLocaleString() || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Acquisitions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Acquisitions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {recentCards?.slice(0, 5).map((item) => (
                <Card key={item.id} className="overflow-hidden">
                  <div className="aspect-[3/4] bg-gray-100">
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
                  <CardContent className="p-3">
                    <h4 className="font-semibold text-sm line-clamp-2">{item.cardName}</h4>
                    <p className="text-xs text-gray-600">#{item.cardNumber}</p>
                    <p className="text-xs text-gray-500">{item.setName}</p>
                    <Badge variant="outline" className="text-xs mt-1">
                      {item.condition}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trending Cards */}
      <Card>
        <CardHeader>
          <CardTitle>Trending Cards</CardTitle>
        </CardHeader>
        <CardContent>
          {trendingLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {trendingCards?.map((card) => (
                <Card key={card.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="aspect-[3/4] bg-gray-100">
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
                  <CardContent className="p-3">
                    <h4 className="font-semibold text-sm line-clamp-2">{card.name}</h4>
                    <p className="text-xs text-gray-600">#{card.cardNumber}</p>
                    <p className="text-xs text-gray-500">{card.setName} ({card.setYear})</p>
                    <div className="flex gap-1 mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {card.rarity}
                      </Badge>
                      {card.isInsert && (
                        <Badge variant="outline" className="text-xs">
                          Insert
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {card.collectionCount} collections
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Latest Cards Browse */}
      <Card>
        <CardHeader>
          <CardTitle>Browse All Cards</CardTitle>
        </CardHeader>
        <CardContent>
          <OptimizedCardGrid 
            endpoint="/api/v2/cards"
            pageSize={20}
            enableFilters={true}
          />
        </CardContent>
      </Card>
    </div>
  );
}