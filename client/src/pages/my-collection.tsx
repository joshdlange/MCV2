import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardValue } from "@/components/cards/card-value";
import { BinderView } from "@/components/collection/binder-view";
import { Star, Heart, Check, ShoppingCart, Trash2, Search, Grid3X3, List, Filter, X, Plus, BookOpen, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import type { CollectionItem, CardWithSet, CardSet } from "@shared/schema";

export default function MyCollection() {
  const [, setLocation] = useLocation();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [collectionView, setCollectionView] = useState<"cards" | "sets">("sets");
  const [cardsViewMode, setCardsViewMode] = useState<"owned" | "missing">("owned");
  const [binderViewMode, setBinderViewMode] = useState<"binder" | "grid">("binder");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: collection, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });



  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  // Query for missing cards when in missing view mode
  const { data: missingCards, isLoading: missingCardsLoading } = useQuery<CardWithSet[]>({
    queryKey: [`/api/missing-cards/${selectedSet}`],
    enabled: collectionView === "cards" && cardsViewMode === "missing" && selectedSet !== "all",
  });

  // Query for all cards in the selected set (for binder view)
  // Keep query warm when viewing a specific set to avoid data loss on view toggle
  const { data: allSetCards, isLoading: allSetCardsLoading } = useQuery<CardWithSet[]>({
    queryKey: [`/api/sets/${selectedSet}/cards`],
    enabled: collectionView === "cards" && selectedSet !== "all",
  });

  // Get unique sets from collection with completion data
  const collectionSets = Array.from(new Set(collection?.map(item => item.card?.set?.id) || []))
    .map(setId => {
      const set = collection?.find(item => item.card?.set?.id === setId)?.card?.set;
      if (!set) return null;
      
      const ownedCards = collection?.filter(item => item.card?.set?.id === setId).length || 0;
      const totalCards = cardSets?.find(s => s.id === setId)?.totalCards || 0;
      const completionPercentage = totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0;
      
      // Try to find a card image from collection, then fallback to any card from the set
      const collectionCard = collection?.find(item => item.card?.set?.id === setId && item.card?.frontImageUrl);
      const setFromCardSets = cardSets?.find(s => s.id === setId);
      
      return {
        ...set,
        ownedCards,
        totalCards,
        completionPercentage,
        firstCardImage: collectionCard?.card?.frontImageUrl || setFromCardSets?.imageUrl
      };
    })
    .filter((set): set is NonNullable<typeof set> => set !== null)
    .sort((a, b) => {
      // Sort by completion percentage (highest first), then by year (newest first)
      if (a.completionPercentage !== b.completionPercentage) {
        return b.completionPercentage - a.completionPercentage;
      }
      return (b.year || 0) - (a.year || 0);
    });

  // Get filtered cards based on view mode (owned vs missing)
  const filteredCards = (() => {
    if (cardsViewMode === "missing") {
      if (missingCardsLoading) return [];
      if (!missingCards) return [];
      
      let filtered = missingCards;
      
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(card => 
          card.name.toLowerCase().includes(query) ||
          card.cardNumber.toLowerCase().includes(query) ||
          card.set.name.toLowerCase().includes(query)
        );
      }
      
      // Sort by card number (convert to number for proper sorting)
      return filtered.sort((a, b) => {
        const aNum = parseInt(a.cardNumber) || 0;
        const bNum = parseInt(b.cardNumber) || 0;
        return aNum - bNum;
      });
    }
    
    // For owned cards (collection items)
    const filteredCollection = collection?.filter(item => {
      const matchesSearch = item.card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.card.set.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.card.cardNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.card.rarity.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesSet = selectedSet === "all" || item.card.set.id.toString() === selectedSet;
      
      return matchesSearch && matchesSet;
    }).sort((a, b) => {
      // Sort cards by card number (1, 2, 3...)
      const numA = parseInt(a.card.cardNumber) || 0;
      const numB = parseInt(b.card.cardNumber) || 0;
      return numA - numB;
    }) || [];
    
    return filteredCollection;
  })();

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

  const handleCardClick = (item: CardWithSet | CollectionItem) => {
    // Handle both CardWithSet (missing cards) and CollectionItem (owned cards)
    let cardData: CardWithSet;
    
    if ('card' in item && item.card) {
      // This is a CollectionItem with nested card data
      cardData = {
        id: item.card.id,
        name: item.card.name,
        cardNumber: item.card.cardNumber,
        frontImageUrl: item.card.frontImageUrl,
        estimatedValue: item.card.estimatedValue,
        isInsert: item.card.isInsert,
        rarity: item.card.rarity,
        description: '',
        createdAt: new Date(),
        setId: item.card.set.id,
        variation: null,
        backImageUrl: null,
        set: item.card.set
      };
    } else {
      // This should not happen with proper nested structure
      console.warn('Unexpected data structure in collection item:', item);
      return;
    }
    
    setSelectedCard(cardData);
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

  const handleToggleSelectionMode = () => {
    if (isSelectionMode) {
      // Exit selection mode and clear selections
      setIsSelectionMode(false);
      setSelectedItems(new Set());
    } else {
      // Enter selection mode
      setIsSelectionMode(true);
    }
  };

  const formatCondition = (condition: string) => {
    return condition
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Helper functions to handle both CardWithSet and CollectionItem types
  const getCardId = (item: CardWithSet | CollectionItem): number => {
    return 'card' in item ? item.card.id : item.id;
  };

  const getCardName = (item: CardWithSet | CollectionItem): string => {
    return 'card' in item ? item.card.name : item.name;
  };

  const getImageUrl = (item: CardWithSet | CollectionItem): string | null => {
    return 'card' in item ? item.card.frontImageUrl : item.frontImageUrl;
  };

  const getEstimatedValue = (item: CardWithSet | CollectionItem): string | null => {
    return 'card' in item ? item.card.estimatedValue : item.estimatedValue;
  };

  const getCurrentPrice = (item: CardWithSet | CollectionItem): number | null => {
    // CollectionItems don't have currentPrice, only cards do
    return 'card' in item ? null : null;
  };

  const getSetName = (item: CardWithSet | CollectionItem): string => {
    return 'card' in item ? item.card.set.name : item.set.name;
  };

  const getCardNumber = (item: CardWithSet | CollectionItem): string => {
    return 'card' in item ? item.card.cardNumber : item.cardNumber;
  };

  const getIsInsert = (item: CardWithSet | CollectionItem): boolean => {
    return 'card' in item ? item.card.isInsert : item.isInsert;
  };

  const getCollectionCondition = (item: CollectionItem): string => {
    return item.condition;
  };

  const getCollectionQuantity = (item: CollectionItem): number => {
    return item.quantity;
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
    if (selectedItems.size === filteredCards.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredCards.map(item => item.id)));
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
          <h2 className="text-lg sm:text-xl md:text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
          
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search your collection..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64 bg-white text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            {/* View Mode Toggle */}
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <Button
                variant={collectionView === "cards" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCollectionView("cards")}
                className={`rounded-none px-3 ${collectionView === "cards" ? "text-white" : "text-[#f73f32] hover:text-[#f73f32]"}`}
              >
                Cards
              </Button>
              <Button
                variant={collectionView === "sets" ? "default" : "ghost"}
                size="sm"
                onClick={() => setCollectionView("sets")}
                className={`rounded-none px-3 ${collectionView === "sets" ? "text-white" : "text-[#f73f32] hover:text-[#f73f32]"}`}
              >
                Sets
              </Button>
            </div>
            
            {/* Cards View Mode Toggle - Show only in cards view */}
            {collectionView === "cards" && selectedSet !== "all" && (
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <Button
                  variant={cardsViewMode === "owned" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCardsViewMode("owned")}
                  className={`rounded-none px-3 ${cardsViewMode === "owned" ? "text-white" : "text-[#f73f32] hover:text-[#f73f32]"}`}
                >
                  View Owned
                </Button>
                <Button
                  variant={cardsViewMode === "missing" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCardsViewMode("missing")}
                  className={`rounded-none px-3 ${cardsViewMode === "missing" ? "text-white" : "text-[#f73f32] hover:text-[#f73f32]"}`}
                >
                  View Missing
                </Button>
              </div>
            )}
            
            {/* Layout Toggle - Show for both cards and sets view */}
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className={`rounded-none px-2 ${viewMode === "grid" ? "text-white" : "text-gray-900 hover:text-gray-900"}`}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className={`rounded-none px-2 ${viewMode === "list" ? "text-white" : "text-gray-900 hover:text-gray-900"}`}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleSelectionMode}
              className={isSelectionMode ? "bg-red-600 text-white border-red-600 hover:bg-red-700 hover:text-white" : "bg-gray-800 text-white border-gray-800 hover:bg-gray-700 hover:text-white"}
            >
              {isSelectionMode ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Exit Selection
                </>
              ) : (
                <>
                  <div className="mr-2 w-4 h-4 border border-gray-400 rounded" />
                  Select Items
                </>
              )}
            </Button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
          <span>{collection?.length || 0} cards in collection</span>
          {searchQuery && (
            <>
              <span>•</span>
              <span>{filteredCards.length} matching "{searchQuery}"</span>
            </>
          )}
          <span>•</span>
          <span>{collection?.filter(item => 'isForSale' in item ? item.isForSale : false).length || 0} listed for sale</span>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {collectionView === "cards" ? (
          <>
            {selectedSet !== "all" && (
              <div className="flex items-center justify-between mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCollectionView("sets");
                    setSelectedSet("all");
                  }}
                  className="text-gray-600 hover:text-gray-900"
                  data-testid="button-back-to-sets"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to Sets
                </Button>
                
                {cardsViewMode === "owned" && (
                  <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                    <Button
                      variant={binderViewMode === "binder" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setBinderViewMode("binder")}
                      className={`rounded-none px-2 ${binderViewMode === "binder" ? "text-white" : "text-gray-900"}`}
                      data-testid="button-binder-mode"
                    >
                      <BookOpen className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={binderViewMode === "grid" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setBinderViewMode("grid")}
                      className={`rounded-none px-2 ${binderViewMode === "grid" ? "text-white" : "text-gray-900"}`}
                      data-testid="button-expanded-grid-mode"
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
            
            {selectedSet !== "all" && cardsViewMode === "owned" && binderViewMode === "binder" ? (
              allSetCardsLoading || !cardSets ? (
                <div className="relative rounded-2xl p-4 sm:p-6" style={{ background: 'linear-gradient(135deg, #1e1e2f 0%, #141422 50%, #0d0d1a 100%)' }}>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="aspect-[2.5/3.5] rounded-lg bg-gray-700/50 animate-pulse" />
                    ))}
                  </div>
                  <div className="mt-4 text-center text-white/60 text-sm">Loading binder...</div>
                </div>
              ) : (
                <BinderView
                  ownedCards={collection?.filter(item => item.card.set.id.toString() === selectedSet) || []}
                  allCardsInSet={allSetCards || []}
                  totalCardsInSet={allSetCards?.length || 0}
                  setName={cardSets?.find(s => s.id.toString() === selectedSet)?.name || ""}
                  onCardClick={(item) => {
                    if ('card' in item) {
                      handleCardClick(item as CollectionItem);
                    } else {
                      setSelectedCard(item as CardWithSet);
                      setIsModalOpen(true);
                    }
                  }}
                  onViewModeChange={setBinderViewMode}
                  viewMode={binderViewMode}
                />
              )
            ) : cardsViewMode === "missing" && missingCardsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
          ) : cardsViewMode === "missing" && (!missingCards || missingCards.length === 0) ? (
            <div className="text-center py-12">
              <p className="text-gray-600">No missing cards found for this set.</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredCards.map((item) => (
            <Card 
              key={getCardId(item)} 
              className="group hover:shadow-lg transition-all duration-200 cursor-pointer relative"
              onClick={() => handleCardClick(item)}
            >
              <CardContent className="p-0">
                {/* Selection Checkbox - Only visible in selection mode */}
                {isSelectionMode && (
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
                )}

                {/* Sale Status and Favorite - Only for owned cards */}
                {'card' in item && (
                  <div className="absolute top-2 right-2 z-10 flex gap-1">
                    {item.isForSale && (
                      <Badge className="bg-green-100 text-green-800 text-xs px-2 py-1">
                        For Sale
                      </Badge>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(item);
                      }}
                      className={`p-1 rounded-full transition-colors ${
                        item.isFavorite 
                          ? 'bg-yellow-500 text-white' 
                          : 'bg-white/80 text-gray-400 hover:text-yellow-500'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                )}

                {/* Card Image */}
                <div className="relative aspect-[2.5/3.5] bg-gray-100 rounded-t-lg overflow-hidden">
                  {getImageUrl(item) ? (
                    <img
                      src={getImageUrl(item) ?? ''}
                      alt={getCardName(item)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                      <span className="text-red-600 font-bold text-xs text-center px-2">
                        {getCardName(item)}
                      </span>
                    </div>
                  )}

                  {/* Badges */}
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    {('card' in item ? item.card.isInsert : item.isInsert) && (
                      <div className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <span className="text-xs">💎</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Info */}
                <div className="p-3 space-y-1">
                  <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-tight">
                    {getCardName(item)}
                  </h3>
                  <p className="text-xs text-gray-600">
                    {getSetName(item)} #{getCardNumber(item)}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex gap-1">
                      {'card' in item ? (
                        <Badge className="bg-blue-100 text-blue-800 text-xs border-blue-200">
                          {formatCondition(getCollectionCondition(item))}
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 text-xs border-red-200">
                          Missing
                        </Badge>
                      )}
                      {'card' in item && getCollectionQuantity(item) > 1 && (
                        <Badge className="bg-orange-100 text-orange-800 text-xs border-orange-200">
                          Qty: {getCollectionQuantity(item)}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CardValue 
                        cardId={getCardId(item)} 
                        estimatedValue={getEstimatedValue(item)}
                        currentPrice={getCurrentPrice(item)}
                        showRefresh={true}
                      />
                      {'card' in item && (
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
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
            // List View
            <div className="space-y-3">
              {filteredCards.map((item) => (
                <Card 
                  key={item.id} 
                  className="group hover:shadow-md transition-all duration-200 cursor-pointer"
                  onClick={() => handleCardClick(item)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      {/* Selection Checkbox */}
                      {isSelectionMode && (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelection(item.id);
                          }}
                        >
                          <Checkbox 
                            checked={selectedItems.has(item.id)}
                            className="border-2"
                          />
                        </div>
                      )}

                      {/* Card Thumbnail */}
                      <div className="w-14 h-20 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {('card' in item ? item.card.frontImageUrl : item.frontImageUrl) ? (
                          <img
                            src={('card' in item ? item.card.frontImageUrl : item.frontImageUrl) ?? ''}
                            alt={'card' in item ? item.card.name : item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                            <span className="text-red-600 font-bold text-xs text-center px-1">
                              {('card' in item ? item.card.name : item.name).substring(0, 8)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Card Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 pr-2">
                            <h3 className="font-semibold text-gray-900 text-sm leading-tight mb-1">
                              {'card' in item ? item.card.name : item.name}
                            </h3>
                            <p className="text-xs text-gray-500 mb-1">
                              {'card' in item ? item.card.set.year + ' ' + item.card.set.name : item.set.year + ' ' + item.set.name}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-600">
                                #{'card' in item ? item.card.cardNumber : item.cardNumber}
                              </span>
                              {('card' in item ? item.card.isInsert : item.isInsert) && (
                                <div className="bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center">
                                  <span className="text-[10px]">💎</span>
                                </div>
                              )}
                              {'card' in item && item.quantity > 1 && (
                                <Badge className="bg-orange-100 text-orange-800 text-[10px] px-1 py-0">
                                  x{item.quantity}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Card Value and Status */}
                          <div className="flex flex-col items-end gap-1">
                            <div className="text-sm font-medium">
                              <CardValue 
                                cardId={'card' in item ? item.card.id : item.id} 
                                estimatedValue={getEstimatedValue(item)}
                                currentPrice={getCurrentPrice(item)}
                                showRefresh={false}
                              />
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {'card' in item ? (
                                <div className="p-1 rounded-full bg-green-500 text-white">
                                  <Check className="w-3 h-3" />
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Add to wishlist logic
                                  }}
                                  className="p-1 rounded-full bg-gray-200 text-gray-600 hover:bg-red-100 hover:text-red-600"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              )}
                              
                              {'card' in item && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleFavorite(item);
                                  }}
                                  className={`p-1 rounded-full transition-colors ${
                                    item.isFavorite 
                                      ? 'bg-yellow-500 text-white' 
                                      : 'bg-gray-200 text-gray-400 hover:text-yellow-500'
                                  }`}
                                >
                                  <Star className={`w-3 h-3 ${item.isFavorite ? 'fill-current' : ''}`} />
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
          </>
        ) : (
          // Sets View
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {collectionSets.map((set) => (
              <Card 
                key={set.id} 
                className="group hover:shadow-lg transition-all duration-200 cursor-pointer"
                onClick={() => {
                  setCollectionView("cards");
                  setSelectedSet(set.id.toString());
                }}
              >
                <CardContent className="p-0">
                  {/* Set Image */}
                  <div className="relative aspect-[3/4] bg-gray-100 rounded-t-lg overflow-hidden">
                    {set.firstCardImage ? (
                      <img
                        src={set.firstCardImage}
                        alt={set.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                        <span className="text-red-600 font-bold text-sm text-center px-4">
                          {set.name}
                        </span>
                      </div>
                    )}
                    
                    {/* Completion Badge */}
                    <div className="absolute top-2 right-2">
                      <Badge 
                        className={`text-white font-bold ${
                          set.completionPercentage === 100 
                            ? 'bg-green-600' 
                            : set.completionPercentage >= 75 
                            ? 'bg-blue-600' 
                            : set.completionPercentage >= 50 
                            ? 'bg-yellow-600' 
                            : 'bg-gray-600'
                        }`}
                      >
                        {set.completionPercentage}%
                      </Badge>
                    </div>
                  </div>

                  {/* Set Info */}
                  <div className="p-4 space-y-3">
                    <div>
                      <h3 className="font-semibold text-gray-900 line-clamp-2 leading-tight">
                        {set.name}
                      </h3>
                      <p className="text-sm text-gray-600">{set.year}</p>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Progress</span>
                        <span className="font-medium text-gray-900">
                          {set.ownedCards} of {set.totalCards}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-300 ${
                            set.completionPercentage === 100 
                              ? 'bg-green-600' 
                              : set.completionPercentage >= 75 
                              ? 'bg-blue-600' 
                              : set.completionPercentage >= 50 
                              ? 'bg-yellow-600' 
                              : 'bg-gray-600'
                          }`}
                          style={{ width: `${set.completionPercentage}%` }}
                        />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs text-white bg-green-600 border-green-600 hover:bg-green-700 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollectionView("cards");
                          setSelectedSet(set.id.toString());
                          setCardsViewMode("owned");
                        }}
                      >
                        View Owned
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs text-white bg-[#f73f32] border-[#f73f32] hover:bg-red-700 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollectionView("cards");
                          setSelectedSet(set.id.toString());
                          setCardsViewMode("missing");
                        }}
                      >
                        View Missing
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              ))}
            </div>
          ) : (
            // Sets List View
            <div className="space-y-6">
              {collectionSets.map((set) => (
                <Card 
                  key={set.id} 
                  className="group hover:shadow-md transition-all duration-200 cursor-pointer"
                  onClick={() => {
                    setCollectionView("cards");
                    setSelectedSet(set.id.toString());
                  }}
                >
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center gap-4 md:gap-6">
                      {/* Set Thumbnail */}
                      <div className="w-20 h-28 md:w-16 md:h-22 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {set.firstCardImage ? (
                          <img
                            src={set.firstCardImage}
                            alt={set.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                            <span className="text-red-600 font-bold text-xs text-center px-1">
                              {set.name.substring(0, 10)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Set Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-900 text-lg md:text-base truncate">{set.name}</h3>
                            <p className="text-sm text-gray-600 mt-1">{set.year}</p>
                            
                            {/* Progress Bar */}
                            <div className="space-y-2 mt-3">
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600">Progress</span>
                                <span className="font-medium text-gray-900">
                                  {set.ownedCards} of {set.totalCards} ({set.completionPercentage}%)
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div 
                                  className={`h-2.5 rounded-full transition-all duration-300 ${
                                    set.completionPercentage === 100 
                                      ? 'bg-green-600' 
                                      : set.completionPercentage >= 75 
                                      ? 'bg-blue-600' 
                                      : set.completionPercentage >= 50 
                                      ? 'bg-yellow-600' 
                                      : 'bg-gray-600'
                                  }`}
                                  style={{ width: `${set.completionPercentage}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 w-full md:w-auto md:ml-4">
                            <div className="flex rounded-lg overflow-hidden w-full">
                              <Button
                                variant="default"
                                size="sm"
                                className="rounded-none bg-green-600 text-white hover:bg-green-700 text-sm md:text-xs px-4 md:px-3 flex-1 md:flex-none"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollectionView("cards");
                                  setSelectedSet(set.id.toString());
                                  setCardsViewMode("owned");
                                }}
                              >
                                View Owned
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                className="rounded-none bg-[#f73f32] text-white hover:bg-red-700 text-sm md:text-xs px-4 md:px-3 flex-1 md:flex-none"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollectionView("cards");
                                  setSelectedSet(set.id.toString());
                                  setCardsViewMode("missing");
                                }}
                              >
                                View Missing
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCard(null);
        }}
        isInCollection={true}
        collectionItemId={selectedCard ? collection.find(item => item.card.id === selectedCard.id)?.id : undefined}
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
        onCardUpdate={(updatedCard) => setSelectedCard(updatedCard)}
      />
    </div>
  );
}