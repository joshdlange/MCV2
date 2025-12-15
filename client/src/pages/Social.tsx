import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Users, MessageCircle, Award, User, Lock, Clock, Check, X, Search, UserPlus, Plus, Grid, List, Trophy, Star, Calendar, Info } from "lucide-react";
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
    rarity?: string;
    unlockHint?: string;
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
  
  // Badge detail modal state
  const [selectedBadge, setSelectedBadge] = useState<{ badge: any; earnedAt?: string; isLocked?: boolean } | null>(null);
  
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentUser } = useAppStore();

  // Read URL parameters to set initial tab
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam === 'messages') {
      setActiveTab('messages');
    }
  }, []);

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

  // Fetch message threads (only friends with message history)
  const { data: messageThreads = [] } = useQuery({
    queryKey: ["social/message-threads"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/social/message-threads", { headers });
      if (!response.ok) throw new Error("Failed to fetch message threads");
      return response.json();
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
      queryClient.invalidateQueries({ queryKey: ["social/message-threads"] });
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
      {/* Clean minimal header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Social Hub</h1>
        <p className="text-gray-500 text-sm mt-1">Connect with friends and share your collection</p>
      </div>

      {/* Modern segmented pill tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`inline-flex ${viewingProfile ? 'w-full' : 'w-auto'} bg-gray-100 dark:bg-gray-800 rounded-full p-1 mb-6 gap-1`}>
          <TabsTrigger 
            value="friends" 
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-medium text-gray-600 dark:text-gray-400 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm transition-all"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">Friends</span>
            {friends.length > 0 && (
              <span className="ml-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-1.5 py-0.5 rounded-full">
                {friends.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="messages"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-medium text-gray-600 dark:text-gray-400 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm transition-all"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Messages</span>
          </TabsTrigger>
          <TabsTrigger 
            value="badges"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-medium text-gray-600 dark:text-gray-400 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm transition-all"
          >
            <Award className="w-4 h-4" />
            <span className="hidden sm:inline">Powers</span>
            {userBadges.length > 0 && (
              <span className="ml-1 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                {userBadges.length}
              </span>
            )}
          </TabsTrigger>
          {viewingProfile && (
            <TabsTrigger 
              value="profile"
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-gray-600 dark:text-gray-400 data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm transition-all"
            >
              <User className="w-4 h-4" />
              <span className="truncate max-w-[80px]">{selectedFriendProfile?.displayName || selectedFriendProfile?.username || 'Profile'}</span>
              <span 
                className="ml-1 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-pointer rounded-full p-0.5" 
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Friends List - Clean Modern Design */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">My Friends</h2>
                <span className="text-sm text-gray-500">{friends.length} connections</span>
              </div>
              
              {/* Search Section - Minimal */}
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                      placeholder="Find new friends..."
                      value={searchQuery}
                      onChange={handleSearchChange}
                      className="pl-9 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:bg-white dark:focus:bg-gray-900"
                    />
                  </div>
                  <Button
                    onClick={() => searchUsers(searchQuery)}
                    disabled={isSearching || !searchQuery.trim()}
                    size="sm"
                    className="bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                  >
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
                  
                  {isSearching && (
                    <div className="mt-3 text-center">
                      <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-gray-500"></div>
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

              {/* Friends List - Social Tiles */}
              <div className="space-y-2">
                {friendsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full mx-auto mb-3"></div>
                    <p className="text-gray-500 text-sm">Loading friends...</p>
                  </div>
                ) : friends.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-600 dark:text-gray-400">No friends yet</p>
                    <p className="text-sm text-gray-400">Search above to find collectors</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {friends.map((friend: Friend) => {
                      const currentUserId = currentUser?.id;
                      const isRequesterCurrentUser = friend.requester.id === currentUserId;
                      const friendUser = isRequesterCurrentUser 
                        ? friend.recipient : friend.requester;
                      return (
                        <div key={friend.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm hover:shadow-md transition-all">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-10 h-10 ring-2 ring-gray-200 dark:ring-gray-700">
                                <AvatarImage src={friendUser.photoURL} />
                                <AvatarFallback className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-sm">
                                  {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-medium text-gray-900 dark:text-white text-sm truncate">{friendUser.displayName || friendUser.username}</p>
                                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                                </div>
                                <p className="text-xs text-gray-500 truncate">@{friendUser.username}</p>
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedFriendId(friendUser.id);
                                  const tabEvent = new CustomEvent('switchToMessages', { detail: { friendId: friendUser.id } });
                                  window.dispatchEvent(tabEvent);
                                }}
                                className="h-8 w-8 p-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <MessageCircle className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedFriendProfile(friendUser);
                                  setViewingProfile(true);
                                  setActiveTab('profile');
                                }}
                                className="h-8 w-8 p-0 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <User className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Combined Requests & Invitations */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-gray-500" />
                    Requests & Invitations
                  </h3>
                  {(friendRequests.length > 0 || pendingInvitations.length > 0) && (
                    <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-1 rounded-full">
                      {friendRequests.length + pendingInvitations.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-4">
                {friendRequests.length === 0 && pendingInvitations.length === 0 ? (
                  <div className="text-center py-8">
                    <UserPlus className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">No pending requests or invitations</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Incoming Friend Requests */}
                    {friendRequests.map((request: Friend) => (
                      <div key={`req-${request.id}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10 ring-2 ring-gray-200 dark:ring-gray-700">
                            <AvatarImage src={request.requester.photoURL} />
                            <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium">
                              {request.requester.displayName?.charAt(0) || request.requester.username.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white text-sm">{request.requester.displayName || request.requester.username}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Wants to connect</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "accepted" })}
                            disabled={respondToFriendRequest.isPending}
                            className="h-8 px-3 bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 text-xs rounded-full"
                          >
                            <Check className="w-3 h-3 mr-1" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "declined" })}
                            disabled={respondToFriendRequest.isPending}
                            className="h-8 w-8 p-0 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
                          >
                            <X className="w-4 h-4 text-gray-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    
                    {/* Outgoing Pending Invitations */}
                    {pendingInvitations.map((invitation: Friend) => (
                      <div key={`inv-${invitation.id}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10 ring-2 ring-gray-200 dark:ring-gray-700">
                            <AvatarImage src={invitation.recipient.photoURL} />
                            <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium">
                              {invitation.recipient.displayName?.charAt(0) || invitation.recipient.username.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white text-sm">{invitation.recipient.displayName || invitation.recipient.username}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Invitation sent</p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>



        <TabsContent value="messages" className="min-h-[70vh] bg-white dark:bg-gray-900">
          {/* Mobile: Show either conversation list OR chat (not both) */}
          {/* Desktop: Show side-by-side layout */}
          <div className="h-full rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
            
            {/* MOBILE VIEW - Two-step flow */}
            <div className="md:hidden h-full">
              {!selectedFriendId ? (
                /* Step 1: Conversation List */
                <div className="flex flex-col h-full">
                  {/* Header */}
                  <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Messages</h2>
                    <Button 
                      size="sm" 
                      onClick={() => setActiveTab('friends')}
                      className="bg-blue-500 hover:bg-blue-600 text-white"
                      data-testid="button-new-chat"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      New
                    </Button>
                  </div>
                  
                  {/* Conversation List */}
                  <div className="flex-1 overflow-y-auto">
                    {messageThreads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
                        <MessageCircle className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                        <p className="text-gray-600 dark:text-gray-400 font-medium mb-1">No conversations yet</p>
                        <p className="text-gray-400 dark:text-gray-500 text-sm mb-4">Send a message to start chatting</p>
                        <Button 
                          onClick={() => setActiveTab('friends')}
                          className="bg-blue-500 hover:bg-blue-600 text-white"
                          data-testid="button-view-friends"
                        >
                          <Users className="w-4 h-4 mr-2" />
                          View Friends
                        </Button>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {messageThreads.map((thread: any) => {
                          const friendUser = thread.user;
                          const lastMessage = thread.lastMessage;
                          const unreadCount = thread.unreadCount || 0;
                          
                          return (
                            <div
                              key={friendUser.id}
                              onClick={() => setSelectedFriendId(friendUser.id)}
                              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
                              data-testid={`conversation-${friendUser.id}`}
                            >
                              {/* Avatar with status */}
                              <div className="relative flex-shrink-0">
                                <Avatar className="w-14 h-14">
                                  <AvatarImage src={friendUser.photoURL} />
                                  <AvatarFallback className="bg-blue-500 text-white font-semibold text-lg">
                                    {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900"></div>
                                {unreadCount > 0 && (
                                  <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center font-bold px-1">
                                    {unreadCount}
                                  </div>
                                )}
                              </div>
                              
                              {/* Message preview */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-semibold text-gray-900 dark:text-white truncate">
                                    {friendUser.displayName || friendUser.username}
                                  </p>
                                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2">
                                    {new Date(lastMessage.createdAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </div>
                                <p className={`text-sm truncate ${unreadCount > 0 ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                                  {lastMessage.senderId === currentUser?.id ? 'You: ' : ''}{lastMessage.content}
                                </p>
                              </div>
                              
                              {/* Chevron */}
                              <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Step 2: Chat View (Full Screen) */
                <div className="flex flex-col h-full min-h-[70vh]">
                  {/* Chat Header with Back Button */}
                  {(() => {
                    const selectedThread = messageThreads.find((t: any) => t.user.id === selectedFriendId);
                    const selectedFriendUser = selectedThread?.user;
                    
                    return (
                      <div className="p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedFriendId(null)}
                          className="p-2 -ml-1"
                          data-testid="button-back-to-chats"
                        >
                          <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </Button>
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={selectedFriendUser?.photoURL} />
                          <AvatarFallback className="bg-blue-500 text-white font-medium">
                            {selectedFriendUser?.displayName?.charAt(0) || selectedFriendUser?.username?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 dark:text-white">
                            {selectedFriendUser?.displayName || selectedFriendUser?.username || 'Friend'}
                          </h3>
                          <p className="text-xs text-green-600">Active now</p>
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-gray-900">
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <MessageCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                        <p className="text-gray-500 dark:text-gray-400">No messages yet</p>
                        <p className="text-gray-400 dark:text-gray-500 text-sm">Say hello!</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((message: Message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                                message.senderId === currentUser?.id
                                  ? 'bg-blue-500 text-white rounded-br-md'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-md'
                              }`}
                            >
                              {(message as any).imageUrl && (
                                <img 
                                  src={(message as any).imageUrl} 
                                  alt="Shared" 
                                  className="rounded-lg max-w-full h-auto mb-2"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                              )}
                              <p className="text-sm leading-relaxed">{message.content}</p>
                              <p className={`text-xs mt-1 ${
                                message.senderId === currentUser?.id ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                              }`}>
                                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Message Input - Fixed at bottom */}
                  <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-end gap-2">
                      {/* Attachment Button */}
                      <Button
                        type="button"
                        variant="ghost"
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
                                  headers: { ...(await getAuthHeaders()) },
                                  body: formData,
                                });
                                if (response.ok) {
                                  refetchMessages();
                                  toast({ title: "Image sent!", description: "Your image has been shared." });
                                } else {
                                  throw new Error('Failed');
                                }
                              } catch (error) {
                                toast({ title: "Upload failed", description: "Could not send image.", variant: "destructive" });
                              }
                            }
                          };
                          input.click();
                        }}
                        className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 p-0 flex-shrink-0"
                        data-testid="button-attach-image"
                      >
                        <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </Button>
                      
                      {/* Message Input */}
                      <div className="flex-1">
                        <Input
                          placeholder="Message..."
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (newMessage.trim() && selectedFriendId) {
                                sendMessage.mutate({ recipientId: selectedFriendId, content: newMessage.trim() });
                                setNewMessage("");
                              }
                            }
                          }}
                          data-testid="input-message"
                        />
                      </div>
                      
                      {/* Send Button */}
                      <Button
                        onClick={() => {
                          if (newMessage.trim() && selectedFriendId) {
                            sendMessage.mutate({ recipientId: selectedFriendId, content: newMessage.trim() });
                            setNewMessage("");
                          }
                        }}
                        disabled={!newMessage.trim() || sendMessage.isPending}
                        className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-0 flex-shrink-0"
                        data-testid="button-send-message"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* DESKTOP VIEW - Side-by-side layout */}
            <div className="hidden md:flex h-[70vh]">
              {/* Left Column: Conversation List */}
              <div className="w-80 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
                {/* Header */}
                <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Messages</h2>
                  <Button 
                    size="sm" 
                    onClick={() => setActiveTab('friends')}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    New
                  </Button>
                </div>
                
                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto">
                  {messageThreads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6">
                      <MessageCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                      <p className="text-gray-500 dark:text-gray-400 text-sm">No conversations</p>
                      <Button 
                        onClick={() => setActiveTab('friends')}
                        className="mt-3 bg-blue-500 hover:bg-blue-600 text-white text-sm"
                        size="sm"
                      >
                        View Friends
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {messageThreads.map((thread: any) => {
                        const friendUser = thread.user;
                        const lastMessage = thread.lastMessage;
                        const unreadCount = thread.unreadCount || 0;
                        
                        return (
                          <div
                            key={friendUser.id}
                            onClick={() => setSelectedFriendId(friendUser.id)}
                            className={`flex items-center gap-3 p-4 cursor-pointer transition-colors ${
                              selectedFriendId === friendUser.id 
                                ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' 
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                          >
                            <div className="relative flex-shrink-0">
                              <Avatar className="w-12 h-12">
                                <AvatarImage src={friendUser.photoURL} />
                                <AvatarFallback className="bg-blue-500 text-white font-semibold">
                                  {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900"></div>
                              {unreadCount > 0 && (
                                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1">
                                  {unreadCount}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                                  {friendUser.displayName || friendUser.username}
                                </p>
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                  {new Date(lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className={`text-sm truncate ${unreadCount > 0 ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                                {lastMessage.senderId === currentUser?.id ? 'You: ' : ''}{lastMessage.content}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Chat */}
              <div className="flex-1 flex flex-col bg-white dark:bg-gray-900">
                {!selectedFriendId ? (
                  <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-800/50">
                    <div className="text-center">
                      <MessageCircle className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                      <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">Select a conversation</p>
                      <p className="text-gray-400 dark:text-gray-500 text-sm">Choose from your existing conversations</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Chat Header */}
                    {(() => {
                      const selectedThread = messageThreads.find((t: any) => t.user.id === selectedFriendId);
                      const selectedFriendUser = selectedThread?.user;
                      
                      return (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={selectedFriendUser?.photoURL} />
                              <AvatarFallback className="bg-blue-500 text-white font-medium">
                                {selectedFriendUser?.displayName?.charAt(0) || selectedFriendUser?.username?.charAt(0) || 'U'}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h3 className="font-semibold text-gray-900 dark:text-white">
                                {selectedFriendUser?.displayName || selectedFriendUser?.username || 'Friend'}
                              </h3>
                              <p className="text-xs text-green-600">Active now</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4">
                      {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                          <MessageCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                          <p className="text-gray-500 dark:text-gray-400">No messages yet</p>
                          <p className="text-gray-400 dark:text-gray-500 text-sm">Say hello!</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {messages.map((message: Message) => (
                            <div
                              key={message.id}
                              className={`flex ${message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                                  message.senderId === currentUser?.id
                                    ? 'bg-blue-500 text-white rounded-br-md'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-md'
                                }`}
                              >
                                {(message as any).imageUrl && (
                                  <img 
                                    src={(message as any).imageUrl} 
                                    alt="Shared" 
                                    className="rounded-lg max-w-full h-auto mb-2"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                                )}
                                <p className="text-sm leading-relaxed">{message.content}</p>
                                <p className={`text-xs mt-1 ${
                                  message.senderId === currentUser?.id ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                                }`}>
                                  {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Message Input */}
                    <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-end gap-3">
                        <Button
                          type="button"
                          variant="ghost"
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
                                    headers: { ...(await getAuthHeaders()) },
                                    body: formData,
                                  });
                                  if (response.ok) {
                                    refetchMessages();
                                    toast({ title: "Image sent!" });
                                  } else {
                                    throw new Error('Failed');
                                  }
                                } catch (error) {
                                  toast({ title: "Upload failed", variant: "destructive" });
                                }
                              }
                            };
                            input.click();
                          }}
                          className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 p-0 flex-shrink-0"
                        >
                          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </Button>
                        
                        <div className="flex-1">
                          <Input
                            placeholder="Message..."
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full bg-gray-50 dark:bg-gray-800"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (newMessage.trim() && selectedFriendId) {
                                  sendMessage.mutate({ recipientId: selectedFriendId, content: newMessage.trim() });
                                  setNewMessage("");
                                }
                              }
                            }}
                          />
                        </div>
                        
                        <Button
                          onClick={() => {
                            if (newMessage.trim() && selectedFriendId) {
                              sendMessage.mutate({ recipientId: selectedFriendId, content: newMessage.trim() });
                              setNewMessage("");
                            }
                          }}
                          disabled={!newMessage.trim() || sendMessage.isPending}
                          className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-0 flex-shrink-0"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="badges" className="space-y-6">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-500" />
                  Super Powers
                </h2>
                {userBadges.length > 0 && (
                  <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs px-2 py-1 rounded-full">
                    {userBadges.length} earned
                  </span>
                )}
              </div>
            </div>
            <div className="p-6">
              {userBadges.length === 0 ? (
                <div className="text-center py-12">
                  <Award className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">No Powers Yet</p>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Start collecting cards and making friends to earn powers!</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                      <Award className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Collection</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Collect cards</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                      <Users className="w-8 h-8 mx-auto mb-2 text-green-500" />
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Social</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Make friends</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Activity</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Stay active</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {userBadges.map((userBadge: UserBadge) => (
                    <div 
                      key={userBadge.id} 
                      className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center hover:shadow-md transition-all cursor-pointer hover:scale-105"
                      onClick={() => setSelectedBadge({ badge: userBadge.badge, earnedAt: userBadge.earnedAt, isLocked: false })}
                      data-testid={`badge-card-${userBadge.badge.id}`}
                    >
                      <div className="flex justify-center mb-3">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${getRarityStyle(userBadge.badge.rarity || 'common')}`}>
                          {userBadge.badge.iconUrl ? (
                            <img 
                              src={userBadge.badge.iconUrl} 
                              alt={userBadge.badge.name}
                              className="w-10 h-10 object-cover rounded-full"
                            />
                          ) : (
                            <span className="text-xl">{getRarityEmoji(userBadge.badge.rarity || 'common')}</span>
                          )}
                        </div>
                      </div>
                      <h3 className="font-medium text-sm text-gray-900 dark:text-white mb-1">
                        {userBadge.badge.name || 'Unknown Power'}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">{userBadge.badge.description || 'No description'}</p>
                      <div className="flex justify-center gap-1 mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${getBadgeColor(userBadge.badge.category || 'achievement')}`}>
                          {userBadge.badge.category || 'Achievement'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        Earned {new Date(userBadge.earnedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Locked Badges Preview */}
              {(() => {
                const earnedBadgeIds = userBadges.map((ub: UserBadge) => ub.badge.id);
                const lockedBadges = allBadges.filter((badge: any) => !earnedBadgeIds.includes(badge.id));
                
                return lockedBadges.length > 0 ? (
                  <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-4 flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Locked Powers
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                      {lockedBadges.map((badge: any) => (
                        <div 
                          key={badge.id} 
                          className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-center opacity-50 hover:opacity-70 transition-opacity cursor-pointer"
                          onClick={() => setSelectedBadge({ badge, isLocked: true })}
                          data-testid={`locked-badge-card-${badge.id}`}
                        >
                          <div className="w-10 h-10 mx-auto mb-2 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
                            {badge.iconUrl ? (
                              <img 
                                src={badge.iconUrl} 
                                alt={badge.name}
                                className="w-6 h-6 object-cover rounded-full opacity-50"
                              />
                            ) : (
                              <Lock className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <p className="font-medium text-gray-500 dark:text-gray-400 text-xs mb-1">{badge.name}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 line-clamp-1">{badge.unlockHint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="profile" className="space-y-6">
          {selectedFriendProfile && (
            <div className="space-y-6">
              {/* Profile Header - Minimal Style */}
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="flex-shrink-0">
                    <Avatar className="w-20 h-20 ring-4 ring-gray-200 dark:ring-gray-700">
                      <AvatarImage src={selectedFriendProfile.photoURL} alt={selectedFriendProfile.displayName} />
                      <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xl font-medium">
                        {selectedFriendProfile.displayName?.charAt(0) || selectedFriendProfile.username?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                      {selectedFriendProfile.displayName || selectedFriendProfile.username}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">@{selectedFriendProfile.username}</p>
                    {selectedFriendProfile.bio && (
                      <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">{selectedFriendProfile.bio}</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="text-xl font-bold text-gray-900 dark:text-white">
                          {friendProfile?.stats?.totalCards || 0}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Cards</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="text-xl font-bold text-gray-900 dark:text-white">
                          ${friendProfile?.stats?.totalValue?.toFixed(0) || '0'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Value</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="text-xl font-bold text-gray-900 dark:text-white">
                          {friendProfile?.stats?.wishlistItems || 0}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Wishlist</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="text-xl font-bold text-gray-900 dark:text-white">
                          {friendProfile?.stats?.badgesCount || 0}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Powers</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Friend's Super Powers - Minimal Style */}
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-500" />
                    {selectedFriendProfile.displayName || selectedFriendProfile.username}'s Powers
                  </h3>
                </div>
                <div className="p-4">
                  {friendBadgesLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto"></div>
                      <p className="text-gray-500 dark:text-gray-400 mt-3 text-sm">Loading...</p>
                    </div>
                  ) : friendBadges.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {friendBadges.map((userBadge: UserBadge) => (
                        <div key={userBadge.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center hover:shadow-sm transition-shadow">
                          <div className={`w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center border-2 ${getRarityStyle(userBadge.badge.rarity || 'common')}`}>
                            {userBadge.badge.iconUrl ? (
                              <img 
                                src={userBadge.badge.iconUrl} 
                                alt={userBadge.badge.name}
                                className="w-8 h-8 object-contain"
                              />
                            ) : (
                              <span className="text-lg">{getRarityEmoji(userBadge.badge.rarity || 'common')}</span>
                            )}
                          </div>
                          <h3 className="font-medium text-xs text-gray-900 dark:text-white mb-1">{userBadge.badge.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getBadgeColor(userBadge.badge.category)}`}>
                            {userBadge.badge.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Award className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">No powers earned yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Friend's Collection - Minimal Style */}
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-500" />
                      {selectedFriendProfile.displayName || selectedFriendProfile.username}'s Collection
                    </h3>
                    {friendCollection.length > 0 && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {(() => {
                          const filteredCount = friendCollection.filter((item: any) => {
                            const matchesSearch = collectionSearchQuery === "" || 
                              item.card.name.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                              item.card.cardNumber.toLowerCase().includes(collectionSearchQuery.toLowerCase()) ||
                              item.card.cardSet?.name.toLowerCase().includes(collectionSearchQuery.toLowerCase());
                            
                            const matchesSet = selectedCollectionSet === "all" || item.card.cardSet?.name === selectedCollectionSet;
                            
                            return matchesSearch && matchesSet;
                          }).length;
                          return filteredCount !== friendCollection.length 
                            ? `${filteredCount} of ${friendCollection.length} cards`
                            : `${friendCollection.length} cards`;
                        })()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  {friendCollectionLoading ? (
                    <div className="text-center py-16">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500 mx-auto"></div>
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
                        
                        <div className="flex border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <Button
                            variant={collectionViewMode === "grid" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setCollectionViewMode("grid")}
                            className={`rounded-none px-3 ${collectionViewMode === "grid" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"}`}
                          >
                            <Grid className="w-4 h-4 mr-1" />
                            Grid
                          </Button>
                          <Button
                            variant={collectionViewMode === "list" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setCollectionViewMode("list")}
                            className={`rounded-none px-3 ${collectionViewMode === "list" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"}`}
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
                                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:shadow-md transition-shadow cursor-pointer hover:border-gray-400 dark:hover:border-gray-500"
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
                                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow cursor-pointer hover:border-gray-400 dark:hover:border-gray-500"
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
                    <div className="text-center py-8">
                      <User className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">No cards in collection yet</p>
                    </div>
                  )}
                </div>
              </div>
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

      {/* Badge Detail Modal */}
      <Dialog open={!!selectedBadge} onOpenChange={(open) => !open && setSelectedBadge(null)}>
        <DialogContent className="max-w-md mx-auto" data-testid="badge-detail-modal">
          {selectedBadge && (
            <div className="text-center">
              {/* Badge Icon - Large */}
              <div className="flex justify-center mb-6">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${
                  selectedBadge.isLocked 
                    ? 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800' 
                    : getRarityStyle(selectedBadge.badge.rarity || 'common')
                } ${!selectedBadge.isLocked ? getRarityGlow(selectedBadge.badge.rarity || 'common') : ''}`}>
                  {selectedBadge.badge.iconUrl ? (
                    <img 
                      src={selectedBadge.badge.iconUrl} 
                      alt={selectedBadge.badge.name}
                      className={`w-16 h-16 object-cover rounded-full ${selectedBadge.isLocked ? 'opacity-40 grayscale' : ''}`}
                    />
                  ) : selectedBadge.isLocked ? (
                    <Lock className="w-10 h-10 text-gray-400" />
                  ) : (
                    <span className="text-4xl">{getRarityEmoji(selectedBadge.badge.rarity || 'common')}</span>
                  )}
                </div>
              </div>

              {/* Badge Name */}
              <DialogHeader className="mb-4">
                <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-2">
                  {selectedBadge.isLocked && <Lock className="w-5 h-5 text-gray-400" />}
                  {selectedBadge.badge.name}
                </DialogTitle>
              </DialogHeader>

              {/* Category & Rarity Badges */}
              <div className="flex justify-center gap-2 mb-4">
                <span className={`text-sm px-3 py-1 rounded-full ${getBadgeColor(selectedBadge.badge.category || 'Achievement')}`}>
                  {selectedBadge.badge.category || 'Achievement'}
                </span>
                {selectedBadge.badge.rarity && (
                  <span className={`text-sm px-3 py-1 rounded-full ${getRarityStyle(selectedBadge.badge.rarity)} flex items-center gap-1`}>
                    {getRarityEmoji(selectedBadge.badge.rarity)} {selectedBadge.badge.rarity.charAt(0).toUpperCase() + selectedBadge.badge.rarity.slice(1)}
                  </span>
                )}
              </div>

              {/* Full Description */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-4">
                <p className="text-gray-700 dark:text-gray-300 text-base leading-relaxed">
                  {selectedBadge.badge.description || 'No description available.'}
                </p>
              </div>

              {/* Unlock Hint (for locked badges) or Earned Date (for earned badges) */}
              {selectedBadge.isLocked ? (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400 mb-2">
                    <Info className="w-4 h-4" />
                    <span className="font-medium text-sm">How to Unlock</span>
                  </div>
                  <p className="text-amber-700 dark:text-amber-300 text-sm">
                    {selectedBadge.badge.unlockHint || 'Keep exploring to discover how to unlock this power!'}
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
                    <Trophy className="w-5 h-5" />
                    <span className="font-medium">Earned on {selectedBadge.earnedAt ? new Date(selectedBadge.earnedAt).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    }) : 'Unknown'}</span>
                  </div>
                </div>
              )}

              {/* Close Button */}
              <Button 
                variant="outline" 
                className="mt-6 w-full"
                onClick={() => setSelectedBadge(null)}
                data-testid="close-badge-modal"
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}