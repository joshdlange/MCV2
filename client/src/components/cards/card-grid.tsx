import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Plus, Check, Star } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardPricing } from "@/components/cards/card-pricing";
import { convertGoogleDriveUrl } from "@/lib/utils";
import type { CardWithSet } from "@/types/schema";
import SimpleImage from "@/components/ui/simple-image";

interface CardGridProps {
  cards: CardWithSet[];
  onCardClick: (card: CardWithSet) => void;
  isInCollection: (cardId: number) => boolean;
  isInWishlist: (cardId: number) => boolean;
  onAddToCollection: (cardId: number) => void;
  onRemoveFromCollection: (cardId: number) => void;
  onAddToWishlist: (cardId: number) => void;
  onRemoveFromWishlist: (cardId: number) => void;
  viewMode: "grid" | "list";
}

export function CardGrid({ 
  cards,
  onCardClick,
  isInCollection,
  isInWishlist,
  onAddToCollection,
  onRemoveFromCollection,
  onAddToWishlist,
  onRemoveFromWishlist,
  viewMode = "grid"
}: CardGridProps) {
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Safety check - ensure cards is an array
  if (!Array.isArray(cards)) {
    console.error('CardGrid received non-array cards:', cards);
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No cards available</p>
      </div>
    );
  }

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const handleAddToCollection = (cardId: number) => {
    if (isInCollection(cardId)) {
      onRemoveFromCollection(cardId);
    } else {
      onAddToCollection(cardId);
    }
  };

  const handleAddToWishlist = (cardId: number) => {
    if (isInWishlist(cardId)) {
      onRemoveFromWishlist(cardId);
    } else {
      onAddToWishlist(cardId);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCard(null);
  };

  if (!cards || cards.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No cards found matching your criteria.</p>
      </div>
    );
  }

  return (
    <>
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {cards.map((card) => (
            <Card key={card.id} className="group comic-border card-hover cursor-pointer" onClick={() => handleCardClick(card)}>
              <CardContent className="p-0">
                <div className="relative">
                  <div className="w-full aspect-[5/7] bg-gray-200 rounded-t-lg overflow-hidden">
                    <SimpleImage
                      src={card.frontImageUrl || ''}
                      alt={card.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  
                  {/* Status indicators */}
                  <div className="absolute top-2 right-2 flex flex-col gap-1">
                    {isInCollection(card.id) && (
                      <div className="bg-green-500 text-white rounded-full p-1">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                    {isInWishlist(card.id) && (
                      <div className="bg-red-500 text-white rounded-full p-1">
                        <Heart className="w-3 h-3 fill-current" />
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={isInCollection(card.id) ? "secondary" : "default"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCollection(card.id);
                        }}
                        className="h-8 w-8 p-0"
                      >
                        {isInCollection(card.id) ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant={isInWishlist(card.id) ? "secondary" : "outline"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToWishlist(card.id);
                        }}
                        className="h-8 w-8 p-0"
                      >
                        <Heart className={`w-4 h-4 ${isInWishlist(card.id) ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </div>
                
                <div className="p-2">
                  <h3 className="font-semibold text-xs truncate mb-1">{card.name}</h3>
                  <p className="text-xs text-gray-600 truncate">{card.set.name}</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs text-gray-500">#{card.cardNumber}</span>
                    <CardPricing cardId={card.id} className="text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => (
            <Card key={card.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleCardClick(card)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-20 bg-gray-200 rounded overflow-hidden flex-shrink-0">
                    <SimpleImage
                      src={card.frontImageUrl || ''}
                      alt={card.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{card.name}</h3>
                    <p className="text-sm text-gray-600 truncate">{card.set.name}</p>
                    <p className="text-sm text-gray-500">#{card.cardNumber}</p>
                    {card.variation && (
                      <p className="text-xs text-gray-500 italic">{card.variation}</p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <CardPricing cardId={card.id} />
                    
                    <div className="flex gap-1">
                      {isInCollection(card.id) && (
                        <div className="bg-green-500 text-white rounded-full p-1">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                      {isInWishlist(card.id) && (
                        <div className="bg-red-500 text-white rounded-full p-1">
                          <Heart className="w-4 h-4 fill-current" />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={isInCollection(card.id) ? "secondary" : "default"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCollection(card.id);
                        }}
                      >
                        {isInCollection(card.id) ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant={isInWishlist(card.id) ? "secondary" : "outline"}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToWishlist(card.id);
                        }}
                      >
                        <Heart className={`w-4 h-4 ${isInWishlist(card.id) ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onAddToCollection={() => {
            onCardClick(selectedCard);
            handleCloseModal();
          }}
        />
      )}
    </>
  );
}