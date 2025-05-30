import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Search } from "lucide-react";
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
    <div className="relative">
      {/* Desktop Search Controls */}
      <div className="hidden md:flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Quick search cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
          />
        </div>
        <Select value={selectedSet} onValueChange={setSelectedSet}>
          <SelectTrigger className="w-32 bg-white border-gray-200 text-gray-900">
            <SelectValue placeholder="Set" />
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

      {/* Mobile Search Controls - Larger and More Touch-Friendly */}
      <div className="md:hidden space-y-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            placeholder="Search cards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 pr-4 py-4 text-lg bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500 rounded-xl"
          />
        </div>
        <Select value={selectedSet} onValueChange={setSelectedSet}>
          <SelectTrigger className="w-full py-4 text-lg bg-white border-gray-200 text-gray-900 rounded-xl">
            <SelectValue placeholder="Choose Set" />
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

      {/* Search Results Dropdown */}
      {debouncedQuery.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-hidden">
          <div className="p-4">
            {isLoading && (
              <div className="text-center py-4">
                <p className="text-gray-500">Searching...</p>
              </div>
            )}

            {!isLoading && searchResults && searchResults.length === 0 && (
              <div className="text-center py-4">
                <p className="text-gray-500">No cards found matching your search.</p>
              </div>
            )}

            {!isLoading && searchResults && searchResults.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600 font-medium">
                  Found {searchResults.length} card{searchResults.length === 1 ? '' : 's'}
                </p>
                <div className="grid grid-cols-6 gap-2 max-h-64 overflow-y-auto">
                  {searchResults.slice(0, 12).map((card) => (
                    <div 
                      key={card.id} 
                      className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer border border-gray-200 hover:border-orange-300 hover:bg-gradient-to-br hover:from-orange-50 hover:to-red-50 transform hover:scale-105"
                      onClick={() => setSelectedCard(card)}
                    >
                      {/* Trading card with proper 2.5:3.5 aspect ratio */}
                      <div className={`${cardAspectRatio} relative`}>
                        {card.frontImageUrl ? (
                          <img 
                            src={card.frontImageUrl} 
                            alt={card.name}
                            className="w-full h-full object-cover rounded-t-lg"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-t-lg">
                            <span className="text-gray-400 text-xs">No Image</span>
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
                        <p className="font-medium text-gray-900 text-xs truncate">
                          {card.name}
                        </p>
                        <p className="text-xs text-gray-600 truncate">
                          {card.set.name}
                        </p>
                        <p className="text-xs text-gray-500">
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
                  <p className="text-xs text-gray-500 text-center">
                    Showing first 12 results. Use Card Search for more detailed filtering.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {debouncedQuery.length < 2 && debouncedQuery.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="p-4 text-center">
            <p className="text-gray-500 text-sm">Type at least 2 characters to search</p>
          </div>
        </div>
      )}

      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        isInCollection={false}
        isInWishlist={false}
      />
    </div>
  );
}