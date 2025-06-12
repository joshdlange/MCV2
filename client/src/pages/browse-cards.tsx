import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Star, Grid3X3, List, Filter, ArrowLeft } from "lucide-react";
import { MainSetTile } from "@/components/cards/main-set-tile";
import { SetThumbnail } from "@/components/cards/set-thumbnail";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { CardSet, MainSet, UserCollection } from "@shared/schema";

interface CardFilters {
  setId?: number;
  search?: string;
  rarity?: string;
  isInsert?: boolean;
  year?: number;
}

export default function BrowseCards() {
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
  const [currentTab, setCurrentTab] = useState<"master-sets" | "all-sets">("master-sets");
  const [mainSetId, setMainSetId] = useState<number | null>(null);

  const { toast } = useToast();

  // Derived state for current view
  const isMainSetView = currentTab === "master-sets" && mainSetId;

  // Data queries
  const { data: cardSets, isLoading: setsLoading } = useQuery<CardSet[]>({
    queryKey: ["/api/sets"],
  });

  const { data: mainSets, isLoading: mainSetsLoading } = useQuery<MainSet[]>({
    queryKey: ["/api/main-sets"],
  });

  const { data: collection } = useQuery<UserCollection[]>({
    queryKey: ["/api/collection"],
  });

  const { data: wishlist } = useQuery<any[]>({
    queryKey: ["/api/wishlist"],
  });

  // Get current main set details
  const currentMainSet = useMemo(() => {
    if (!isMainSetView || !mainSetId || !mainSets) return null;
    return mainSets.find(ms => ms.id === mainSetId) || null;
  }, [isMainSetView, mainSetId, mainSets]);

  // Get search results query  
  const { data: globalSearchResults } = useQuery<{ sets: CardSet[], cards: any[] }>({
    queryKey: ["/api/search", setSearchQuery],
    enabled: setSearchQuery.length >= 2,
  });

  // Filter sets based on current view
  const { unassignedSets, assignedSetsGrouped, currentViewSets } = useMemo(() => {
    if (!cardSets) return { unassignedSets: [], assignedSetsGrouped: new Map(), currentViewSets: [] };

    const unassigned = cardSets.filter(set => !set.mainSetId);
    const assignedGrouped = new Map<number, CardSet[]>();
    
    cardSets.forEach(set => {
      if (set.mainSetId) {
        if (!assignedGrouped.has(set.mainSetId)) {
          assignedGrouped.set(set.mainSetId, []);
        }
        assignedGrouped.get(set.mainSetId)!.push(set);
      }
    });

    // Sort sets within each group by year (descending)
    assignedGrouped.forEach(sets => {
      sets.sort((a, b) => (b.year || 0) - (a.year || 0));
    });

    let viewSets: CardSet[] = [];
    if (isMainSetView && mainSetId) {
      viewSets = assignedGrouped.get(mainSetId) || [];
    } else {
      viewSets = unassigned;
    }

    return { 
      unassignedSets: unassigned, 
      assignedSetsGrouped: assignedGrouped, 
      currentViewSets: viewSets 
    };
  }, [cardSets, isMainSetView, mainSetId]);

  // Mutation queries
  const editSetMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; year: number; description: string; imageUrl: string }) => {
      const response = await fetch(`/api/sets/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update set');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sets"] });
      toast({ title: "Set updated successfully!" });
      setEditingSet(null);
    },
    onError: () => {
      toast({ title: "Failed to update set", variant: "destructive" });
    }
  });

  const favoriteSetMutation = useMutation({
    mutationFn: async (setId: number) => {
      const response = await fetch('/api/favorite-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setId }),
      });
      if (!response.ok) throw new Error('Failed to toggle favorite');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorite-sets"] });
      toast({ title: "Favorite updated!" });
    }
  });

  // Event handlers
  const handleYearFilter = (year: string) => {
    setFilters({ year: year === "all" ? undefined : parseInt(year) });
  };

  const handleFavoriteSet = (setId: number) => {
    favoriteSetMutation.mutate(setId);
    setFavoriteSetIds(prev => 
      prev.includes(setId) 
        ? prev.filter(id => id !== setId)
        : [...prev, setId]
    );
  };

  const isCardInCollection = (cardId: number) => {
    return collection?.some((item: any) => item.cardId === cardId) || false;
  };

  const isCardInWishlist = (cardId: number) => {
    return wishlist?.some((item: any) => item.cardId === cardId) || false;
  };

  const handleEditSet = (set: CardSet) => {
    setEditingSet(set);
    setEditFormData({
      name: set.name || '',
      year: set.year || 0,
      description: set.description || '',
      imageUrl: set.imageUrl || ''
    });
  };

  const handleSaveEdit = () => {
    if (!editingSet) return;

    editSetMutation.mutate({
      id: editingSet.id,
      ...editFormData
    });
  };

  const handleCancelEdit = () => {
    setEditingSet(null);
    setEditFormData({ name: '', year: 0, description: '', imageUrl: '' });
  };

  // Filter and sort sets based on search and year
  const filteredDisplaySets = useMemo(() => {
    if (!currentViewSets) return [];
    
    let filtered = currentViewSets;
    
    // Apply year filter
    if (filters.year) {
      filtered = filtered.filter(set => set.year === filters.year);
    }
    
    // Apply search filter
    const query = setSearchQuery.toLowerCase();
    if (query.length >= 2) {
      filtered = filtered.filter(set => 
        set.name?.toLowerCase().includes(query) ||
             set.description?.toLowerCase().includes(query));
    }
    
    return filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  }, [currentViewSets, filters.year, setSearchQuery]);

  // Show search results when user is searching
  const shouldShowSearchResults = setSearchQuery.length >= 2 && globalSearchResults;

  // For main overview: create main set tiles with their assigned sets
  const mainSetTiles = useMemo(() => {
    if (!mainSets || isMainSetView) return [];
    
    return mainSets.map(mainSet => {
      const assignedSets = assignedSetsGrouped.get(mainSet.id) || [];
      return { mainSet, assignedSets };
    }).filter(({ assignedSets }) => assignedSets.length > 0); // Only show main sets with assigned sets
  }, [mainSets, assignedSetsGrouped, isMainSetView]);

  // Show card sets grid (sort favorites by year too)
  const favoritesets = filteredDisplaySets.filter(set => favoriteSetIds.includes(set.id));
  const otherSets = filteredDisplaySets.filter(set => !favoriteSetIds.includes(set.id));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-6 py-4">
        <div className="flex flex-col space-y-4 md:space-y-0 md:flex-row md:items-center md:justify-between">
          
          {/* Navigation and Title */}
          <div className="flex items-center gap-4">
            {isMainSetView && (
              <Button
                variant="outline"
                onClick={() => {
                  setMainSetId(null);
                  setCurrentTab("master-sets");
                }}
                className="flex items-center gap-2 text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to Master Sets</span>
                <span className="sm:hidden">Back</span>
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl md:text-3xl font-bebas text-gray-900 tracking-wide">
                {isMainSetView 
                  ? currentMainSet?.name || "Loading..." 
                  : currentTab === "master-sets" 
                    ? "Master Sets" 
                    : "All Card Sets"
                }
              </h1>
              <p className="text-sm text-gray-600 font-roboto">
                {isMainSetView 
                  ? "Browse sets within this master collection"
                  : currentTab === "master-sets" 
                    ? "Browse organized collections of Marvel trading cards" 
                    : "Browse all available Marvel trading card sets"
                }
              </p>
            </div>
          </div>

          {/* View Mode Toggle - only show when not in main set view */}
          {!isMainSetView && (
            <div className="flex items-center gap-2">
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
          )}
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search sets or cards..."
                value={setSearchQuery}
                onChange={(e) => setSetSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            {!isMainSetView && currentTab === "all-sets" && (
              <Select value={filters.year?.toString() || "all"} onValueChange={handleYearFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  <SelectItem value="1992">1992</SelectItem>
                  <SelectItem value="1993">1993</SelectItem>
                  <SelectItem value="1994">1994</SelectItem>
                  <SelectItem value="1995">1995</SelectItem>
                  <SelectItem value="1996">1996</SelectItem>
                  <SelectItem value="1997">1997</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {Object.keys(filters).length > 0 && (
            <Button 
              variant="outline" 
              onClick={() => setFilters({})}
              className="text-gray-600 hover:text-gray-900"
            >
              <Filter className="w-4 h-4 mr-2" />
              Clear
            </Button>
          )}
        </div>

        {/* Tab Navigation - only show when not in main set view */}
        {!isMainSetView && (
          <Tabs value={currentTab} onValueChange={(value) => setCurrentTab(value as "master-sets" | "all-sets")} className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="master-sets">Master Sets</TabsTrigger>
              <TabsTrigger value="all-sets">All Sets</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Content Area */}
      <div className="p-6">
        {/* Show search results if user is actively searching */}
        {shouldShowSearchResults && (
          <div className="mb-8">
            <h2 className="text-xl font-bebas text-gray-900 mb-4 tracking-wide">Search Results</h2>
            
            {/* Search Results - Sets */}
            {globalSearchResults?.sets && globalSearchResults.sets.length > 0 && (
              <div className="mb-6">
                <h3 className="text-lg font-roboto font-semibold text-gray-800 mb-3">Sets ({globalSearchResults.sets.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {globalSearchResults.sets.map((set: any) => (
                    <SetThumbnail
                      key={set.id}
                      setId={set.id}
                      setName={set.name}
                      setImageUrl={set.imageUrl}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Search Results - Cards */}
            {globalSearchResults?.cards && globalSearchResults.cards.length > 0 && (
              <div>
                <h3 className="text-lg font-roboto font-semibold text-gray-800 mb-3">Cards ({globalSearchResults.cards.length})</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {globalSearchResults.cards.map((card: any) => (
                    <div
                      key={card.id}
                      className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                    >
                      <div className="aspect-[2.5/3.5] bg-gray-100 flex items-center justify-center">
                        {card.imageUrl ? (
                          <img 
                            src={card.imageUrl} 
                            alt={card.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="text-gray-400 text-center p-2">
                            <span className="text-xs">No Image</span>
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-gray-900 truncate">{card.name}</p>
                        <p className="text-xs text-gray-500 truncate">{card.setName}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No search results */}
            {(!globalSearchResults?.sets?.length && !globalSearchResults?.cards?.length) && (
              <div className="text-center py-8">
                <p className="text-gray-500">No results found for "{setSearchQuery}"</p>
              </div>
            )}
          </div>
        )}

        {/* Main Content based on current tab and view */}
        {!shouldShowSearchResults && (
          <div>
            {/* Master Sets Overview */}
            {currentTab === "master-sets" && !isMainSetView && (
              <div className="space-y-6">
                {setsLoading || mainSetsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                        <div className="h-6 bg-gray-200 rounded mb-4"></div>
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded"></div>
                          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {mainSetTiles.map(({ mainSet, assignedSets }) => (
                      <div key={mainSet.id} onClick={() => {
                        setMainSetId(mainSet.id);
                        setCurrentTab("master-sets");
                      }} className="cursor-pointer">
                        <MainSetTile
                          mainSet={mainSet}
                          assignedSets={assignedSets}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Individual Sets within Master Set */}
            {currentTab === "master-sets" && isMainSetView && (
              <div className="space-y-6">
                {setsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
                        <div className="aspect-[4/3] bg-gray-200"></div>
                        <div className="p-4 space-y-2">
                          <div className="h-4 bg-gray-200 rounded"></div>
                          <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredDisplaySets.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No sets found in this master collection.</p>
                  </div>
                ) : (
                  <div>
                    {/* Favorite Sets */}
                    {favoritesets.length > 0 && (
                      <div className="mb-8">
                        <div className="flex items-center gap-2 mb-4">
                          <Star className="w-5 h-5 text-yellow-500 fill-current" />
                          <h2 className="text-xl font-bebas text-gray-900 tracking-wide">Favorite Sets</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                          {favoritesets.map(set => (
                            <SetThumbnail
                              key={set.id}
                              setId={set.id}
                              setName={set.name}
                              setImageUrl={set.imageUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Other Sets */}
                    {otherSets.length > 0 && (
                      <div>
                        {favoritesets.length > 0 && (
                          <h2 className="text-xl font-bebas text-gray-900 mb-4 tracking-wide">All Sets</h2>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                          {otherSets.map(set => (
                            <SetThumbnail
                              key={set.id}
                              setId={set.id}
                              setName={set.name}
                              setImageUrl={set.imageUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* All Sets Tab */}
            {currentTab === "all-sets" && (
              <div className="space-y-6">
                {setsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {[...Array(12)].map((_, i) => (
                      <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
                        <div className="aspect-[4/3] bg-gray-200"></div>
                        <div className="p-4 space-y-2">
                          <div className="h-4 bg-gray-200 rounded"></div>
                          <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredDisplaySets.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No sets found matching your criteria.</p>
                  </div>
                ) : (
                  <div>
                    {/* Favorite Sets */}
                    {favoritesets.length > 0 && (
                      <div className="mb-8">
                        <div className="flex items-center gap-2 mb-4">
                          <Star className="w-5 h-5 text-yellow-500 fill-current" />
                          <h2 className="text-xl font-bebas text-gray-900 tracking-wide">Favorite Sets</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                          {favoritesets.map(set => (
                            <SetThumbnail
                              key={set.id}
                              setId={set.id}
                              setName={set.name}
                              setImageUrl={set.imageUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Other Sets */}
                    {otherSets.length > 0 && (
                      <div>
                        {favoritesets.length > 0 && (
                          <h2 className="text-xl font-bebas text-gray-900 mb-4 tracking-wide">All Sets</h2>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                          {otherSets.map(set => (
                            <SetThumbnail
                              key={set.id}
                              setId={set.id}
                              setName={set.name}
                              setImageUrl={set.imageUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Set Dialog */}
      <Dialog open={!!editingSet} onOpenChange={() => editingSet && handleCancelEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={editFormData.name}
                onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Set name"
              />
            </div>
            <div>
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                value={editFormData.year || ''}
                onChange={(e) => setEditFormData(prev => ({ ...prev, year: parseInt(e.target.value) || 0 }))}
                placeholder="Year"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={editFormData.description}
                onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Set description"
                className="resize-none"
              />
            </div>
            <div>
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                value={editFormData.imageUrl}
                onChange={(e) => setEditFormData(prev => ({ ...prev, imageUrl: e.target.value }))}
                placeholder="Image URL"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={editSetMutation.isPending}>
                {editSetMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}