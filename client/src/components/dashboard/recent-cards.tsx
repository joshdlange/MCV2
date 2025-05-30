import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CollectionItem } from "@shared/schema";

export function RecentCards() {
  const { data: recentCards, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ["/api/recent-cards"],
  });

  if (isLoading) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-gray-50 rounded-lg overflow-hidden animate-pulse">
                <div className="w-full h-40 bg-gray-200"></div>
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="flex justify-between">
                    <div className="h-6 bg-gray-200 rounded w-16"></div>
                    <div className="h-4 bg-gray-200 rounded w-12"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!recentCards || recentCards.length === 0) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
            <Button variant="ghost" className="text-marvel-red hover:text-red-700">
              View All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">No cards in your collection yet</p>
            <Button className="mt-4 bg-marvel-red hover:bg-red-700">
              Add Your First Card
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity.toLowerCase()) {
      case 'common': return 'bg-blue-600';
      case 'uncommon': return 'bg-green-600';
      case 'rare': return 'bg-marvel-red';
      case 'epic': return 'bg-purple-600';
      case 'legendary': return 'bg-orange-600';
      case 'insert': return 'bg-marvel-gold';
      default: return 'bg-gray-600';
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-bebas text-lg tracking-wide">RECENT ADDITIONS</CardTitle>
          <Button variant="ghost" className="text-marvel-red hover:text-red-700">
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recentCards.map((item) => (
            <div 
              key={item.id} 
              className="bg-gray-50 rounded-lg overflow-hidden comic-border card-hover cursor-pointer"
            >
              {item.card.imageUrl ? (
                <img 
                  src={item.card.imageUrl} 
                  alt={item.card.name}
                  className="w-full h-40 object-cover"
                />
              ) : (
                <div className="w-full h-40 bg-gray-200 flex items-center justify-center">
                  <span className="text-gray-400">No Image</span>
                </div>
              )}
              <div className="p-3">
                <p className="font-medium text-gray-900 text-sm truncate">
                  {item.card.name} #{item.card.cardNumber}
                </p>
                <p className="text-xs text-gray-500">{item.card.set.name}</p>
                <div className="flex items-center justify-between mt-2">
                  <Badge 
                    className={`text-xs text-white px-2 py-1 ${
                      item.card.isInsert ? 'bg-marvel-gold' : getRarityColor(item.card.rarity)
                    }`}
                  >
                    {item.card.isInsert ? 'Insert' : item.card.rarity}
                  </Badge>
                  {item.card.estimatedValue && (
                    <span className="text-sm font-semibold text-gray-900">
                      ${parseFloat(item.card.estimatedValue).toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
