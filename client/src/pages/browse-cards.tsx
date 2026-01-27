import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, ArrowLeft, Plus, Edit, Filter, Grid3X3, List, X, Save, Home, Image, DollarSign, Loader2 } from "lucide-react";
import { CardGrid } from "@/components/cards/card-grid";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { SetThumbnail } from "@/components/cards/set-thumbnail";
import { MainSetTile } from "@/components/cards/main-set-tile";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useParams, Link } from "wouter";
import type { CardSet, CardWithSet, CollectionItem, MainSet } from "@shared/schema";
import { formatCardName, formatSetName } from "@/lib/formatTitle";

interface CardFilters {
  setId?: number;
  search?: string;
  rarity?: string;
  isInsert?: boolean;
  year?: number;
}

export default function BrowseCards() {
  // All state hooks first
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
  const [processingImages, setProcessingImages] = useState(false);
  const [processingPricing, setProcessingPricing] = useState(false);

  // All hooks
  const { toast } = useToast();
  const { isAdminMode } = useAppStore();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const params = useParams<{ mainSetSlug?: string; setSlug?: string }>();
  
  // Route determination
  const isMainSetView = params.mainSetSlug !== undefined;
  const isSpecificSetView = params.setSlug !== undefined;
  const mainSetSlug = params.mainSetSlug;
  const setSlug = params.setSlug;

  // Reset state when route changes to prevent crashes
  useEffect(() => {
    setSelectedSet(null);
    setSelectedCard(null);
    setEditingSet(null);
    setSetSearchQuery("");
    // Don't reset filters.year to preserve the year filter selection
    setFilters(prev => ({ year: prev.year }));
  }, [location]);

  // All queries
  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const { data: mainSets } = useQuery<MainSet[]>({
    queryKey: ["/api/main-sets"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
    enabled: !!user,
  });

  const { data: wishlist } = useQuery<any[]>({
    queryKey: ["/api/wishlist"],
    enabled: !!user,
  });

  const { data: searchResults } = useQuery<{ sets: CardSet[], cards: CardWithSet[] }>({
    queryKey: ["/api/search", setSearchQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(setSearchQuery)}`).then(res => res.json()),
    enabled: setSearchQuery.length >= 2,
  });

  // All mutations with optimistic updates for instant UI feedback
  const addToCollectionMutation = useMutation({
    mutationFn: (cardId: number) => 
      apiRequest("POST", "/api/collection", { cardId, condition: "Near Mint" }),
    onMutate: async (cardId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/collection"] });
      
      // Snapshot the previous value
      const previousCollection = queryClient.getQueryData<CollectionItem[]>(["/api/collection"]);
      
      // Optimistically update to show card immediately
      queryClient.setQueryData<CollectionItem[]>(["/api/collection"], (old = []) => [
        ...old,
        {
          id: Date.now(), // Temporary ID
          userId: 0, // Placeholder for optimistic update
          cardId,
          condition: "Near Mint",
          acquiredDate: new Date(),
          acquiredVia: "manual",
          personalValue: null,
          salePrice: null,
          isForSale: false,
          serialNumber: null,
          quantity: 1,
          isFavorite: false,
          notes: null,
        } as CollectionItem
      ]);
      
      return { previousCollection };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      toast({ title: "Added to collection!" });
    },
    onError: (err, cardId, context) => {
      // Rollback on error
      if (context?.previousCollection) {
        queryClient.setQueryData(["/api/collection"], context.previousCollection);
      }
      toast({ title: "Failed to add card", variant: "destructive" });
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
        console.log('Removing card from collection:', cardId, 'collection item ID:', collectionItem.id);
        return apiRequest("DELETE", `/api/collection/${collectionItem.id}`);
      }
      throw new Error("Card not found in collection");
    },
    onMutate: async (cardId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/collection"] });
      
      // Snapshot the previous value
      const previousCollection = queryClient.getQueryData<CollectionItem[]>(["/api/collection"]);
      
      // Optimistically remove the card
      queryClient.setQueryData<CollectionItem[]>(["/api/collection"], (old = []) => 
        old.filter(item => item.cardId !== cardId)
      );
      
      return { previousCollection };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      toast({ title: "Removed from collection!" });
    },
    onError: (err, cardId, context) => {
      // Rollback on error
      if (context?.previousCollection) {
        queryClient.setQueryData(["/api/collection"], context.previousCollection);
      }
      console.error('Error removing card:', err);
      toast({ title: "Failed to remove card", variant: "destructive" });
    },
  });

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

  const addAllMutation = useMutation({
    mutationFn: async (setId: number) => {
      const cardsResponse = await fetch(`/api/sets/${setId}/cards`);
      const cards: CardWithSet[] = await cardsResponse.json();
      
      const collectionCardIds = collection?.map(item => item.cardId) || [];
      const newCards = cards.filter(card => !collectionCardIds.includes(card.id));
      
      if (newCards.length === 0) {
        throw new Error('All cards from this set are already in your collection!');
      }
      
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

  const updateSetMutation = useMutation({
    mutationFn: async ({ setId, updates }: { setId: number, updates: any }) => {
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();
      const response = await fetch(`/api/card-sets/${setId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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

  // Get current main set if viewing a specific one
  const currentMainSet = useMemo(() => {
    if (!isMainSetView || !mainSetSlug || !mainSets) return null;
    return mainSets.find(ms => ms.slug === mainSetSlug) || null;
  }, [isMainSetView, mainSetSlug, mainSets]);

  // Filter sets based on current view
  const { unassignedSets, assignedSetsGrouped, currentViewSets } = useMemo(() => {
    if (!cardSets) return { unassignedSets: [], assignedSetsGrouped: new Map(), currentViewSets: [] };

    const unassigned = cardSets.filter(set => !set.mainSetId);
    
    const grouped = new Map<number, CardSet[]>();
    cardSets.forEach(set => {
      if (set.mainSetId) {
        if (!grouped.has(set.mainSetId)) {
          grouped.set(set.mainSetId, []);
        }
        grouped.get(set.mainSetId)!.push(set);
      }
    });

    const currentView = isMainSetView && currentMainSet 
      ? (grouped.get(currentMainSet.id) || [])
      : unassigned;

    return { 
      unassignedSets: unassigned, 
      assignedSetsGrouped: grouped, 
      currentViewSets: currentView 
    };
  }, [cardSets, isMainSetView, currentMainSet]);

  // Filter sets for display based on current view
  const filteredDisplaySets = useMemo(() => {
    if (!currentViewSets) return [];
    
    let filtered = currentViewSets.filter(set => {
      // Apply year filter
      if (filters.year && set.year !== filters.year) return false;
      
      // Apply search filter
      if (!setSearchQuery) return true;
      const query = setSearchQuery.toLowerCase();
      return set.name.toLowerCase().includes(query) || 
             set.year?.toString().includes(query) ||
             set.description?.toLowerCase().includes(query);
    });
    
    // Sort by year descending
    return filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  }, [currentViewSets, filters.year, setSearchQuery]);

  // Show search results when user is searching
  const shouldShowSearchResults = setSearchQuery.length >= 2 && searchResults;

  // For main overview: create main set tiles with their assigned sets, sorted by year descending
  const mainSetTiles = useMemo(() => {
    if (!mainSets || isMainSetView) return [];
    
    return mainSets.map(mainSet => {
      const assignedSets = assignedSetsGrouped.get(mainSet.id) || [];
      return { mainSet, assignedSets };
    })
    .filter(({ assignedSets, mainSet }) => {
      if (assignedSets.length === 0) return false;
      
      // Apply year filter to main sets
      if (filters.year) {
        const getYear = (name: string): number => {
          const yearMatch = name.match(/\b(19|20)\d{2}\b/);
          return yearMatch ? parseInt(yearMatch[0]) : 0;
        };
        
        const mainSetYear = getYear(mainSet.name);
        if (mainSetYear !== filters.year) return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      // Extract year from main set name (e.g., "2024 Skybox..." or "Marvel 1992...")
      const getYear = (name: string): number => {
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : 0;
      };
      
      const yearA = getYear(a.mainSet.name);
      const yearB = getYear(b.mainSet.name);
      
      // If both have years, sort by year descending
      if (yearA && yearB) {
        return yearB - yearA;
      }
      
      // If only one has a year, prioritize the one with year
      if (yearA && !yearB) return -1;
      if (!yearA && yearB) return 1;
      
      // If neither has a year, sort alphabetically
      return a.mainSet.name.localeCompare(b.mainSet.name);
    });
  }, [mainSets, assignedSetsGrouped, isMainSetView, filters.year]);

  // Show card sets grid (sort favorites by year too)
  const favoritesets = filteredDisplaySets.filter(set => favoriteSetIds.includes(set.id));
  const otherSets = filteredDisplaySets.filter(set => !favoriteSetIds.includes(set.id));

  // Helper functions
  const isCardInCollection = (cardId: number) => {
    if (!user || !collection) return false;
    return collection.some(item => item.cardId === cardId);
  };

  const getCollectionItemId = (cardId: number): number | undefined => {
    if (!user || !collection) return undefined;
    const item = collection.find(item => item.cardId === cardId);
    return item?.id;
  };

  const isCardInWishlist = (cardId: number) => {
    if (!user || !wishlist) return false;
    return wishlist.some((item: any) => item.cardId === cardId);
  };

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

  const handleProcessImages = async () => {
    console.log("handleProcessImages called", { editingSet, user, authLoading });
    
    if (!editingSet) {
      console.log("No editingSet, returning early");
      return;
    }
    
    if (!user || authLoading) {
      console.log("No user or still loading", { user, authLoading });
      toast({
        title: "Error",
        description: "Please wait for authentication to complete or log in again",
        variant: "destructive"
      });
      return;
    }
    
    setProcessingImages(true);
    console.log("About to fetch token and make request");
    try {
      const token = await user.getIdToken();
      console.log("Got token, making request to:", `/api/admin/sets/${editingSet.id}/process-images`);
      const response = await fetch(`/api/admin/sets/${editingSet.id}/process-images`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const result = await response.json();
      if (response.ok) {
        toast({
          title: "Image Processing Started",
          description: `Processing ${result.totalCards} cards in "${result.setName}". This runs in the background.`
        });
      } else {
        throw new Error(result.message || 'Failed to start image processing');
      }
    } catch (error: any) {
      console.error("handleProcessImages error:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setProcessingImages(false);
    }
  };

  const handleProcessPricing = async () => {
    if (!editingSet) return;
    
    if (!user || authLoading) {
      toast({
        title: "Error",
        description: "Please wait for authentication to complete or log in again",
        variant: "destructive"
      });
      return;
    }
    
    setProcessingPricing(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/sets/${editingSet.id}/process-pricing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const result = await response.json();
      if (response.ok) {
        toast({
          title: "Pricing Update Started",
          description: `Fetching prices for ${result.totalCards} cards in "${result.setName}". This runs in the background.`
        });
      } else {
        throw new Error(result.message || 'Failed to start pricing update');
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setProcessingPricing(false);
    }
  };

  // Show individual cards if a set is selected
  if (selectedSet) {
    return (
      <div className="min-h-screen bg-gray-50">
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

        <div className="p-6">
          <CardGrid filters={filters} viewMode={viewMode} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-6 py-4">
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <div>
              {isMainSetView && currentMainSet ? (
                <div className="flex items-center space-x-3">
                  <Link href="/browse">
                    <Button variant="outline" size="sm">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Browse
                    </Button>
                  </Link>
                  <div>
                    <h2 className="text-lg sm:text-xl md:text-2xl font-bebas text-gray-900 tracking-wide truncate">{currentMainSet.name}</h2>
                    <p className="text-sm text-gray-600 font-roboto">
                      {currentViewSets.length} set{currentViewSets.length !== 1 ? 's' : ''} in this collection
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className="text-lg sm:text-xl md:text-2xl font-bebas text-gray-900 tracking-wide">BROWSE CARD SETS</h2>
                  <p className="text-sm text-gray-600 font-roboto">
                    Choose a collection or set to explore individual cards
                  </p>
                </div>
              )}
            </div>
          </div>
          
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

      <div className="p-6">
        {shouldShowSearchResults ? (
          <div className="space-y-8">
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

            {searchResults.sets.length > 0 && (
              <div>
                <h4 className="text-md font-semibold text-gray-900 mb-4">Card Sets</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                  {searchResults.sets.map((set) => (
                    <SetThumbnail
                      key={set.id}
                      set={set}
                      onClick={() => handleSetClick(set)}
                      isFavorite={favoriteSetIds.includes(set.id)}
                      onFavorite={() => handleFavoriteSet(set.id)}
                      showAdminControls={isAdminMode}
                      onEdit={() => handleEditSet(set.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {searchResults.cards.length > 0 && (
              <div id="individual-cards-section">
                <h4 className="text-md font-semibold text-gray-900 mb-4">Individual Cards</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 md:gap-3">
                  {searchResults.cards.map((card) => (
                    <div
                      key={card.id}
                      className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => setSelectedCard(card)}
                    >
                      <div className="aspect-[2.5/3.5] bg-gray-100 rounded-t-lg overflow-hidden">
                        {card.frontImageUrl ? (
                          <img
                            src={convertGoogleDriveUrl(card.frontImageUrl)}
                            alt={card.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            No Image
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-gray-900 truncate">{card.name}</p>
                        <p className="text-xs text-gray-600">{card.set.name}</p>
                        <p className="text-xs text-gray-500">#{card.cardNumber}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : !isMainSetView ? (
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Master Sets</h3>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2 md:gap-3">
                {mainSetTiles.map(({ mainSet, assignedSets }) => (
                  <MainSetTile
                    key={mainSet.id}
                    mainSet={mainSet}
                    assignedSets={assignedSets}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {favoritesets.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-5 h-5 text-yellow-500 fill-current" />
                  <h3 className="text-lg font-semibold text-gray-900">Favorite Sets</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                  {favoritesets.map((set) => (
                    <SetThumbnail
                      key={set.id}
                      set={set}
                      onClick={() => handleSetClick(set)}
                      isFavorite={true}
                      onFavorite={() => handleFavoriteSet(set.id)}
                      showAdminControls={isAdminMode}
                      onEdit={() => handleEditSet(set.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {otherSets.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {favoritesets.length > 0 ? 'Other Sets' : 'Card Sets'}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
                  {otherSets.map((set) => (
                    <SetThumbnail
                      key={set.id}
                      set={set}
                      onClick={() => handleSetClick(set)}
                      isFavorite={false}
                      onFavorite={() => handleFavoriteSet(set.id)}
                      showAdminControls={isAdminMode}
                      onEdit={() => handleEditSet(set.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          isOpen={!!selectedCard}
          onClose={() => setSelectedCard(null)}
          isInCollection={isCardInCollection(selectedCard.id)}
          isInWishlist={isCardInWishlist(selectedCard.id)}
          collectionItemId={getCollectionItemId(selectedCard.id)}
          onAddToCollection={user ? () => addToCollectionMutation.mutate(selectedCard.id) : undefined}
          onRemoveFromCollection={user ? () => removeFromCollectionMutation.mutate(selectedCard.id) : undefined}
          onAddToWishlist={user ? () => addToWishlistMutation.mutate(selectedCard.id) : undefined}
          onRemoveFromWishlist={user ? () => removeFromWishlistMutation.mutate(selectedCard.id) : undefined}
          onCardUpdate={(updatedCard) => setSelectedCard(updatedCard)}
        />
      )}

      {editingSet && (
        <Dialog open={!!editingSet} onOpenChange={() => setEditingSet(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Set</DialogTitle>
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
                  value={editFormData.year || ''}
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
                  placeholder="Enter description (optional)"
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="imageUrl">Image URL</Label>
                <Input
                  id="imageUrl"
                  value={editFormData.imageUrl}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="Enter image URL (optional)"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleSaveSet}
                  disabled={!editFormData.name.trim() || updateSetMutation.isPending}
                  className="flex-1"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateSetMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={updateSetMutation.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
              
              {/* Bulk Processing Section */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Bulk Processing</h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessImages}
                    disabled={processingImages || processingPricing}
                    className="flex-1"
                  >
                    {processingImages ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Image className="w-4 h-4 mr-2" />
                    )}
                    {processingImages ? 'Starting...' : 'Find Images'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessPricing}
                    disabled={processingImages || processingPricing}
                    className="flex-1"
                  >
                    {processingPricing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4 mr-2" />
                    )}
                    {processingPricing ? 'Starting...' : 'Update Prices'}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  These run in the background - you can close this dialog
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}