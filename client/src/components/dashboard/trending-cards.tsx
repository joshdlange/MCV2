import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { Star, Plus, Heart, Check } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { convertGoogleDriveUrl } from "@/lib/utils";
import { useCardPricing } from "@/hooks/useCardPricing";
import type { CardWithSet, CollectionItem, InsertUserCollection, InsertUserWishlist, WishlistItem } from "@shared/schema";

interface TrendingCardProps {
  card: CardWithSet;
  isInCollection?: boolean;
  onClick?: () => void;
}

function TrendingCard({ card, isInCollection, onClick }: TrendingCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const { data: pricing } = useCardPricing(card.id, true);

  // Use eBay pricing first, then database pricing, then estimated value
  const ebayPrice = pricing?.avgPrice || 0;
  const databasePrice = card.estimatedValue ? parseFloat(card.estimatedValue) : 0;
  const currentValue = ebayPrice > 0 ? ebayPrice : databasePrice;
  const hasEbayPricing = Boolean(pricing && pricing.avgPrice && pricing.avgPrice > 0);
  const hasDatabasePricing = Boolean(!hasEbayPricing && databasePrice > 0);
  
  // Calculate mock price change for trending effect
  const priceChange = Math.floor(Math.random() * 20) + 5;

  return (
    <div 
      className="relative w-full aspect-[2.5/3.5] perspective-1000 cursor-pointer"
      onMouseEnter={() => setIsFlipped(true)}
      onMouseLeave={() => setIsFlipped(false)}
      onClick={onClick}
    >
      {/* Card Container with 3D flip */}
      <div className={`relative w-full h-full transition-transform duration-700 transform-style-preserve-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front of Card */}
        <div className="absolute inset-0 w-full h-full backface-hidden bg-gradient-to-br from-gray-900 to-black rounded-lg overflow-hidden shadow-lg">
          {card.frontImageUrl ? (
            <img 
              src={convertGoogleDriveUrl(card.frontImageUrl)} 
              alt={card.name}
              className="w-full h-full object-contain"
              onError={(e) => {
                e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzlkYTNhZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIEVycm9yPC90ZXh0Pjwvc3ZnPg==';
              }}
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
            <div className="absolute top-2 right-2 bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg">
              <span className="text-sm">💎</span>
            </div>
          )}
          
          {/* Collection status badge */}
          {isInCollection && (
            <div className="absolute top-2 left-2 bg-green-500 text-white rounded-full p-1 shadow-lg flex items-center justify-center">
              <Check className="w-3 h-3" />
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
                <span className="text-gray-300">Set:</span>
                <span className="ml-1 md:ml-2 text-xs">{card.set.name}</span>
              </div>

              <div>
                <span className="text-gray-300">Card #:</span>
                <span className="ml-1 md:ml-2">{card.cardNumber}</span>
              </div>
              
              <div className="text-center">
                <span className="text-gray-300 block text-xs mb-1">Market Value</span>
                <div>
                  {hasEbayPricing ? (
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-bold text-green-400 text-lg md:text-2xl">
                        ${currentValue.toFixed(2)}
                      </span>
                      <span className="text-xs text-blue-400">eBay</span>
                    </div>
                  ) : hasDatabasePricing ? (
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-bold text-green-400 text-lg md:text-2xl">
                        ${currentValue.toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400">DB</span>
                    </div>
                  ) : (
                    <span className="font-bold text-lg md:text-2xl text-gray-500">
                      No data
                    </span>
                  )}
                </div>
                {hasEbayPricing && pricing && pricing.salesCount > 0 && (
                  <span className="text-xs text-blue-300 block mt-1">
                    {pricing.salesCount} recent sales
                  </span>
                )}
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
        personalValue: "0",
        isForSale: false,
        isFavorite: false,
      };
      return apiRequest("POST", "/api/collection", insertData);
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
      };
      return apiRequest("POST", "/api/wishlist", insertData);
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
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-bebas text-xl tracking-wide">TRENDING CARDS</CardTitle>
          <p className="text-sm text-muted-foreground">
            The most popular cards right now - Do you have these yet?
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