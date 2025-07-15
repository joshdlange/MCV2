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
import { Users, MessageCircle, Award, User, Lock, Clock, Check, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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

export default function Social() {
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const queryClient = useQueryClient();
  const { user } = useAuth();

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

  // Fetch messages for selected friend
  const { data: messages = [] } = useQuery({
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
      <div className="flex items-center justify-between mb-8">
        <div className="relative">
          <h1 className="text-4xl font-bold text-marvel-red font-bebas tracking-wider">
            SOCIAL HUB
          </h1>
          <div className="absolute -bottom-1 left-0 w-full h-1 bg-gradient-to-r from-marvel-red to-red-600 rounded-full"></div>
        </div>
        <Button 
          onClick={() => checkBadges.mutate()} 
          disabled={checkBadges.isPending}
          className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-bold px-6 py-3 rounded-lg shadow-lg border-2 border-yellow-400 transform hover:scale-105 transition-all duration-200"
        >
          <Award className="w-5 h-5 mr-2" />
          CHECK NEW BADGES
        </Button>
      </div>

      {/* Comic-style tabs */}
      <Tabs defaultValue="friends" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-transparent p-0 h-auto gap-2 mb-6">
          <TabsTrigger 
            value="friends" 
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-3 px-6 font-bold text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white transform hover:scale-105 transition-all duration-200"
          >
            <Users className="w-5 h-5 mr-2" />
            FRIENDS
            {friends.length > 0 && (
              <Badge className="ml-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                {friends.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="messages"
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-3 px-6 font-bold text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white transform hover:scale-105 transition-all duration-200"
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            MESSAGES
            {/* TODO: Add unread message count here */}
          </TabsTrigger>
          <TabsTrigger 
            value="badges"
            className="relative bg-white border-2 border-marvel-red rounded-t-lg py-3 px-6 font-bold text-marvel-red data-[state=active]:bg-marvel-red data-[state=active]:text-white transform hover:scale-105 transition-all duration-200"
          >
            <Award className="w-5 h-5 mr-2" />
            BADGES
            {userBadges.length > 0 && (
              <Badge className="ml-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full">
                {userBadges.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="friends" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Friends List - Comic Panel Style */}
            <Card className="border-2 border-marvel-red bg-gradient-to-br from-white to-blue-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-marvel-red to-red-600 text-white">
                <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                  <Users className="w-6 h-6 mr-2" />
                  MY HEROES ({friends.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {friendsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin w-8 h-8 border-4 border-marvel-red border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-gray-600 font-medium">Loading your team...</p>
                  </div>
                ) : friends.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <Users className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Heroes Yet!</p>
                    <p className="text-gray-500">Build your superhero team by adding friends</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {friends.map((friend: Friend) => {
                      const friendUser = friend.requester.id === friend.recipient.id 
                        ? friend.recipient : friend.requester;
                      return (
                        <div key={friend.id} className="bg-white rounded-lg border-2 border-blue-200 p-4 shadow-sm hover:shadow-md transition-all duration-200 transform hover:scale-105">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <Avatar className="w-12 h-12 border-2 border-marvel-red">
                                <AvatarImage src={friendUser.photoURL} />
                                <AvatarFallback className="bg-marvel-red text-white font-bold">
                                  {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-bold text-gray-800">{friendUser.displayName || friendUser.username}</p>
                                <p className="text-sm text-gray-600">@{friendUser.username}</p>
                                <div className="flex items-center mt-1">
                                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                  <span className="text-xs text-green-600 font-medium">Online</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              <Button
                                size="sm"
                                onClick={() => setSelectedFriendId(friendUser.id)}
                                className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded-lg"
                              >
                                <MessageCircle className="w-4 h-4 mr-1" />
                                Message
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

            {/* Friend Requests - Comic Panel Style */}
            <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black">
                <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                  <User className="w-6 h-6 mr-2" />
                  RECRUITMENT ({friendRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {friendRequests.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <User className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">No Pending Requests</p>
                    <p className="text-gray-500">All heroes have been recruited!</p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {friendRequests.map((request: Friend) => (
                      <div key={request.id} className="bg-white rounded-lg border-2 border-yellow-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <Avatar className="w-12 h-12 border-2 border-yellow-500">
                              <AvatarImage src={request.requester.photoURL} />
                              <AvatarFallback className="bg-yellow-500 text-black font-bold">
                                {request.requester.displayName?.charAt(0) || request.requester.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-bold text-gray-800">{request.requester.displayName || request.requester.username}</p>
                              <p className="text-sm text-gray-600">@{request.requester.username}</p>
                              <p className="text-xs text-yellow-600 font-medium mt-1">Wants to join your team</p>
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

        <TabsContent value="messages" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Friends to message - Comic Panel Style */}
            <Card className="border-2 border-blue-500 bg-gradient-to-br from-white to-blue-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                <CardTitle className="font-bebas text-xl tracking-wide flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  TEAM CHAT
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {friends.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm text-gray-600">No friends to message yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {friends.map((friend: Friend) => {
                      const friendUser = friend.requester.id === friend.recipient.id 
                        ? friend.recipient : friend.requester;
                      return (
                        <div
                          key={friend.id}
                          onClick={() => setSelectedFriendId(friendUser.id)}
                          className={`p-3 rounded-lg cursor-pointer transition-all duration-200 border-2 ${
                            selectedFriendId === friendUser.id 
                              ? 'bg-blue-500 border-blue-600 text-white shadow-lg' 
                              : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={friendUser.photoURL} />
                              <AvatarFallback className="bg-marvel-red text-white text-sm font-bold">
                                {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm truncate">
                                {friendUser.displayName || friendUser.username}
                              </p>
                              <p className="text-xs opacity-75 truncate">
                                Last message preview...
                              </p>
                            </div>
                            <div className="flex flex-col items-end">
                              <Clock className="w-3 h-3 mb-1 opacity-60" />
                              <Badge className="text-xs bg-green-500 text-white px-1 py-0">
                                2
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Messages - Comic Panel Style */}
            <Card className="lg:col-span-2 border-2 border-green-500 bg-gradient-to-br from-white to-green-50 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                <CardTitle className="font-bebas text-xl tracking-wide flex items-center">
                  <MessageCircle className="w-5 h-5 mr-2" />
                  {selectedFriendId ? `CHAT WITH ${
                    friends.find((f: Friend) => {
                      const friendUser = f.requester.id === f.recipient.id 
                        ? f.recipient : f.requester;
                      return friendUser.id === selectedFriendId;
                    })?.requester.displayName?.toUpperCase() || "HERO"
                  }` : "SELECT A HERO TO CHAT"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {selectedFriendId ? (
                  <div className="space-y-4">
                    {/* Messages display - Comic speech bubbles */}
                    <div className="max-h-96 overflow-y-auto space-y-4 p-4 bg-gray-50 rounded-lg border-2 border-gray-200">
                      {messages.length === 0 ? (
                        <div className="text-center py-8">
                          <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                          <p className="text-gray-600 font-medium">Start your heroic conversation!</p>
                        </div>
                      ) : (
                        messages.map((message: Message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.senderId === selectedFriendId ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`max-w-xs px-4 py-3 rounded-2xl shadow-md border-2 ${
                                message.senderId === selectedFriendId
                                  ? 'bg-white border-gray-300 text-gray-900'
                                  : 'bg-marvel-red border-red-600 text-white'
                              }`}
                            >
                              <p className="text-sm font-medium">{message.content}</p>
                              <p className="text-xs opacity-75 mt-1">
                                {new Date(message.createdAt).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Message input - Comic style */}
                    <div className="flex space-x-3">
                      <Textarea
                        placeholder="Type your heroic message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="flex-1 border-2 border-gray-300 rounded-lg font-medium"
                        rows={2}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || sendMessage.isPending}
                        className="bg-marvel-red hover:bg-red-600 text-white font-bold px-6 py-3 rounded-lg border-2 border-red-600 self-end"
                      >
                        <MessageCircle className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <MessageCircle className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-xl font-bold text-gray-600 mb-2">Ready to Chat!</p>
                    <p className="text-gray-500">Select a hero from your team to start messaging</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="badges" className="space-y-6">
          <Card className="border-2 border-yellow-500 bg-gradient-to-br from-white to-yellow-50 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black">
              <CardTitle className="font-bebas text-2xl tracking-wide flex items-center">
                <Award className="w-6 h-6 mr-2" />
                HERO ACHIEVEMENTS ({userBadges.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {userBadges.length === 0 ? (
                <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <Award className="w-20 h-20 mx-auto mb-4 text-gray-400" />
                  <p className="text-2xl font-bold text-gray-600 mb-2">No Achievements Yet!</p>
                  <p className="text-gray-500 mb-6">Start collecting cards and making friends to earn heroic badges!</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Award className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                      <p className="text-sm font-bold text-gray-700">Collection Badges</p>
                      <p className="text-xs text-gray-500">Collect cards to unlock</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Users className="w-8 h-8 mx-auto mb-2 text-green-500" />
                      <p className="text-sm font-bold text-gray-700">Social Badges</p>
                      <p className="text-xs text-gray-500">Make friends to unlock</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                      <p className="text-sm font-bold text-gray-700">Activity Badges</p>
                      <p className="text-xs text-gray-500">Stay active to unlock</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {userBadges.map((userBadge: UserBadge) => (
                    <Card key={userBadge.id} className="text-center border-2 border-gray-200 bg-white shadow-md hover:shadow-xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-1">
                      <CardContent className="p-6">
                        <div className="flex justify-center mb-4">
                          <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 transition-all duration-300 ${getRarityStyle(userBadge.badge.rarity)} ${getRarityGlow(userBadge.badge.rarity)}`}>
                            <div className="text-2xl">{getRarityEmoji(userBadge.badge.rarity)}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-center mb-2">
                          <h3 className="font-bebas text-lg text-gray-800 tracking-wide">
                            {userBadge.badge.name.toUpperCase()}
                          </h3>
                          <div className="ml-2 text-sm">{getRarityEmoji(userBadge.badge.rarity)}</div>
                        </div>
                        <p className="text-sm text-gray-600 mb-4 px-2 line-clamp-2">{userBadge.badge.description}</p>
                        <div className="flex justify-center space-x-2 mb-3">
                          <Badge className={`${getBadgeColor(userBadge.badge.category)} font-bold px-3 py-1 text-xs`}>
                            {userBadge.badge.category.toUpperCase()}
                          </Badge>
                          <Badge className="bg-gray-200 text-gray-800 font-bold px-3 py-1 text-xs">
                            {userBadge.badge.rarity.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500 font-medium">
                            🏆 EARNED {new Date(userBadge.earnedAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-yellow-600 font-bold mt-1">
                            +{userBadge.badge.points} Points
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              {/* Locked Badges Preview */}
              <div className="mt-8 pt-8 border-t border-gray-300">
                <h3 className="font-bebas text-xl text-gray-700 mb-4 tracking-wide">
                  🔒 LOCKED ACHIEVEMENTS
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {[
                    { name: "Vault Guardian", rarity: "platinum", hint: "Collect 1000 cards" },
                    { name: "Master Collector", rarity: "platinum", hint: "Complete 5 full sets" },
                    { name: "Social Butterfly", rarity: "gold", hint: "Send 50 messages" },
                    { name: "Squad Assembled", rarity: "silver", hint: "Add 10 friends" },
                    { name: "Insert Hunter", rarity: "gold", hint: "Collect 10 insert cards" },
                    { name: "7-Day Streak", rarity: "silver", hint: "Log in daily for 7 days" },
                    { name: "Launch Day Hero", rarity: "platinum", hint: "Join during launch month" },
                    { name: "Event Winner", rarity: "platinum", hint: "Win a challenge" },
                    { name: "Curator", rarity: "gold", hint: "Add notes to 50 cards" },
                    { name: "Speed Collector", rarity: "gold", hint: "Add 50 cards in one day" }
                  ].map((badge, index) => (
                    <div key={index} className="bg-gray-100 rounded-lg p-4 text-center border-2 border-gray-200 opacity-60 hover:opacity-80 transition-opacity duration-200">
                      <div className={`w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-gray-300 border-2 border-gray-400`}>
                        <Lock className="w-8 h-8 text-gray-500" />
                      </div>
                      <p className="font-bold text-gray-600 text-sm mb-1">{badge.name}</p>
                      <div className="flex justify-center mb-2">
                        <Badge className="bg-gray-300 text-gray-600 text-xs px-2 py-1">
                          {badge.rarity.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500">{badge.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}