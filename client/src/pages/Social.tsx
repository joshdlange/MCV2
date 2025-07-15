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
import { Users, MessageCircle, Award, User } from "lucide-react";

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

  // Fetch friends
  const { data: friends = [], isLoading: friendsLoading } = useQuery({
    queryKey: ["social/friends"],
    queryFn: async () => {
      const response = await fetch("/api/social/friends", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch friends");
      return response.json();
    },
  });

  // Fetch friend requests
  const { data: friendRequests = [] } = useQuery({
    queryKey: ["social/friend-requests"],
    queryFn: async () => {
      const response = await fetch("/api/social/friend-requests", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch friend requests");
      return response.json();
    },
  });

  // Fetch user badges
  const { data: userBadges = [] } = useQuery({
    queryKey: ["social/user-badges"],
    queryFn: async () => {
      const response = await fetch("/api/social/user-badges", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch user badges");
      return response.json();
    },
  });

  // Fetch messages for selected friend
  const { data: messages = [] } = useQuery({
    queryKey: ["social/messages", selectedFriendId],
    queryFn: async () => {
      if (!selectedFriendId) return [];
      const response = await fetch(`/api/social/messages/${selectedFriendId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch messages");
      return response.json();
    },
    enabled: !!selectedFriendId,
  });

  // Respond to friend request
  const respondToFriendRequest = useMutation({
    mutationFn: async ({ friendId, status }: { friendId: number; status: string }) => {
      const response = await fetch(`/api/social/friend-request/${friendId}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
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
      const response = await fetch("/api/social/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
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
      const response = await fetch("/api/social/check-badges", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
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
        return "bg-blue-100 text-blue-800";
      case "Social":
        return "bg-green-100 text-green-800";
      case "Activity":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Social Hub</h1>
        <Button 
          onClick={() => checkBadges.mutate()} 
          disabled={checkBadges.isPending}
          className="bg-yellow-500 hover:bg-yellow-600"
        >
          <Award className="w-4 h-4 mr-2" />
          Check New Badges
        </Button>
      </div>

      <Tabs defaultValue="friends" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="friends">
            <Users className="w-4 h-4 mr-2" />
            Friends
          </TabsTrigger>
          <TabsTrigger value="messages">
            <MessageCircle className="w-4 h-4 mr-2" />
            Messages
          </TabsTrigger>
          <TabsTrigger value="badges">
            <Award className="w-4 h-4 mr-2" />
            Badges
          </TabsTrigger>
        </TabsList>

        <TabsContent value="friends" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Friends List */}
            <Card>
              <CardHeader>
                <CardTitle>My Friends ({friends.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {friendsLoading ? (
                  <div className="text-center py-4">Loading friends...</div>
                ) : friends.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No friends yet</div>
                ) : (
                  <div className="space-y-3">
                    {friends.map((friend: Friend) => {
                      const friendUser = friend.requester.id === friend.recipient.id 
                        ? friend.recipient : friend.requester;
                      return (
                        <div key={friend.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center space-x-3">
                            <Avatar>
                              <AvatarImage src={friendUser.photoURL} />
                              <AvatarFallback>
                                {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{friendUser.displayName || friendUser.username}</p>
                              <p className="text-sm text-gray-500">@{friendUser.username}</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedFriendId(friendUser.id)}
                          >
                            Message
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Friend Requests */}
            <Card>
              <CardHeader>
                <CardTitle>Friend Requests ({friendRequests.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {friendRequests.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">No pending requests</div>
                ) : (
                  <div className="space-y-3">
                    {friendRequests.map((request: Friend) => (
                      <div key={request.id} className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center space-x-3">
                          <Avatar>
                            <AvatarImage src={request.requester.photoURL} />
                            <AvatarFallback>
                              {request.requester.displayName?.charAt(0) || request.requester.username.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{request.requester.displayName || request.requester.username}</p>
                            <p className="text-sm text-gray-500">@{request.requester.username}</p>
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "accepted" })}
                            disabled={respondToFriendRequest.isPending}
                          >
                            Accept
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => respondToFriendRequest.mutate({ friendId: request.id, status: "declined" })}
                            disabled={respondToFriendRequest.isPending}
                          >
                            Decline
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="messages" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Friends to message */}
            <Card>
              <CardHeader>
                <CardTitle>Friends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {friends.map((friend: Friend) => {
                    const friendUser = friend.requester.id === friend.recipient.id 
                      ? friend.recipient : friend.requester;
                    return (
                      <Button
                        key={friend.id}
                        variant={selectedFriendId === friendUser.id ? "default" : "ghost"}
                        className="w-full justify-start"
                        onClick={() => setSelectedFriendId(friendUser.id)}
                      >
                        <Avatar className="w-6 h-6 mr-2">
                          <AvatarImage src={friendUser.photoURL} />
                          <AvatarFallback>
                            {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {friendUser.displayName || friendUser.username}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Messages */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>
                  {selectedFriendId ? `Messages with ${
                    friends.find((f: Friend) => {
                      const friendUser = f.requester.id === f.recipient.id 
                        ? f.recipient : f.requester;
                      return friendUser.id === selectedFriendId;
                    })?.requester.displayName || "Friend"
                  }` : "Select a friend to message"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedFriendId ? (
                  <div className="space-y-4">
                    {/* Messages display */}
                    <div className="max-h-96 overflow-y-auto space-y-3 p-3 border rounded-lg">
                      {messages.length === 0 ? (
                        <div className="text-center text-gray-500">No messages yet</div>
                      ) : (
                        messages.map((message: Message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.senderId === selectedFriendId ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`max-w-xs px-3 py-2 rounded-lg ${
                                message.senderId === selectedFriendId
                                  ? 'bg-gray-100 text-gray-900'
                                  : 'bg-blue-500 text-white'
                              }`}
                            >
                              <p className="text-sm">{message.content}</p>
                              <p className="text-xs opacity-75 mt-1">
                                {new Date(message.createdAt).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Message input */}
                    <div className="flex space-x-2">
                      <Textarea
                        placeholder="Type your message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="flex-1"
                        rows={2}
                      />
                      <Button
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || sendMessage.isPending}
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Select a friend to start messaging
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Badges ({userBadges.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {userBadges.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No badges earned yet. Start collecting cards and making friends to earn badges!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {userBadges.map((userBadge: UserBadge) => (
                    <Card key={userBadge.id} className="text-center">
                      <CardContent className="p-4">
                        <div className="flex justify-center mb-3">
                          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
                            <Award className="w-8 h-8 text-yellow-600" />
                          </div>
                        </div>
                        <h3 className="font-semibold mb-1">{userBadge.badge.name}</h3>
                        <p className="text-sm text-gray-600 mb-2">{userBadge.badge.description}</p>
                        <Badge className={getBadgeColor(userBadge.badge.category)}>
                          {userBadge.badge.category}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-2">
                          Earned on {new Date(userBadge.earnedAt).toLocaleDateString()}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}