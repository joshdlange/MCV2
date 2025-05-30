import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardGrid } from "@/components/cards/card-grid";
import { CardFilters } from "@/types";
import { Search } from "lucide-react";
import type { CardSet } from "@shared/schema";

export default function CardSearch() {
  const [cardName, setCardName] = useState("");
  const [selectedSet, setSelectedSet] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [filters, setFilters] = useState<CardFilters>({});

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const handleSearch = () => {
    const newFilters: CardFilters = {};
    if (cardName) newFilters.search = cardName;
    if (selectedSet !== "all") newFilters.setId = parseInt(selectedSet);
    setFilters(newFilters);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">CARD SEARCH</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Find specific cards in the database.
            </p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Card Name
                </label>
                <Input
                  placeholder="e.g. Spider-Man, Hulk"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Card Set
                </label>
                <Select value={selectedSet} onValueChange={setSelectedSet}>
                  <SelectTrigger>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Min Price
                </label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Price
                </label>
                <Input
                  type="number"
                  placeholder="999.99"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <Button
                onClick={handleSearch}
                className="bg-marvel-red hover:bg-red-700 text-white"
              >
                <Search className="w-4 h-4 mr-2" />
                Search Cards
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCardName("");
                  setSelectedSet("all");
                  setMinPrice("");
                  setMaxPrice("");
                  setFilters({});
                }}
              >
                Advanced Search Options
              </Button>
            </div>
          </div>

          {/* Results */}
          <CardGrid filters={filters} />
        </div>
      </div>
    </div>
  );
}