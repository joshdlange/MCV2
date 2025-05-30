import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Plus } from "lucide-react";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import type { CardWithSet } from "@shared/schema";
import { CardFilters } from "@/types";

interface CardGridProps {
  filters?: CardFilters;
  showAddToCollection?: boolean;
  showAddToWishlist?: boolean;
}

export function CardGrid({ 
  filters = {}, 
  showAddToCollection = true, 
  showAddToWishlist = true 
}: CardGridProps) {
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const queryParams = new URLSearchParams();
  if (filters.setId) queryParams.set('setId', filters.setId.toString());
  if (filters.search) queryParams.set('search', filters.search);
  if (filters.rarity) queryParams.set('rarity', filters.rarity);
  if (filters.isInsert !== undefined) queryParams.set('isInsert', filters.isInsert.toString());

  const { data: cards, isLoading } = useQuery<CardWithSet[]>({
    queryKey: [`/api/cards?${queryParams.toString()}`],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {[...Array(10)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-0">
              <div className="w-full h-64 bg-gray-200 rounded-t-lg"></div>
              <div className="p-4 space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                <div className="flex justify-between">
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                  <div className="h-4 bg-gray-200 rounded w-12"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
            <span className="text-gray-400 text-2xl">📋</span>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No cards found</h3>
          <p className="text-gray-500">
            {Object.keys(filters).length > 0 
              ? "Try adjusting your filters to see more results." 
              : "No cards have been added yet."}
          </p>
        </div>
      </div>
    );
  }

  const handleAddToCollection = (cardId: number) => {
    console.log('Add to collection:', cardId);
  };

  const handleAddToWishlist = (cardId: number) => {
    console.log('Add to wishlist:', cardId);
  };

  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedCard(null);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {cards.map((card) => (
          <Card key={card.id} className="group comic-border card-hover cursor-pointer" onClick={() => handleCardClick(card)}>
            <CardContent className="p-0">
              <div className="relative">
                {card.frontImageUrl ? (
                  <img 
                    src={card.frontImageUrl} 
                    alt={card.name}
                    className="w-full h-64 object-cover rounded-t-lg"
                  />
                ) : (
                  <div className="w-full h-64 bg-gray-200 rounded-t-lg flex items-center justify-center">
                    <span className="text-gray-400">No Image</span>
                  </div>
                )}
              </div>
              
              <div className="p-4">
                <h3 className="font-medium text-gray-900 text-sm truncate">
                  {card.name} #{card.cardNumber}
                </h3>
                <p className="text-xs text-gray-500 mb-3">{card.set.name}</p>
                
                <div className="flex items-center justify-between mb-3">
                  {card.estimatedValue && (
                    <span className="text-sm font-semibold text-gray-900">
                      ${parseFloat(card.estimatedValue).toFixed(0)}
                    </span>
                  )}
                  {card.isInsert && (
                    <span className="text-xs text-yellow-600 bg-yellow-100 px-2 py-1 rounded">
                      ⭐ Insert
                    </span>
                  )}
                </div>

                {/* Action Buttons - Now properly positioned */}
                <div className="flex gap-2">
                  {showAddToCollection && (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCollection(card.id);
                      }}
                      className="flex-1 bg-marvel-red hover:bg-red-700 text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Collection
                    </Button>
                  )}
                  {showAddToWishlist && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToWishlist(card.id);
                      }}
                      className="flex-1 text-xs"
                    >
                      <Heart className="w-3 h-3 mr-1" />
                      Wishlist
                    </Button>
                  )}
                </div>
                
                {card.variation && (
                  <p className="text-xs text-gray-400 mt-2 truncate">
                    {card.variation}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onAddToCollection={() => selectedCard && handleAddToCollection(selectedCard.id)}
        onAddToWishlist={() => selectedCard && handleAddToWishlist(selectedCard.id)}
      />
    </>
  );
}
