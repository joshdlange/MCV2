import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, ArrowLeft, Plus, Edit, Filter, Grid3X3, List, X, Save } from "lucide-react";
import { CardGrid } from "@/components/cards/card-grid";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store";
import { apiRequest } from "@/lib/queryClient";
import type { CardSet, CardWithSet, CollectionItem } from "@shared/schema";

interface CardFilters {
  setId?: number;
  search?: string;
  rarity?: string;
  isInsert?: boolean;
}

export default function BrowseCards() {
  const [selectedSet, setSelectedSet] = useState<CardSet | null>(null);
  const [filters, setFilters] = useState<CardFilters>({});
  const [favoriteSetIds, setFavoriteSetIds] = useState<number[]>([]);
  const [setSearchQuery, setSetSearchQuery] = useState("");
  const [editingSet, setEditingSet] = useState<CardSet | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editFormData, setEditFormData] = useState({
    name: '',
    year: 0,
    description: '',
    imageUrl: ''
  });
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const { toast } = useToast();
  const { isAdminMode } = useAppStore();
  const queryClient = useQueryClient();

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const { data: wishlist } = useQuery<any[]>({
    queryKey: ["/api/wishlist"],
  });

  // Add to collection mutation
  const addToCollectionMutation = useMutation({
    mutationFn: (cardId: number) => 
      apiRequest("POST", "/api/collection", { cardId, condition: "Near Mint" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      toast({ title: "Card added to collection!" });
    },
    onError: () => {
      toast({ title: "Failed to add card to collection", variant: "destructive" });
    },
  });

  // Add to wishlist mutation
  const addToWishlistMutation = useMutation({
    mutationFn: (cardId: number) => 
      apiRequest("POST", "/api/wishlist", { cardId, priority: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({ title: "Card added to wishlist!" });
    },
    onError: () => {
      toast({ title: "Failed to add card to wishlist", variant: "destructive" });
    },
  });

  // Remove from collection mutation
  const removeFromCollectionMutation = useMutation({
    mutationFn: (cardId: number) => {
      const collectionItem = collection?.find(item => item.cardId === cardId);
      if (collectionItem) {
        return apiRequest("DELETE", `/api/collection/${collectionItem.id}`);
      }
      throw new Error("Card not found in collection");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      toast({ title: "Card removed from collection!" });
    },
    onError: () => {
      toast({ title: "Failed to remove card from collection", variant: "destructive" });
    },
  });

  // Remove from wishlist mutation
  const removeFromWishlistMutation = useMutation({
    mutationFn: (cardId: number) => {
      const wishlistItem = wishlist?.find((item: any) => item.cardId === cardId);
      if (wishlistItem) {
        return apiRequest("DELETE", `/api/wishlist/${wishlistItem.id}`);
      }
      throw new Error("Card not found in wishlist");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({ title: "Card removed from wishlist!" });
    },
    onError: () => {
      toast({ title: "Failed to remove card from wishlist", variant: "destructive" });
    },
  });

  // Helper functions to check if card is in collection/wishlist
  const isCardInCollection = (cardId: number) => {
    return collection?.some(item => item.cardId === cardId) || false;
  };

  const isCardInWishlist = (cardId: number) => {
    return wishlist?.some((item: any) => item.cardId === cardId) || false;
  };

  // Global search for both sets and cards
  const { data: searchResults } = useQuery<{ sets: CardSet[], cards: CardWithSet[] }>({
    queryKey: ["/api/search", setSearchQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(setSearchQuery)}`).then(res => res.json()),
    enabled: setSearchQuery.length >= 2,
  });

  const handleSearchChange = (search: string) => {
    setFilters(prev => ({ ...prev, search: search || undefined }));
  };

  const handleSetClick = (set: CardSet) => {
    setSelectedSet(set);
    setFilters({ setId: set.id });
  };

  const handleBackToSets = () => {
    setSelectedSet(null);
    setFilters({});
  };

  const clearFilters = () => {
    setFilters(prev => ({ setId: prev.setId }));
  };

  const handleInsertFilter = (value: string) => {
    if (value === "all") {
      setFilters(prev => ({ ...prev, isInsert: undefined }));
    } else {
      setFilters(prev => ({ ...prev, isInsert: value === "true" }));
    }
  };

  const handleFavoriteSet = (setId: number) => {
    setFavoriteSetIds(prev => 
      prev.includes(setId) 
        ? prev.filter(id => id !== setId)
        : [...prev, setId]
    );
  };

  const convertGoogleDriveUrl = (url: string) => {
    if (url.includes('drive.google.com')) {
      const fileId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (fileId) {
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }
    return url;
  };

  const addAllMutation = useMutation({
    mutationFn: async (setId: number) => {
      // Get cards for this set
      const cardsResponse = await fetch(`/api/cards?setId=${setId}`);
      const cards: CardWithSet[] = await cardsResponse.json();
      
      // Get cards already in collection for this set
      const collectionCardIds = collection?.map(item => item.cardId) || [];
      
      // Filter out cards already in collection
      const newCards = cards.filter(card => !collectionCardIds.includes(card.id));
      
      if (newCards.length === 0) {
        throw new Error('All cards from this set are already in your collection!');
      }
      
      // Add each new card to collection
      const promises = newCards.map(card => {
        const insertData = {
          cardId: card.id,
          condition: 'near_mint',
          quantity: 1
        };
        
        return apiRequest('POST', '/api/collection', insertData);
      });
      
      await Promise.all(promises);
      return { addedCount: newCards.length, totalCards: cards.length };
    },
    onSuccess: (data) => {
      // Invalidate all related queries for immediate updates
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recent-cards'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trending-cards'] });
      
      toast({
        title: "Cards Added Successfully!",
        description: `Added ${data.addedCount} new cards to your collection (${data.totalCards - data.addedCount} were already owned).`
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error Adding Cards",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleAddAllToCollection = (setId: number) => {
    addAllMutation.mutate(setId);
  };

  const handleEditSet = (setId: number) => {
    const set = cardSets?.find(s => s.id === setId);
    if (set) {
      setEditingSet(set);
      setEditFormData({
        name: set.name,
        year: set.year,
        description: set.description || '',
        imageUrl: set.imageUrl || ''
      });
    }
  };

  const updateSetMutation = useMutation({
    mutationFn: async ({ setId, updates }: { setId: number, updates: any }) => {
      const response = await fetch(`/api/card-sets/${setId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error('Failed to update set');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/card-sets'] });
      setEditingSet(null);
      setEditFormData({ name: '', year: 0, description: '', imageUrl: '' });
      toast({
        title: "Set Updated",
        description: "Card set has been updated successfully."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error Updating Set",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSaveSet = () => {
    if (editingSet && editFormData.name.trim()) {
      updateSetMutation.mutate({ 
        setId: editingSet.id, 
        updates: {
          name: editFormData.name.trim(),
          year: editFormData.year,
          description: editFormData.description.trim() || null,
          imageUrl: editFormData.imageUrl.trim() || null
        }
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingSet(null);
    setEditFormData({ name: '', year: 0, description: '', imageUrl: '' });
  };

  // Show individual cards if a set is selected
  if (selectedSet) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Page Header */}
        <div className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-6 py-4">
          <div className="flex flex-col space-y-4 md:space-y-0 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={handleBackToSets}
                className="flex items-center gap-2 text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Sets</span>
                <span className="sm:hidden">Back</span>
              </Button>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl md:text-2xl font-bebas text-gray-900 tracking-wide truncate">{selectedSet.name}</h2>
                <p className="text-sm text-gray-600 font-roboto">
                  Explore cards from this set
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => handleFavoriteSet(selectedSet.id)}
                variant="outline"
                size="sm"
                className={`flex items-center gap-2 ${
                  favoriteSetIds.includes(selectedSet.id) 
                    ? 'bg-yellow-50 text-yellow-700 border-yellow-300' 
                    : ''
                }`}
              >
                <Star className={`w-4 h-4 ${favoriteSetIds.includes(selectedSet.id) ? 'fill-current' : ''}`} />
                <span className="hidden sm:inline">{favoriteSetIds.includes(selectedSet.id) ? 'Favorited' : 'Favorite Set'}</span>
                <span className="sm:hidden">{favoriteSetIds.includes(selectedSet.id) ? 'Favorited' : 'Favorite'}</span>
              </Button>
              <Button
                onClick={() => handleAddAllToCollection(selectedSet.id)}
                disabled={addAllMutation.isPending}
                size="sm"
                className="bg-marvel-red hover:bg-red-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{addAllMutation.isPending ? 'Adding All Cards...' : 'Add All to Collection'}</span>
                <span className="sm:hidden">{addAllMutation.isPending ? 'Adding...' : 'Add All'}</span>
              </Button>
              <Select 
                value={filters.isInsert === undefined ? "all" : filters.isInsert.toString()} 
                onValueChange={handleInsertFilter}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="true">Insert Cards</SelectItem>
                  <SelectItem value="false">Base Cards</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Filters for individual cards */}
        <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4">
          <div className="flex flex-col space-y-3 md:space-y-0 md:flex-row md:flex-wrap md:items-center gap-4">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search cards in this set..."
                  value={filters.search || ""}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
            </div>

            {/* Layout Toggle - Larger on mobile */}
            <div className="flex gap-1">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="h-10 w-12 md:h-8 md:w-8 p-0"
              >
                <Grid3X3 className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="h-10 w-12 md:h-8 md:w-8 p-0"
              >
                <List className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </div>

            {Object.keys(filters).filter(key => key !== 'setId').length > 0 && (
              <Button 
                variant="outline" 
                onClick={clearFilters}
                className="text-gray-600 hover:text-gray-900"
              >
                <Filter className="w-4 h-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Cards Grid */}
        <div className="p-6">
          <CardGrid filters={filters} viewMode={viewMode} />
        </div>
      </div>
    );
  }

  // Filter sets based on search query
  const filteredSets = cardSets?.filter(set => {
    if (!setSearchQuery) return true;
    const query = setSearchQuery.toLowerCase();
    return set.name.toLowerCase().includes(query) || 
           set.year?.toString().includes(query) ||
           set.description?.toLowerCase().includes(query);
  }) || [];

  // Show search results when user is searching
  const shouldShowSearchResults = setSearchQuery.length >= 2 && searchResults;

  // Show card sets grid
  const favoritesets = filteredSets.filter(set => favoriteSetIds.includes(set.id));
  const otherSets = filteredSets.filter(set => !favoriteSetIds.includes(set.id));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-6 py-4">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">BROWSE CARD SETS</h2>
              <p className="text-sm text-gray-600 font-roboto">
                Choose a card set to explore individual cards
              </p>
            </div>
          </div>
          
          {/* Set Search Bar */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search sets by name or year..."
              value={setSearchQuery}
              onChange={(e) => setSetSearchQuery(e.target.value)}
              className="pl-10 bg-white text-gray-900 placeholder:text-gray-500"
            />
          </div>
        </div>
      </div>

      {/* Search Results or Card Sets Grid */}
      <div className="p-6">
        {/* Show Search Results */}
        {shouldShowSearchResults ? (
          <div className="space-y-8">
            {/* Search Results Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Search Results for "{setSearchQuery}"
              </h3>
              <div className="text-sm text-gray-600">
                {searchResults.sets.length} sets, {searchResults.cards.length > 0 && (
                  <button
                    onClick={() => {
                      const element = document.getElementById('individual-cards-section');
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                    className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                  >
                    {searchResults.cards.length} cards
                  </button>
                )}
                {searchResults.cards.length === 0 && `${searchResults.cards.length} cards`}
              </div>
            </div>

            {/* Card Sets Results */}
            {searchResults.sets.length > 0 && (
              <div>
                <h4 className="text-md font-semibold text-gray-900 mb-4">Card Sets</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                  {searchResults.sets.map((set) => (
                    <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                      <CardContent className="p-0">
                        <div className="relative">
                          {set.imageUrl ? (
                            <img 
                              src={convertGoogleDriveUrl(set.imageUrl)} 
                              alt={set.name}
                              className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                            />
                          ) : (
                            <div className="w-full h-32 md:h-48 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                              <span className="text-white text-sm md:text-lg font-bold text-center px-2 md:px-4">{set.name}</span>
                            </div>
                          )}
                        </div>
                        <div className="p-3 md:p-4">
                          <h3 className="font-semibold text-gray-900 mb-1 md:mb-2 text-sm md:text-base line-clamp-2">{set.name}</h3>
                          <p className="text-xs md:text-sm text-gray-600 mb-2 line-clamp-2 hidden md:block">{set.description || 'Click to explore cards from this set'}</p>
                          <p className="text-xs text-gray-500 mb-2 md:mb-3">{set.totalCards} cards • {set.year}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Individual Cards Results */}
            {searchResults.cards.length > 0 && (
              <div id="individual-cards-section">
                <h4 className="text-md font-semibold text-gray-900 mb-4">Individual Cards</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
                  {searchResults.cards.slice(0, 12).map((card) => (
                    <Card key={card.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedCard(card)}>
                      <CardContent className="p-0">
                        <div className="relative">
                          {card.frontImageUrl ? (
                            <img 
                              src={convertGoogleDriveUrl(card.frontImageUrl)} 
                              alt={card.name}
                              className="w-full h-32 md:h-40 object-cover rounded-t-lg"
                            />
                          ) : (
                            <div className="w-full h-32 md:h-40 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                              <span className="text-white text-xs md:text-sm font-bold text-center px-2">{card.name}</span>
                            </div>
                          )}
                          <div className="absolute top-2 right-2">
                            <span className="bg-black/70 text-white text-xs px-2 py-1 rounded">
                              #{card.cardNumber}
                            </span>
                          </div>
                        </div>
                        <div className="p-2 md:p-3">
                          <h3 className="font-semibold text-gray-900 text-xs md:text-sm line-clamp-2 mb-1">{card.name}</h3>
                          <p className="text-xs text-gray-600 mb-1">{card.set.name}</p>
                          <p className="text-xs text-gray-500">{card.rarity}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                {searchResults.cards.length > 12 && (
                  <div className="mt-4 text-center">
                    <p className="text-sm text-gray-600">
                      Showing 12 of {searchResults.cards.length} cards. Click on a set to see all cards.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* No Results */}
            {searchResults.sets.length === 0 && searchResults.cards.length === 0 && (
              <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                  <Search className="w-16 h-16 mx-auto" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No results found</h3>
                <p className="text-gray-600">Try adjusting your search terms</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Favorite Sets */}
            {favoritesets.length > 0 && (
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500 fill-current" />
                  Favorite Sets
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                  {favoritesets.map((set) => (
                    <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                      <CardContent className="p-0">
                        <div className="relative">
                          {set.imageUrl ? (
                            <img 
                              src={convertGoogleDriveUrl(set.imageUrl)} 
                              alt={set.name}
                              className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                            />
                          ) : (
                            <div className="w-full h-32 md:h-48 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                              <span className="text-white text-sm md:text-lg font-bold text-center px-2 md:px-4">{set.name}</span>
                            </div>
                          )}
                          <div className="absolute top-2 right-2 flex gap-1">
                            {isAdminMode && (
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditSet(set.id);
                                }}
                                variant="outline"
                                size="sm"
                                className="bg-white/90 hover:bg-white"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFavoriteSet(set.id);
                              }}
                              variant="outline"
                              size="sm"
                              className="bg-white/90 hover:bg-white"
                            >
                              <Star className="w-4 h-4 text-yellow-500 fill-current" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-3 md:p-4">
                          <h3 className="font-semibold text-gray-900 mb-1 md:mb-2 text-sm md:text-base line-clamp-2">{set.name}</h3>
                          <p className="text-xs md:text-sm text-gray-600 mb-2 line-clamp-2 hidden md:block">{set.description || 'Click to explore cards from this set'}</p>
                          <p className="text-xs text-gray-500 mb-2 md:mb-3">{set.totalCards} cards • {set.year}</p>
                          <div className="flex gap-2">
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddAllToCollection(set.id);
                              }}
                              size="sm"
                              className="flex-1 bg-marvel-red hover:bg-red-700"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              {addAllMutation.isPending ? 'Adding...' : 'Add All'}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* All Sets */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {favoritesets.length > 0 ? 'All Sets' : 'Card Sets'}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                {otherSets.map((set) => (
                  <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                    <CardContent className="p-0">
                      <div className="relative">
                        {set.imageUrl ? (
                          <img 
                            src={convertGoogleDriveUrl(set.imageUrl)} 
                            alt={set.name}
                            className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                          />
                        ) : (
                          <div className="w-full h-32 md:h-48 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                            <span className="text-white text-sm md:text-lg font-bold text-center px-2 md:px-4">{set.name}</span>
                          </div>
                        )}
                        <div className="absolute top-2 right-2 flex gap-1">
                          {isAdminMode && (
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditSet(set.id);
                              }}
                              variant="outline"
                              size="sm"
                              className="bg-white/90 hover:bg-white"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFavoriteSet(set.id);
                            }}
                            variant="outline"
                            size="sm"
                            className="bg-white/90 hover:bg-white"
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-gray-900 mb-2">{set.name}</h3>
                        <p className="text-sm text-gray-600 mb-2">{set.description || 'Click to explore cards from this set'}</p>
                        <p className="text-xs text-gray-500 mb-3">{set.totalCards} cards • {set.year}</p>
                        <div className="flex gap-2">
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddAllToCollection(set.id);
                            }}
                            size="sm"
                            className="flex-1 bg-marvel-red hover:bg-red-700"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add All
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Edit Set Modal */}
      <Dialog open={!!editingSet} onOpenChange={() => handleCancelEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Card Set</DialogTitle>
            <DialogDescription>
              Update the details for this card set.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Set Name</Label>
              <Input
                id="name"
                value={editFormData.name}
                onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter set name"
              />
            </div>
            
            <div>
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                value={editFormData.year}
                onChange={(e) => setEditFormData(prev => ({ ...prev, year: parseInt(e.target.value) || 0 }))}
                placeholder="Enter year"
              />
            </div>
            
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={editFormData.description}
                onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Enter set description"
                rows={3}
              />
            </div>
            
            <div>
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={editFormData.imageUrl}
                onChange={(e) => setEditFormData(prev => ({ ...prev, imageUrl: e.target.value }))}
                placeholder="Enter image URL"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={handleCancelEdit}>
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
            <Button 
              onClick={handleSaveSet}
              disabled={!editFormData.name.trim() || updateSetMutation.isPending}
              className="bg-marvel-red hover:bg-red-700"
            >
              <Save className="w-4 h-4 mr-1" />
              {updateSetMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full-Featured Card Details Modal */}
      <CardDetailModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        isInCollection={selectedCard ? isCardInCollection(selectedCard.id) : false}
        isInWishlist={selectedCard ? isCardInWishlist(selectedCard.id) : false}
        onAddToCollection={() => selectedCard && addToCollectionMutation.mutate(selectedCard.id)}
        onAddToWishlist={() => selectedCard && addToWishlistMutation.mutate(selectedCard.id)}
        onRemoveFromCollection={() => selectedCard && removeFromCollectionMutation.mutate(selectedCard.id)}
        onRemoveFromWishlist={() => selectedCard && removeFromWishlistMutation.mutate(selectedCard.id)}
      />

      {/* Floating Set Navigation for Mobile */}
      {selectedSet && (
        <div className="fixed bottom-6 right-6 md:hidden z-40">
          <Button
            onClick={() => setSelectedSet(null)}
            className="bg-marvel-red hover:bg-red-700 text-white rounded-full w-14 h-14 shadow-lg"
            size="sm"
          >
            <Grid3X3 className="w-6 h-6" />
          </Button>
        </div>
      )}
    </div>
  );
}