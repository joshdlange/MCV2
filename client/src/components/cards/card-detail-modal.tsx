import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Check, Heart, Star, RotateCcw, Edit, Trash2, Save, X, RefreshCw, ExternalLink, Image, Upload, Camera, ChevronDown, ChevronUp, Settings, MoreVertical, ShoppingCart, TrendingUp } from "lucide-react";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { buildInputFromCard, openEbaySearch } from "@/lib/ebayAffiliate";
import { useAppStore } from "@/lib/store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import { getCardAuraTier, type AuraTier } from "@/lib/cardAura";
import type { CardWithSet } from "@shared/schema";
import { useCardPricing, useRefreshCardPricing } from "@/hooks/useCardPricing";
import { auth } from "@/lib/firebase";
import noCardImagePlaceholder from "@assets/image_1784478496002.png";
import { formatCardName, formatSetName } from "@/lib/formatTitle";

interface CardDetailModalProps {
  card: CardWithSet | null;
  isOpen: boolean;
  onClose: () => void;
  isInCollection?: boolean;
  isInWishlist?: boolean;
  collectionItemId?: number;
  collectionQuantity?: number;
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
  collectionQuantity,
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
  const [isImageEditing, setIsImageEditing] = useState(false);
  const [editedCard, setEditedCard] = useState<Partial<CardWithSet>>({});
  const [editedImageUrls, setEditedImageUrls] = useState({ frontImageUrl: "", backImageUrl: "" });
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [backImageFile, setBackImageFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [showPricing, setShowPricing] = useState(true);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showAdminTools, setShowAdminTools] = useState(false);
  
  const { isAdminMode, currentUser } = useAppStore();
  const isFullAdmin = Boolean(currentUser?.isAdmin && isAdminMode);
  const canEditCardImages = Boolean(currentUser?.imageAdmin || isFullAdmin);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showQuantityControls, setShowQuantityControls] = useState(false);
  useEffect(() => { setShowQuantityControls(false); }, [card?.id, isOpen]);
  useEffect(() => {
    setIsImageEditing(false);
    setEditedImageUrls({
      frontImageUrl: card?.frontImageUrl || "",
      backImageUrl: card?.backImageUrl || "",
    });
  }, [card?.id, isOpen]);

  // Self-sufficient ownership lookup: shares the app-wide collection cache so
  // every entry point (browse, binders, search, …) gets quantity for free.
  // Props remain as an override for pages that already resolved the item.
  const { data: ownCollection } = useQuery<any[]>({
    queryKey: ['/api/collection'],
    enabled: !!currentUser && isOpen,
  });
  const ownedItem = card
    ? ownCollection?.find((item: any) => (item.card?.id ?? item.cardId) === card.id)
    : undefined;
  const effectiveItemId = collectionItemId ?? ownedItem?.id;
  const effectiveQuantity = collectionQuantity ?? ownedItem?.quantity;
  const showAsOwned = isInCollection || !!ownedItem;
  
  // eBay pricing hooks - enable autoFetch to display cached pricing data
  const { data: pricing, isLoading: isPricingLoading } = useCardPricing(card?.id || 0, true);
  const refreshPricing = useRefreshCardPricing();

  // Owner quantity update (min 1; removal stays a separate action)
  const updateQuantityMutation = useMutation({
    mutationFn: async (quantity: number) => {
      if (!effectiveItemId) throw new Error('No collection item');
      return apiRequest('PATCH', `/api/collection/${effectiveItemId}`, { quantity });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/collection'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
    },
    onError: () => {
      toast({ title: "Failed to update quantity", variant: "destructive" });
    }
  });

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

  const updateCardImagesMutation = useMutation({
    mutationFn: async (updates: { frontImageUrl?: string; backImageUrl?: string }) => {
      if (!card) throw new Error('No card selected');
      const response = await apiRequest('PATCH', `/api/cards/${card.id}/images`, updates);
      return response.json();
    },
    onSuccess: (updatedCard: CardWithSet) => {
      queryClient.invalidateQueries({ queryKey: ['/api/cards'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cards/search'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/image-admins'] });
      onCardUpdate?.({ ...card!, ...updatedCard });
      setIsImageEditing(false);
      setShowAdminTools(false);
      toast({ title: "Card images saved to Cloudinary" });
    },
    onError: (error: Error) => {
      toast({
        title: "Image update failed",
        description: error.message,
        variant: "destructive",
      });
    },
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

  const startImageEditing = () => {
    setEditedImageUrls({
      frontImageUrl: card.frontImageUrl || "",
      backImageUrl: card.backImageUrl || "",
    });
    setIsImageEditing(true);
    setIsEditing(false);
  };

  const handleSaveImages = () => {
    const updates: { frontImageUrl?: string; backImageUrl?: string } = {};
    const front = editedImageUrls.frontImageUrl.trim();
    const back = editedImageUrls.backImageUrl.trim();
    if (front && front !== (card.frontImageUrl || "")) updates.frontImageUrl = front;
    if (back && back !== (card.backImageUrl || "")) updates.backImageUrl = back;
    if (!updates.frontImageUrl && !updates.backImageUrl) {
      toast({ title: "Paste a new front or back image URL", variant: "destructive" });
      return;
    }
    updateCardImagesMutation.mutate(updates);
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
            className="h-10 w-10 p-0 rounded-full bg-red-600 hover:bg-red-700 text-white"
            data-testid="button-close-modal"
          >
            <X className="h-6 w-6 text-white" />
          </Button>
          
          {/* Card Title - Centered */}
          <div className="flex-1 text-center px-2 min-w-0">
            <h2 className="text-base sm:text-lg font-bebas tracking-wide truncate text-white">
              {isEditing ? 'Edit Card' : isImageEditing ? 'Edit Card Images' : formatCardName(card.name)}
            </h2>
            <p className="text-xs text-gray-400">#{card.cardNumber}</p>
          </div>
          
          {/* Admin Tools Toggle or Empty Space */}
          {canEditCardImages && !isEditing && !isImageEditing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdminTools(!showAdminTools)}
              className="h-10 w-10 p-0 rounded-full bg-gray-700 hover:bg-gray-600 text-white"
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
            {canEditCardImages && showAdminTools && !isEditing && !isImageEditing && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 space-y-2 animate-in slide-in-from-top-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {isFullAdmin ? 'Admin Tools' : 'Image Admin Tools'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={startImageEditing}
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[110px] bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    data-testid="button-edit-card-images"
                  >
                    <Image className="w-4 h-4 mr-1" />
                    Edit Images
                  </Button>
                  {isFullAdmin && (
                    <>
                      <Button
                        onClick={() => updateImageMutation.mutate(card.id)}
                        disabled={updateImageMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="flex-1 min-w-[100px]"
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
                        Edit Details
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
                    </>
                  )}
                </div>
              </div>
            )}

            {isImageEditing && (
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">Edit Images</p>
                    <p className="text-xs text-gray-500">New URLs are copied to Cloudinary before this card changes.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveImages}
                      disabled={updateCardImagesMutation.isPending}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      {updateCardImagesMutation.isPending ? 'Uploading...' : 'Save'}
                    </Button>
                    <Button onClick={() => setIsImageEditing(false)} variant="outline" size="sm">
                      Cancel
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="imageAdminFrontUrl" className="text-xs text-gray-700 dark:text-gray-300">Front Image URL</Label>
                    <Input
                      id="imageAdminFrontUrl"
                      type="url"
                      value={editedImageUrls.frontImageUrl}
                      onChange={(e) => setEditedImageUrls((value) => ({ ...value, frontImageUrl: e.target.value }))}
                      placeholder="https://..."
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                    {editedImageUrls.frontImageUrl && (
                      <img src={editedImageUrls.frontImageUrl} alt="Front preview" className="mt-2 max-h-44 rounded border object-contain" />
                    )}
                  </div>
                  <div>
                    <Label htmlFor="imageAdminBackUrl" className="text-xs text-gray-700 dark:text-gray-300">Back Image URL</Label>
                    <Input
                      id="imageAdminBackUrl"
                      type="url"
                      value={editedImageUrls.backImageUrl}
                      onChange={(e) => setEditedImageUrls((value) => ({ ...value, backImageUrl: e.target.value }))}
                      placeholder="https://..."
                      className="bg-white text-gray-900 border-gray-300 mt-1"
                    />
                    {editedImageUrls.backImageUrl && (
                      <img src={editedImageUrls.backImageUrl} alt="Back preview" className="mt-2 max-h-44 rounded border object-contain" />
                    )}
                  </div>
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
            {!isEditing && !isImageEditing && (() => {
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
                        src={(showBack ? convertGoogleDriveUrl(card.backImageUrl || '') : convertGoogleDriveUrl(card.frontImageUrl || '')) || noCardImagePlaceholder}
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
                <p className="text-sm text-white font-medium">{formatSetName(card.set?.name || (card as any).setName) || 'Unknown Set'}</p>
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
                {showAsOwned ? (
                  <div className="relative">
                    <Button 
                      variant="outline" 
                      onClick={() => onRemoveFromCollection?.()}
                      data-testid="button-remove-from-collection"
                      className="h-12 w-full text-sm border-green-200 text-green-700 hover:bg-green-50"
                    >
                      <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mr-2">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      In Collection
                    </Button>
                    {effectiveItemId != null && effectiveQuantity != null && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowQuantityControls(v => !v); }}
                        className="absolute -top-2 -right-2 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-gray-100 border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-200"
                        title="Copies owned — tap to adjust"
                        data-testid="button-quantity-toggle"
                      >
                        ×{effectiveQuantity}
                      </button>
                    )}
                  </div>
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

            {/* Compact quantity stepper — revealed only via the ×N chip */}
            {!isEditing && showAsOwned && showQuantityControls && effectiveItemId != null && effectiveQuantity != null && (
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground" data-testid="quantity-editor">
                <span>Copies owned:</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={effectiveQuantity <= 1 || updateQuantityMutation.isPending}
                  onClick={() => updateQuantityMutation.mutate(effectiveQuantity - 1)}
                  data-testid="button-quantity-decrease"
                >
                  −
                </Button>
                <span className="w-5 text-center font-medium text-foreground" data-testid="text-quantity">{effectiveQuantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={updateQuantityMutation.isPending}
                  onClick={() => updateQuantityMutation.mutate(effectiveQuantity + 1)}
                  data-testid="button-quantity-increase"
                >
                  +
                </Button>
              </div>
            )}

            {/* Market Price - Collapsible */}
            {!isEditing && (
              <Collapsible open={showPricing} onOpenChange={setShowPricing}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-700 text-left">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-400" />
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
                          toast({ title: "Fetching pricing...", description: "This may take a moment" });
                          try {
                            const result = await refreshPricing(card.id);
                            await queryClient.invalidateQueries({ queryKey: ["/api/card-pricing", card.id] });
                            await queryClient.refetchQueries({ queryKey: ["/api/card-pricing", card.id] });
                            
                            if (result && result.avgPrice === -1) {
                              toast({ title: "Pricing rate limit reached", description: "Try again later.", variant: "destructive" });
                            } else if (result && result.avgPrice === 0 && result.salesCount === 0) {
                              toast({ title: "No recent sales found", description: "This card may not have recent sales data." });
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
                        <div className="text-sm text-red-400">Pricing unavailable (rate limit)</div>
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

            {/* Buy on eBay Button */}
            {!isEditing && (
              <button
                onClick={() => openEbaySearch(buildInputFromCard(card))}
                className="w-full py-2 px-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold text-sm shadow-lg rounded-md flex items-center justify-center gap-2"
                data-testid="button-buy-on-ebay"
              >
                <ShoppingCart className="w-4 h-4" />
                Buy on eBay
                <ExternalLink className="w-3 h-3 opacity-70" />
              </button>
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

            {/* Marketplace Settings - Collapsible (only if in collection and marketplace enabled) */}
            {FEATURE_FLAGS.MARKETPLACE_ENABLED && isInCollection && !isEditing && (
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
