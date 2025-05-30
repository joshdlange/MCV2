import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, ShoppingCart } from "lucide-react";
import type { WishlistItem } from "@shared/schema";

export default function Wishlist() {
  const { data: wishlist, isLoading } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">WISHLIST</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-0">
                  <div className="w-full h-64 bg-gray-200 rounded-t-lg"></div>
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleRemoveFromWishlist = (itemId: number) => {
    console.log('Remove from wishlist:', itemId);
  };

  const handleMoveToCollection = (item: WishlistItem) => {
    console.log('Move to collection:', item);
  };

  const getRarityColor = (rarity: string, isInsert: boolean) => {
    if (isInsert) return 'bg-marvel-gold';
    
    switch (rarity.toLowerCase()) {
      case 'common': return 'bg-blue-600';
      case 'uncommon': return 'bg-green-600';
      case 'rare': return 'bg-marvel-red';
      case 'epic': return 'bg-purple-600';
      case 'legendary': return 'bg-orange-600';
      default: return 'bg-gray-600';
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return 'bg-red-500';
      case 2: return 'bg-orange-500';
      case 3: return 'bg-yellow-500';
      case 4: return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1: return 'High';
      case 2: return 'Medium';
      case 3: return 'Low';
      case 4: return 'Someday';
      default: return 'Normal';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">WISHLIST</h2>
            <p className="text-sm text-gray-600 font-roboto">
              {wishlist?.length || 0} cards on your wishlist
            </p>
          </div>
          <Button className="bg-marvel-red text-white hover:bg-red-700">
            <Plus className="w-4 h-4 mr-2" />
            Add to Wishlist
          </Button>
        </div>
      </div>

      {/* Wishlist Grid */}
      <div className="p-6">
        {!wishlist || wishlist.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-gray-400 text-2xl">💝</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Your wishlist is empty</h3>
              <p className="text-gray-500 mb-6">
                Add cards you want to acquire to keep track of your collecting goals.
              </p>
              <Button className="bg-marvel-red hover:bg-red-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {wishlist.map((item) => (
              <Card key={item.id} className="group comic-border card-hover">
                <CardContent className="p-0">
                  <div className="relative">
                    {item.card.imageUrl ? (
                      <img 
                        src={item.card.imageUrl} 
                        alt={item.card.name}
                        className="w-full h-64 object-cover rounded-t-lg"
                      />
                    ) : (
                      <div className="w-full h-64 bg-gray-200 rounded-t-lg flex items-center justify-center">
                        <span className="text-gray-400">No Image</span>
                      </div>
                    )}
                    
                    {/* Priority badge */}
                    <div className="absolute top-2 left-2">
                      <Badge className={`text-xs text-white ${getPriorityColor(item.priority)}`}>
                        {getPriorityLabel(item.priority)}
                      </Badge>
                    </div>
                    
                    {/* Overlay buttons */}
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-t-lg">
                      <Button
                        size="sm"
                        onClick={() => handleMoveToCollection(item)}
                        className="bg-marvel-red hover:bg-red-700"
                      >
                        <ShoppingCart className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemoveFromWishlist(item.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <h3 className="font-medium text-gray-900 text-sm truncate">
                      {item.card.name} #{item.card.cardNumber}
                    </h3>
                    <p className="text-xs text-gray-500 mb-2">{item.card.set.name}</p>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge 
                          className={`text-xs text-white px-2 py-1 ${getRarityColor(item.card.rarity, item.card.isInsert)}`}
                        >
                          {item.card.isInsert ? 'Insert' : item.card.rarity}
                        </Badge>
                        {item.card.estimatedValue && (
                          <span className="text-sm font-semibold text-gray-900">
                            ${parseFloat(item.card.estimatedValue).toFixed(0)}
                          </span>
                        )}
                      </div>
                      
                      {item.maxPrice && (
                        <div className="text-xs text-gray-500">
                          <p>Max Price: ${parseFloat(item.maxPrice).toFixed(0)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
