import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import { useAppStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Star, Search, Filter, Crown, Lock, ShoppingCart, CreditCard, Package, Loader2 } from "lucide-react";
import type { CollectionItem, CardWithSet, CardSet } from "@/types/schema";

export default function Marketplace() {
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");

  // Handle Buy Now button click
  const handleBuyNow = (item: CollectionItem) => {
    // Don't allow buying own items
    if (item.userId === currentUser?.id) {
      toast({ 
        title: "Cannot purchase own item", 
        description: "You cannot buy your own listed cards.",
        variant: "destructive" 
      });
      return;
    }
    setSelectedItem(item);
    setShowPurchaseModal(true);
  };

  // Create checkout session mutation
  const createCheckoutMutation = useMutation({
    mutationFn: async (collectionItemId: number) => {
      const response = await apiRequest('POST', '/api/marketplace/quick-checkout', { collectionItemId });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      // Extract the actual error message from the backend response
      let errorMessage = "Unable to create checkout session. Please try again.";
      if (error.message) {
        // Error format from apiRequest is "status: {json body}"
        const match = error.message.match(/\d+: (.+)/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed.message) {
              errorMessage = parsed.message;
            }
          } catch {
            // If not JSON, use the raw message
            errorMessage = match[1];
          }
        }
      }
      toast({ 
        title: "Checkout failed", 
        description: errorMessage,
        variant: "destructive" 
      });
    }
  });

  // Handle cancelled checkout - release reservation
  const releaseReservationMutation = useMutation({
    mutationFn: async (collectionItemId: number) => {
      const response = await apiRequest('POST', '/api/marketplace/release-reservation', { collectionItemId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace"] });
    }
  });

  // Check for cancelled checkout on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cancelled = params.get('cancelled');
    const itemId = params.get('itemId');
    
    if (cancelled === 'true' && itemId) {
      releaseReservationMutation.mutate(parseInt(itemId));
      toast({
        title: "Checkout cancelled",
        description: "The item has been released and is available again.",
      });
      // Clean up URL
      setLocation('/marketplace', { replace: true });
    }
  }, []);

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

        {/* Upgrade Modal for locked view */}
        <UpgradeModal 
          isOpen={showUpgradeModal} 
          onClose={() => setShowUpgradeModal(false)} 
          currentPlan={currentUser?.plan || 'SIDE_KICK'}
        />
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
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-4 w-4" />
              <Input
                placeholder="Search cards, sets, or sellers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white text-gray-900 border-gray-300 placeholder:text-gray-500"
              />
            </div>
            
            <div className="flex gap-2">
              <Select value={selectedSet} onValueChange={setSelectedSet}>
                <SelectTrigger className="w-40 bg-white text-gray-900 border-gray-300">
                  <SelectValue placeholder="All Sets" />
                </SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
                  <SelectItem value="all">All Sets</SelectItem>
                  {cardSets?.map((set) => (
                    <SelectItem key={set.id} value={set.id.toString()}>
                      {set.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40 bg-white text-gray-900 border-gray-300">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent className="bg-white text-gray-900">
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
                  <div className="p-3 space-y-2">
                    <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-tight">
                      {item.card.name}
                    </h3>
                    <p className="text-xs text-gray-600">
                      {item.card.set.name} #{item.card.cardNumber}
                    </p>
                    <Button
                      size="sm"
                      className="w-full h-8 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBuyNow(item);
                      }}
                      data-testid={`button-buy-now-${item.id}`}
                    >
                      Buy Now
                    </Button>
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
        currentPlan={currentUser?.plan || "SIDE_KICK"}
      />

      {/* Purchase Modal */}
      <Dialog open={showPurchaseModal} onOpenChange={setShowPurchaseModal}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">Purchase Card</DialogTitle>
            <DialogDescription className="text-gray-600">
              Review your purchase details below
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              {/* Card Preview */}
              <div className="flex gap-4 p-4 bg-gray-50 rounded-lg">
                <div className="w-20 h-28 bg-gray-200 rounded overflow-hidden flex-shrink-0">
                  {selectedItem.card.frontImageUrl ? (
                    <img 
                      src={selectedItem.card.frontImageUrl} 
                      alt={selectedItem.card.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                      <span className="text-red-600 font-bold text-xs text-center px-1">
                        {selectedItem.card.name}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900">{selectedItem.card.name}</h4>
                  <p className="text-sm text-gray-600">{selectedItem.card.set.name}</p>
                  <p className="text-sm text-gray-500">Card #{selectedItem.card.cardNumber}</p>
                  <Badge className="mt-1 bg-gray-100 text-gray-700 text-xs">
                    {selectedItem.condition}
                  </Badge>
                </div>
              </div>

              {/* Seller Info */}
              {selectedItem.seller && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                    {selectedItem.seller.photoURL ? (
                      <img 
                        src={selectedItem.seller.photoURL} 
                        alt={selectedItem.seller.displayName || selectedItem.seller.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                        {(selectedItem.seller.displayName || selectedItem.seller.username || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">
                      Sold by {selectedItem.seller.displayName || selectedItem.seller.username}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-gray-600">
                      {selectedItem.seller.sellerRating && parseFloat(selectedItem.seller.sellerRating) > 0 ? (
                        <>
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          <span>{parseFloat(selectedItem.seller.sellerRating).toFixed(1)}</span>
                          <span className="text-gray-400">
                            ({selectedItem.seller.sellerReviewCount || 0} reviews)
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400">New seller</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Price Breakdown */}
              <div className="space-y-2 p-4 border rounded-lg">
                <div className="flex justify-between">
                  <span className="text-gray-600">Card Price</span>
                  <span className="font-semibold text-gray-900">
                    ${parseFloat(selectedItem.salePrice || "0").toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Shipping</span>
                  <span className="text-gray-600">Calculated at checkout</span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between">
                  <span className="font-semibold text-gray-900">Subtotal</span>
                  <span className="font-bold text-lg text-green-600">
                    ${parseFloat(selectedItem.salePrice || "0").toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Checkout Button */}
              <Button
                className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-semibold text-lg"
                onClick={() => {
                  if (selectedItem) {
                    createCheckoutMutation.mutate(selectedItem.id);
                  }
                }}
                disabled={createCheckoutMutation.isPending}
                data-testid="button-proceed-checkout"
              >
                {createCheckoutMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-5 w-5" />
                    Proceed to Checkout
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-gray-500">
                Secure payment powered by Stripe
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upgrade Modal */}
      <UpgradeModal 
        isOpen={showUpgradeModal} 
        onClose={() => setShowUpgradeModal(false)} 
        currentPlan={currentUser?.plan || 'SIDE_KICK'}
      />
    </div>
  );
}