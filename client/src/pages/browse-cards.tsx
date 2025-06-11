import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, ArrowLeft, Plus, Edit, Filter, Grid3X3, List, X, Save, ChevronDown, ChevronRight } from "lucide-react";
import { CardGrid } from "@/components/cards/card-grid";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { SetThumbnail } from "@/components/cards/set-thumbnail";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store";
import { apiRequest } from "@/lib/queryClient";
import type { CardSet, CardWithSet, CollectionItem } from "@shared/schema";

interface CardFilters {
  setId?: number;
  search?: string;
  rarity?: string;
  isInsert?: boolean;
  year?: number;
}

export default function BrowseCards() {
  const [selectedSet, setSelectedSet] = useState<CardSet | null>(null);
  const [selectedMainSet, setSelectedMainSet] = useState<any>(null);
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
  const [expandedMainSets, setExpandedMainSets] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsPerPage] = useState(50);
  const { toast } = useToast();
  const { isAdminMode } = useAppStore();
  const queryClient = useQueryClient();

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const { data: mainSetsData } = useQuery({
    queryKey: ["/api/main-sets-with-details"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const { data: wishlist } = useQuery<any[]>({
    queryKey: ["/api/wishlist"],
  });

  // Paginated cards query for selected set (ONLY when set is selected, not mainSet)
  const { data: cardsData, isLoading: cardsLoading } = useQuery<{cards: CardWithSet[], totalCount: number}>({
    queryKey: ["/api/cards", { 
      setId: selectedSet?.id, 
      page: currentPage, 
      limit: cardsPerPage,
      ...filters 
    }],
    enabled: !!selectedSet && !!selectedMainSet, // Only load cards when we have BOTH mainSet and specific subset selected
    queryFn: async () => {
      if (!selectedSet) throw new Error('No set selected');
      
      const params = new URLSearchParams({
        setId: selectedSet.id.toString(),
        page: currentPage.toString(),
        limit: Math.min(cardsPerPage, 50).toString(), // Ensure max 50 cards per request
        ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, String(v)]))
      });
      
      const response = await fetch(`/api/cards?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch cards');
      }
      return response.json();
    },
    select: (data: any) => {
      // Add performance logging and debug info
      console.time(`Card list load (Set ${selectedSet?.id})`);
      const cardCount = data?.cards?.length || data?.length || 0;
      console.log(`VIEW MODE: card | mainSetId: ${selectedMainSet?.id} | setId: ${selectedSet?.id} | cardCount loaded: ${cardCount}`);
      const result = {
        cards: data?.cards || data || [],
        totalCount: data?.totalCount || data?.length || 0
      };
      console.timeEnd(`Card list load (Set ${selectedSet?.id})`);
      return result;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false
  });

  // Subsets query for selected mainSet
  const { data: subsetsData, isLoading: subsetsLoading } = useQuery<CardSet[]>({
    queryKey: ["/api/sets", { mainSetId: selectedMainSet?.id }],
    enabled: !!selectedMainSet,
    queryFn: async () => {
      if (!selectedMainSet) return [];
      
      const response = await fetch(`/api/sets?mainSetId=${selectedMainSet.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch subsets');
      }
      return response.json();
    },
    select: (data: CardSet[]) => {
      if (!selectedMainSet) return [];
      
      // Add performance logging and debug info
      console.time(`Subset load (MainSet ${selectedMainSet.id})`);
      console.log(`VIEW MODE: subset | mainSetId: ${selectedMainSet.id} | setId: none | cardCount loaded: 0`);
      console.log(`Found ${data.length} subsets for mainSet ${selectedMainSet.id}`);
      console.timeEnd(`Subset load (MainSet ${selectedMainSet.id})`);
      return data;
    }
  });

  // Search query
  const { data: searchResults } = useQuery({
    queryKey: ["/api/search", setSearchQuery],
    enabled: setSearchQuery.length >= 2,
  });

  // Navigation handlers for hierarchy
  const handleMainSetClick = (mainSet: any) => {
    console.time(`MainSet load (${mainSet.name})`);
    console.log(`VIEW MODE: mainSet | mainSetId: ${mainSet.id} | setId: none | cardCount loaded: 0`);
    setSelectedMainSet(mainSet);
    setSelectedSet(null);
    setCurrentPage(1);
    console.timeEnd(`MainSet load (${mainSet.name})`);
  };

  const handleSubsetClick = (subset: CardSet) => {
    console.time(`Subset selected (${subset.name})`);
    console.log(`VIEW MODE: card | mainSetId: ${selectedMainSet?.id || 'none'} | setId: ${subset.id} | cardCount loaded: 0`);
    setSelectedSet(subset);
    // KEEP selectedMainSet for proper hierarchy - DO NOT clear it
    setCurrentPage(1);
    console.timeEnd(`Subset selected (${subset.name})`);
  };

  const handleBackToMainSets = () => {
    setSelectedMainSet(null);
    setSelectedSet(null);
    setCurrentPage(1);
  };

  const handleBackToSubsets = () => {
    setSelectedSet(null);
    setCurrentPage(1);
  };

  const handleSetClick = (set: CardSet) => {
    // This function should NOT be used for subset navigation
    // Use handleSubsetClick instead to maintain hierarchy
    setSelectedSet(set);
    // Do NOT clear selectedMainSet here - breaks hierarchy
    setCurrentPage(1);
  };

  // Other mutations and handlers...
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
      toast({ title: "Card removed from collection" });
    },
    onError: () => {
      toast({ title: "Failed to remove card from collection", variant: "destructive" });
    },
  });

  const removeFromWishlistMutation = useMutation({
    mutationFn: (cardId: number) => {
      const wishlistItem = wishlist?.find(item => item.cardId === cardId);
      if (wishlistItem) {
        return apiRequest("DELETE", `/api/wishlist/${wishlistItem.id}`);
      }
      throw new Error("Card not found in wishlist");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({ title: "Card removed from wishlist" });
    },
    onError: () => {
      toast({ title: "Failed to remove card from wishlist", variant: "destructive" });
    },
  });

  const handleFavoriteSet = (setId: number) => {
    setFavoriteSetIds(prev => 
      prev.includes(setId) 
        ? prev.filter(id => id !== setId)
        : [...prev, setId]
    );
  };

  // Show search results when user is searching
  const shouldShowSearchResults = setSearchQuery.length >= 2 && searchResults;

  // Show card sets grid (sort favorites by year too)
  const filteredSets = cardSets?.filter(set => {
    // Year filter
    if (filters.year && set.year !== filters.year) return false;
    
    // Search query filter
    if (!setSearchQuery) return true;
    const query = setSearchQuery.toLowerCase();
    return set.name.toLowerCase().includes(query) || 
           set.year?.toString().includes(query) ||
           set.description?.toLowerCase().includes(query);
  }).sort((a, b) => (b.year || 0) - (a.year || 0)) || [];

  const favoritesets = filteredSets.filter(set => favoriteSetIds.includes(set.id));

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
          
          {/* Set Search Bar and Year Filter */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search sets by name or year..."
                value={setSearchQuery}
                onChange={(e) => setSetSearchQuery(e.target.value)}
                className="pl-10 bg-white text-gray-900 placeholder:text-gray-500"
              />
            </div>
            <Select 
              value={filters.year?.toString() || "all"} 
              onValueChange={(value) => setFilters(prev => ({ 
                ...prev, 
                year: value === "all" ? undefined : parseInt(value)
              }))}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="All Years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {Array.from(new Set(cardSets?.map(set => set.year).filter(Boolean)))
                  .sort((a, b) => (b || 0) - (a || 0))
                  .map(year => (
                    <SelectItem key={year} value={year!.toString()}>{year}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Navigation Breadcrumbs */}
      {(selectedMainSet || selectedSet) && (
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={handleBackToMainSets}
              className="text-blue-600 hover:text-blue-800 hover:underline"
            >
              Marvel Card Sets
            </button>
            {selectedMainSet && (
              <>
                <span className="text-gray-400">/</span>
                <span className="text-gray-900 font-medium">{selectedMainSet.name}</span>
              </>
            )}
            {selectedSet && (
              <>
                <span className="text-gray-400">/</span>
                {selectedMainSet && (
                  <>
                    <button
                      onClick={handleBackToSubsets}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Subsets
                    </button>
                    <span className="text-gray-400">/</span>
                  </>
                )}
                <span className="text-gray-900 font-medium">{selectedSet.name}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-6">
        {/* View 1: Subsets from MainSet (Second Level) */}
        {selectedMainSet && !selectedSet && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{selectedMainSet.name} Subsets</h3>
                <p className="text-gray-600">
                  {subsetsData?.length || 0} subsets found
                </p>
              </div>
              <Button
                onClick={handleBackToMainSets}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Main Sets
              </Button>
            </div>

            {subsetsLoading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-marvel-red"></div>
                <p className="text-gray-600 font-medium">Loading subsets...</p>
              </div>
            ) : subsetsData && subsetsData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {subsetsData.map((subset) => (
                  <Card 
                    key={subset.id} 
                    className="cursor-pointer hover:shadow-lg transition-shadow duration-200 border-2 hover:border-marvel-red"
                    onClick={() => handleSubsetClick(subset)}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-col space-y-3">
                        <div className="aspect-[2/3] relative overflow-hidden rounded-lg bg-gray-100">
                          <SetThumbnail 
                            setId={subset.id}
                            setName={subset.name}
                            setImageUrl={subset.imageUrl}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="text-center">
                          <h4 className="font-semibold text-gray-900 text-sm truncate">{subset.name}</h4>
                          <p className="text-xs text-gray-500">{subset.totalCards || 0} cards</p>
                          <p className="text-xs text-gray-500">{subset.year}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500">No subsets found for this main set.</p>
              </div>
            )}
          </div>
        )}

        {/* View 2: Selected Set Cards (Final Level) */}
        {selectedSet && selectedMainSet && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{selectedSet.name}</h3>
                <p className="text-gray-600">
                  {cardsData?.totalCount || 0} cards • Page {currentPage} of {Math.ceil((cardsData?.totalCount || 0) / cardsPerPage)}
                </p>
              </div>
              <Button
                onClick={handleBackToMainSets}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sets
              </Button>
            </div>

            {cardsLoading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-marvel-red"></div>
                <p className="text-gray-600 font-medium">Loading cards...</p>
              </div>
            ) : cardsData?.cards && cardsData.cards.length > 0 ? (
              <>
                <CardGrid 
                  cards={cardsData.cards}
                  onCardClick={setSelectedCard}
                  isInCollection={(cardId: number) => 
                    collection?.some(item => item.cardId === cardId) || false
                  }
                  isInWishlist={(cardId: number) => 
                    wishlist?.some(item => item.cardId === cardId) || false
                  }
                  onAddToCollection={addToCollectionMutation.mutate}
                  onRemoveFromCollection={removeFromCollectionMutation.mutate}
                  onAddToWishlist={addToWishlistMutation.mutate}
                  onRemoveFromWishlist={removeFromWishlistMutation.mutate}
                  viewMode={viewMode}
                />
                {/* Pagination */}
                {cardsData.totalCount > cardsPerPage && (
                  <div className="flex justify-center gap-2 mt-8">
                    <Button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      variant="outline"
                    >
                      Previous
                    </Button>
                    <span className="flex items-center px-4 py-2 text-sm text-gray-600">
                      Page {currentPage} of {Math.ceil(cardsData.totalCount / cardsPerPage)}
                    </span>
                    <Button
                      onClick={() => setCurrentPage(prev => prev + 1)}
                      disabled={currentPage >= Math.ceil(cardsData.totalCount / cardsPerPage)}
                      variant="outline"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-600">No cards found in this set.</p>
              </div>
            )}
          </div>
        )}

        {/* View 2: Selected MainSet Subsets */}
        {selectedMainSet && !selectedSet && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{selectedMainSet.name}</h3>
                <p className="text-gray-600">Choose a subset to view cards</p>
              </div>
              <Button
                onClick={handleBackToMainSets}
                variant="outline"
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Main Sets
              </Button>
            </div>

            {subsetsLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-marvel-red"></div>
              </div>
            ) : subsetsData && subsetsData.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {subsetsData.map((subset) => (
                  <Card 
                    key={subset.id} 
                    className="group cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => handleSubsetClick(subset)}
                  >
                    <CardContent className="p-0">
                      <div className="relative">
                        <SetThumbnail
                          setId={subset.id}
                          setName={subset.name}
                          setImageUrl={subset.imageUrl}
                          className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                        />
                      </div>
                      <div className="p-3 md:p-4">
                        <h3 className="font-semibold text-gray-900 mb-1 text-sm md:text-base line-clamp-2">
                          {subset.name}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {subset.totalCards} cards • {subset.year}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-600">No subsets found for this set.</p>
              </div>
            )}
          </div>
        )}

        {/* View 3: Main Sets and Search Results */}
        {!selectedMainSet && !selectedSet && (
          <>
            {/* Show Search Results */}
            {shouldShowSearchResults ? (
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Search Results for "{setSearchQuery}"
                  </h3>
                  <div className="text-sm text-gray-600">
                    {searchResults?.sets?.length || 0} sets, {searchResults?.cards?.length || 0} cards
                  </div>
                </div>

                {/* Card Sets Results */}
                {searchResults?.sets && searchResults.sets.length > 0 && (
                  <div>
                    <h4 className="text-md font-semibold text-gray-900 mb-4">Card Sets</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                      {searchResults.sets.map((set: any) => (
                        <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                          <CardContent className="p-0">
                            <div className="relative">
                              <SetThumbnail
                                setId={set.id}
                                setName={set.name}
                                setImageUrl={set.imageUrl}
                                className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                              />
                            </div>
                            <div className="p-3 md:p-4">
                              <h3 className="font-semibold text-gray-900 mb-1 md:mb-2 text-sm md:text-base line-clamp-2">{set.name}</h3>
                              <p className="text-xs text-gray-500 mb-2 md:mb-3">{set.totalCards} cards • {set.year}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Results */}
                {(!searchResults?.sets || searchResults.sets.length === 0) && (!searchResults?.cards || searchResults.cards.length === 0) && (
                  <div className="text-center py-12">
                    <div className="mx-auto w-24 h-24 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                      <Search className="w-8 h-8 text-gray-400" />
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
                              <SetThumbnail
                                setId={set.id}
                                setName={set.name}
                                setImageUrl={set.imageUrl}
                                className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                              />
                              <div className="absolute top-2 right-2 flex gap-1">
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
                              <p className="text-xs text-gray-500 mb-2 md:mb-3">{set.totalCards} cards • {set.year}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* MainSets with Nested Structure */}
                {mainSetsData && mainSetsData.mainSets && mainSetsData.mainSets.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Marvel Card Sets</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {mainSetsData.mainSets.map((mainSet: any) => (
                        <Card 
                          key={mainSet.id} 
                          className="group cursor-pointer hover:shadow-lg transition-shadow"
                          onClick={() => handleMainSetClick(mainSet)}
                        >
                          <CardContent className="p-0">
                            <div className="relative">
                              <SetThumbnail
                                setId={mainSet.id}
                                setName={mainSet.name}
                                setImageUrl={mainSet.thumbnailImageUrl}
                                className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                              />
                            </div>
                            <div className="p-3 md:p-4">
                              <h3 className="font-semibold text-gray-900 mb-1 text-sm md:text-base line-clamp-2">
                                {mainSet.name}
                              </h3>
                              <p className="text-xs text-gray-500">
                                {mainSet.subsetCount} subsets • {mainSet.totalCardCount} cards
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Individual Sets (Unlinked) */}
                {mainSetsData && mainSetsData.unlinkedSets && mainSetsData.unlinkedSets.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Individual Sets</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                      {mainSetsData.unlinkedSets.map((set: any) => (
                        <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                          <CardContent className="p-0">
                            <div className="relative">
                              <SetThumbnail
                                setId={set.id}
                                setName={set.name}
                                setImageUrl={set.imageUrl}
                                className="w-full h-32 md:h-48 object-cover rounded-t-lg"
                              />
                            </div>
                            <div className="p-3 md:p-4">
                              <h3 className="font-semibold text-gray-900 mb-1 md:mb-2 text-sm md:text-base line-clamp-2">{set.name}</h3>
                              <p className="text-xs text-gray-500 mb-2 md:mb-3">{set.totalCards} cards • {set.year}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Card Detail Modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          isOpen={!!selectedCard}
          onClose={() => setSelectedCard(null)}
          isInCollection={collection?.some(item => item.cardId === selectedCard.id) || false}
          isInWishlist={wishlist?.some(item => item.cardId === selectedCard.id) || false}
          onAddToCollection={() => addToCollectionMutation.mutate(selectedCard.id)}
          onRemoveFromCollection={() => removeFromCollectionMutation.mutate(selectedCard.id)}
          onAddToWishlist={() => addToWishlistMutation.mutate(selectedCard.id)}
          onRemoveFromWishlist={() => removeFromWishlistMutation.mutate(selectedCard.id)}
        />
      )}
    </div>
  );
}