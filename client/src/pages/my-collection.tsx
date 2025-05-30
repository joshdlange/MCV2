import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { Star, Heart, Check, ShoppingCart, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CollectionItem, CardWithSet } from "@shared/schema";

export default function MyCollection() {
  const [, setLocation] = useLocation();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: collection, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const removeFromCollectionMutation = useMutation({
    mutationFn: async (itemId: number) => {
      return apiRequest('DELETE', `/api/collection/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      toast({ title: "Card removed from collection" });
    },
    onError: () => {
      toast({ title: "Failed to remove card", variant: "destructive" });
    }
  });

  const updateCollectionItemMutation = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: number; updates: any }) => {
      return apiRequest('PATCH', `/api/collection/${itemId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      toast({ title: "Collection item updated" });
    },
    onError: () => {
      toast({ title: "Failed to update collection item", variant: "destructive" });
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-0">
                  <div className="w-full h-64 bg-gray-200 rounded-t-lg"></div>
                  <div className="p-4 space-y-2">
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

  const handleRemoveFromCollection = (itemId: number) => {
    removeFromCollectionMutation.mutate(itemId);
  };

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const handleToggleFavorite = (item: CollectionItem) => {
    updateCollectionItemMutation.mutate({
      itemId: item.id,
      updates: { isFavorite: !item.isFavorite }
    });
  };

  const handleToggleForSale = (itemId: number, isForSale: boolean) => {
    updateCollectionItemMutation.mutate({
      itemId,
      updates: { isForSale: !isForSale }
    });
  };

  const handleToggleSelection = (itemId: number) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  const handleBulkAddToMarketplace = () => {
    if (selectedItems.size === 0) {
      toast({ title: "Please select items to add to marketplace", variant: "destructive" });
      return;
    }

    // Update all selected items to be for sale
    selectedItems.forEach(itemId => {
      updateCollectionItemMutation.mutate({
        itemId,
        updates: { isForSale: true }
      });
    });

    setSelectedItems(new Set());
    toast({ title: `Added ${selectedItems.size} items to marketplace` });
  };

  const handleSelectAll = () => {
    if (selectedItems.size === collection?.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(collection?.map(item => item.id) || []));
    }
  };

  if (!collection || collection.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
        </div>
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-6">
            <Heart className="h-12 w-12 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No Cards in Collection</h3>
          <p className="text-gray-600 mb-6 max-w-md">
            Start building your Marvel card collection by browsing available cards and adding them to your collection.
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
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
          
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              className="bg-black text-white border-black hover:bg-gray-800"
            >
              <Checkbox 
                checked={selectedItems.size === collection.length && collection.length > 0}
                className="mr-2"
              />
              {selectedItems.size === collection.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
          <span>{collection.length} cards in collection</span>
          <span>•</span>
          <span>{collection.filter(item => item.isForSale).length} listed for sale</span>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {collection.map((item) => (
            <Card 
              key={item.id} 
              className="group hover:shadow-lg transition-all duration-200 cursor-pointer relative"
              onClick={() => handleCardClick(item.card)}
            >
              <CardContent className="p-0">
                {/* Selection Checkbox */}
                <div 
                  className="absolute top-2 left-2 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSelection(item.id);
                  }}
                >
                  <Checkbox 
                    checked={selectedItems.has(item.id)}
                    className="bg-white/80 border-2"
                  />
                </div>

                {/* Sale Status */}
                {item.isForSale && (
                  <div className="absolute top-2 right-2 z-10">
                    <Badge className="bg-green-100 text-green-800 text-xs px-2 py-1">
                      For Sale
                    </Badge>
                  </div>
                )}

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
                  <p className="text-xs text-gray-600">{item.card.set.name} #{item.card.cardNumber}</p>
                  <div className="flex items-center justify-between mt-2">
                    <Badge variant="outline" className="text-xs">
                      {item.condition}
                    </Badge>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleForSale(item.id, item.isForSale);
                        }}
                        className="h-6 w-6 p-0 hover:bg-green-100"
                      >
                        <ShoppingCart className={`h-3 w-3 ${item.isForSale ? 'text-green-600' : 'text-gray-400'}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromCollection(item.id);
                        }}
                        className="h-6 w-6 p-0 hover:bg-red-100"
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
        isInCollection={true}
        onRemoveFromCollection={() => {
          if (selectedCard) {
            const collectionItem = collection.find(item => item.card.id === selectedCard.id);
            if (collectionItem) {
              handleRemoveFromCollection(collectionItem.id);
              setIsModalOpen(false);
              setSelectedCard(null);
            }
          }
        }}
      />
    </div>
  );
}