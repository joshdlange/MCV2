import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Users, MessageCircle, Award, User, Lock, Clock, Check, X, Search, UserPlus, Plus, Grid, List } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { useAuth } from "@/contexts/AuthContext";
import { useAppStore } from "@/lib/store";

interface Friend {
  id: number;
  status: string;
  requester: {
    id: number;
    username: string;
    displayName: string;
    photoURL?: string;
  };
  recipient: {
    id: number;
    username: string;
    displayName: string;
    photoURL?: string;
  };
}

interface Message {
  id: number;
  senderId: number;
  recipientId: number;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender: {
    id: number;
    username: string;
    displayName: string;
    photoURL?: string;
  };
}

interface UserBadge {
  id: number;
  earnedAt: string;
  badge: {
    id: number;
    name: string;
    description: string;
    iconUrl?: string;
    category: string;
  };
}

interface ProfileStats {
  totalCards: number;
  totalValue: number;
  wishlistItems: number;
  friendsCount: number;
  badgesCount: number;
  completedSets: number;
  loginStreak: number;
}

interface SearchUser {
  id: number;
  username: string;
  displayName: string;
  photoURL?: string;
  email: string;
}

export default function Social() {
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState("friends");
  const [selectedFriendProfile, setSelectedFriendProfile] = useState<any>(null);
  const [viewingProfile, setViewingProfile] = useState(false);
  
  // Collection enhancement state
  const [collectionSearchQuery, setCollectionSearchQuery] = useState("");
  const [selectedCollectionSet, setSelectedCollectionSet] = useState("all");
  const [collectionViewMode, setCollectionViewMode] = useState<"grid" | "list">("grid");
  const [showCardDetail, setShowCardDetail] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentUser } = useAppStore();

  // Listen for custom tab switching events
  useEffect(() => {
    const handleSwitchToMessages = (event: CustomEvent) => {
      setActiveTab("messages");
      setSelectedFriendId(event.detail.friendId);
    };
    
    const handleSwitchToMessagesTab = () => {
      setActiveTab("messages");
    };
    
    window.addEventListener('switchToMessages', handleSwitchToMessages as EventListener);
    window.addEventListener('switchToMessagesTab', handleSwitchToMessagesTab as EventListener);
    return () => {
      window.removeEventListener('switchToMessages', handleSwitchToMessages as EventListener);
      window.removeEventListener('switchToMessagesTab', handleSwitchToMessagesTab as EventListener);
    };
  }, []);

  // Helper function to get auth headers
  const getAuthHeaders = async () => {
    if (!user) return {};
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  // Fetch friends
  const { data: friends = [], isLoading: friendsLoading } = useQuery({
    queryKey: ["social/friends"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/friends", { headers });
      if (!response.ok) throw new Error("Failed to fetch friends");
      const friendsData = await response.json();
      
      // Deduplicate friends by ID to avoid showing duplicates
      const uniqueFriends = new Map();
      const currentUserId = currentUser?.id;
      
      friendsData.forEach((friend: Friend) => {
        const friendUser = friend.requester.id === currentUserId 
          ? friend.recipient 
          : friend.requester;
        
        // Use friend ID as unique key
        if (!uniqueFriends.has(friendUser.id)) {
          uniqueFriends.set(friendUser.id, {
            ...friend,
            // Normalize to always show the friend (not current user)
            requester: friend.requester.id === currentUserId ? friend.requester : friend.recipient,
            recipient: friend.requester.id === currentUserId ? friend.recipient : friend.requester
          });
        }
      });
      
      return Array.from(uniqueFriends.values());
    },
    enabled: !!user,
  });

  // Fetch friend requests
  const { data: friendRequests = [] } = useQuery({
    queryKey: ["social/friend-requests"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/friend-requests", { headers });
      if (!response.ok) throw new Error("Failed to fetch friend requests");
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch pending invitations (outgoing requests)
  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ["social/pending-invitations"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/pending-invitations", { headers });
      if (!response.ok) throw new Error("Failed to fetch pending invitations");
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch user badges
  const { data: userBadges = [] } = useQuery({
    queryKey: ["social/user-badges"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/user-badges", { headers });
      if (!response.ok) throw new Error("Failed to fetch user badges");
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch friend profile data
  const { data: friendProfile, isLoading: friendProfileLoading } = useQuery({
    queryKey: ["social/friend-profile", selectedFriendProfile?.id],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${selectedFriendProfile.id}/profile`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend profile");
      return response.json();
    },
    enabled: !!user && !!selectedFriendProfile,
  });

  // Fetch friend collection
  const { data: friendCollection = [], isLoading: friendCollectionLoading } = useQuery({
    queryKey: ["social/friend-collection", selectedFriendProfile?.id],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${selectedFriendProfile.id}/collection`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend collection");
      return response.json();
    },
    enabled: !!user && !!selectedFriendProfile,
  });

  // Fetch friend badges
  const { data: friendBadges = [], isLoading: friendBadgesLoading } = useQuery({
    queryKey: ["social/friend-badges", selectedFriendProfile?.id],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friends/${selectedFriendProfile.id}/badges`, { headers });
      if (!response.ok) throw new Error("Failed to fetch friend badges");
      return response.json();
    },
    enabled: !!user && !!selectedFriendProfile,
  });

  // Fetch all badges to show locked ones
  const { data: allBadges = [] } = useQuery({
    queryKey: ["badges"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/badges", { headers });
      if (!response.ok) throw new Error("Failed to fetch badges");
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch messages for selected friend
  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ["social/messages", selectedFriendId],
    queryFn: async () => {
      if (!selectedFriendId) return [];
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/messages/${selectedFriendId}`, { headers });
      if (!response.ok) throw new Error("Failed to fetch messages");
      return response.json();
    },
    enabled: !!selectedFriendId && !!user,
  });

  // Respond to friend request
  const respondToFriendRequest = useMutation({
    mutationFn: async ({ friendId, status }: { friendId: number; status: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/friend-request/${friendId}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to respond to friend request");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social/friend-requests"] });
      queryClient.invalidateQueries({ queryKey: ["social/friends"] });
      queryClient.invalidateQueries({ queryKey: ["social/pending-invitations"] });
      toast({
        title: "Success",
        description: "Friend request responded to successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to respond to friend request",
        variant: "destructive",
      });
    },
  });

  // Send message
  const sendMessage = useMutation({
    mutationFn: async ({ recipientId, content }: { recipientId: number; content: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ recipientId, content }),
      });
      if (!response.ok) throw new Error("Failed to send message");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social/messages", selectedFriendId] });
      setNewMessage("");
      toast({
        title: "Success",
        description: "Message sent successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    },
  });

  // Check for new badges
  const checkBadges = useMutation({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/check-badges", {
        method: "POST",
        headers,
      });
      if (!response.ok) throw new Error("Failed to check badges");
      return response.json();
    },
    onSuccess: (data) => {
      if (data.newBadges.length > 0) {
        toast({
          title: "New Badges Earned!",
          description: `You earned ${data.newBadges.length} new badge(s)!`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["social/user-badges"] });
    },
  });

  // Send friend request
  const sendFriendRequest = useMutation({
    mutationFn: async ({ recipientId }: { recipientId: number }) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/friend-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ recipientId }),
      });
      if (!response.ok) throw new Error("Failed to send friend request");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social/friends"] });
      queryClient.invalidateQueries({ queryKey: ["social/pending-invitations"] });
      toast({
        title: "Success",
        description: "Friend request sent successfully",
      });
      setSearchResults([]);
      setSearchQuery("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send friend request",
        variant: "destructive",
      });
    },
  });

  // Search for users
  const searchUsers = async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/social/search-users?q=${encodeURIComponent(query)}`, { headers });
      if (!response.ok) throw new Error("Failed to search users");
      const users = await response.json();
      setSearchResults(users);
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    searchUsers(value);
  };

  const handleSendMessage = () => {
    if (selectedFriendId && newMessage.trim()) {
      sendMessage.mutate({ recipientId: selectedFriendId, content: newMessage.trim() });
    }
  };

  const getBadgeColor = (category: string) => {
    switch (category) {
      case "Collection":
        return "bg-blue-500 text-white";
      case "Social":
        return "bg-green-500 text-white";
      case "Achievement":
        return "bg-purple-500 text-white";
      case "Event":
        return "bg-yellow-500 text-black";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRarityStyle = (rarity: string) => {
    switch (rarity) {
      case "bronze":
        return "bg-gradient-to-br from-amber-600 to-amber-800 border-amber-500";
      case "silver":
        return "bg-gradient-to-br from-gray-400 to-gray-600 border-gray-400";
      case "gold":
        return "bg-gradient-to-br from-yellow-400 to-yellow-600 border-yellow-400";
      case "platinum":
        return "bg-gradient-to-br from-purple-400 to-purple-600 border-purple-400";
      default:
        return "bg-gradient-to-br from-gray-400 to-gray-600 border-gray-400";
    }
  };

  const getRarityGlow = (rarity: string) => {
    switch (rarity) {
      case "bronze":
        return "shadow-lg shadow-amber-500/50";
      case "silver":
        return "shadow-lg shadow-gray-400/50";
      case "gold":
        return "shadow-lg shadow-yellow-400/50";
      case "platinum":
        return "shadow-lg shadow-purple-400/50";
      default:
        return "shadow-lg shadow-gray-400/50";
    }
  };

  const getRarityEmoji = (rarity: string) => {
    switch (rarity) {
      case "bronze":
        return "🥉";
      case "silver":
        return "🥈";
      case "gold":
        return "🥇";
      case "platinum":
        return "💎";
      default:
        return "🏅";
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Comic-style header with Marvel theme */}
      <div className="text-center mb-8">
        <div className="relative inline-block">
          <h1 className="text-4xl font-black text-black font-bebas tracking-wider">
            SOCIAL HUB
          </h1>
          <div className="absolute -bottom-1 left-0 w-full h-1 bg-gradient-to-r from-marvel-red to-red-600 rounded-full"></div>
        </div>
        <p className="text-gray-600 mt-2">Connect with friends and show off your collection</p>
      </div>
      {/* Comic-style tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`grid w-full ${viewingProfile ? 'grid-cols-4' : 'grid-cols-3'} bg-transparent p-0 h-auto gap-1 mb-4`}>
          <TabsTrigger 
            value="friends" 
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-2 px-3 font-bold text-sm text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white hover:scale-105 transition-all duration-200"
          >
            <Users className="w-4 h-4 mr-1" />
            FRIENDS
            {friends.length > 0 && (
              <Badge className="ml-1 bg-blue-500 text-white text-xs px-1 py-0.5 rounded-full">
                {friends.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="messages"
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-2 px-3 font-bold text-sm text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white hover:scale-105 transition-all duration-200"
          >
            <MessageCircle className="w-4 h-4 mr-1" />
            MESSAGES
          </TabsTrigger>
          <TabsTrigger 
            value="badges"
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-2 px-3 font-bold text-sm text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white hover:scale-105 transition-all duration-200"
          >
            <Award className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">SUPER POWERS</span>
            <span className="sm:hidden">POWERS</span>
            {userBadges.length > 0 && (
              <Badge className="ml-1 bg-yellow-500 text-black text-xs px-1 py-0.5 rounded-full">
                {userBadges.length}
              </Badge>
            )}
          </TabsTrigger>
          {viewingProfile && (
            <TabsTrigger 
              value="profile"
              className="relative bg-white border-2 border-marvel-red rounded-t-lg py-2 px-3 font-bold text-sm text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white hover:scale-105 transition-all duration-200"
            >
              <User className="w-4 h-4 mr-1" />
              {selectedFriendProfile?.displayName || selectedFriendProfile?.username || 'PROFILE'}
              <span 
                className="ml-2 h-4 w-4 p-0 text-current hover:bg-white/20 cursor-pointer rounded inline-flex items-center justify-center" 
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingProfile(false);
                  setSelectedFriendProfile(null);
                  setActiveTab('friends');
                }}
              >
                <X className="w-3 h-3" />
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="friends" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Friends List with Find Heroes - Comic Panel Style */}
            <Card className="border-2 border-marvel-red bg-gradient-to-br from-white to-blue-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-marvel-red to-red-600 text-white p-3" style={{ backgroundColor: '#EF4444' }}>
                <CardTitle className="font-bebas text-lg tracking-wide flex items-center" style={{ color: 'white' }}>
                  <Users className="w-5 h-5 mr-2" style={{ color: 'white' }} />
                  <span style={{ color: 'white' }} className="text-[#151515]">MY HEROES ({friends.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {/* Find New Heroes Section */}
                <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                  <div className="flex items-center mb-2">
                    <UserPlus className="w-4 h-4 mr-2 text-green-600" />
                    <h3 className="font-semibold text-gray-800">Find New Heroes</h3>
                  </div>
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Search for heroes by name or email..."
                      value={searchQuery}
                      onChange={handleSearchChange}
                      className="flex-1 border-gray-300 focus:border-green-500 bg-white text-gray-900 placeholder-gray-500"
                    />
                    <Button
                      onClick={() => searchUsers(searchQuery)}
                      disabled={isSearching || !searchQuery.trim()}
                      className="bg-green-500 hover:bg-green-600 text-white"
                    >
                      <Search className="w-4 h-4 mr-1" />
                      Search
                    </Button>
                  </div>
                  
                  {isSearching && (
                    <div className="mt-3 text-center">
                      <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-green-500"></div>
                      <p className="text-sm text-gray-600 mt-2">Searching heroes...</p>
                    </div>
                  )}
                  
                  {searchResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {searchResults.map((searchUser: SearchUser) => (
                        <div
                          key={searchUser.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <div className="flex items-center space-x-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={searchUser.photoURL} />
                              <AvatarFallback className="bg-green-500 text-white font-bold">
                                {searchUser.displayName?.charAt(0) || searchUser.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-bold text-gray-900">{searchUser.displayName}</p>
                              <p className="text-sm text-gray-500">@{searchUser.username}</p>
                            </div>
                          </div>
                          <Button
                            onClick={() => sendFriendRequest.mutate({ recipientId: searchUser.id })}
                            disabled={sendFriendRequest.isPending}
                            className="bg-green-500 hover:bg-green-600 text-white"
                          >
                            <UserPlus className="w-4 h-4 mr-1" />
                            Add Friend
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Friends List */}
                {friendsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin w-8 h-8 border-4 border-marvel-red border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">Loading your team...</p>
                  </div>
                ) : friends.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <Users className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Heroes Yet!</p>
                    <p className="text-gray-500">Use the search above to find fellow Marvel fans</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {friends.map((friend: Friend) => {
                      // Get the friend user (not the current user)
                      const userEmail = user?.email;
                      const isRequesterCurrentUser = friend.requester.username === userEmail;
                      const friendUser = isRequesterCurrentUser 
                        ? friend.recipient : friend.requester;
                      return (
                        <div key={friend.id} className="bg-white rounded-lg border border-blue-200 p-3 shadow-sm hover:shadow-md transition-all duration-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <Avatar className="w-10 h-10 border-2 border-marvel-red">
                                <AvatarImage src={friendUser.photoURL} />
                                <AvatarFallback className="bg-marvel-red text-white font-bold text-sm">
                                  {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-bold text-gray-800 text-sm">{friendUser.displayName || friendUser.username}</p>
                                <p className="text-xs text-gray-600">@{friendUser.username}</p>
                                <div className="flex items-center mt-1">
                                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1"></div>
                                  <span className="text-xs text-green-600">Online</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex space-x-1">
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedFriendId(friendUser.id);
                                  // Create a custom event to switch tabs
                                  const tabEvent = new CustomEvent('switchToMessages', { detail: { friendId: friendUser.id } });
                                  window.dispatchEvent(tabEvent);
                                }}
                                className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-2 py-1.5 rounded text-xs sm:px-3"
                              >
                                <MessageCircle className="w-3 h-3 sm:mr-1" />
                                <span className="hidden sm:inline">Message</span>
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedFriendProfile(friendUser);
                                  setViewingProfile(true);
                                  setActiveTab('profile');
                                }}
                                className="bg-green-500 hover:bg-green-600 text-white font-bold px-2 py-1.5 rounded text-xs sm:px-3"
                              >
                                <User className="w-3 h-3 sm:mr-1" />
                                <span className="hidden sm:inline">View Profile</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending Invitations - Comic Panel Style */}
            <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black p-3">
                <CardTitle className="font-bebas text-lg tracking-wide flex items-center">
                  <Clock className="w-5 h-5 mr-2" />
                  PENDING INVITATIONS ({pendingInvitations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {pendingInvitations.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <Clock className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Pending Invitations</p>
                    <p className="text-gray-500">Send invitations to grow your team!</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {pendingInvitations.map((invitation: Friend) => (
                      <div key={invitation.id} className="bg-white rounded-lg border-2 border-yellow-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <Avatar className="w-12 h-12 border-2 border-yellow-500">
                              <AvatarImage src={invitation.recipient.photoURL} />
                              <AvatarFallback className="bg-yellow-500 text-black font-bold">
                                {invitation.recipient.displayName?.charAt(0) || invitation.recipient.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-bold text-gray-800">{invitation.recipient.displayName || invitation.recipient.username}</p>
                              <p className="text-sm text-gray-600">@{invitation.recipient.username}</p>
                              <p className="text-xs text-yellow-600 font-medium mt-1 flex items-center">
                                <Clock className="w-3 h-3 mr-1" />
                                Invitation pending
                              </p>
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                              Waiting for response
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Friend Requests - Comic Panel Style */}
            <Card className="border-2 border-green-500 bg-gradient-to-br from-white to-green-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-500 to-green-600 text-black p-3">
                <CardTitle className="font-bebas text-lg tracking-wide flex items-center">
                  <User className="w-5 h-5 mr-2" />
                  RECRUITMENT ({friendRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {friendRequests.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <User className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Pending Requests</p>
                    <p className="text-gray-500">All heroes have been recruited!</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {friendRequests.map((request: Friend) => (
                      <div key={request.id} className="bg-white rounded-lg border-2 border-green-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <Avatar className="w-12 h-12 border-2 border-green-500">
                              <AvatarImage src={request.requester.photoURL} />
                              <AvatarFallback className="bg-green-500 text-black font-bold">
                                {request.requester.displayName?.charAt(0) || request.requester.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-bold text-gray-800">{request.requester.displayName || request.requester.username}</p>
                              <p className="text-sm text-gray-600">@{request.requester.username}</p>
                              <p className="text-xs text-green-600 font-medium mt-1">Wants to join your team</p>
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "accepted" })}
                              disabled={respondToFriendRequest.isPending}
                              className="bg-green-500 hover:bg-green-600 text-white font-bold px-4 py-2 rounded-lg"
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "declined" })}
                              disabled={respondToFriendRequest.isPending}
                              className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg"
                            >
                              <X className="w-4 h-4 mr-1" />
                              Decline
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>



        <TabsContent value="messages" className="h-[80vh] bg-white">
          <div className="h-full flex rounded-lg overflow-hidden border border-gray-200 shadow-sm">
            {/* Left Column: Conversation List - iPhone Style */}
            <div className="w-2/5 border-r border-gray-200 bg-white flex flex-col">
              {/* Header */}
              <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 hidden md:block">Messages</h2>
                <h2 className="text-sm font-semibold text-gray-900 block md:hidden">Chats</h2>
                <Button 
                  size="sm" 
                  onClick={() => setActiveTab('friends')}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-1"
                >
                  <UserPlus className="w-3 h-3 mr-1 hidden md:block" />
                  <UserPlus className="w-4 h-4 block md:hidden" />
                  <span className="hidden md:block">New</span>
                </Button>
              </div>
              
              {/* Conversation List */}
              <div className="flex-1 overflow-y-auto">
                {friends.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <MessageCircle className="w-16 h-16 text-gray-300 mb-4" />
                    <p className="text-gray-500 text-sm">No conversations</p>
                    <p className="text-gray-400 text-xs">Add friends to start messaging</p>
                    <Button 
                      onClick={() => setActiveTab('friends')}
                      className="mt-4 bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-2"
                    >
                      Add Friends
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {friends.map((friend: Friend) => {
                      const userEmail = user?.email;
                      const isRequesterCurrentUser = friend.requester.username === userEmail;
                      const friendUser = isRequesterCurrentUser 
                        ? friend.recipient : friend.requester;
                      
                      // Get the last message with this friend
                      const lastMessage = messages.find(m => 
                        (m.senderId === currentUser?.id && m.recipientId === friendUser.id) ||
                        (m.senderId === friendUser.id && m.recipientId === currentUser?.id)
                      );
                      
                      return (
                        <div
                          key={friend.id}
                          onClick={() => setSelectedFriendId(friendUser.id)}
                          className={`cursor-pointer transition-colors duration-150 hover:bg-gray-50 ${
                            selectedFriendId === friendUser.id 
                              ? 'bg-blue-50 border-r-3 border-blue-500' 
                              : 'bg-white'
                          }`}
                        >
                          {/* Mobile Layout - Avatar focused */}
                          <div className="block md:hidden p-3">
                            <div className="flex flex-col items-center space-y-2">
                              <div className="relative">
                                <Avatar className="w-12 h-12">
                                  <AvatarImage src={friendUser.photoURL} />
                                  <AvatarFallback className="bg-gray-400 text-white font-medium text-sm">
                                    {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></div>
                              </div>
                              <p className="text-xs font-medium text-gray-900 truncate w-full text-center">
                                {friendUser.displayName?.split(' ')[0] || friendUser.username}
                              </p>
                            </div>
                          </div>

                          {/* Desktop Layout - Full info */}
                          <div className="hidden md:block p-5">
                            <div className="flex items-center space-x-4">
                              <div className="relative">
                                <Avatar className="w-14 h-14">
                                  <AvatarImage src={friendUser.photoURL} />
                                  <AvatarFallback className="bg-gray-400 text-white font-medium text-lg">
                                    {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white"></div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-semibold text-gray-900 truncate text-base">
                                    {friendUser.displayName || friendUser.username}
                                  </p>
                                  <span className="text-xs text-gray-400 flex-shrink-0">
                                    {lastMessage ? new Date(lastMessage.createdAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    }) : 'now'}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-500 truncate">
                                  {lastMessage ? 
                                    (lastMessage.senderId === currentUser?.id ? 'You: ' : '') + lastMessage.content
                                    : 'Tap to start chatting'
                                  }
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Current Conversation - iPhone Style */}
            <div className="flex-1 flex flex-col">
              {!selectedFriendId ? (
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                  <div className="text-center">
                    <MessageCircle className="w-20 h-20 text-gray-300 mx-auto mb-4" />
                    <p className="text-xl font-medium text-gray-600 mb-2">Select a conversation</p>
                    <p className="text-gray-500">Choose from your existing conversations</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Chat Header */}
                  <div className="p-4 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center space-x-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={friends.find(f => {
                          const userEmail = user?.email;
                          const isRequesterCurrentUser = f.requester.username === userEmail;
                          const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                          return friendUser.id === selectedFriendId;
                        })?.recipient?.photoURL || friends.find(f => {
                          const userEmail = user?.email;
                          const isRequesterCurrentUser = f.requester.username === userEmail;
                          const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                          return friendUser.id === selectedFriendId;
                        })?.requester?.photoURL} />
                        <AvatarFallback className="bg-gray-400 text-white font-medium">
                          {friends.find(f => {
                            const userEmail = user?.email;
                            const isRequesterCurrentUser = f.requester.username === userEmail;
                            const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                            return friendUser.id === selectedFriendId;
                          })?.recipient?.displayName?.charAt(0) || friends.find(f => {
                            const userEmail = user?.email;
                            const isRequesterCurrentUser = f.requester.username === userEmail;
                            const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                            return friendUser.id === selectedFriendId;
                          })?.requester?.displayName?.charAt(0) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-medium text-gray-900">
                          {friends.find(f => {
                            const userEmail = user?.email;
                            const isRequesterCurrentUser = f.requester.username === userEmail;
                            const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                            return friendUser.id === selectedFriendId;
                          })?.recipient?.displayName || friends.find(f => {
                            const userEmail = user?.email;
                            const isRequesterCurrentUser = f.requester.username === userEmail;
                            const friendUser = isRequesterCurrentUser ? f.recipient : f.requester;
                            return friendUser.id === selectedFriendId;
                          })?.requester?.displayName || 'Friend'}
                        </h3>
                        <p className="text-sm text-green-600">Active now</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-4 bg-white">
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <MessageCircle className="w-16 h-16 text-gray-300 mb-4" />
                        <p className="text-gray-500">No messages yet</p>
                        <p className="text-gray-400 text-sm">Say hello to start the conversation!</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((message: Message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-xs px-4 py-2 rounded-2xl ${
                                message.senderId === currentUser?.id
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-100 text-gray-900'
                              }`}
                            >
                              {(message as any).imageUrl ? (
                                <div className="space-y-2">
                                  <img 
                                    src={(message as any).imageUrl} 
                                    alt="Shared image" 
                                    className="rounded-lg max-w-full h-auto"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  <p className="text-sm leading-relaxed">{message.content}</p>
                                </div>
                              ) : (
                                <p className="text-sm leading-relaxed">{message.content}</p>
                              )}
                              <p className={`text-xs mt-1 ${
                                message.senderId === currentUser?.id ? 'text-blue-100' : 'text-gray-500'
                              }`}>
                                {new Date(message.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Message Input - Enhanced iPhone Style */}
                  <div className="p-4 bg-white border-t border-gray-200">
                    <div className="flex items-end space-x-3">
                      {/* Attachment Button */}
                      <Button
                        type="button"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file && selectedFriendId) {
                              try {
                                const formData = new FormData();
                                formData.append('image', file);
                                formData.append('recipientId', selectedFriendId.toString());

                                const response = await fetch('/api/social/messages/image', {
                                  method: 'POST',
                                  headers: {
                                    ...(await getAuthHeaders()),
                                  },
                                  body: formData,
                                });

                                if (response.ok) {
                                  const result = await response.json();
                                  // Refresh messages
                                  refetchMessages();
                                  toast({
                                    title: "Image sent!",
                                    description: "Your image has been shared successfully.",
                                  });
                                } else {
                                  throw new Error('Failed to send image');
                                }
                              } catch (error) {
                                console.error('Image upload error:', error);
                                toast({
                                  title: "Upload failed",
                                  description: "Could not send image. Please try again.",
                                  variant: "destructive",
                                });
                              }
                            }
                          };
                          input.click();
                        }}
                        className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 p-0 flex items-center justify-center flex-shrink-0"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </Button>
                      
                      {/* Message Input */}
                      <div className="flex-1 relative">
                        <Textarea
                          placeholder="Message..."
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          className="w-full px-5 py-3 border border-gray-300 rounded-full resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-500 text-base"
                          rows={1}
                          style={{ maxHeight: '120px' }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (newMessage.trim() && selectedFriendId) {
                                sendMessage.mutate({
                                  recipientId: selectedFriendId,
                                  content: newMessage.trim(),
                                });
                                setNewMessage("");
                              }
                            }
                          }}
                        />
                      </div>
                      
                      {/* Send Button */}
                      <Button
                        onClick={() => {
                          if (newMessage.trim() && selectedFriendId) {
                            sendMessage.mutate({
                              recipientId: selectedFriendId,
                              content: newMessage.trim(),
                            });
                            setNewMessage("");
                          }
                        }}
                        disabled={!newMessage.trim() || sendMessage.isPending}
                        className="w-12 h-12 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-0 flex items-center justify-center flex-shrink-0"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="badges" className="space-y-6">
          <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black">
              <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                <Award className="w-6 h-6 mr-2" />
                HERO SUPER POWERS ({userBadges.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {userBadges.length === 0 ? (
                <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <Award className="w-20 h-20 mx-auto mb-4 text-gray-400" />
                  <p className="text-2xl font-bold text-gray-600 mb-2">No Super Powers Yet!</p>
                  <p className="text-gray-500 mb-6">Start collecting cards and making friends to earn heroic super powers!</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Award className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                      <p className="text-sm font-bold text-gray-700">Collection Powers</p>
                      <p className="text-xs text-gray-500">Collect cards to unlock</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Users className="w-8 h-8 mx-auto mb-2 text-green-500" />
                      <p className="text-sm font-bold text-gray-700">Social Powers</p>
                      <p className="text-xs text-gray-500">Make friends to unlock</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                      <p className="text-sm font-bold text-gray-700">Activity Powers</p>
                      <p className="text-xs text-gray-500">Stay active to unlock</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                  {userBadges.map((userBadge: UserBadge) => (
                    <Card key={userBadge.id} className="text-center border-2 border-gray-200 bg-white shadow-md hover:shadow-xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1">
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex justify-center mb-4">
                          <div className={`w-16 h-16 sm:w-24 sm:h-24 rounded-full flex items-center justify-center border-4 transition-all duration-300 ${getRarityStyle(userBadge.badge.rarity || 'common')} ${getRarityGlow(userBadge.badge.rarity || 'common')}`}>
                            {userBadge.badge.iconUrl ? (
                              <img 
                                src={userBadge.badge.iconUrl} 
                                alt={userBadge.badge.name}
                                className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded-full"
                              />
                            ) : (
                              <div className="text-2xl">{getRarityEmoji(userBadge.badge.rarity || 'common')}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-center mb-2">
                          <h3 className="font-bebas text-sm sm:text-lg text-gray-800 tracking-wide">
                            {userBadge.badge.name?.toUpperCase() || 'UNKNOWN POWER'}
                          </h3>
                          <div className="ml-2 text-sm">{getRarityEmoji(userBadge.badge.rarity || 'common')}</div>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4 px-1 sm:px-2 line-clamp-2">{userBadge.badge.description || 'No description available'}</p>
                        <div className="flex justify-center space-x-2 mb-3">
                          <Badge className={`${getBadgeColor(userBadge.badge.category || 'achievement')} font-bold px-3 py-1 text-xs`}>
                            {userBadge.badge.category?.toUpperCase() || 'ACHIEVEMENT'}
                          </Badge>
                          <Badge className="bg-gray-200 text-gray-800 font-bold px-3 py-1 text-xs">
                            {userBadge.badge.rarity?.toUpperCase() || 'COMMON'}
                          </Badge>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500 font-medium">
                            🏆 EARNED {new Date(userBadge.earnedAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-yellow-600 font-bold mt-1">
                            +{userBadge.badge.points || 0} Points
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              {/* Locked Badges Preview */}
              {(() => {
                const earnedBadgeIds = userBadges.map((ub: UserBadge) => ub.badge.id);
                const lockedBadges = allBadges.filter((badge: any) => !earnedBadgeIds.includes(badge.id));
                
                return lockedBadges.length > 0 ? (
                  <div className="mt-8 pt-8 border-t border-gray-300">
                    <h3 className="font-bebas text-xl text-gray-700 mb-4 tracking-wide">
                      🔒 LOCKED SUPER POWERS
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                      {lockedBadges.map((badge: any) => (
                        <div key={badge.id} className="bg-gray-100 rounded-lg p-3 sm:p-4 text-center border-2 border-gray-200 opacity-60 hover:opacity-80 transition-opacity duration-200">
                          <div className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-2 sm:mb-3 rounded-full flex items-center justify-center bg-gray-300 border-2 border-gray-400`}>
                            {badge.iconUrl ? (
                              <img 
                                src={badge.iconUrl} 
                                alt={badge.name}
                                className="w-8 h-8 sm:w-12 sm:h-12 object-cover rounded-full opacity-50"
                              />
                            ) : (
                              <Lock className="w-6 h-6 sm:w-8 sm:h-8 text-gray-500" />
                            )}
                          </div>
                          <p className="font-bold text-gray-600 text-xs sm:text-sm mb-1">{badge.name}</p>
                          <div className="flex justify-center mb-2">
                            <Badge className="bg-gray-300 text-gray-600 text-xs px-2 py-1">
                              {badge.rarity.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-500">{badge.unlockHint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="space-y-6">
          {selectedFriendProfile && (
            <div className="space-y-6">
              <Card className="border-2 border-blue-500 bg-gradient-to-br from-white to-blue-50">
                <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                  <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                    <User className="w-6 h-6 mr-2" />
                    {selectedFriendProfile.displayName || selectedFriendProfile.username}'s Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row gap-6">
                    <div className="flex-shrink-0">
                      <Avatar className="w-24 h-24 border-4 border-blue-300">
                        <AvatarImage src={selectedFriendProfile.photoURL} alt={selectedFriendProfile.displayName} />
                        <AvatarFallback className="bg-blue-100 text-blue-800 text-xl font-bold">
                          {selectedFriendProfile.displayName?.charAt(0) || selectedFriendProfile.username?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-800 mb-1">
                        {selectedFriendProfile.displayName || selectedFriendProfile.username}
                      </h3>
                      <p className="text-gray-600 mb-4">@{selectedFriendProfile.username}</p>
                      {selectedFriendProfile.bio && (
                        <p className="text-gray-700 mb-4">{selectedFriendProfile.bio}</p>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
                          <div className="text-2xl font-bold text-green-600">
                            {friendProfile?.stats?.totalCards || 0}
                          </div>
                          <div className="text-sm text-green-800">Cards</div>
                        </div>
                        <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                          <div className="text-2xl font-bold text-purple-600">
                            ${friendProfile?.stats?.totalValue?.toFixed(2) || '0.00'}
                          </div>
                          <div className="text-sm text-purple-800">Value</div>
                        </div>
                        <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                          <div className="text-2xl font-bold text-orange-600">
                            {friendProfile?.stats?.wishlistItems || 0}
                          </div>
                          <div className="text-sm text-orange-800">Wishlist</div>
                        </div>
                        <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                          <div className="text-2xl font-bold text-yellow-600">
                            {friendProfile?.stats?.badgesCount || 0}
                          </div>
                          <div className="text-sm text-yellow-800">Badges</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50">
                <CardHeader className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black">
                  <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                    <Award className="w-6 h-6 mr-2" />
                    {selectedFriendProfile.displayName || selectedFriendProfile.username}'s Super Powers
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {friendBadgesLoading ? (
                    <div className="text-center py-16">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mx-auto"></div>
                      <p className="text-gray-600 mt-4">Loading badges...</p>
                    </div>
                  ) : friendBadges.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {friendBadges.map((userBadge: UserBadge) => (
                        <div key={userBadge.id} className="bg-white rounded-lg border-2 border-gray-200 p-4 text-center hover:shadow-md transition-shadow">
                          <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-red-400 to-red-600 rounded-full flex items-center justify-center">
                            {userBadge.badge.iconUrl ? (
                              <img 
                                src={userBadge.badge.iconUrl} 
                                alt={userBadge.badge.name}
                                className="w-12 h-12 object-contain"
                              />
                            ) : (
                              <Award className="w-8 h-8 text-white" />
                            )}
                          </div>
                          <h3 className="font-bold text-sm text-gray-800 mb-1">{userBadge.badge.name}</h3>
                          <p className="text-xs text-gray-600 mb-2">{userBadge.badge.description}</p>
                          <div className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getBadgeColor(userBadge.badge.category)}`}>
                            {userBadge.badge.category}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <Award className="w-20 h-20 mx-auto mb-4 text-gray-400" />
                      <p className="text-2xl font-bold text-gray-600 mb-2">No badges yet!</p>
                      <p className="text-gray-500">{selectedFriendProfile?.displayName || selectedFriendProfile?.username} hasn't earned any badges yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>



              <Card className="border-2 border-green-500 bg-gradient-to-br from-white to-green-50">
                <CardHeader className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                  <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                    <User className="w-6 h-6 mr-2" />
                    {selectedFriendProfile.displayName || selectedFriendProfile.username}'s Collection
                    {friendCollection.length > 0 && (
                      <span className="ml-2 text-sm opacity-90">
                        ({(() => {
                          const filteredCount = friendCollection.filter((item: any) => {
                            const matchesSearch = collectionSearchQuery === "" || 
                              item.card.name.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                              item.card.cardNumber.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                              item.card.cardSet?.name.toLowerCase().includes(collectionSearchQuery.toLowerCase());
                            
                            const matchesSet = selectedCollectionSet === "all" || item.card.cardSet?.name === selectedCollectionSet;
                            
                            return matchesSearch && matchesSet;
                          }).length;
                          return filteredCount !== friendCollection.length 
                            ? `${filteredCount} of ${friendCollection.length}`
                            : friendCollection.length;
                        })()})
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {friendCollectionLoading ? (
                    <div className="text-center py-16">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto"></div>
                      <p className="text-gray-600 mt-4">Loading collection...</p>
                    </div>
                  ) : friendCollection.length > 0 ? (
                    <>
                      {/* Search and Filter Controls */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                            <Input
                              placeholder="Search cards..."
                              value={collectionSearchQuery}
                              onChange={(e) => setCollectionSearchQuery(e.target.value)}
                              className="pl-10 w-64 bg-white text-gray-900 placeholder:text-gray-500"
                            />
                          </div>
                          
                          <Select value={selectedCollectionSet} onValueChange={setSelectedCollectionSet}>
                            <SelectTrigger className="w-48 bg-white text-gray-900">
                              <SelectValue placeholder="Filter by set" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Sets</SelectItem>
                              {(() => {
                                const uniqueSets = Array.from(new Set(friendCollection.map((item: any) => item.card.cardSet?.name)))
                                  .filter(Boolean)
                                  .sort()
                                  .map(setName => ({ value: setName, label: setName }));
                                return uniqueSets.map(set => (
                                  <SelectItem key={set.value} value={set.value}>
                                    {set.label}
                                  </SelectItem>
                                ));
                              })()}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                          <Button
                            variant={collectionViewMode === "grid" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setCollectionViewMode("grid")}
                            className={`rounded-none px-3 ${collectionViewMode === "grid" ? "text-white" : "text-green-600 hover:text-green-600"}`}
                          >
                            <Grid className="w-4 h-4 mr-1" />
                            Grid
                          </Button>
                          <Button
                            variant={collectionViewMode === "list" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setCollectionViewMode("list")}
                            className={`rounded-none px-3 ${collectionViewMode === "list" ? "text-white" : "text-green-600 hover:text-green-600"}`}
                          >
                            <List className="w-4 h-4 mr-1" />
                            List
                          </Button>
                        </div>
                      </div>

                      {/* Collection Display */}
                      {(() => {
                        const filteredCollection = friendCollection.filter((item: any) => {
                          const matchesSearch = collectionSearchQuery === "" || 
                            item.card.name.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                            item.card.cardNumber.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                            item.card.cardSet?.name.toLowerCase().includes(collectionSearchQuery.toLowerCase());
                          
                          const matchesSet = selectedCollectionSet === "all" || item.card.cardSet?.name === selectedCollectionSet;
                          
                          return matchesSearch && matchesSet;
                        });

                        const handleCardClick = (item: any) => {
                          const cardWithSet = {
                            id: item.card.id,
                            setId: item.card.setId,
                            cardNumber: item.card.cardNumber,
                            name: item.card.name,
                            variation: item.card.variation,
                            rarity: item.card.rarity,
                            isInsert: item.card.isInsert,
                            description: item.card.description,
                            frontImageUrl: item.card.imageUrl,
                            backImageUrl: item.card.backImageUrl,
                            estimatedValue: item.card.estimatedValue,
                            cardSet: item.card.cardSet || {
                              id: 0,
                              name: 'Unknown Set',
                              slug: '',
                              year: null,
                              description: null,
                              totalCards: null,
                              imageUrl: null,
                            }
                          };
                          
                          setSelectedCard(cardWithSet);
                          setShowCardDetail(true);
                        };

                        return filteredCollection.length === 0 ? (
                          <div className="text-center py-12">
                            <Search className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p className="text-xl font-bold text-gray-600 mb-2">No Cards Found</p>
                            <p className="text-gray-500">Try adjusting your search or filter criteria.</p>
                          </div>
                        ) : collectionViewMode === "grid" ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {filteredCollection.map((item: any) => (
                              <div 
                                key={item.id} 
                                className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow cursor-pointer hover:border-green-300"
                                onClick={() => handleCardClick(item)}
                              >
                                <div className="aspect-[3/4] bg-gray-100 rounded-lg mb-2 overflow-hidden">
                                  {item.card.imageUrl ? (
                                    <img 
                                      src={item.card.imageUrl} 
                                      alt={item.card.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-200">
                                      <span className="text-gray-400 text-xs">No Image</span>
                                    </div>
                                  )}
                                </div>
                                <h3 className="font-semibold text-sm text-gray-800 mb-1 truncate">{item.card.name}</h3>
                                <p className="text-xs text-gray-600 mb-1">{item.card.cardSet?.name}</p>
                                <div className="flex justify-between items-center">
                                  <span className="text-xs text-gray-500">#{item.card.cardNumber}</span>
                                  <span className="text-xs font-semibold text-green-600">
                                    {item.condition || 'Unknown'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {filteredCollection.map((item: any) => (
                              <div 
                                key={item.id} 
                                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer hover:border-green-300"
                                onClick={() => handleCardClick(item)}
                              >
                                <div className="flex items-center space-x-4">
                                  <div className="w-12 h-16 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                    {item.card.imageUrl ? (
                                      <img src={item.card.imageUrl} alt={item.card.name} className="w-full h-full object-cover rounded" />
                                    ) : (
                                      <span className="text-xs text-gray-500">No Image</span>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <h4 className="font-semibold text-gray-900 truncate">{item.card.name}</h4>
                                      {item.card.estimatedValue && (
                                        <p className="text-green-600 font-semibold">${item.card.estimatedValue.toFixed(2)}</p>
                                      )}
                                    </div>
                                    <p className="text-sm text-gray-600">#{item.card.cardNumber}</p>
                                    <p className="text-sm text-gray-500 truncate">{item.card.cardSet?.name}</p>
                                    <div className="flex items-center space-x-3 mt-2">
                                      <Badge variant="secondary" className="text-xs">
                                        {item.card.rarity}
                                      </Badge>
                                      <span className="text-xs text-gray-500">{item.condition || 'Unknown'}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <div className="w-20 h-20 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
                        <User className="w-12 h-12 text-gray-400" />
                      </div>
                      <p className="text-2xl font-bold text-gray-600 mb-2">No cards yet!</p>
                      <p className="text-gray-500">{selectedFriendProfile?.displayName || selectedFriendProfile?.username} hasn't added any cards to their collection yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard}
        isOpen={showCardDetail}
        onClose={() => {
          setShowCardDetail(false);
          setSelectedCard(null);
        }}
        isInCollection={false}
        isInWishlist={false}
      />
    </div>
  );
}