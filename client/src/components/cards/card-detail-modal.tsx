import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Check, Heart, Star, RotateCcw } from "lucide-react";
import type { CardWithSet } from "@shared/schema";

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

  if (!card) return null;

  const cardAspectRatio = "aspect-[2.5/3.5]"; // Trading card proportions

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bebas tracking-wide">
            {card.name} #{card.cardNumber}
          </DialogTitle>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card Image */}
          <div className="space-y-4">
            <div className="relative">
              <div className={`${cardAspectRatio} w-full max-w-sm mx-auto relative overflow-hidden rounded-lg shadow-lg`}>
                <img
                  src={showBack ? card.backImageUrl : card.frontImageUrl}
                  alt={showBack ? `${card.name} back` : card.name}
                  className="w-full h-full object-cover"
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
                    <div className="bg-yellow-500 rounded-full p-1 shadow-lg">
                      <Star className="w-4 h-4 text-white fill-white" />
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
                  className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-white/90 hover:bg-white"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {showBack ? "Front" : "Back"}
                </Button>
              )}
            </div>
          </div>

          {/* Card Details */}
          <div className="space-y-6">
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

            <div>
              <Label className="text-sm font-medium">Estimated Value</Label>
              <p className="text-lg font-semibold text-green-600">
                ${card.estimatedValue ? parseFloat(card.estimatedValue).toFixed(2) : "N/A"}
              </p>
            </div>

            {/* Collection Actions */}
            <div className="flex gap-2">
              {isInCollection ? (
                <Button 
                  variant="outline" 
                  onClick={onRemoveFromCollection}
                  className="flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
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