import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { Star, Heart, Plus, Trash2, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WishlistItem, CardWithSet } from "@shared/schema";

export default function Wishlist() {
  const [, setLocation] = useLocation();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: wishlist, isLoading } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
  });

  // Filter wishlist based on search query
  const filteredWishlist = wishlist?.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.card.name.toLowerCase().includes(query) ||
      item.card.set.name.toLowerCase().includes(query) ||
      item.card.cardNumber.toLowerCase().includes(query) ||
      item.card.rarity.toLowerCase().includes(query)
    );
  }) || [];

  const removeFromWishlistMutation = useMutation({
    mutationFn: async (itemId: number) => {
      return apiRequest('DELETE', `/api/wishlist/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wishlist'] });
      toast({ title: "Card removed from wishlist" });
    },
    onError: () => {
      toast({ title: "Failed to remove card", variant: "destructive" });
    }
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

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const handleRemoveFromWishlist = (itemId: number) => {
    removeFromWishlistMutation.mutate(itemId);
  };

  const handleAddToCollection = (item: WishlistItem) => {
    addToCollectionMutation.mutate(item.card.id);
  };

  const handleMoveToCollection = (item: WishlistItem) => {
    // Add to collection and remove from wishlist
    addToCollectionMutation.mutate(item.card.id);
    removeFromWishlistMutation.mutate(item.id);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY WISHLIST</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-0">
                  <div className="w-full aspect-[2.5/3.5] bg-gray-200 rounded-t-lg"></div>
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!wishlist || wishlist.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY WISHLIST</h2>
        </div>
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-6">
            <Heart className="h-12 w-12 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No Cards in Wishlist</h3>
          <p className="text-gray-600 mb-6 max-w-md">
            Start building your wishlist by browsing cards and clicking the heart icon to add cards you want to collect.
          </p>
          <Button 
            onClick={() => setLocation("/browse")}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Browse Cards
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY WISHLIST</h2>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search your wishlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 bg-white"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
          <span>{filteredWishlist.length} cards in wishlist</span>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredWishlist.map((item) => (
            <Card 
              key={item.id} 
              className="group hover:shadow-lg transition-all duration-200 cursor-pointer"
              onClick={() => handleCardClick(item.card)}
            >
              <CardContent className="p-0">
                {/* Card Image */}
                <div className="relative aspect-[2.5/3.5] bg-gray-100 rounded-t-lg overflow-hidden">
                  {item.card.frontImageUrl ? (
                    <img
                      src={item.card.frontImageUrl}
                      alt={item.card.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                      <span className="text-red-600 font-bold text-xs text-center px-2">
                        {item.card.name}
                      </span>
                    </div>
                  )}

                  {/* Badges */}
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    {item.card.isInsert && (
                      <Badge className="bg-yellow-100 text-yellow-800 text-xs p-1">
                        <Star className="h-3 w-3" />
                      </Badge>
                    )}
                  </div>


                </div>

                {/* Card Info */}
                <div className="p-3 space-y-1">
                  <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-tight">
                    {item.card.name}
                  </h3>
                  <p className="text-xs text-gray-600">
                    {item.card.set.name} #{item.card.cardNumber}
                  </p>
                  
                  {item.maxPrice && (
                    <p className="text-xs text-green-600 font-medium">
                      Max Price: ${item.maxPrice}
                    </p>
                  )}

                  <div className="flex items-center justify-end mt-2 gap-1">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCollection(item);
                        }}
                        className="h-6 w-6 p-0 hover:bg-green-100"
                        title="Add to Collection"
                      >
                        <Plus className="h-3 w-3 text-gray-400 hover:text-green-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromWishlist(item.id);
                        }}
                        className="h-6 w-6 p-0 hover:bg-red-100"
                        title="Remove from Wishlist"
                      >
                        <Trash2 className="h-3 w-3 text-gray-400 hover:text-red-600" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCard(null);
        }}
        isInCollection={false}
        isInWishlist={true}
        onAddToCollection={() => {
          if (selectedCard) {
            const wishlistItem = wishlist.find(item => item.card.id === selectedCard.id);
            if (wishlistItem) {
              handleMoveToCollection(wishlistItem);
              setIsModalOpen(false);
              setSelectedCard(null);
            }
          }
        }}
        onRemoveFromWishlist={() => {
          if (selectedCard) {
            const wishlistItem = wishlist.find(item => item.card.id === selectedCard.id);
            if (wishlistItem) {
              handleRemoveFromWishlist(wishlistItem.id);
              setIsModalOpen(false);
              setSelectedCard(null);
            }
          }
        }}
      />
    </div>
  );
}