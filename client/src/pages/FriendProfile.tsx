import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Users, Award, Star, Eye, EyeOff, MapPin, Globe, Calendar, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

interface FriendProfileData {
  user: {
    id: number;
    username: string;
    displayName: string;
    photoURL?: string;
    bio?: string;
    location?: string;
    website?: string;
    createdAt: string;
    profileVisibility: string;
    showCollection: boolean;
    showWishlist: boolean;
  };
  stats: {
    totalCards: number;
    totalValue: number;
    wishlistItems: number;
    friendsCount: number;
    badgesCount: number;
    completedSets: number;
    loginStreak: number;
  };
  canViewCollection: boolean;
  canViewWishlist: boolean;
}

interface CollectionItem {
  id: number;
  cardId: number;
  condition: string;
  acquiredDate: string;
  pricePaid?: number;
  cardName: string;
  cardNumber: string;
  setName: string;
  rarity: string;
  frontImageUrl?: string;
  estimatedValue?: number;
}

export default function FriendProfile() {
  const { friendId } = useParams<{ friendId: string }>();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("profile");
  const { user } = useAuth();

  // Helper function to get auth headers
  const getAuthHeaders = async () => {
    if (!user) return {};
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  // Fetch friend profile data
  const { data: friendProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["social/friends", friendId, "profile"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${friendId}/profile`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend profile");
      return response.json();
    },
    enabled: !!user && !!friendId,
  });

  // Fetch friend collection
  const { data: friendCollection = [], isLoading: collectionLoading } = useQuery({
    queryKey: ["social/friends", friendId, "collection"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${friendId}/collection`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend collection");
      return response.json();
    },
    enabled: !!user && !!friendId && friendProfile?.canViewCollection,
  });

  // Fetch friend wishlist
  const { data: friendWishlist = [], isLoading: wishlistLoading } = useQuery({
    queryKey: ["social/friends", friendId, "wishlist"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${friendId}/wishlist`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend wishlist");
      return response.json();
    },
    enabled: !!user && !!friendId && friendProfile?.canViewWishlist,
  });

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded mb-4"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="h-64 bg-gray-300 rounded"></div>
              <div className="col-span-2 h-64 bg-gray-300 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!friendProfile) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Friend Not Found</h1>
          <p className="text-gray-600 mb-6">Unable to load friend profile.</p>
          <Button onClick={() => setLocation("/social")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Social Hub
          </Button>
        </div>
      </div>
    );
  }

  const friend = friendProfile.user;
  const stats = friendProfile.stats;

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" onClick={() => setLocation("/social")} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Social Hub
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">Friend Profile</h1>
        </div>

        {/* Profile Header */}
        <Card className="mb-6 border-2 border-blue-500 bg-gradient-to-br from-white to-blue-50">
          <CardContent className="p-6">
            <div className="flex items-center space-x-6">
              <Avatar className="w-24 h-24 border-4 border-blue-500">
                <AvatarImage src={friend.photoURL} />
                <AvatarFallback className="bg-blue-500 text-white text-2xl font-bold">
                  {friend.displayName?.charAt(0) || friend.username.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-900">{friend.displayName || friend.username}</h2>
                <p className="text-gray-600 mb-2">@{friend.username}</p>
                {friend.bio && (
                  <p className="text-gray-700 mb-3">{friend.bio}</p>
                )}
                <div className="flex items-center space-x-4 text-sm text-gray-600">
                  {friend.location && (
                    <div className="flex items-center">
                      <MapPin className="w-4 h-4 mr-1" />
                      {friend.location}
                    </div>
                  )}
                  {friend.website && (
                    <div className="flex items-center">
                      <Globe className="w-4 h-4 mr-1" />
                      <a href={friend.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {friend.website}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-1" />
                    Joined {new Date(friend.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="border-2 border-green-500 bg-gradient-to-br from-white to-green-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.totalCards.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Cards Collected</div>
            </CardContent>
          </Card>
          <Card className="border-2 border-purple-500 bg-gradient-to-br from-white to-purple-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">${stats.totalValue.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Collection Value</div>
            </CardContent>
          </Card>
          <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.friendsCount}</div>
              <div className="text-sm text-gray-600">Friends</div>
            </CardContent>
          </Card>
          <Card className="border-2 border-red-500 bg-gradient-to-br from-white to-red-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.badgesCount}</div>
              <div className="text-sm text-gray-600">Super Powers</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="collection" disabled={!friendProfile.canViewCollection}>
              Collection {!friendProfile.canViewCollection && <EyeOff className="w-4 h-4 ml-1" />}
            </TabsTrigger>
            <TabsTrigger value="wishlist" disabled={!friendProfile.canViewWishlist}>
              Wishlist {!friendProfile.canViewWishlist && <EyeOff className="w-4 h-4 ml-1" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <Card className="border-2 border-blue-500 bg-gradient-to-br from-white to-blue-50">
              <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                <CardTitle className="flex items-center">
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Collection Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Collection Stats</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Total Cards:</span>
                        <span className="font-bold">{stats.totalCards.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Collection Value:</span>
                        <span className="font-bold">${stats.totalValue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Completed Sets:</span>
                        <span className="font-bold">{stats.completedSets}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Wishlist Items:</span>
                        <span className="font-bold">{stats.wishlistItems}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Activity</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Login Streak:</span>
                        <span className="font-bold">{stats.loginStreak} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Friends:</span>
                        <span className="font-bold">{stats.friendsCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Super Powers:</span>
                        <span className="font-bold">{stats.badgesCount}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="collection" className="space-y-6">
            <Card className="border-2 border-green-500 bg-gradient-to-br from-white to-green-50">
              <CardHeader className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                <CardTitle className="flex items-center">
                  <Star className="w-5 h-5 mr-2" />
                  {friend.displayName || friend.username}'s Collection ({friendCollection.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {!friendProfile.canViewCollection ? (
                  <div className="text-center py-12">
                    <EyeOff className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">Collection Private</p>
                    <p className="text-gray-500">This user's collection is not visible to you.</p>
                  </div>
                ) : collectionLoading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto"></div>
                    <p className="text-gray-600 mt-2">Loading collection...</p>
                  </div>
                ) : friendCollection.length === 0 ? (
                  <div className="text-center py-12">
                    <Star className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Cards Yet</p>
                    <p className="text-gray-500">This collection is empty.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {friendCollection.slice(0, 12).map((item: CollectionItem) => (
                      <div key={item.id} className="bg-white rounded-lg border-2 border-gray-200 p-4 hover:shadow-lg transition-shadow">
                        <div className="flex items-center space-x-3">
                          <div className="w-16 h-20 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                            {item.frontImageUrl ? (
                              <img src={item.frontImageUrl} alt={item.cardName} className="w-full h-full object-cover rounded" />
                            ) : (
                              <span className="text-xs text-gray-500">No Image</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm text-gray-900 truncate">{item.cardName}</h4>
                            <p className="text-xs text-gray-600">#{item.cardNumber}</p>
                            <p className="text-xs text-gray-500 truncate">{item.setName}</p>
                            <div className="flex items-center justify-between mt-2">
                              <Badge variant="secondary" className="text-xs">
                                {item.rarity}
                              </Badge>
                              <span className="text-xs text-gray-500">{item.condition}</span>
                            </div>
                            {item.estimatedValue && (
                              <p className="text-xs text-green-600 font-semibold mt-1">
                                ${item.estimatedValue.toFixed(2)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wishlist" className="space-y-6">
            <Card className="border-2 border-purple-500 bg-gradient-to-br from-white to-purple-50">
              <CardHeader className="bg-gradient-to-r from-purple-500 to-purple-600 text-white">
                <CardTitle className="flex items-center">
                  <Award className="w-5 h-5 mr-2" />
                  {friend.displayName || friend.username}'s Wishlist ({friendWishlist.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {!friendProfile.canViewWishlist ? (
                  <div className="text-center py-12">
                    <EyeOff className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">Wishlist Private</p>
                    <p className="text-gray-500">This user's wishlist is not visible to you.</p>
                  </div>
                ) : wishlistLoading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                    <p className="text-gray-600 mt-2">Loading wishlist...</p>
                  </div>
                ) : friendWishlist.length === 0 ? (
                  <div className="text-center py-12">
                    <Award className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Wishlist Items</p>
                    <p className="text-gray-500">This wishlist is empty.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {friendWishlist.slice(0, 12).map((item: CollectionItem) => (
                      <div key={item.id} className="bg-white rounded-lg border-2 border-gray-200 p-4 hover:shadow-lg transition-shadow">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-16 bg-gray-200 rounded flex items-center justify-center">
                            {item.frontImageUrl ? (
                              <img src={item.frontImageUrl} alt={item.cardName} className="w-full h-full object-cover rounded" />
                            ) : (
                              <span className="text-xs text-gray-500">No Image</span>
                            )}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm text-gray-900">{item.cardName}</h4>
                            <p className="text-xs text-gray-600">#{item.cardNumber}</p>
                            <p className="text-xs text-gray-500">{item.setName}</p>
                            <Badge variant="secondary" className="text-xs mt-1">
                              {item.rarity}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}