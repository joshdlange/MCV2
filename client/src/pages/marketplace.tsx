import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import { useAppStore } from "@/lib/store";
import { Star, Search, Filter, Crown, Lock } from "lucide-react";
import type { CollectionItem, CardWithSet, CardSet } from "@/types/schema";

export default function Marketplace() {
  const { currentUser } = useAppStore();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  const { data: marketplaceItems, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ["/api/marketplace", { search: searchQuery, setId: selectedSet, sort: sortBy }],
  });

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const filteredItems = marketplaceItems?.filter(item => {
    const matchesSearch = !searchQuery || 
      item.card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.card.set.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesSet = selectedSet === "all" || item.card.setId.toString() === selectedSet;
    
    return matchesSearch && matchesSet;
  }) || [];

  const sortedItems = [...filteredItems].sort((a, b) => {
    switch (sortBy) {
      case "price-low":
        return parseFloat(a.salePrice || "0") - parseFloat(b.salePrice || "0");
      case "price-high":
        return parseFloat(b.salePrice || "0") - parseFloat(a.salePrice || "0");
      case "newest":
        return new Date(b.acquiredDate).getTime() - new Date(a.acquiredDate).getTime();
      case "oldest":
        return new Date(a.acquiredDate).getTime() - new Date(b.acquiredDate).getTime();
      default:
        return 0;
    }
  });

  // Check if user is on SIDE KICK plan and restrict access
  if (currentUser?.plan === 'SIDE_KICK') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MARKETPLACE</h2>
        </div>
        <div className="flex items-center justify-center min-h-[60vh] p-6">
          <div className="max-w-lg mx-auto text-center">
            <div className="w-32 h-32 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-full flex items-center justify-center mx-auto mb-8">
              <Lock className="h-16 w-16 text-yellow-600" />
            </div>
            <h3 className="text-3xl font-bold text-gray-900 mb-4">Marketplace Access</h3>
            <h4 className="text-xl font-semibold text-yellow-600 mb-4">SUPER HERO Feature</h4>
            <p className="text-gray-600 mb-8 leading-relaxed">
              The Marketplace is an exclusive feature for SUPER HERO members. Buy and sell cards with other collectors, 
              access premium listings, and unlock the full trading experience.
            </p>
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
              <h5 className="font-semibold text-gray-900 mb-3">What you'll get with SUPER HERO:</h5>
              <ul className="text-left space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  Full marketplace access
                </li>
                <li className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  Buy & sell with collectors
                </li>
                <li className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  Unlimited card storage
                </li>
                <li className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  Priority support
                </li>
              </ul>
            </div>
            <Button 
              onClick={() => setShowUpgradeModal(true)}
              className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-yellow-900 font-bold px-8 py-3 text-lg"
            >
              <Crown className="w-5 h-5 mr-2" />
              Upgrade to SUPER HERO
            </Button>
            <p className="text-sm text-gray-500 mt-4">Only $5/month • Cancel anytime</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MARKETPLACE</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {[...Array(12)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-0">
                  <div className="w-full aspect-[2.5/3.5] bg-gray-200 rounded-t-lg"></div>
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MARKETPLACE</h2>
          
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search cards, sets, or sellers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex gap-2">
              <Select value={selectedSet} onValueChange={setSelectedSet}>
                <SelectTrigger className="w-40">
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
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="price-low">Price: Low to High</SelectItem>
                  <SelectItem value="price-high">Price: High to Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="text-sm text-gray-600">
            {sortedItems.length} cards available for purchase
          </div>
        </div>
      </div>

      <div className="p-6">
        {sortedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-6">
              <Filter className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Cards Found</h3>
            <p className="text-gray-600 mb-6 max-w-md">
              {searchQuery || selectedSet !== "all" 
                ? "Try adjusting your search criteria or filters."
                : "No cards are currently listed for sale in the marketplace."
              }
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {sortedItems.map((item) => (
              <Card 
                key={item.id} 
                className="group hover:shadow-lg transition-all duration-200 cursor-pointer"
                onClick={() => handleCardClick(item.card)}
              >
                <CardContent className="p-0">
                  {/* Card Image */}
                  <div className="relative aspect-[2.5/3.5] bg-gray-100 rounded-t-lg overflow-hidden">
                    {item.card.frontImageUrl ? (
                      <img
                        src={item.card.frontImageUrl}
                        alt={item.card.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                        <span className="text-red-600 font-bold text-xs text-center px-2">
                          {item.card.name}
                        </span>
                      </div>
                    )}

                    {/* Insert Badge */}
                    <div className="absolute bottom-2 left-2 flex gap-1">
                      {item.card.isInsert && (
                        <div className="bg-purple-600 text-white rounded-full w-5 h-5 flex items-center justify-center">
                          <span className="text-xs">💎</span>
                        </div>
                      )}
                    </div>

                    {/* Price Badge */}
                    {item.salePrice && (
                      <div className="absolute top-2 right-2">
                        <Badge className="bg-green-100 text-green-800 text-sm font-bold px-2 py-1">
                          ${parseFloat(item.salePrice).toFixed(2)}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Card Info */}
                  <div className="p-3 space-y-1">
                    <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-tight">
                      {item.card.name}
                    </h3>
                    <p className="text-xs text-gray-600">
                      {item.card.set.name} #{item.card.cardNumber}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="outline" className="text-xs">
                        {item.condition}
                      </Badge>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-xs bg-red-600 hover:bg-red-700 text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Handle purchase logic here
                        }}
                      >
                        Buy Now
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCard(null);
        }}
        isInCollection={false}
        isInWishlist={false}
      />

      <UpgradeModal 
        isOpen={showUpgradeModal} 
        onClose={() => setShowUpgradeModal(false)} 
        reason="marketplace"
      />
    </div>
  );
}