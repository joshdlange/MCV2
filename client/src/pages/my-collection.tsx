import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Plus, Check, ShoppingCart } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
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

  const handleRemoveFromCollection = (itemId: number) => {
    removeFromCollectionMutation.mutate(itemId);
  };

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
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

    Promise.all(
      Array.from(selectedItems).map(itemId =>
        updateCollectionItemMutation.mutateAsync({
          itemId,
          updates: { isForSale: true }
        })
      )
    ).then(() => {
      setSelectedItems(new Set());
      toast({ title: `Added ${selectedItems.size} items to marketplace` });
    });
  };

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
            <p className="text-sm text-gray-600 font-roboto">
              {collection?.length || 0} cards in your collection
            </p>
          </div>
          <div className="flex gap-2">
            {selectedItems.size > 0 && (
              <Button 
                onClick={handleBulkAddToMarketplace}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                Add {selectedItems.size} to Marketplace
              </Button>
            )}
            <Button 
              onClick={() => setLocation('/browse-cards')}
              className="bg-marvel-red text-white hover:bg-red-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Cards
            </Button>
          </div>
        </div>
      </div>

      {/* Collection Grid */}
      <div className="p-6">
        {!collection || collection.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-gray-400 text-2xl">📚</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Your collection is empty</h3>
              <p className="text-gray-500 mb-6">
                Start building your Marvel card collection by adding your first card.
              </p>
              <Button className="bg-marvel-red hover:bg-red-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {collection.map((item) => (
              <Card key={item.id} className="group comic-border card-hover relative">
                <CardContent className="p-0">
                  {/* Selection checkbox */}
                  <div className="absolute top-2 left-2 z-10">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => handleToggleSelection(item.id)}
                      className="w-4 h-4 text-marvel-red bg-white border-gray-300 rounded focus:ring-marvel-red"
                    />
                  </div>
                  
                  {/* For sale indicator */}
                  {item.isForSale && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className="bg-green-600 text-white text-xs px-2 py-1 rounded">
                        For Sale
                      </div>
                    </div>
                  )}
                  
                  <div 
                    className="relative cursor-pointer"
                    onClick={() => handleCardClick(item.card)}
                  >
                    {item.card.frontImageUrl ? (
                      <img 
                        src={item.card.frontImageUrl} 
                        alt={item.card.name}
                        className="w-full h-64 object-cover rounded-t-lg"
                      />
                    ) : (
                      <div className="w-full h-64 bg-gray-200 rounded-t-lg flex items-center justify-center">
                        <span className="text-gray-400">No Image</span>
                      </div>
                    )}
                    
                    {/* Overlay buttons */}
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-t-lg">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleForSale(item.id, item.isForSale || false);
                        }}
                        className="bg-white hover:bg-gray-100"
                      >
                        <ShoppingCart className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromCollection(item.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <h3 className="font-medium text-gray-900 text-sm truncate">
                      {item.card.name} #{item.card.cardNumber}
                    </h3>
                    <p className="text-xs text-gray-500 mb-2">{item.card.set.name}</p>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        {item.card.isInsert && (
                          <span className="text-xs font-medium text-marvel-gold">★ Insert</span>
                        )}
                        {item.card.estimatedValue && (
                          <span className="text-sm font-semibold text-gray-900">
                            ${parseFloat(item.card.estimatedValue).toFixed(0)}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-xs text-gray-500">
                        <p>Condition: {item.condition}</p>
                        {item.personalValue && (
                          <p>Personal Value: ${parseFloat(item.personalValue).toFixed(0)}</p>
                        )}
                        {item.salePrice && (
                          <p>Sale Price: ${parseFloat(item.salePrice).toFixed(0)}</p>
                        )}
                      </div>
                    </div>
                    
                    {item.notes && (
                      <p className="text-xs text-gray-400 mt-2 truncate">
                        {item.notes}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
