import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CardGrid } from "@/components/cards/card-grid";
import { CardFilters } from "@/types";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import type { CardSet } from "@shared/schema";
import { useLocation } from "wouter";

export default function CardSearch() {
  const [location] = useLocation();
  const [cardName, setCardName] = useState("");
  const [selectedSet, setSelectedSet] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [cardType, setCardType] = useState("all");
  const [condition, setCondition] = useState("all");
  const [yearRange, setYearRange] = useState({ min: "", max: "" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filters, setFilters] = useState<CardFilters>({});

  // Check if we came from quick search
  useEffect(() => {
    const urlParams = new URLSearchParams(location.split('?')[1] || '');
    const searchQuery = urlParams.get('search');
    if (searchQuery) {
      setCardName(searchQuery);
      setFilters({ search: searchQuery });
    }
  }, [location]);

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const handleSearch = () => {
    const newFilters: CardFilters = {};
    if (cardName) newFilters.search = cardName;
    if (selectedSet !== "all") newFilters.setId = parseInt(selectedSet);
    if (cardType !== "all") newFilters.isInsert = cardType === "insert";
    setFilters(newFilters);
  };

  const clearAllFilters = () => {
    setCardName("");
    setSelectedSet("all");
    setMinPrice("");
    setMaxPrice("");
    setCardType("all");
    setCondition("all");
    setYearRange({ min: "", max: "" });
    setFilters({});
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
            {/* Basic Search */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Card Name
                </label>
                <Input
                  placeholder="e.g. Spider-Man, Hulk"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Card Set
                </label>
                <Select value={selectedSet} onValueChange={setSelectedSet}>
                  <SelectTrigger className="bg-white border-gray-200 text-gray-900">
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
            </div>

            {/* Advanced Search Options */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  className="mb-4 bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
                >
                  Advanced Search Options
                  {advancedOpen ? (
                    <ChevronUp className="w-4 h-4 ml-2" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ml-2" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Min Price
                    </label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
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
                      className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Card Type
                    </label>
                    <Select value={cardType} onValueChange={setCardType}>
                      <SelectTrigger className="bg-white border-gray-200 text-gray-900">
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="base">Base Cards</SelectItem>
                        <SelectItem value="insert">Insert Cards</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Condition
                    </label>
                    <Select value={condition} onValueChange={setCondition}>
                      <SelectTrigger className="bg-white border-gray-200 text-gray-900">
                        <SelectValue placeholder="Any Condition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Condition</SelectItem>
                        <SelectItem value="mint">Mint</SelectItem>
                        <SelectItem value="near-mint">Near Mint</SelectItem>
                        <SelectItem value="excellent">Excellent</SelectItem>
                        <SelectItem value="very-good">Very Good</SelectItem>
                        <SelectItem value="good">Good</SelectItem>
                        <SelectItem value="fair">Fair</SelectItem>
                        <SelectItem value="poor">Poor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Min Year
                    </label>
                    <Input
                      type="number"
                      placeholder="1990"
                      value={yearRange.min}
                      onChange={(e) => setYearRange(prev => ({ ...prev, min: e.target.value }))}
                      className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Max Year
                    </label>
                    <Input
                      type="number"
                      placeholder="2024"
                      value={yearRange.max}
                      onChange={(e) => setYearRange(prev => ({ ...prev, max: e.target.value }))}
                      className="bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

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
                onClick={clearAllFilters}
                className="bg-white hover:bg-gray-50 text-gray-700 border-gray-300"
              >
                Clear All Filters
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