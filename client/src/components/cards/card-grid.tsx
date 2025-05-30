import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heart, Plus } from "lucide-react";
import type { CardWithSet } from "@shared/schema";
import { CardFilters } from "@/types";

interface CardGridProps {
  filters?: CardFilters;
  showAddToCollection?: boolean;
  showAddToWishlist?: boolean;
}

export function CardGrid({ 
  filters = {}, 
  showAddToCollection = true, 
  showAddToWishlist = true 
}: CardGridProps) {
  const queryParams = new URLSearchParams();
  if (filters.setId) queryParams.set('setId', filters.setId.toString());
  if (filters.search) queryParams.set('search', filters.search);
  if (filters.rarity) queryParams.set('rarity', filters.rarity);
  if (filters.isInsert !== undefined) queryParams.set('isInsert', filters.isInsert.toString());

  const { data: cards, isLoading } = useQuery<CardWithSet[]>({
    queryKey: [`/api/cards?${queryParams.toString()}`],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {[...Array(10)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-0">
              <div className="w-full h-64 bg-gray-200 rounded-t-lg"></div>
              <div className="p-4 space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                <div className="flex justify-between">
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                  <div className="h-4 bg-gray-200 rounded w-12"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
            <span className="text-gray-400 text-2xl">📋</span>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No cards found</h3>
          <p className="text-gray-500">
            {Object.keys(filters).length > 0 
              ? "Try adjusting your filters to see more results." 
              : "No cards have been added yet."}
          </p>
        </div>
      </div>
    );
  }

  const getRarityColor = (rarity: string, isInsert: boolean) => {
    if (isInsert) return 'bg-marvel-gold';
    
    switch (rarity.toLowerCase()) {
      case 'common': return 'bg-blue-600';
      case 'uncommon': return 'bg-green-600';
      case 'rare': return 'bg-marvel-red';
      case 'epic': return 'bg-purple-600';
      case 'legendary': return 'bg-orange-600';
      default: return 'bg-gray-600';
    }
  };

  const handleAddToCollection = (cardId: number) => {
    console.log('Add to collection:', cardId);
  };

  const handleAddToWishlist = (cardId: number) => {
    console.log('Add to wishlist:', cardId);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {cards.map((card) => (
        <Card key={card.id} className="group comic-border card-hover">
          <CardContent className="p-0">
            <div className="relative">
              {card.imageUrl ? (
                <img 
                  src={card.imageUrl} 
                  alt={card.name}
                  className="w-full h-64 object-cover rounded-t-lg"
                />
              ) : (
                <div className="w-full h-64 bg-gray-200 rounded-t-lg flex items-center justify-center">
                  <span className="text-gray-400">No Image</span>
                </div>
              )}
              
              {/* Overlay buttons */}
              <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-t-lg">
                {showAddToCollection && (
                  <Button
                    size="sm"
                    onClick={() => handleAddToCollection(card.id)}
                    className="bg-marvel-red hover:bg-red-700"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Collection
                  </Button>
                )}
                {showAddToWishlist && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddToWishlist(card.id)}
                    className="bg-white hover:bg-gray-100"
                  >
                    <Heart className="w-4 h-4 mr-1" />
                    Wishlist
                  </Button>
                )}
              </div>
            </div>
            
            <div className="p-4">
              <h3 className="font-medium text-gray-900 text-sm truncate">
                {card.name} #{card.cardNumber}
              </h3>
              <p className="text-xs text-gray-500 mb-3">{card.set.name}</p>
              
              <div className="flex items-center justify-between">
                <Badge 
                  className={`text-xs text-white px-2 py-1 ${getRarityColor(card.rarity, card.isInsert)}`}
                >
                  {card.isInsert ? 'Insert' : card.rarity}
                </Badge>
                {card.estimatedValue && (
                  <span className="text-sm font-semibold text-gray-900">
                    ${parseFloat(card.estimatedValue).toFixed(0)}
                  </span>
                )}
              </div>
              
              {card.variation && (
                <p className="text-xs text-gray-400 mt-2 truncate">
                  {card.variation}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
