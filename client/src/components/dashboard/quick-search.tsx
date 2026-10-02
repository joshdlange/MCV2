import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Search, ImageOff, Loader2 } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { useLocation } from "wouter";
import type { CardWithSet, CardSet } from "@shared/schema";
import { formatSetName } from "@/lib/formatTitle";
import { apiRequest } from "@/lib/queryClient";

// /api/v2/search intentionally returns lightweight rows, not CardWithSet.
export interface QuickSearchSelection {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  setName: string;
  setYear: number | null;
  isInsert: boolean;
  rarity: string | null;
}

export function QuickSearch({ onSelect }: { onSelect?: (card: QuickSearchSelection) => void } = {}) {
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
    enabled: !onSelect && debouncedQuery.length >= 2,
  });

  const { data: selectableResults, isFetching: selectingLoading, error: selectionError } = useQuery<QuickSearchSelection[]>({
    queryKey: ["/api/v2/search", { q: debouncedQuery.trim(), setId: selectedSet, limit: 50 }],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedQuery.trim(), limit: "50" });
      if (selectedSet !== "all") params.set("setId", selectedSet);
      return (await apiRequest("GET", `/api/v2/search?${params}`)).json();
    },
    enabled: !!onSelect && debouncedQuery.trim().length >= 2,
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
              if (!onSelect && e.key === 'Enter' && searchQuery.trim().length >= 2) {
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
                {formatSetName(set.name)}
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
              if (!onSelect && e.key === 'Enter' && searchQuery.trim().length >= 2) {
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
                {formatSetName(set.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>



      {onSelect && (
        <div className="space-y-2 mt-4">
          {searchQuery.trim().length < 2 ? (
            <p className="text-sm text-gray-500">Enter at least two characters to search by name, set or card number.</p>
          ) : selectingLoading || searchQuery.trim() !== debouncedQuery.trim() ? (
            <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</p>
          ) : selectionError ? (
            <p role="alert" className="text-sm text-red-600">Search failed: {selectionError.message}</p>
          ) : selectableResults?.length === 0 ? (
            <p className="text-sm text-gray-500">No cards found. Try another name or card number, or change the set.</p>
          ) : selectableResults?.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-red-300 bg-white dark:bg-gray-900"
            >
              <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
                {card.frontImageUrl
                  ? <img src={card.frontImageUrl} alt={card.name} className="w-full h-full object-contain" />
                  : <div className="w-full h-full flex items-center justify-center"><ImageOff className="w-4 h-4 text-gray-400" /></div>}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900 dark:text-white">{card.name}</p>
                <p className="text-xs text-gray-500">{card.setName}</p>
                <p className="text-xs text-gray-500">#{card.cardNumber}{card.setYear ? ` · ${card.setYear}` : ""}</p>
              </div>
            </button>
          ))}
          {selectableResults?.length === 50 && <p className="text-xs text-gray-500">Showing first 50 results. Narrow your search to find the exact version.</p>}
        </div>
      )}

      {/* Card Detail Modal */}
      {!onSelect && <CardDetailModal
        card={selectedCard}
        isOpen={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        isInCollection={false}
        isInWishlist={false}
      />}
    </div>
  );
}