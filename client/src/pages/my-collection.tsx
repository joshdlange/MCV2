import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2, Edit, Plus } from "lucide-react";
import type { CollectionItem } from "@shared/schema";

export default function MyCollection() {
  const { data: collection, isLoading } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[...Array(8)].map((_, i) => (
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

  const handleRemoveFromCollection = (itemId: number) => {
    console.log('Remove from collection:', itemId);
  };

  const handleEditItem = (itemId: number) => {
    console.log('Edit collection item:', itemId);
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MY COLLECTION</h2>
            <p className="text-sm text-gray-600 font-roboto">
              {collection?.length || 0} cards in your collection
            </p>
          </div>
          <Button className="bg-marvel-red text-white hover:bg-red-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Cards
          </Button>
        </div>
      </div>

      {/* Collection Grid */}
      <div className="p-6">
        {!collection || collection.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-gray-400 text-2xl">📚</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Your collection is empty</h3>
              <p className="text-gray-500 mb-6">
                Start building your Marvel card collection by adding your first card.
              </p>
              <Button className="bg-marvel-red hover:bg-red-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {collection.map((item) => (
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
                    
                    {/* Overlay buttons */}
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rounded-t-lg">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditItem(item.id)}
                        className="bg-white hover:bg-gray-100"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemoveFromCollection(item.id)}
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
                      
                      <div className="text-xs text-gray-500">
                        <p>Condition: {item.condition}</p>
                        {item.personalValue && (
                          <p>Personal Value: ${parseFloat(item.personalValue).toFixed(0)}</p>
                        )}
                      </div>
                    </div>
                    
                    {item.notes && (
                      <p className="text-xs text-gray-400 mt-2 truncate">
                        {item.notes}
                      </p>
                    )}
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
