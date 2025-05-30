import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { Star, Plus, Heart, Check } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CardWithSet, CollectionItem, InsertUserCollection, InsertUserWishlist, WishlistItem } from "@shared/schema";

interface TrendingCardProps {
  card: CardWithSet;
  isInCollection?: boolean;
  onClick?: () => void;
}

function TrendingCard({ card, isInCollection, onClick }: TrendingCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  // Generate mock price change for trending effect
  const priceChange = Math.floor(Math.random() * 20) + 5; // Random between 5-25%
  const currentValue = card.estimatedValue ? parseFloat(card.estimatedValue) : 10;

  return (
    <div 
      className="relative w-full aspect-[2.5/3.5] perspective-1000 cursor-pointer"
      onMouseEnter={() => setIsFlipped(true)}
      onMouseLeave={() => setIsFlipped(false)}
    >
      {/* Card Container with 3D flip */}
      <div className={`relative w-full h-full transition-transform duration-700 transform-style-preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front of Card */}
        <div className="absolute inset-0 w-full h-full backface-hidden bg-gradient-to-br from-gray-900 to-black rounded-lg overflow-hidden shadow-lg">
          {card.frontImageUrl ? (
            <img 
              src={card.frontImageUrl} 
              alt={card.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              <span className="text-gray-400 text-sm">No Image</span>
            </div>
          )}
          
          {/* Front overlay with card name */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4">
            <h3 className="text-white font-bold text-lg tracking-wide font-bebas">
              {card.name}
            </h3>
          </div>

          {/* Insert badge */}
          {card.isInsert && (
            <div className="absolute top-2 right-2 bg-yellow-500 rounded-full p-1 shadow-lg">
              <Star className="w-3 h-3 text-white fill-white" />
            </div>
          )}
          
          {/* Collection status badge */}
          {isInCollection && (
            <div className="absolute top-2 left-2 bg-green-500 rounded-full p-1 shadow-lg">
              <Check className="w-3 h-3 text-white" />
            </div>
          )}
        </div>

        {/* Back of Card - Details */}
        <div className="absolute inset-0 w-full h-full backface-hidden rotate-y-180 bg-gradient-to-br from-gray-900 to-black rounded-lg p-2 md:p-4 flex flex-col justify-between text-white shadow-lg">
          <div>
            <h3 className="font-bold text-sm md:text-xl mb-1 md:mb-2 font-bebas tracking-wide text-center leading-tight">
              {card.name}
            </h3>
            
            <div className="space-y-1 md:space-y-3 text-xs md:text-sm">
              <div>
                <span className="text-gray-300">Rarity:</span>
                <span className="ml-1 md:ml-2 font-medium">{card.rarity}</span>
              </div>
              
              <div>
                <span className="text-gray-300">Value:</span>
                <span className="ml-1 md:ml-2 font-bold text-green-400">
                  ${currentValue.toFixed(2)}
                </span>
              </div>
              
              <div>
                <span className="text-gray-300">Change:</span>
                <span className="ml-1 md:ml-2 font-bold text-green-400">
                  +{priceChange}%
                </span>
              </div>

              <div>
                <span className="text-gray-300">Set:</span>
                <span className="ml-1 md:ml-2 text-xs">{card.set.name}</span>
              </div>

              <div>
                <span className="text-gray-300">Card #:</span>
                <span className="ml-1 md:ml-2">{card.cardNumber}</span>
              </div>
            </div>
          </div>

          {/* Click to view details hint */}
          <div className="text-center mt-2 md:mt-4">
            <span className="text-xs text-gray-400">Tap for details</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrendingCards() {
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { toast } = useToast();

  const { data: trendingCards, isLoading } = useQuery<CardWithSet[]>({
    queryKey: ["/api/trending-cards"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const { data: wishlist } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
  });

  // Helper function to check if a card is in the collection
  const isCardInCollection = (cardId: number) => {
    return collection?.some(item => item.cardId === cardId) || false;
  };

  // Helper function to check if a card is in the wishlist
  const isCardInWishlist = (cardId: number) => {
    return wishlist?.some(item => item.cardId === cardId) || false;
  };

  // Handle card click to open modal
  const handleCardClick = (card: CardWithSet) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  // Add to collection mutation
  const addToCollectionMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const insertData: InsertUserCollection = {
        userId: 1,
        cardId,
        condition: "Near Mint",
        quantity: 1,
        acquiredDate: new Date(),
        personalValue: "0",
        isForSale: false,
        isFavorite: false,
      };
      return apiRequest("/api/collection", {
        method: "POST",
        body: JSON.stringify(insertData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Added to Collection",
        description: "Card successfully added to your collection",
      });
    },
  });

  // Add to wishlist mutation
  const addToWishlistMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const insertData: InsertUserWishlist = {
        userId: 1,
        cardId,
        priority: 1,
        maxPrice: null,
        notes: null,
      };
      return apiRequest("/api/wishlist", {
        method: "POST",
        body: JSON.stringify(insertData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({
        title: "Added to Wishlist",
        description: "Card successfully added to your wishlist",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-bebas text-xl tracking-wide">TOP TRENDING CARDS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-[2.5/3.5] bg-gray-200 rounded-lg animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!trendingCards || trendingCards.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-bebas text-xl tracking-wide">TOP TRENDING CARDS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">No trending cards available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bebas text-xl tracking-wide">TOP TRENDING CARDS</CardTitle>
        <p className="text-sm text-muted-foreground">
          Most popular cards being added to collections
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {trendingCards.slice(0, 8).map((card) => (
            <TrendingCard
              key={card.id}
              card={card}
              isInCollection={isCardInCollection(card.id)}
              onClick={() => handleCardClick(card)}
            />
          ))}
        </div>
      </CardContent>
    </Card>

    {/* Card Detail Modal */}
    <CardDetailModal
      card={selectedCard}
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      isInCollection={selectedCard ? isCardInCollection(selectedCard.id) : false}
      isInWishlist={selectedCard ? isCardInWishlist(selectedCard.id) : false}
      onAddToCollection={() => {
        if (selectedCard) {
          addToCollectionMutation.mutate(selectedCard.id);
        }
      }}
      onAddToWishlist={() => {
        if (selectedCard) {
          addToWishlistMutation.mutate(selectedCard.id);
        }
      }}
    />
  </>
  );
}