import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardGrid } from "@/components/cards/card-grid";
import { CardFilters } from "@/types";
import { Search, Filter } from "lucide-react";
import type { CardSet } from "@shared/schema";

export default function BrowseCards() {
  const [filters, setFilters] = useState<CardFilters>({});

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">BROWSE CARDS</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Discover and explore all available cards.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search cards..."
                value={filters.search || ""}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>
          </div>

          <Select value={filters.setId?.toString() || "all"} onValueChange={handleSetChange}>
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

          {Object.keys(filters).length > 0 && (
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
