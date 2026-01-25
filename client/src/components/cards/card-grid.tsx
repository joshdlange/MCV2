import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Plus, Check, Star } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardPricing } from "@/components/cards/card-pricing";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CardWithSet, CollectionItem, WishlistItem } from "@/types/schema";
import SimpleImage from "@/components/ui/simple-image";
import { CardFilters } from "@/types";
import { formatCardName, formatSetName } from "@/lib/formatTitle";

interface CardGridProps {
  filters?: CardFilters;
  showAddToCollection?: boolean;
  showAddToWishlist?: boolean;
  viewMode?: "grid" | "list";
}

export function CardGrid({ 
  filters = {}, 
  showAddToCollection = true, 
  showAddToWishlist = true,
  viewMode = "grid"
}: CardGridProps) {
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Use dedicated set endpoint for complete card list when filtering by set
  const apiEndpoint = filters.setId ? `/api/sets/${filters.setId}/cards` : '/api/cards';
  
  const queryParams = new URLSearchParams();
  if (!filters.setId) {
    // Only apply these filters for general card search, not set-specific queries
    if (filters.search) queryParams.set('search', filters.search);
    if (filters.rarity) queryParams.set('rarity', filters.rarity);
    if (filters.isInsert !== undefined) queryParams.set('isInsert', filters.isInsert.toString());
  }

  const { data: cardsResponse, isLoading } = useQuery<{ items?: CardWithSet[]; cards?: CardWithSet[] }>({
    queryKey: [filters.setId ? apiEndpoint : `${apiEndpoint}?${queryParams.toString()}`],
  });

  // Handle both paginated response format (items) and direct array format (cards)
  const cards = cardsResponse?.items || cardsResponse?.cards || cardsResponse || [];

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
    onMutate: async (cardId) => {
      // Cancel outgoing refetches for instant UI
      await queryClient.cancelQueries({ queryKey: ['/api/collection'] });
      
      const previousCollection = queryClient.getQueryData(['/api/collection']);
      
      // Optimistically add card
      queryClient.setQueryData(['/api/collection'], (old: any = []) => [
        ...old,
        {
          id: Date.now(),
          userId: 0,
          cardId,
          condition: 'Near Mint',
          acquiredDate: new Date(),
          acquiredVia: 'manual',
          personalValue: null,
          salePrice: null,
          isForSale: false,
          serialNumber: null,
          quantity: 1,
          isFavorite: false,
          notes: null,
        }
      ]);
      
      return { previousCollection };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      queryClient.invalidateQueries({ queryKey: ['/api/missing-cards'] });
      toast({ title: "Added to collection!" });
    },
    onError: (err, cardId, context: any) => {
      // Rollback on error
      if (context?.previousCollection) {
        queryClient.setQueryData(['/api/collection'], context.previousCollection);
      }
      toast({ title: "Failed to add card", variant: "destructive" });
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

  const removeFromCollectionMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const collectionItem = collection?.find(item => (item.card?.id || item.cardId) === cardId);
      if (!collectionItem) throw new Error('Card not in collection');
      return apiRequest('DELETE', `/api/collection/${collectionItem.id}`);
    },
    onMutate: async (cardId) => {
      // Cancel outgoing refetches for instant UI
      await queryClient.cancelQueries({ queryKey: ['/api/collection'] });
      
      const previousCollection = queryClient.getQueryData(['/api/collection']);
      
      // Optimistically remove card
      queryClient.setQueryData(['/api/collection'], (old: any = []) => 
        old.filter((item: any) => item.cardId !== cardId && item.card?.id !== cardId)
      );
      
      return { previousCollection };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      toast({ title: "Removed from collection!" });
    },
    onError: (err, cardId, context: any) => {
      // Rollback on error
      if (context?.previousCollection) {
        queryClient.setQueryData(['/api/collection'], context.previousCollection);
      }
      toast({ title: "Failed to remove card", variant: "destructive" });
    }
  });

  const removeFromWishlistMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const wishlistItem = wishlist?.find(item => item.card.id === cardId);
      if (!wishlistItem) throw new Error('Card not in wishlist');
      return apiRequest('DELETE', `/api/wishlist/${wishlistItem.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wishlist'] });
      toast({ title: "Card removed from wishlist" });
    },
    onError: () => {
      toast({ title: "Failed to remove from wishlist", variant: "destructive" });
    }
  });

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  // Helper functions to check card status
  const isInCollection = (cardId: number) => {
    return collection?.some(item => item.card?.id === cardId) ?? false;
  };

  const isInWishlist = (cardId: number) => {
    return wishlist?.some(item => item.card?.id === cardId) ?? false;
  };

  const isFavorite = (cardId: number) => {
    return collection?.some(item => (item.card?.id || item.cardId) === cardId && item.isFavorite) ?? false;
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

  const handleRemoveFromCollection = (cardId: number) => {
    removeFromCollectionMutation.mutate(cardId);
  };

  const handleRemoveFromWishlist = (cardId: number) => {
    removeFromWishlistMutation.mutate(cardId);
  };

  // Natural sort function for card numbers
  const sortCardsByNumber = (cards: CardWithSet[]) => {
    return [...cards].sort((a, b) => {
      const aNum = a.cardNumber;
      const bNum = b.cardNumber;
      
      // Handle non-numeric card numbers (like "CG-1", "P1", etc.)
      const aNumeric = aNum.match(/^\d+$/);
      const bNumeric = bNum.match(/^\d+$/);
      
      if (aNumeric && bNumeric) {
        // Both are pure numbers - compare numerically
        return parseInt(aNum) - parseInt(bNum);
      } else if (aNumeric && !bNumeric) {
        // a is numeric, b is not - a comes first
        return -1;
      } else if (!aNumeric && bNumeric) {
        // b is numeric, a is not - b comes first
        return 1;
      } else {
        // Both are non-numeric - sort alphabetically
        return aNum.localeCompare(bNum);
      }
    });
  };

  // Sort cards by card number in natural order
  const sortedCards = cards ? sortCardsByNumber(cards) : [];

  if (isLoading) {
    return viewMode === "grid" ? (
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
    ) : (
      <div className="space-y-4">
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-22 bg-gray-200 rounded flex-shrink-0"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="flex gap-2">
                    <div className="h-6 bg-gray-200 rounded w-20"></div>
                    <div className="h-6 bg-gray-200 rounded w-20"></div>
                  </div>
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
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {sortedCards.map((card) => (
            <Card key={card.id} className="group comic-border card-hover cursor-pointer" onClick={() => handleCardClick(card)}>
              <CardContent className="p-0">
                <div className="relative">
                  <div className="w-full aspect-[5/7] bg-gray-200 rounded-t-lg overflow-hidden">
                    <SimpleImage
                      src={card.frontImageUrl || ''}
                      alt={card.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  
                  {/* Status indicators */}
                  <div className="absolute top-2 right-2 flex flex-col gap-1">
                    {card.isInsert && (
                      <div className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <span className="text-xs">💎</span>
                      </div>
                    )}
                    {isInCollection(card.id) && (
                      <div className="bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                    {isInWishlist(card.id) && (
                      <div className="bg-pink-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <Heart className="w-3 h-3 fill-current" />
                      </div>
                    )}
                    {isFavorite(card.id) && (
                      <div className="bg-yellow-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <Star className="w-3 h-3 fill-current" />
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="p-2">
                  <h3 className="font-medium text-gray-900 text-xs truncate">
                    {formatCardName(card.name)} #{card.cardNumber}
                  </h3>
                  <p className="text-xs text-gray-500 mb-2">{formatSetName(card.set?.name) || 'Unknown Set'}</p>
                  
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
                        disabled={addToCollectionMutation.isPending || removeFromCollectionMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCollection(card.id);
                        }}
                        className="flex-1 bg-marvel-red hover:bg-red-700 text-xs h-6 px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    
                    {showAddToWishlist && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={addToWishlistMutation.isPending || removeFromWishlistMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToWishlist(card.id);
                        }}
                        className="flex-1 border-gray-300 hover:bg-gray-100 text-xs h-6 px-1 text-pink-500 hover:text-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
      ) : (
        <div className="space-y-3">
          {sortedCards.map((card) => (
            <Card key={card.id} className="group hover:shadow-md transition-all duration-200 cursor-pointer" onClick={() => handleCardClick(card)}>
              <CardContent className="p-3">
                <div className="flex items-center gap-4 md:gap-6">
                  {/* Card Thumbnail */}
                  <div className="w-14 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {card.frontImageUrl ? (
                      <img
                        src={card.frontImageUrl}
                        alt={card.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                        <span className="text-red-600 font-bold text-xs text-center px-1">
                          {card.name.substring(0, 8)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-2">
                        <h3 className="font-semibold text-gray-900 text-sm leading-tight mb-1">
                          {formatCardName(card.name)}
                        </h3>
                        <p className="text-xs text-gray-500 mb-1">
                          {card.set.year} {formatSetName(card.set.name)}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-600">
                            #{card.cardNumber}
                          </span>
                          {card.isInsert && (
                            <div className="bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center">
                              <span className="text-[10px]">💎</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Value and Actions */}
                      <div className="flex flex-col items-end gap-1">
                        <CardPricing cardId={card.id} className="text-sm font-medium" />
                        
                        <div className="flex items-center gap-2">
                          {isInCollection(card.id) && (
                            <div className="p-1 rounded-full bg-green-500 text-white">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                          {showAddToCollection && !isInCollection(card.id) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToCollection(card.id);
                              }}
                              className="p-1 rounded-full bg-gray-200 text-gray-600 hover:bg-green-100 hover:text-green-600"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                          {showAddToWishlist && !isInWishlist(card.id) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToWishlist(card.id);
                              }}
                              className="p-1 rounded-full bg-gray-200 text-gray-600 hover:bg-pink-100 hover:text-pink-600"
                            >
                              <Heart className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        isInCollection={selectedCard ? isInCollection(selectedCard.id) : false}
        isInWishlist={selectedCard ? isInWishlist(selectedCard.id) : false}
        onAddToCollection={selectedCard ? () => handleAddToCollection(selectedCard.id) : undefined}
        onAddToWishlist={selectedCard ? () => handleAddToWishlist(selectedCard.id) : undefined}
        onRemoveFromCollection={selectedCard ? () => handleRemoveFromCollection(selectedCard.id) : undefined}
        onRemoveFromWishlist={selectedCard ? () => handleRemoveFromWishlist(selectedCard.id) : undefined}
      />
    </>
  );
}