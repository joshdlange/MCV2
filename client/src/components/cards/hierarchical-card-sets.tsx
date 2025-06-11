import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Grid3X3, Star } from "lucide-react";
import { SetThumbnail } from "./set-thumbnail";
import type { CardSet } from "@shared/schema";

interface HierarchicalCardSetsProps {
  cardSets: CardSet[];
  selectedSet: CardSet | null;
  onSetSelect: (set: CardSet) => void;
  favoriteSetIds: number[];
  onToggleFavorite: (setId: number) => void;
  viewMode: "grid" | "list";
  isAdminMode: boolean;
  onEditSet?: (set: CardSet) => void;
}

export function HierarchicalCardSets({
  cardSets,
  selectedSet,
  onSetSelect,
  favoriteSetIds,
  onToggleFavorite,
  viewMode,
  isAdminMode,
  onEditSet
}: HierarchicalCardSetsProps) {
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set());

  // Fetch subsets for expanded main sets
  const expandedSetIds = Array.from(expandedSets);
  const subsetQueries = useQuery({
    queryKey: ["/api/card-sets/subsets", expandedSetIds],
    queryFn: async () => {
      const subsetPromises = expandedSetIds.map(async (setId) => {
        const response = await fetch(`/api/card-sets/${setId}/subsets`);
        const subsets = await response.json();
        return { mainSetId: setId, subsets };
      });
      const results = await Promise.all(subsetPromises);
      return results.reduce((acc, { mainSetId, subsets }) => {
        acc[mainSetId] = subsets;
        return acc;
      }, {} as Record<number, CardSet[]>);
    },
    enabled: expandedSetIds.length > 0,
  });

  const toggleExpanded = (setId: number) => {
    const newExpanded = new Set(expandedSets);
    if (newExpanded.has(setId)) {
      newExpanded.delete(setId);
    } else {
      newExpanded.add(setId);
    }
    setExpandedSets(newExpanded);
  };

  // Filter to only show main sets (those without parent_set_id or with is_main_set = true)
  const mainSets = cardSets?.filter(set => set.isMainSet || !set.parentSetId) || [];

  const renderSetCard = (set: CardSet, isSubset = false, depth = 0) => {
    const isSelected = selectedSet?.id === set.id;
    const isFavorite = favoriteSetIds.includes(set.id);
    const isExpanded = expandedSets.has(set.id);
    const subsets = subsetQueries.data?.[set.id] || [];
    const hasSubsets = !isSubset && subsets.length > 0;

    return (
      <div key={set.id} className={`${depth > 0 ? 'ml-6 border-l-2 border-gray-200 pl-4' : ''}`}>
        <Card 
          className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
            isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
          } ${isSubset ? 'bg-gray-50' : ''}`}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {hasSubsets && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(set.id);
                  }}
                  className="p-1 h-6 w-6"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              )}
              
              {!hasSubsets && !isSubset && <div className="w-6" />}
              
              <div className="flex-1 min-w-0">
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onSetSelect(set)}
                >
                  {viewMode === "grid" && (
                    <SetThumbnail 
                      setId={set.id}
                      setName={set.name}
                      setImageUrl={set.imageUrl}
                      className="w-12 h-12 rounded object-cover flex-shrink-0"
                    />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-medium truncate ${
                        isSubset ? 'text-sm text-gray-700' : 'text-base'
                      }`}>
                        {set.name}
                      </h3>
                      
                      {isSubset && set.subsetType && (
                        <Badge variant="outline" className="text-xs">
                          {set.subsetType}
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{set.year}</span>
                      <span>•</span>
                      <span>{set.totalCards} cards</span>
                      {set.description && (
                        <>
                          <span>•</span>
                          <span className="truncate">{set.description}</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(set.id);
                      }}
                      className="p-1 h-8 w-8"
                    >
                      <Star 
                        className={`h-4 w-4 ${
                          isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'
                        }`}
                      />
                    </Button>
                    
                    {isAdminMode && onEditSet && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditSet(set);
                        }}
                        className="p-1 h-8 w-8"
                      >
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Render subsets when expanded */}
        {isExpanded && hasSubsets && (
          <div className="mt-2 space-y-2">
            {subsets.map(subset => renderSetCard(subset, true, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (viewMode === "list") {
    return (
      <div className="space-y-2">
        {mainSets.map(set => renderSetCard(set))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {mainSets.map(set => (
        <div key={set.id} className="space-y-2">
          {renderSetCard(set)}
        </div>
      ))}
    </div>
  );
}