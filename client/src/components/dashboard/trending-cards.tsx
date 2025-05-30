import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, Plus, Heart } from "lucide-react";
import type { CardWithSet } from "@shared/schema";

interface TrendingCardProps {
  card: CardWithSet;
  onAddToCollection?: () => void;
  onAddToWishlist?: () => void;
}

function TrendingCard({ card, onAddToCollection, onAddToWishlist }: TrendingCardProps) {
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
        </div>

        {/* Back of Card - Details */}
        <div className="absolute inset-0 w-full h-full backface-hidden rotate-y-180 bg-gradient-to-br from-gray-900 to-black rounded-lg p-4 flex flex-col justify-between text-white shadow-lg">
          <div>
            <h3 className="font-bold text-xl mb-2 font-bebas tracking-wide text-center">
              {card.name}
            </h3>
            
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-300">Rarity:</span>
                <span className="ml-2 font-medium">{card.rarity}</span>
              </div>
              
              <div>
                <span className="text-gray-300">Current Value:</span>
                <span className="ml-2 font-bold text-green-400">
                  ${currentValue.toFixed(2)}
                </span>
              </div>
              
              <div>
                <span className="text-gray-300">1-Month Change:</span>
                <span className="ml-2 font-bold text-green-400">
                  +{priceChange}%
                </span>
              </div>

              <div>
                <span className="text-gray-300">Set:</span>
                <span className="ml-2 text-xs">{card.set.name}</span>
              </div>

              <div>
                <span className="text-gray-300">Card #:</span>
                <span className="ml-2">{card.cardNumber}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            <Button 
              size="sm" 
              className="flex-1 bg-white text-black hover:bg-gray-200 text-xs font-medium"
              onClick={(e) => {
                e.stopPropagation();
                onAddToCollection?.();
              }}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1 border-red-500 text-red-500 hover:bg-red-500 hover:text-white text-xs font-medium"
              onClick={(e) => {
                e.stopPropagation();
                onAddToWishlist?.();
              }}
            >
              <Heart className="w-3 h-3 mr-1" />
              Wishlist
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrendingCards() {
  const { data: trendingCards, isLoading } = useQuery<CardWithSet[]>({
    queryKey: ["/api/trending-cards"],
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
              onAddToCollection={() => {
                // TODO: Implement add to collection
                console.log('Add to collection:', card.name);
              }}
              onAddToWishlist={() => {
                // TODO: Implement add to wishlist
                console.log('Add to wishlist:', card.name);
              }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}