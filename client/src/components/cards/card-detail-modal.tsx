import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, Heart, Star, RotateCcw, Edit, Trash2, Save, X, RefreshCw, ExternalLink, Image, Upload, Camera, ChevronDown, ChevronUp, Settings, MoreVertical } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import { getCardAuraTier, type AuraTier } from "@/lib/cardAura";
import type { CardWithSet } from "@shared/schema";
import { useCardPricing, useRefreshCardPricing } from "@/hooks/useCardPricing";
import { auth } from "@/lib/firebase";
import noCardImagePlaceholder from "@assets/no card image 4_1764019444486.png";

interface CardDetailModalProps {
  card: CardWithSet | null;
  isOpen: boolean;
  onClose: () => void;
  isInCollection?: boolean;
  isInWishlist?: boolean;
  collectionItemId?: number;
  onAddToCollection?: () => void;
  onAddToWishlist?: () => void;
  onRemoveFromCollection?: () => void;
  onRemoveFromWishlist?: () => void;
  onCardUpdate?: (updatedCard: CardWithSet) => void;
}

export function CardDetailModal({
  card,
  isOpen,
  onClose,
  isInCollection = false,
  isInWishlist = false,
  collectionItemId,
  onAddToCollection,
  onAddToWishlist,
  onRemoveFromCollection,
  onRemoveFromWishlist,
  onCardUpdate,
}: CardDetailModalProps) {
  const [showBack, setShowBack] = useState(false);
  const [salePrice, setSalePrice] = useState("");
  const [isForSale, setIsForSale] = useState(false);
  const [condition, setCondition] = useState("Near Mint");
  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedCard, setEditedCard] = useState<Partial<CardWithSet>>({});
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [backImageFile, setBackImageFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [showPricing, setShowPricing] = useState(true);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showAdminTools, setShowAdminTools] = useState(false);
  
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
    onSuccess: async (data: { success: boolean; message: string; result?: any }) => {
      toast({
        title: data.success ? "Image Updated" : "No Image Found",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      if (data.success && card?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
        queryClient.invalidateQueries({ queryKey: ['/api/cards/search'] });
        
        try {
          const updatedCard = await apiRequest('GET', `/api/cards/${card.id}`).then(res => res.json());
          if (onCardUpdate) {
            onCardUpdate(updatedCard);
          }
        } catch (error) {
          console.error('Failed to fetch updated card data:', error);
        }
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

  // User image upload mutation
  const uploadImageMutation = useMutation({
    mutationFn: async ({ cardId, formData }: { cardId: number; formData: FormData }) => {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in to upload images');
      }
      const token = await user.getIdToken();
      const response = await fetch(`/api/cards/${cardId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Image uploaded successfully!",
        description: "Your submission is pending admin approval. Thank you for contributing!",
      });
      setFrontImageFile(null);
      setBackImageFile(null);
      setFrontPreview(null);
      setBackPreview(null);
      setShowUploadSection(false);
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Marketplace settings mutation - fetches collection item ID by card ID first
  const saveMarketplaceSettingsMutation = useMutation({
    mutationFn: async (data: { cardId: number; isForSale: boolean; salePrice: string; condition: string; notes: string }) => {
      // First, fetch the collection item by card ID to get the real collection item ID
      const collectionResponse = await apiRequest('GET', '/api/collection');
      const collection = await collectionResponse.json();
      const collectionItem = collection.find((item: any) => item.cardId === data.cardId);
      
      if (!collectionItem) {
        throw new Error('Collection item not found. Please ensure the card is in your collection.');
      }
      
      return apiRequest('PATCH', `/api/collection/${collectionItem.id}`, {
        isForSale: data.isForSale,
        salePrice: data.salePrice,
        condition: data.condition,
        notes: data.notes,
      });
    },
    onSuccess: () => {
      toast({ title: "Marketplace settings saved" });
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      queryClient.invalidateQueries({ queryKey: ['/api/marketplace'] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    }
  });

  const handleSaveMarketplaceSettings = () => {
    if (!card) {
      toast({ title: "Error", description: "No card selected", variant: "destructive" });
      return;
    }
    saveMarketplaceSettingsMutation.mutate({
      cardId: card.id,
      isForSale,
      salePrice,
      condition,
      notes,
    });
  };

  const handleSaveEdit = () => {
    updateCardMutation.mutate(editedCard);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
      deleteCardMutation.mutate();
    }
  };

  const handleFileSelect = (file: File | null, type: 'front' | 'back') => {
    if (!file) {
      if (type === 'front') {
        setFrontImageFile(null);
        setFrontPreview(null);
      } else {
        setBackImageFile(null);
        setBackPreview(null);
      }
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Images must be under 5MB",
        variant: "destructive",
      });
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    if (type === 'front') {
      setFrontImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFrontPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setBackImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setBackPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadSubmit = () => {
    if (!card) return;
    if (!frontImageFile && !backImageFile) {
      toast({
        title: "No images selected",
        description: "Please select at least one image to upload",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    if (frontImageFile) {
      formData.append('frontImage', frontImageFile);
    }
    if (backImageFile) {
      formData.append('backImage', backImageFile);
    }

    uploadImageMutation.mutate({ cardId: card.id, formData });
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-[95vw] sm:w-full max-h-[95vh] p-0 overflow-hidden flex flex-col">
        {/* Sticky Header - Mobile Optimized */}
        <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-3 py-3 sm:px-4">
          {/* Large Close Button on Left */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-10 w-10 p-0 rounded-full hover:bg-gray-700 text-white"
            data-testid="button-close-modal"
          >
            <X className="h-6 w-6 text-white" />
          </Button>
          
          {/* Card Title - Centered */}
          <div className="flex-1 text-center px-2 min-w-0">
            <h2 className="text-base sm:text-lg font-bebas tracking-wide truncate text-white">
              {isEditing ? 'Edit Card' : card.name}
            </h2>
            <p className="text-xs text-gray-400">#{card.cardNumber}</p>
          </div>
          
          {/* Admin Tools Toggle or Empty Space */}
          {isAdminMode && !isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdminTools(!showAdminTools)}
              className="h-10 w-10 p-0 rounded-full hover:bg-gray-700 text-white"
              data-testid="button-admin-menu"
            >
              <MoreVertical className="h-5 w-5 text-white" />
            </Button>
          ) : (
            <div className="w-10" /> 
          )}
        </div>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            
            {/* Admin Tools Dropdown - Only visible when toggled */}
            {isAdminMode && showAdminTools && !isEditing && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 space-y-2 animate-in slide-in-from-top-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Admin Tools</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => updateImageMutation.mutate(card.id)}
                    disabled={updateImageMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[100px] bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    data-testid="button-update-image"
                  >
                    <Image className="w-4 h-4 mr-1" />
                    {updateImageMutation.isPending ? 'Updating...' : 'Find Image'}
                  </Button>
                  <Button
                    onClick={startEditing}
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[80px]"
                    data-testid="button-edit-card"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    onClick={handleDelete}
                    disabled={deleteCardMutation.isPending}
                    variant="destructive"
                    size="sm"
                    className="flex-1 min-w-[80px]"
                    data-testid="button-delete-card"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            )}

            {/* Admin Edit Mode */}
            {isEditing && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900 dark:text-gray-100">Editing Card</p>
                  <div className="flex gap-2">
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
                      Cancel
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="cardName" className="text-xs text-gray-700 dark:text-gray-300">Card Name</Label>
                    <Input
                      id="cardName"
                      value={editedCard.name || ''}
                      onChange={(e) => setEditedCard({ ...editedCard, name: e.target.value })}
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="cardNumber" className="text-xs text-gray-700 dark:text-gray-300">Card Number</Label>
                      <Input
                        id="cardNumber"
                        value={editedCard.cardNumber || ''}
                        onChange={(e) => setEditedCard({ ...editedCard, cardNumber: e.target.value })}
                        className="bg-white text-gray-900 border-gray-300 mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="rarity" className="text-xs text-gray-700 dark:text-gray-300">Rarity</Label>
                      <Input
                        id="rarity"
                        value={editedCard.rarity || ''}
                        onChange={(e) => setEditedCard({ ...editedCard, rarity: e.target.value })}
                        className="bg-white text-gray-900 border-gray-300 mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="estimatedValue" className="text-xs text-gray-700 dark:text-gray-300">Estimated Value</Label>
                    <Input
                      id="estimatedValue"
                      type="number"
                      step="0.01"
                      value={editedCard.estimatedValue || ''}
                      onChange={(e) => setEditedCard({ ...editedCard, estimatedValue: e.target.value })}
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="frontImage" className="text-xs text-gray-700 dark:text-gray-300">Front Image URL</Label>
                    <Input
                      id="frontImage"
                      value={editedCard.frontImageUrl || ''}
                      onChange={(e) => setEditedCard({ ...editedCard, frontImageUrl: e.target.value })}
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="backImage" className="text-xs text-gray-700 dark:text-gray-300">Back Image URL</Label>
                    <Input
                      id="backImage"
                      value={editedCard.backImageUrl || ''}
                      onChange={(e) => setEditedCard({ ...editedCard, backImageUrl: e.target.value })}
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="description" className="text-xs text-gray-700 dark:text-gray-300">Description</Label>
                    <Textarea
                      id="description"
                      value={editedCard.description || ''}
                      onChange={(e) => setEditedCard({ ...editedCard, description: e.target.value })}
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                      rows={2}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isInsert"
                      checked={editedCard.isInsert || false}
                      onCheckedChange={(checked) => setEditedCard({ ...editedCard, isInsert: checked })}
                    />
                    <Label htmlFor="isInsert" className="text-sm text-gray-700 dark:text-gray-300">Insert Card</Label>
                  </div>
                </div>
              </div>
            )}

            {/* Card Image - Optimized for Mobile with Value-Based Aura */}
            {!isEditing && (() => {
              // Calculate aura tier based on eBay pricing (if available) or card's estimated value
              // Priority: manual override > eBay avg price > card.estimatedValue
              const priceForTier = pricing?.avgPrice && pricing.avgPrice > 0 
                ? pricing.avgPrice 
                : (card.estimatedValue ? parseFloat(String(card.estimatedValue)) : null);
              
              const auraTier = getCardAuraTier(
                priceForTier,
                (card as any).auraTierOverride as AuraTier | undefined
              );
              
              return (
                <div className="flex justify-center py-6">
                  {/* Card Container with Aura */}
                  <div className={`card-aura-container aura-${auraTier}`}>
                    <div className="aspect-[2.5/3.5] w-[280px] relative overflow-hidden rounded-xl shadow-xl">
                      <img
                        src={showBack ? convertGoogleDriveUrl(card.backImageUrl || '') : convertGoogleDriveUrl(card.frontImageUrl || '')}
                        alt={showBack ? `${card.name} back` : card.name}
                        className="w-full h-full object-contain bg-gray-900"
                        onError={(e) => {
                          e.currentTarget.src = noCardImagePlaceholder;
                        }}
                      />
                      
                      {/* Status Badges */}
                      <div className="absolute top-2 right-2 flex flex-col gap-1.5">
                        {isInCollection && (
                          <div className="bg-green-500 rounded-full p-1.5 shadow-lg">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {isInWishlist && (
                          <div className="bg-pink-500 rounded-full p-1.5 shadow-lg">
                            <Heart className="w-3 h-3 text-white fill-white" />
                          </div>
                        )}
                        {card.isInsert && (
                          <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg text-xs">
                            💎
                          </div>
                        )}
                      </div>
                      
                      {/* Flip Button */}
                      {card.backImageUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowBack(!showBack)}
                          className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-orange-500 text-white border-orange-500 hover:bg-orange-600 hover:text-white text-xs px-3 py-1 h-8"
                          data-testid="button-flip-card"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          FLIP
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Card Info */}
            {!isEditing && (
              <div className="text-center space-y-2 bg-gray-900 border border-gray-700 rounded-lg p-3">
                <p className="text-sm text-white font-medium">{card.set?.name || (card as any).setName || 'Unknown Set'}</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs border-gray-500 text-gray-300 bg-gray-800">#{card.cardNumber}</Badge>
                  {card.variation && <Badge variant="outline" className="text-xs border-gray-500 text-gray-300 bg-gray-800">{card.variation}</Badge>}
                  {card.isInsert && <Badge className="bg-yellow-500 text-black text-xs">Insert Card</Badge>}
                </div>
                {card.description && (
                  <p className="text-xs text-gray-400 mt-2 px-2">{card.description}</p>
                )}
              </div>
            )}

            {/* Collection/Wishlist Actions - Always Visible */}
            {!isEditing && (
              <div className="grid grid-cols-2 gap-2">
                {isInCollection ? (
                  <Button 
                    variant="outline" 
                    onClick={() => onRemoveFromCollection?.()}
                    data-testid="button-remove-from-collection"
                    className="h-12 text-sm border-green-200 text-green-700 hover:bg-green-50"
                  >
                    <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mr-2">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    In Collection
                  </Button>
                ) : (
                  <Button 
                    onClick={() => onAddToCollection?.()}
                    data-testid="button-add-to-collection"
                    className="h-12 text-sm bg-green-600 hover:bg-green-700"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Add to Collection
                  </Button>
                )}

                {isInWishlist ? (
                  <Button 
                    variant="outline" 
                    onClick={onRemoveFromWishlist}
                    data-testid="button-remove-from-wishlist"
                    className="h-12 text-sm border-pink-200 text-pink-700 hover:bg-pink-50"
                  >
                    <Heart className="w-4 h-4 fill-pink-500 text-pink-500 mr-2" />
                    In Wishlist
                  </Button>
                ) : (
                  <Button 
                    onClick={onAddToWishlist}
                    data-testid="button-add-to-wishlist"
                    className="h-12 text-sm bg-pink-500 hover:bg-pink-600"
                  >
                    <Heart className="w-4 h-4 mr-2" />
                    Add to Wishlist
                  </Button>
                )}
              </div>
            )}

            {/* eBay Pricing - Collapsible */}
            {!isEditing && (
              <Collapsible open={showPricing} onOpenChange={setShowPricing}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-700 text-left">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5">
                        <span className="text-red-500 font-bold text-sm">e</span>
                        <span className="text-blue-500 font-bold text-sm">b</span>
                        <span className="text-yellow-400 font-bold text-sm">a</span>
                        <span className="text-green-400 font-bold text-sm">y</span>
                      </div>
                      <span className="text-white text-sm font-medium">Market Price</span>
                      {pricing && pricing.avgPrice > 0 && (
                        <span className="text-green-400 font-bold">${pricing.avgPrice.toFixed(2)}</span>
                      )}
                    </div>
                    {showPricing ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 bg-gray-900 border border-t-0 border-gray-700 rounded-b-lg space-y-3">
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!card) return;
                          toast({ title: "Fetching eBay pricing...", description: "This may take a moment" });
                          try {
                            const result = await refreshPricing(card.id);
                            await queryClient.invalidateQueries({ queryKey: ["/api/card-pricing", card.id] });
                            await queryClient.refetchQueries({ queryKey: ["/api/card-pricing", card.id] });
                            
                            if (result && result.avgPrice === -1) {
                              toast({ title: "eBay API rate limit reached", description: "Try again later.", variant: "destructive" });
                            } else if (result && result.avgPrice === 0 && result.salesCount === 0) {
                              toast({ title: "No eBay sales found", description: "This card may not have recent sales data." });
                            } else {
                              toast({ title: "Pricing updated", description: result ? `$${result.avgPrice.toFixed(2)} (${result.salesCount} sales)` : "No data" });
                            }
                          } catch (error: any) {
                            toast({ title: "Failed to update", description: error.message || "Unknown error", variant: "destructive" });
                          }
                        }}
                        disabled={isPricingLoading}
                        className="text-xs bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white border-none"
                        data-testid="button-refresh-pricing"
                      >
                        <RefreshCw className={`w-3 h-3 mr-1 ${isPricingLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                    </div>
                    
                    {isPricingLoading ? (
                      <div className="flex items-center gap-2 text-gray-300 text-sm">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                        Fetching latest prices...
                      </div>
                    ) : pricing ? (
                      pricing.avgPrice === -1 ? (
                        <div className="text-sm text-red-400">⚠️ Pricing unavailable (rate limit)</div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-2xl font-bold text-green-400">${pricing.avgPrice.toFixed(2)}</span>
                            <span className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded-full">
                              {pricing.salesCount} sales
                            </span>
                          </div>
                          <p className="text-xs text-gray-400">
                            Updated: {new Date(pricing.lastFetched).toLocaleDateString()}
                          </p>
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-gray-400">No pricing data yet. Click refresh to fetch.</p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Image Upload Section - Available for all users */}
            {!isEditing && (
              <Collapsible open={showUploadSection} onOpenChange={setShowUploadSection}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-700 text-left">
                    <div className="flex items-center gap-2">
                      <Camera className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-white">Upload Card Image</span>
                    </div>
                    {showUploadSection ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 bg-gray-900 border border-t-0 border-gray-700 rounded-b-lg space-y-3">
                    <p className="text-xs text-gray-400">Help grow the database with high-quality card images</p>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input
                          id="frontImage"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleFileSelect(e.target.files?.[0] || null, 'front')}
                          className="hidden"
                        />
                        <label htmlFor="frontImage" className="flex items-center justify-center gap-1 w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md cursor-pointer text-sm">
                          <Upload className="w-3 h-3" />
                          Front
                        </label>
                        {frontPreview && (
                          <div className="relative aspect-[2.5/3.5] mt-2 rounded border overflow-hidden">
                            <img src={frontPreview} alt="Front" className="w-full h-full object-contain" />
                            <Button
                              variant="destructive"
                              size="sm"
                              className="absolute top-1 right-1 h-6 w-6 p-0"
                              onClick={() => handleFileSelect(null, 'front')}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <input
                          id="backImage"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleFileSelect(e.target.files?.[0] || null, 'back')}
                          className="hidden"
                        />
                        <label htmlFor="backImage" className="flex items-center justify-center gap-1 w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md cursor-pointer text-sm">
                          <Upload className="w-3 h-3" />
                          Back
                        </label>
                        {backPreview && (
                          <div className="relative aspect-[2.5/3.5] mt-2 rounded border overflow-hidden">
                            <img src={backPreview} alt="Back" className="w-full h-full object-contain" />
                            <Button
                              variant="destructive"
                              size="sm"
                              className="absolute top-1 right-1 h-6 w-6 p-0"
                              onClick={() => handleFileSelect(null, 'back')}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <Button
                      onClick={handleUploadSubmit}
                      disabled={uploadImageMutation.isPending || (!frontImageFile && !backImageFile)}
                      className="w-full bg-marvel-red hover:bg-red-700 text-sm h-10"
                    >
                      {uploadImageMutation.isPending ? (
                        <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="w-3 h-3 mr-1" /> Submit for Review</>
                      )}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Marketplace Settings - Collapsible (only if in collection) */}
            {isInCollection && !isEditing && (
              <Collapsible open={showMarketplace} onOpenChange={setShowMarketplace}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-700 text-left">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-white">Marketplace Settings</span>
                    </div>
                    {showMarketplace ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 bg-gray-900 border border-t-0 border-gray-700 rounded-b-lg space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="condition" className="text-xs text-white">Condition</Label>
                        <select 
                          id="condition"
                          value={condition}
                          onChange={(e) => setCondition(e.target.value)}
                          className="w-full mt-1 px-2 py-2 text-sm border border-gray-600 rounded-md bg-white text-black"
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
                        <Label htmlFor="salePrice" className="text-xs text-white">Sale Price</Label>
                        <Input
                          id="salePrice"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={salePrice}
                          onChange={(e) => setSalePrice(e.target.value)}
                          className="mt-1 text-sm h-9 bg-white text-black border-gray-600"
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        id="forSale"
                        checked={isForSale}
                        onCheckedChange={setIsForSale}
                      />
                      <Label htmlFor="forSale" className="text-sm text-white">List for sale</Label>
                    </div>

                    <div>
                      <Label htmlFor="notes" className="text-xs text-white">Notes</Label>
                      <Textarea
                        id="notes"
                        placeholder="Personal notes about this card..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="mt-1 text-sm bg-white text-black border-gray-600"
                        rows={2}
                      />
                    </div>

                    <Button 
                      className="w-full bg-marvel-red hover:bg-red-700 text-sm h-10"
                      onClick={handleSaveMarketplaceSettings}
                      disabled={saveMarketplaceSettingsMutation.isPending}
                    >
                      {saveMarketplaceSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* Bottom padding for scroll */}
            <div className="h-4" />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
