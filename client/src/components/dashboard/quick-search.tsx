import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Heart, Star, Search } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import type { CardWithSet, CardSet } from "@shared/schema";

export function QuickSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch card sets for filter
  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  // Fetch search results
  const { data: searchResults, isLoading } = useQuery<CardWithSet[]>({
    queryKey: ["/api/cards/search", { query: debouncedQuery, setId: selectedSet }],
    enabled: debouncedQuery.length >= 2,
  });

  const cardAspectRatio = "aspect-[2.5/3.5]";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bebas text-lg tracking-wide">QUICK SEARCH</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Controls */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedSet} onValueChange={setSelectedSet}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Sets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sets</SelectItem>
              {cardSets?.map((set) => (
                <SelectItem key={set.id} value={set.id.toString()}>
                  {set.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Search Results */}
        {debouncedQuery.length >= 2 && (
          <div className="space-y-3">
            {isLoading && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Searching...</p>
              </div>
            )}

            {!isLoading && searchResults && searchResults.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No cards found matching your search.</p>
              </div>
            )}

            {!isLoading && searchResults && searchResults.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Found {searchResults.length} card{searchResults.length === 1 ? '' : 's'}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 max-h-64 overflow-y-auto">
                  {searchResults.slice(0, 12).map((card) => (
                    <div 
                      key={card.id} 
                      className="bg-background rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow cursor-pointer border relative"
                      onClick={() => setSelectedCard(card)}
                    >
                      {/* Trading card with proper 2.5:3.5 aspect ratio */}
                      <div className={`${cardAspectRatio} relative`}>
                        {card.frontImageUrl ? (
                          <img 
                            src={card.frontImageUrl} 
                            alt={card.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <span className="text-muted-foreground text-xs">No Image</span>
                          </div>
                        )}
                        
                        {/* Status badges */}
                        <div className="absolute top-1 right-1 flex flex-col gap-1">
                          {card.isInsert && (
                            <div className="bg-yellow-500 rounded-full p-1 shadow-lg">
                              <Star className="w-2 h-2 text-white fill-white" />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Card info below image */}
                      <div className="p-1.5">
                        <p className="font-medium text-card-foreground text-xs truncate">
                          {card.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {card.set.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          #{card.cardNumber}
                        </p>
                        {card.estimatedValue && (
                          <p className="text-xs font-semibold text-green-600 mt-1">
                            ${parseFloat(card.estimatedValue).toFixed(0)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {searchResults.length > 12 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Showing first 12 results. Use Card Search for more detailed filtering.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {debouncedQuery.length < 2 && debouncedQuery.length > 0 && (
          <div className="text-center py-4">
            <p className="text-muted-foreground text-sm">Type at least 2 characters to search</p>
          </div>
        )}
      </CardContent>

      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        isInCollection={false}
        isInWishlist={false}
      />
    </Card>
  );
}