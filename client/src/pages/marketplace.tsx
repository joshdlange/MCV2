import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import { useAppStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Star, Search, Filter, Crown, Lock, ShoppingCart, CreditCard, Package, Loader2, MapPin, Truck } from "lucide-react";
import type { CollectionItem, CardWithSet, CardSet } from "@/types/schema";

interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
}

interface ShippingRate {
  rateId: string;
  shipmentId: string;
  parcelType: string;
  parcelName: string;
  carrier: string;
  serviceLevel: string;
  shippingCost: number;
  estimatedDays: number;
}

interface ShippingQuote {
  rates: ShippingRate[];
  expiresAt: number;
}

export default function Marketplace() {
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSet, setSelectedSet] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  
  const [shippingAddress, setShippingAddress] = useState<ShippingAddress | null>(null);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [selectedShippingRate, setSelectedShippingRate] = useState<ShippingRate | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [shippingQuoteError, setShippingQuoteError] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<ShippingAddress>({
    name: '',
    street1: '',
    street2: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
    phone: '',
  });

  const { data: savedAddress, refetch: refetchAddress } = useQuery<{ shippingAddress: ShippingAddress | null }>({
    queryKey: ["/api/user/shipping-address"],
    enabled: !!currentUser,
  });

  useEffect(() => {
    if (savedAddress?.shippingAddress) {
      setShippingAddress(savedAddress.shippingAddress);
      setAddressForm(savedAddress.shippingAddress);
    }
  }, [savedAddress]);

  const saveAddressMutation = useMutation({
    mutationFn: async (address: ShippingAddress) => {
      const response = await apiRequest('PATCH', '/api/user/shipping-address', { shippingAddress: address });
      return response.json();
    },
    onSuccess: () => {
      refetchAddress();
      toast({ title: "Address saved", description: "Your shipping address has been updated." });
    },
    onError: () => {
      toast({ title: "Failed to save address", variant: "destructive" });
    }
  });

  const fetchShippingQuote = async (collectionItemId: number) => {
    setIsLoadingQuote(true);
    setShippingQuote(null);
    setSelectedShippingRate(null);
    setShippingQuoteError(null);
    try {
      const response = await apiRequest('POST', '/api/marketplace/shipping/quick-quote', { collectionItemId });
      const data = await response.json();
      setShippingQuote(data);
      // Auto-select cheapest rate (first in sorted list)
      if (data.rates && data.rates.length > 0) {
        setSelectedShippingRate(data.rates[0]);
      }
    } catch (error: any) {
      let errorMsg = "Failed to calculate shipping";
      try {
        const match = error.message?.match(/\d+: (.+)/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          errorMsg = parsed.message || errorMsg;
          if (parsed.needsAddress) {
            setShowAddressModal(true);
            setShowPurchaseModal(false);
            return;
          }
        }
      } catch {}
      setShippingQuoteError(errorMsg);
      toast({ title: "Shipping Error", description: errorMsg, variant: "destructive" });
    } finally {
      setIsLoadingQuote(false);
    }
  };

  const handleBuyNow = async (item: CollectionItem) => {
    if (item.userId === currentUser?.id) {
      toast({ 
        title: "Cannot purchase own item", 
        description: "You cannot buy your own listed cards.",
        variant: "destructive" 
      });
      return;
    }
    
    setSelectedItem(item);
    setShippingQuote(null);
    setSelectedShippingRate(null);
    setShippingQuoteError(null);
    
    if (!shippingAddress && !savedAddress?.shippingAddress) {
      setShowAddressModal(true);
    } else {
      setShowPurchaseModal(true);
      fetchShippingQuote(item.id);
    }
  };

  const handleAddressSaveAndContinue = async () => {
    if (!addressForm.street1 || !addressForm.city || !addressForm.state || !addressForm.zip) {
      toast({ title: "Missing required fields", description: "Please fill in all required address fields.", variant: "destructive" });
      return;
    }
    
    await saveAddressMutation.mutateAsync(addressForm);
    setShippingAddress(addressForm);
    setShowAddressModal(false);
    
    if (selectedItem) {
      setShowPurchaseModal(true);
      fetchShippingQuote(selectedItem.id);
    }
  };

  const createCheckoutMutation = useMutation({
    mutationFn: async ({ collectionItemId, shippingRateId }: { collectionItemId: number; shippingRateId: string }) => {
      const response = await apiRequest('POST', '/api/marketplace/quick-checkout', { collectionItemId, shippingRateId });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      let errorMessage = "Unable to create checkout session. Please try again.";
      let requiresShippingAddress = false;
      if (error.message) {
        const match = error.message.match(/\d+: (.+)/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            if (parsed.message) {
              errorMessage = parsed.message;
            }
            if (parsed.needsShippingQuote) {
              if (selectedItem) {
                fetchShippingQuote(selectedItem.id);
              }
            }
            if (parsed.requiresShippingAddress) {
              requiresShippingAddress = true;
            }
          } catch {
            errorMessage = match[1];
          }
        }
      }
      if (requiresShippingAddress) {
        toast({ 
          title: "Shipping Address Required", 
          description: "Please add your shipping address in your Profile settings before making a purchase.",
          variant: "destructive",
          duration: 8000
        });
      } else {
        toast({ 
          title: "Checkout failed", 
          description: errorMessage,
          variant: "destructive" 
        });
      }
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

      {/* Shipping Address Modal */}
      <Dialog open={showAddressModal} onOpenChange={setShowAddressModal}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-red-600" />
              Shipping Address
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Enter your shipping address to continue with checkout
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="name" className="text-sm font-medium text-gray-700">Full Name</Label>
              <Input
                id="name"
                value={addressForm.name}
                onChange={(e) => setAddressForm({ ...addressForm, name: e.target.value })}
                placeholder="John Smith"
                className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
              />
            </div>
            <div>
              <Label htmlFor="street1" className="text-sm font-medium text-gray-700">Address Line 1 *</Label>
              <Input
                id="street1"
                value={addressForm.street1}
                onChange={(e) => setAddressForm({ ...addressForm, street1: e.target.value })}
                placeholder="123 Main Street"
                className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                required
              />
            </div>
            <div>
              <Label htmlFor="street2" className="text-sm font-medium text-gray-700">Address Line 2</Label>
              <Input
                id="street2"
                value={addressForm.street2 || ''}
                onChange={(e) => setAddressForm({ ...addressForm, street2: e.target.value })}
                placeholder="Apt, Suite, etc."
                className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="city" className="text-sm font-medium text-gray-700">City *</Label>
                <Input
                  id="city"
                  value={addressForm.city}
                  onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                  placeholder="New York"
                  className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                  required
                />
              </div>
              <div>
                <Label htmlFor="state" className="text-sm font-medium text-gray-700">State *</Label>
                <Input
                  id="state"
                  value={addressForm.state}
                  onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                  placeholder="NY"
                  className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="zip" className="text-sm font-medium text-gray-700">ZIP Code *</Label>
                <Input
                  id="zip"
                  value={addressForm.zip}
                  onChange={(e) => setAddressForm({ ...addressForm, zip: e.target.value })}
                  placeholder="10001"
                  className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                  required
                />
              </div>
              <div>
                <Label htmlFor="phone" className="text-sm font-medium text-gray-700">Phone</Label>
                <Input
                  id="phone"
                  value={addressForm.phone || ''}
                  onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="mt-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                />
              </div>
            </div>
            
            <Button
              className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-semibold"
              onClick={handleAddressSaveAndContinue}
              disabled={saveAddressMutation.isPending}
            >
              {saveAddressMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save & Continue to Checkout"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Purchase Modal */}
      <Dialog open={showPurchaseModal} onOpenChange={(open) => {
        setShowPurchaseModal(open);
        if (!open) {
          setShippingQuote(null);
          setSelectedShippingRate(null);
        }
      }}>
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

              {/* Seller Info - prioritize username */}
              {selectedItem.seller && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                    {selectedItem.seller.photoURL ? (
                      <img 
                        src={selectedItem.seller.photoURL} 
                        alt={selectedItem.seller.username || 'Seller'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                        {(selectedItem.seller.username || selectedItem.seller.displayName || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 text-sm">
                      Sold by @{selectedItem.seller.username || 'Seller'}
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

              {/* Shipping Options */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-900">Choose Shipping</span>
                </div>
                
                {isLoadingQuote ? (
                  <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-500 mr-2" />
                    <span className="text-gray-500">Finding best rates...</span>
                  </div>
                ) : shippingQuote?.rates && shippingQuote.rates.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {shippingQuote.rates.map((rate, index) => (
                      <div
                        key={rate.rateId}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedShippingRate?.rateId === rate.rateId
                            ? 'border-red-500 bg-red-50 ring-1 ring-red-500'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedShippingRate(rate)}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">
                                ${rate.shippingCost.toFixed(2)}
                              </span>
                              {index === 0 && (
                                <Badge className="bg-green-100 text-green-700 text-xs px-1.5 py-0">
                                  Cheapest
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">{rate.parcelName}</p>
                            <p className="text-xs text-gray-500">
                              {rate.carrier} {rate.serviceLevel} • {rate.estimatedDays} {rate.estimatedDays === 1 ? 'day' : 'days'}
                            </p>
                          </div>
                          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                            selectedShippingRate?.rateId === rate.rateId
                              ? 'border-red-500 bg-red-500'
                              : 'border-gray-300'
                          }`}>
                            {selectedShippingRate?.rateId === rate.rateId && (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : shippingQuoteError ? (
                  <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm text-red-600">{shippingQuoteError}</p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-red-600 underline mt-1"
                      onClick={() => fetchShippingQuote(selectedItem.id)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <span className="text-gray-400 text-sm">Loading shipping options...</span>
                  </div>
                )}
              </div>

              {/* Price Summary */}
              <div className="space-y-2 p-4 border rounded-lg bg-gray-50">
                <div className="flex justify-between">
                  <span className="text-gray-600">Card Price</span>
                  <span className="font-semibold text-gray-900">
                    ${parseFloat(selectedItem.salePrice || "0").toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Shipping</span>
                  <span className="text-gray-900">
                    {selectedShippingRate ? `$${selectedShippingRate.shippingCost.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-bold text-lg text-green-600">
                    ${(parseFloat(selectedItem.salePrice || "0") + (selectedShippingRate?.shippingCost || 0)).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Checkout Button - requires selected shipping rate */}
              <Button
                className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-semibold text-lg disabled:bg-gray-400"
                onClick={() => {
                  if (selectedItem && selectedShippingRate) {
                    createCheckoutMutation.mutate({ 
                      collectionItemId: selectedItem.id, 
                      shippingRateId: selectedShippingRate.rateId 
                    });
                  }
                }}
                disabled={createCheckoutMutation.isPending || !selectedShippingRate || isLoadingQuote}
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