import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Heart, Star } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { convertGoogleDriveUrl } from "@/lib/utils";
import type { CollectionItem } from "@shared/schema";
import { useLocation } from "wouter";

export function RecentCards() {
  const [selectedCard, setSelectedCard] = useState<CollectionItem | null>(null);
  const [, setLocation] = useLocation();
  
  const { data: recentCards, isLoading } = useQuery<CollectionItem[]>({
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
            onClick={() => setLocation('/my-collection')}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {recentCards.map((item) => (
            <div 
              key={item.id} 
              className="bg-card rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow cursor-pointer border relative"
              onClick={() => setSelectedCard(item)}
            >
              {/* Trading card with proper 2.5:3.5 aspect ratio */}
              <div className="aspect-[2.5/3.5] relative">
                {item.card.frontImageUrl ? (
                  <img 
                    src={convertGoogleDriveUrl(item.card.frontImageUrl)} 
                    alt={item.card.name}
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
                  {item.card.isInsert && (
                    <div className="bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold shadow-lg">
                      INSERT
                    </div>
                  )}
                </div>
              </div>
              
              {/* Card info below image */}
              <div className="p-2">
                <p className="font-medium text-card-foreground text-xs truncate">
                  {item.card.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.card.set.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  #{item.card.cardNumber}
                </p>
                {item.card.estimatedValue && (
                  <p className="text-xs font-semibold text-green-600 mt-1">
                    ${parseFloat(item.card.estimatedValue).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      
      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard?.card || null}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        isInCollection={true}
        isInWishlist={false}
      />
    </Card>
  );
}
