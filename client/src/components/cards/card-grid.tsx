import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Plus, Check, Star } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardPricing } from "@/components/cards/card-pricing";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import type { CardWithSet, CollectionItem, WishlistItem } from "@/types/schema";
import { OptimizedImage } from "@/components/ui/optimized-image";
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
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const queryParams = new URLSearchParams();
  if (filters.setId) queryParams.set('setId', filters.setId.toString());
  if (filters.search) queryParams.set('search', filters.search);
  if (filters.rarity) queryParams.set('rarity', filters.rarity);
  if (filters.isInsert !== undefined) queryParams.set('isInsert', filters.isInsert.toString());

  const { data: cards, isLoading } = useQuery<CardWithSet[]>({
    queryKey: [`/api/cards?${queryParams.toString()}`],
  });

  // Fetch user's collection and wishlist to show status indicators
  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ['/api/collection'],
  });

  const { data: wishlist } = useQuery<WishlistItem[]>({
    queryKey: ['/api/wishlist'],
  });

  const addToCollectionMutation = useMutation({
    mutationFn: async (cardId: number) => {
      return apiRequest('POST', '/api/collection', {
        cardId,
        condition: 'Near Mint'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      toast({ title: "Card added to collection" });
    },
    onError: () => {
      toast({ title: "Failed to add to collection", variant: "destructive" });
    }
  });

  const addToWishlistMutation = useMutation({
    mutationFn: async (cardId: number) => {
      return apiRequest('POST', '/api/wishlist', {
        cardId,
        priority: 3
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wishlist'] });
      toast({ title: "Card added to wishlist" });
    },
    onError: () => {
      toast({ title: "Failed to add to wishlist", variant: "destructive" });
    }
  });

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  // Helper functions to check card status
  const isInCollection = (cardId: number) => {
    return collection?.some(item => item.card.id === cardId) ?? false;
  };

  const isInWishlist = (cardId: number) => {
    return wishlist?.some(item => item.card.id === cardId) ?? false;
  };

  const isFavorite = (cardId: number) => {
    return collection?.some(item => item.card.id === cardId && item.isFavorite) ?? false;
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCard(null);
  };

  const handleAddToCollection = (cardId: number) => {
    addToCollectionMutation.mutate(cardId);
  };

  const handleAddToWishlist = (cardId: number) => {
    addToWishlistMutation.mutate(cardId);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {[...Array(16)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-0">
              <div className="w-full h-40 bg-gray-200 rounded-t-lg"></div>
              <div className="p-2 space-y-2">
                <div className="h-3 bg-gray-200 rounded"></div>
                <div className="h-2 bg-gray-200 rounded w-3/4"></div>
                <div className="flex gap-1">
                  <div className="h-6 bg-gray-200 rounded flex-1"></div>
                  <div className="h-6 bg-gray-200 rounded flex-1"></div>
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
        <p className="text-gray-500 text-lg">No cards found</p>
        <p className="text-gray-400 text-sm">Try adjusting your search filters</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {cards.map((card) => (
          <Card key={card.id} className="group comic-border card-hover cursor-pointer" onClick={() => handleCardClick(card)}>
            <CardContent className="p-0">
              <div className="relative">
                <div className="w-full aspect-[5/7] bg-gray-200 rounded-t-lg overflow-hidden">
                  {card.frontImageUrl ? (
                    <OptimizedImage
                      src={card.frontImageUrl}
                      alt={card.name}
                      size="thumbnail"
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-gray-400 text-xs">No Image</span>
                    </div>
                  )}
                </div>
                
                {/* Status indicators */}
                <div className="absolute top-2 right-2 flex gap-1">
                  {isInCollection(card.id) && (
                    <div className="bg-green-500 text-white rounded-full p-1">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                  {isInWishlist(card.id) && (
                    <div className="bg-pink-500 text-white rounded-full p-1">
                      <Heart className="w-3 h-3 fill-current" />
                    </div>
                  )}
                  {isFavorite(card.id) && (
                    <div className="bg-yellow-500 text-white rounded-full p-1">
                      <Star className="w-3 h-3 fill-current" />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-2">
                <h3 className="font-medium text-gray-900 text-xs truncate">
                  {card.name} #{card.cardNumber}
                </h3>
                <p className="text-xs text-gray-500 mb-2">{card.set.name}</p>
                
                <div className="flex items-center justify-between mb-2">
                  {card.isInsert && (
                    <span className="text-xs text-white px-2 py-1 rounded bg-purple-600 font-bold shadow-lg">
                      INSERT
                    </span>
                  )}
                </div>

                {/* Action Buttons - Compact */}
                <div className="flex gap-1">
                  {showAddToCollection && (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCollection(card.id);
                      }}
                      className="flex-1 bg-marvel-red hover:bg-red-700 text-xs h-6 px-1"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  )}
                  
                  {showAddToWishlist && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToWishlist(card.id);
                      }}
                      className="flex-1 border-gray-300 hover:bg-gray-100 text-xs h-6 px-1 text-pink-500 hover:text-pink-600"
                    >
                      <Heart className="w-3 h-3 fill-current" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onAddToCollection={selectedCard ? () => handleAddToCollection(selectedCard.id) : undefined}
        onAddToWishlist={selectedCard ? () => handleAddToWishlist(selectedCard.id) : undefined}
      />
    </>
  );
}