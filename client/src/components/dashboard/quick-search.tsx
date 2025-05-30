import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Search } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { useLocation } from "wouter";
import type { CardWithSet, CardSet } from "@shared/schema";

export function QuickSearch() {
  const [, setLocation] = useLocation();
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
                setLocation(`/card-search?search=${encodeURIComponent(searchQuery.trim())}`);
              }
            }}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
                setLocation(`/card-search?search=${encodeURIComponent(searchQuery.trim())}`);
              }
            }}
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