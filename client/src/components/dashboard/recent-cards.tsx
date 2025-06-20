import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { convertGoogleDriveUrl } from "@/lib/utils";

interface RecentCardItem {
  id: number;
  cardId: number;
  cardName: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  isInsert?: boolean;
  acquiredDate: string;
  condition: string;
}
import { useLocation } from "wouter";

export function RecentCards() {
  const [, setLocation] = useLocation();
  
  const { data: recentCards, isLoading } = useQuery<RecentCardItem[]>({
    queryKey: ["/api/recent-cards"],
  });

  if (isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card rounded-lg overflow-hidden animate-pulse border">
                <div className="w-full h-40 bg-muted"></div>
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-muted rounded"></div>
                  <div className="h-3 bg-muted rounded w-3/4"></div>
                  <div className="flex justify-between">
                    <div className="h-6 bg-muted rounded w-16"></div>
                    <div className="h-4 bg-muted rounded w-12"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!recentCards || recentCards.length === 0) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
            <Button variant="ghost" className="text-marvel-red hover:text-red-700">
              View All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">No cards in your collection yet</p>
            <Button 
              className="mt-4 bg-marvel-red hover:bg-red-700"
              onClick={() => setLocation('/browse')}
            >
              Add Your First Card
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity.toLowerCase()) {
      case 'common': return 'bg-blue-600';
      case 'uncommon': return 'bg-green-600';
      case 'rare': return 'bg-marvel-red';
      case 'epic': return 'bg-purple-600';
      case 'legendary': return 'bg-orange-600';
      case 'insert': return 'bg-marvel-gold';
      default: return 'bg-gray-600';
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
          <Button 
            variant="ghost" 
            className="text-marvel-red hover:text-red-700"
            onClick={() => setLocation('/collection')}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2" style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(120px, 1fr))`,
          maxWidth: '100%'
        }}>
          {recentCards.filter(item => item.cardName).map((item) => (
            <div 
              key={item.id} 
              className="bg-card rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow cursor-pointer border relative"
              onClick={() => setLocation(`/cards/${item.cardId}`)}
            >
              {/* Trading card with proper 2.5:3.5 aspect ratio */}
              <div className="aspect-[2.5/3.5] relative">
                {item.frontImageUrl ? (
                  <img 
                    src={convertGoogleDriveUrl(item.frontImageUrl)} 
                    alt={item.cardName}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzlkYTNhZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIEVycm9yPC90ZXh0Pjwvc3ZnPg==';
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <span className="text-muted-foreground text-xs">No Image</span>
                  </div>
                )}
                
                {/* Status badges */}
                <div className="absolute top-1 right-1 flex flex-col gap-1">
                  <div className="bg-green-500 text-white rounded-full p-1 shadow-lg">
                    <Check className="w-3 h-3" />
                  </div>
                  {item.isInsert && (
                    <div className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
                      <span className="text-xs">💎</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Card info below image */}
              <div className="p-1">
                <p className="font-medium text-card-foreground text-xs truncate">
                  {item.cardName}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.setName}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
