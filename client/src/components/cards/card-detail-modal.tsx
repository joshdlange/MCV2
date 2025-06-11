import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Check, Heart, Star, RotateCcw, Edit, Trash2, Save, X, RefreshCw, ExternalLink, Image } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import type { CardWithSet } from "@shared/schema";
import { useCardPricing, useRefreshCardPricing } from "@/hooks/useCardPricing";

interface CardDetailModalProps {
  card: CardWithSet | null;
  isOpen: boolean;
  onClose: () => void;
  isInCollection?: boolean;
  isInWishlist?: boolean;
  onAddToCollection?: () => void;
  onAddToWishlist?: () => void;
  onRemoveFromCollection?: () => void;
  onRemoveFromWishlist?: () => void;
}

export function CardDetailModal({
  card,
  isOpen,
  onClose,
  isInCollection = false,
  isInWishlist = false,
  onAddToCollection,
  onAddToWishlist,
  onRemoveFromCollection,
  onRemoveFromWishlist,
}: CardDetailModalProps) {
  const [showBack, setShowBack] = useState(false);
  const [salePrice, setSalePrice] = useState("");
  const [isForSale, setIsForSale] = useState(false);
  const [condition, setCondition] = useState("Near Mint");
  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedCard, setEditedCard] = useState<Partial<CardWithSet>>({});
  
  const { isAdminMode } = useAppStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // eBay pricing hooks - enable autoFetch to display cached pricing data
  const { data: pricing, isLoading: isPricingLoading } = useCardPricing(card?.id || 0, true);
  const refreshPricing = useRefreshCardPricing();

  // Admin mutations
  const updateCardMutation = useMutation({
    mutationFn: async (updatedCard: Partial<CardWithSet>) => {
      if (!card) throw new Error('No card selected');
      return apiRequest('PATCH', `/api/cards/${card.id}`, updatedCard);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards/search'] });
      toast({ title: "Card updated successfully" });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Failed to update card", variant: "destructive" });
    }
  });

  const deleteCardMutation = useMutation({
    mutationFn: async () => {
      if (!card) throw new Error('No card selected');
      return apiRequest('DELETE', `/api/cards/${card.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards/search'] });
      toast({ title: "Card deleted successfully" });
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to delete card", variant: "destructive" });
    }
  });

  // Admin image update mutation
  const updateImageMutation = useMutation({
    mutationFn: async (cardId: number) => {
      return apiRequest('POST', `/api/admin/find-card-image/${cardId}`).then(res => res.json());
    },
    onSuccess: (data: { success: boolean; message: string }) => {
      toast({
        title: data.success ? "Image Updated" : "No Image Found",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      if (data.success) {
        // Refresh card data to show new image
        queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
        queryClient.invalidateQueries({ queryKey: ['/api/cards/search'] });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update card image",
        variant: "destructive",
      });
    }
  });

  const handleSaveEdit = () => {
    updateCardMutation.mutate(editedCard);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
      deleteCardMutation.mutate();
    }
  };

  if (!card) return null;

  const startEditing = () => {
    setIsEditing(true);
    setEditedCard({
      name: card.name,
      cardNumber: card.cardNumber,
      rarity: card.rarity,
      estimatedValue: card.estimatedValue,
      frontImageUrl: card.frontImageUrl,
      backImageUrl: card.backImageUrl,
      isInsert: card.isInsert,
      description: card.description,
    });
  };

  const cardAspectRatio = "aspect-[2.5/3.5]"; // Trading card proportions

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bebas tracking-wide">
              {isEditing ? 'Edit Card' : `${card.name} #${card.cardNumber}`}
            </DialogTitle>
            {isAdminMode && (
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button
                      onClick={handleSaveEdit}
                      disabled={updateCardMutation.isPending}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                    <Button
                      onClick={() => setIsEditing(false)}
                      variant="outline"
                      size="sm"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={() => updateImageMutation.mutate(card.id)}
                      disabled={updateImageMutation.isPending}
                      variant="outline"
                      size="sm"
                      className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    >
                      <Image className="w-4 h-4 mr-1" />
                      {updateImageMutation.isPending ? 'Updating...' : 'Update Image'}
                    </Button>
                    <Button
                      onClick={startEditing}
                      variant="outline"
                      size="sm"
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      onClick={handleDelete}
                      disabled={deleteCardMutation.isPending}
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card Image */}
          <div className="space-y-4">
            <div className="relative">
              <div className={`${cardAspectRatio} w-full max-w-sm mx-auto relative overflow-hidden rounded-lg shadow-lg`}>
                <img
                  src={showBack ? convertGoogleDriveUrl(card.backImageUrl || '') : convertGoogleDriveUrl(card.frontImageUrl || '')}
                  alt={showBack ? `${card.name} back` : card.name}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzlkYTNhZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIEVycm9yPC90ZXh0Pjwvc3ZnPg==';
                  }}
                />
                
                {/* Badges */}
                <div className="absolute top-2 right-2 flex flex-col gap-2">
                  {isInCollection && (
                    <div className="bg-green-500 rounded-full p-1 shadow-lg">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                  {isInWishlist && (
                    <div className="bg-pink-500 rounded-full p-1 shadow-lg">
                      <Heart className="w-4 h-4 text-white fill-white" />
                    </div>
                  )}
                  {card.isInsert && (
                    <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg">
                      <span className="text-sm">💎</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Flip Button */}
              {card.backImageUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBack(!showBack)}
                  className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-500 text-white border-orange-500 hover:bg-orange-500 hover:text-white"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  FLIP
                </Button>
              )}
            </div>
          </div>

          {/* Card Details */}
          <div className="space-y-6">
            {isEditing ? (
              /* Admin Edit Form */
              <div className="space-y-4">
                <div>
                  <Label htmlFor="cardName">Card Name</Label>
                  <Input
                    id="cardName"
                    value={editedCard.name || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, name: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="cardNumber">Card Number</Label>
                  <Input
                    id="cardNumber"
                    value={editedCard.cardNumber || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, cardNumber: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="rarity">Rarity</Label>
                  <Input
                    id="rarity"
                    value={editedCard.rarity || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, rarity: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="estimatedValue">Estimated Value</Label>
                  <Input
                    id="estimatedValue"
                    type="number"
                    step="0.01"
                    value={editedCard.estimatedValue || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, estimatedValue: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="frontImage">Front Image URL</Label>
                  <Input
                    id="frontImage"
                    value={editedCard.frontImageUrl || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, frontImageUrl: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="backImage">Back Image URL</Label>
                  <Input
                    id="backImage"
                    value={editedCard.backImageUrl || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, backImageUrl: e.target.value })}
                    className="bg-white text-black"
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={editedCard.description || ''}
                    onChange={(e) => setEditedCard({ ...editedCard, description: e.target.value })}
                    className="bg-white text-black"
                    rows={3}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="isInsert"
                    checked={editedCard.isInsert || false}
                    onCheckedChange={(checked) => setEditedCard({ ...editedCard, isInsert: checked })}
                  />
                  <Label htmlFor="isInsert">Insert Card</Label>
                </div>
              </div>
            ) : (
              /* Regular Card Display */
              <>
                <div>
                  <h3 className="text-lg font-semibold text-card-foreground">{card.name}</h3>
                  <p className="text-muted-foreground">{card.set.name}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <Badge variant="outline">#{card.cardNumber}</Badge>
                    {card.variation && <Badge variant="outline">{card.variation}</Badge>}
                    {card.isInsert && <Badge className="bg-yellow-500">Insert Card</Badge>}
                  </div>
                </div>

                {card.description && (
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <p className="text-sm text-muted-foreground mt-1">{card.description}</p>
                  </div>
                )}

                {/* eBay Market Pricing */}
                <div className="rounded-lg p-4 bg-gray-900 border-2 border-gray-700 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold text-white flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-red-500 font-bold text-lg">e</span>
                        <span className="text-blue-500 font-bold text-lg">b</span>
                        <span className="text-yellow-400 font-bold text-lg">a</span>
                        <span className="text-green-400 font-bold text-lg">y</span>
                      </div>
                      Market Price
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!card) return;
                        
                        // Show immediate loading state
                        const loadingToast = toast({ 
                          title: "Fetching eBay pricing...", 
                          description: "This may take a moment"
                        });
                        
                        try {
                          console.log(`Refreshing pricing for card ${card.id}: ${card.name}`);
                          const result = await refreshPricing(card.id);
                          console.log('Refresh result:', result);
                          
                          // Invalidate both the specific card pricing and general queries
                          await queryClient.invalidateQueries({ queryKey: ["/api/card-pricing", card.id] });
                          await queryClient.refetchQueries({ queryKey: ["/api/card-pricing", card.id] });
                          
                          if (result && result.avgPrice === -1) {
                            toast({ 
                              title: "eBay API rate limit reached", 
                              description: "Try again later when limits reset.",
                              variant: "destructive" 
                            });
                          } else if (result && result.avgPrice === 0 && result.salesCount === 0) {
                            toast({ 
                              title: "No eBay sales found", 
                              description: "This card may not have recent sales data."
                            });
                          } else {
                            toast({ 
                              title: "Pricing updated from eBay",
                              description: result ? `$${result.avgPrice.toFixed(2)} (${result.salesCount} sales)` : "No data found"
                            });
                          }
                        } catch (error: any) {
                          console.error('Refresh error:', error);
                          toast({ 
                            title: "Failed to update pricing", 
                            description: error.message || "Unknown error",
                            variant: "destructive" 
                          });
                        }
                      }}
                      disabled={isPricingLoading}
                      className="text-xs bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white border-none hover:from-blue-600 hover:via-purple-600 hover:to-pink-600"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isPricingLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                  
                  {isPricingLoading ? (
                    <div className="flex items-center space-x-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                      <span className="text-sm text-gray-300">Fetching latest prices...</span>
                    </div>
                  ) : pricing ? (
                    pricing.avgPrice === -1 ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-red-400">
                          <span className="text-sm font-medium">⚠️ Pricing unavailable (rate limit reached)</span>
                        </div>
                        <div className="text-xs text-gray-400">
                          eBay API limits exceeded. Try again later.
                        </div>
                        <div className="text-xs text-gray-500">
                          Last attempted: {new Date(pricing.lastFetched).toLocaleDateString()}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-green-400">
                            ${pricing.avgPrice.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded-full border border-gray-700">
                            Based on {pricing.salesCount} recent sales
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          Last updated: {new Date(pricing.lastFetched).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-blue-400 font-medium">
                          Real-time data from eBay completed listings
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-300">
                        No pricing data available yet
                      </p>
                      <p className="text-xs text-gray-400">
                        Click refresh to fetch from eBay
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Collection Actions */}
            <div className="flex gap-2">
              {isInCollection ? (
                <Button 
                  variant="outline" 
                  onClick={onRemoveFromCollection}
                  className="flex items-center gap-2 border-green-200 text-green-700"
                >
                  <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                  In Collection
                </Button>
              ) : (
                <Button 
                  onClick={onAddToCollection}
                  className="bg-green-600 hover:bg-green-700 flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Add to Collection
                </Button>
              )}

              {isInWishlist ? (
                <Button 
                  variant="outline" 
                  onClick={onRemoveFromWishlist}
                  className="flex items-center gap-2"
                >
                  <Heart className="w-4 h-4 fill-pink-500 text-pink-500" />
                  In Wishlist
                </Button>
              ) : (
                <Button 
                  onClick={onAddToWishlist}
                  className="bg-pink-500 hover:bg-pink-600 flex items-center gap-2"
                >
                  <Heart className="w-4 h-4" />
                  Add to Wishlist
                </Button>
              )}
            </div>

            {/* Marketplace Settings (only if in collection) */}
            {isInCollection && (
              <div className="border-t pt-4 space-y-4">
                <h4 className="font-medium text-card-foreground">Marketplace Settings</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="condition">Condition</Label>
                    <select 
                      id="condition"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border border-border rounded-md bg-background"
                    >
                      <option value="Mint">Mint</option>
                      <option value="Near Mint">Near Mint</option>
                      <option value="Excellent">Excellent</option>
                      <option value="Very Good">Very Good</option>
                      <option value="Good">Good</option>
                      <option value="Fair">Fair</option>
                      <option value="Poor">Poor</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="salePrice">Sale Price</Label>
                    <Input
                      id="salePrice"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={salePrice}
                      onChange={(e) => setSalePrice(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="forSale"
                    checked={isForSale}
                    onCheckedChange={setIsForSale}
                  />
                  <Label htmlFor="forSale">List for sale</Label>
                </div>

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Personal notes about this card..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <Button className="w-full bg-marvel-red hover:bg-red-700">
                  Save Settings
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}