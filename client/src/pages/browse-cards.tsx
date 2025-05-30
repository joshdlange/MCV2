import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CardGrid } from "@/components/cards/card-grid";
import { CardFilters } from "@/types";
import { Search, Filter, ArrowLeft, Heart, Plus, Star, Edit, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store";
import { apiRequest } from "@/lib/queryClient";
import type { CardSet, CardWithSet, CollectionItem, InsertUserCollection } from "@shared/schema";

export default function BrowseCards() {
  const [selectedSet, setSelectedSet] = useState<CardSet | null>(null);
  const [filters, setFilters] = useState<CardFilters>({});
  const [favoriteSetIds, setFavoriteSetIds] = useState<number[]>([]);
  const [editingSet, setEditingSet] = useState<CardSet | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    year: 0,
    description: '',
    imageUrl: ''
  });
  const { toast } = useToast();
  const { isAdminMode } = useAppStore();
  const queryClient = useQueryClient();

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const handleSearchChange = (search: string) => {
    setFilters(prev => ({ ...prev, search: search || undefined }));
  };

  const handleSetChange = (setId: string) => {
    setFilters(prev => ({ 
      ...prev, 
      setId: setId === "all" ? undefined : parseInt(setId) 
    }));
  };

  const handleRarityChange = (rarity: string) => {
    setFilters(prev => ({ 
      ...prev, 
      rarity: rarity === "all" ? undefined : rarity 
    }));
  };

  const handleInsertFilter = (isInsert: string) => {
    setFilters(prev => ({ 
      ...prev, 
      isInsert: isInsert === "all" ? undefined : isInsert === "true" 
    }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const handleSetClick = (set: CardSet) => {
    setSelectedSet(set);
    setFilters({ setId: set.id });
  };

  const handleBackToSets = () => {
    setSelectedSet(null);
    setFilters({});
  };

  const handleFavoriteSet = (setId: number) => {
    setFavoriteSetIds(prev => 
      prev.includes(setId) 
        ? prev.filter(id => id !== setId)
        : [...prev, setId]
    );
  };

  const addAllMutation = useMutation({
    mutationFn: async (setId: number) => {
      // First get all cards from the set
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
        const insertData: InsertUserCollection = {
          userId: 1, // TODO: Get from auth context
          cardId: card.id,
          condition: 'near_mint',
          quantity: 1
        };
        
        return fetch('/api/collection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(insertData)
        });
      });
      
      await Promise.all(promises);
      return { addedCount: newCards.length, totalCards: cards.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
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
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={handleBackToSets}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sets
              </Button>
              <div>
                <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">{selectedSet.name}</h2>
                <p className="text-sm text-gray-600 font-roboto">
                  Explore cards from this set
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleFavoriteSet(selectedSet.id)}
                variant="outline"
                className={`flex items-center gap-2 ${
                  favoriteSetIds.includes(selectedSet.id) 
                    ? 'bg-yellow-50 text-yellow-700 border-yellow-300' 
                    : ''
                }`}
              >
                <Star className={`w-4 h-4 ${favoriteSetIds.includes(selectedSet.id) ? 'fill-current' : ''}`} />
                {favoriteSetIds.includes(selectedSet.id) ? 'Favorited' : 'Favorite Set'}
              </Button>
              <Button
                onClick={() => handleAddAllToCollection(selectedSet.id)}
                disabled={addAllMutation.isPending}
                className="bg-marvel-red hover:bg-red-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {addAllMutation.isPending ? 'Adding All Cards...' : 'Add All to Collection'}
              </Button>
            </div>
          </div>
        </div>

        {/* Filters for individual cards */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
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
          <CardGrid filters={filters} />
        </div>
      </div>
    );
  }

  // Show card sets grid
  const favoritesets = cardSets?.filter(set => favoriteSetIds.includes(set.id)) || [];
  const otherSets = cardSets?.filter(set => !favoriteSetIds.includes(set.id)) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">BROWSE CARD SETS</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Choose a card set to explore individual cards
            </p>
          </div>
        </div>
      </div>

      {/* Card Sets Grid */}
      <div className="p-6">
        {/* Favorite Sets */}
        {favoritesets.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500 fill-current" />
              Favorite Sets
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {favoritesets.map((set) => (
                <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                  <CardContent className="p-0">
                    <div className="relative">
                      {set.imageUrl ? (
                        <img 
                          src={set.imageUrl} 
                          alt={set.name}
                          className="w-full h-48 object-cover rounded-t-lg"
                        />
                      ) : (
                        <div className="w-full h-48 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                          <span className="text-white text-lg font-bold text-center px-4">{set.name}</span>
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
                    <div className="p-4">
                      <h3 className="font-semibold text-gray-900 mb-2">{set.name}</h3>
                      <p className="text-sm text-gray-600 mb-3">{set.description || 'Click to explore cards from this set'}</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {otherSets.map((set) => (
              <Card key={set.id} className="group cursor-pointer hover:shadow-lg transition-shadow" onClick={() => handleSetClick(set)}>
                <CardContent className="p-0">
                  <div className="relative">
                    {set.imageUrl ? (
                      <img 
                        src={set.imageUrl} 
                        alt={set.name}
                        className="w-full h-48 object-cover rounded-t-lg"
                      />
                    ) : (
                      <div className="w-full h-48 bg-gradient-to-br from-marvel-red to-red-700 rounded-t-lg flex items-center justify-center">
                        <span className="text-white text-lg font-bold text-center px-4">{set.name}</span>
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
                    <p className="text-sm text-gray-600 mb-3">{set.description || 'Click to explore cards from this set'}</p>
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
    </div>
  );
}
