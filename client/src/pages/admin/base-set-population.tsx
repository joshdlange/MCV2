import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, X, ChevronDown, ChevronUp, Search, Copy, AlertCircle } from "lucide-react";

interface SiblingSet {
  id: number;
  name: string;
  total_cards: number;
  is_insert_subset: boolean;
}

interface EmptyBaseSet {
  mainSetId: number;
  mainSetName: string;
  baseSetId: number;
  baseSetName: string;
  year: number;
  siblingCount: number;
  siblings: SiblingSet[];
  suggestedSourceId: number | null;
  suggestedSourceName: string | null;
  suggestedSourceCardCount: number;
  suggestionReason: string;
}

interface SelectedItem {
  baseSetId: number;
  sourceSetId: number;
  mainSetName: string;
}

export default function BaseSetPopulation() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Map<number, SelectedItem>>(new Map());
  const [customSources, setCustomSources] = useState<Map<number, number>>(new Map());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/admin/empty-base-sets'],
    queryFn: () => apiRequest('GET', '/api/admin/empty-base-sets').then(res => res.json()),
  });

  const executeMutation = useMutation({
    mutationFn: (items: { sourceSetId: number; baseSetId: number }[]) =>
      apiRequest('POST', '/api/admin/base-set-population/batch-execute', { items }).then(res => res.json()),
    onSuccess: (result) => {
      toast({
        title: "Population Complete",
        description: `${result.successCount} sets populated, ${result.errorCount} errors`,
      });
      setSelectedItems(new Map());
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/admin/empty-base-sets'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to populate base sets",
        variant: "destructive",
      });
    }
  });

  const sets: EmptyBaseSet[] = data?.sets || [];
  
  const years = Array.from(new Set(sets.map(s => s.year))).sort((a, b) => b - a);
  
  const filteredSets = sets.filter(set => {
    const matchesSearch = searchTerm === "" || 
      set.mainSetName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesYear = yearFilter === "all" || set.year === parseInt(yearFilter);
    return matchesSearch && matchesYear;
  });

  const toggleExpand = (baseSetId: number) => {
    setExpandedSets(prev => {
      const newExpanded = new Set(Array.from(prev));
      if (newExpanded.has(baseSetId)) {
        newExpanded.delete(baseSetId);
      } else {
        newExpanded.add(baseSetId);
      }
      return newExpanded;
    });
  };

  const toggleSelect = (set: EmptyBaseSet) => {
    const newSelected = new Map(selectedItems);
    if (newSelected.has(set.baseSetId)) {
      newSelected.delete(set.baseSetId);
    } else {
      const sourceId = customSources.get(set.baseSetId) || set.suggestedSourceId;
      if (sourceId) {
        newSelected.set(set.baseSetId, {
          baseSetId: set.baseSetId,
          sourceSetId: sourceId,
          mainSetName: set.mainSetName
        });
      }
    }
    setSelectedItems(newSelected);
  };

  const selectAllVisible = () => {
    const newSelected = new Map(selectedItems);
    filteredSets.forEach(set => {
      const sourceId = customSources.get(set.baseSetId) || set.suggestedSourceId;
      if (sourceId && !newSelected.has(set.baseSetId)) {
        newSelected.set(set.baseSetId, {
          baseSetId: set.baseSetId,
          sourceSetId: sourceId,
          mainSetName: set.mainSetName
        });
      }
    });
    setSelectedItems(newSelected);
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
  };

  const changeSource = (baseSetId: number, newSourceId: number) => {
    const newCustomSources = new Map(customSources);
    newCustomSources.set(baseSetId, newSourceId);
    setCustomSources(newCustomSources);
    
    if (selectedItems.has(baseSetId)) {
      const newSelected = new Map(selectedItems);
      const item = newSelected.get(baseSetId)!;
      newSelected.set(baseSetId, { ...item, sourceSetId: newSourceId });
      setSelectedItems(newSelected);
    }
  };

  const executeSelected = () => {
    const items = Array.from(selectedItems.values()).map(item => ({
      sourceSetId: item.sourceSetId,
      baseSetId: item.baseSetId
    }));
    executeMutation.mutate(items);
  };

  const getDisplaySourceId = (set: EmptyBaseSet) => {
    return customSources.get(set.baseSetId) || set.suggestedSourceId;
  };

  const getDisplaySourceName = (set: EmptyBaseSet) => {
    const customId = customSources.get(set.baseSetId);
    if (customId) {
      const sibling = set.siblings.find(s => s.id === customId);
      return sibling?.name || 'Unknown';
    }
    return set.suggestedSourceName;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="h-6 w-6" />
            Base Set Population Tool
          </CardTitle>
          <CardDescription>
            Populate empty base sets by copying card names and numbers from existing subsets.
            Found {sets.length} main sets with empty base subsets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-center mb-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search sets..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-white"
                />
              </div>
            </div>
            
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-[120px] bg-white">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {years.map(year => (
                  <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={selectAllVisible} size="sm">
              Select All ({filteredSets.filter(s => s.suggestedSourceId || customSources.has(s.baseSetId)).length})
            </Button>
            
            <Button variant="outline" onClick={clearSelection} size="sm">
              Clear
            </Button>
          </div>

          {selectedItems.size > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-center justify-between">
              <div>
                <span className="font-medium">{selectedItems.size} sets selected</span>
                <span className="text-gray-600 ml-2">
                  Ready to populate with card data from suggested sources
                </span>
              </div>
              <Button 
                onClick={executeSelected}
                disabled={executeMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {executeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Populate {selectedItems.size} Sets
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="text-sm text-gray-500 mb-2">
            Showing {filteredSets.length} of {sets.length} sets
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {filteredSets.map(set => {
          const isExpanded = expandedSets.has(set.baseSetId);
          const isSelected = selectedItems.has(set.baseSetId);
          const displaySourceId = getDisplaySourceId(set);
          const displaySourceName = getDisplaySourceName(set);
          const hasValidSource = displaySourceId !== null;

          return (
            <Card 
              key={set.baseSetId} 
              className={`transition-all ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(set)}
                    disabled={!hasValidSource}
                    className="mt-1"
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-lg truncate">{set.mainSetName}</h3>
                      <Badge variant="outline">{set.year}</Badge>
                      <Badge variant="secondary">{set.siblingCount} subsets</Badge>
                    </div>
                    
                    {hasValidSource ? (
                      <div className="mt-2 text-sm">
                        <span className="text-gray-600">Copy from: </span>
                        <span className="font-medium text-green-700">
                          {displaySourceName?.split(' - ').pop()}
                        </span>
                        <span className="text-gray-500 ml-2">
                          ({set.siblings.find(s => s.id === displaySourceId)?.total_cards || set.suggestedSourceCardCount} cards)
                        </span>
                        {set.suggestionReason && !customSources.has(set.baseSetId) && (
                          <span className="text-gray-400 ml-2 text-xs">
                            - {set.suggestionReason}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm flex items-center gap-1 text-amber-600">
                        <AlertCircle className="h-4 w-4" />
                        No suitable source found - expand to select manually
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpand(set.baseSetId)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="text-sm font-medium mb-2">Available subsets (select source):</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {set.siblings
                        .filter(s => s.total_cards > 0)
                        .map(sibling => {
                          const isSource = displaySourceId === sibling.id;
                          return (
                            <button
                              key={sibling.id}
                              onClick={() => changeSource(set.baseSetId, sibling.id)}
                              className={`text-left p-2 rounded border transition-all ${
                                isSource 
                                  ? 'border-green-500 bg-green-50 ring-1 ring-green-500' 
                                  : 'border-gray-200 hover:border-gray-400 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm truncate flex-1">
                                  {sibling.name.split(' - ').pop()}
                                </span>
                                {isSource && <Check className="h-4 w-4 text-green-600 ml-1" />}
                              </div>
                              <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                <span>{sibling.total_cards} cards</span>
                                {sibling.is_insert_subset && (
                                  <Badge variant="outline" className="text-xs py-0">insert</Badge>
                                )}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                    
                    {set.siblings.filter(s => s.total_cards > 0).length === 0 && (
                      <div className="text-sm text-gray-500 italic">
                        No subsets with cards available
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredSets.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            {sets.length === 0 ? (
              <>
                <Check className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <p className="text-lg font-medium">All base sets are populated!</p>
                <p className="text-sm">No empty base sets found in the database.</p>
              </>
            ) : (
              <>
                <Search className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>No sets match your search criteria</p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
