import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  User, 
  Settings, 
  Users, 
  CreditCard, 
  Crown, 
  Calendar,
  MapPin,
  Globe,
  Star,
  Trophy,
  Shield,
  Bell,
  Lock,
  Eye,
  EyeOff,
  TrendingUp,
  Award,
  MessageCircle,
  UserPlus,
  AlertTriangle,
  Trash2,
  UserX
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User as UserType } from "@/types/schema";
import { useLocation } from "wouter";
import { useAppStore } from "@/lib/store";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import { signOutUser } from "@/lib/firebase";

// Social Components
function SocialFriendsSection() {
  const { user } = useAuth();
  const { currentUser } = useAppStore();
  
  const { data: friends } = useQuery({
    queryKey: ['/api/social/friends'],
    enabled: !!user
  });

  if (!friends || friends.length === 0) {
    return (
      <div className="text-center py-6">
        <Users className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500 mb-2">No friends yet</p>
        <p className="text-sm text-gray-400">Connect with other collectors to start building your network</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-700">
          {friends.length} Friend{friends.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {friends.slice(0, 8).map((friend: any) => {
          const userId = currentUser?.id;
          const isRequesterCurrentUser = friend.requester.id === userId;
          const friendUser = isRequesterCurrentUser ? friend.recipient : friend.requester;
          
          return (
            <div key={friend.id} className="text-center">
              <Avatar className="w-12 h-12 mx-auto mb-2">
                <AvatarImage src={friendUser.photoURL} />
                <AvatarFallback className="bg-gray-400 text-white text-sm">
                  {friendUser.displayName?.charAt(0) || friendUser.username.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <p className="text-xs text-gray-600 truncate">
                {friendUser.displayName?.split(' ')[0] || friendUser.username.split('@')[0]}
              </p>
            </div>
          );
        })}
      </div>
      {friends.length > 8 && (
        <div className="text-center mt-4">
          <span className="text-sm text-gray-500">
            +{friends.length - 8} more friends
          </span>
        </div>
      )}
    </div>
  );
}

function SocialBadgesSection() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  
  const { data: userBadges } = useQuery({
    queryKey: ['/api/social/user-badges'],
    enabled: !!user
  });

  // Badge Icon Helper
  function GetBadgeIcon({ badgeName }: { badgeName: string }) {
    const iconClass = "w-8 h-8 text-white";
    
    if (badgeName.toLowerCase().includes('collector')) {
      return <Trophy className={iconClass} />;
    } else if (badgeName.toLowerCase().includes('chat') || badgeName.toLowerCase().includes('social') || badgeName.toLowerCase().includes('friend')) {
      return <MessageCircle className={iconClass} />;
    } else if (badgeName.toLowerCase().includes('hunter') || badgeName.toLowerCase().includes('insert')) {
      return <Star className={iconClass} />;
    } else if (badgeName.toLowerCase().includes('vault') || badgeName.toLowerCase().includes('guardian')) {
      return <Shield className={iconClass} />;
    } else if (badgeName.toLowerCase().includes('hero') || badgeName.toLowerCase().includes('launch')) {
      return <Crown className={iconClass} />;
    } else if (badgeName.toLowerCase().includes('hundred') || badgeName.toLowerCase().includes('club')) {
      return <TrendingUp className={iconClass} />;
    } else {
      return <Award className={iconClass} />;
    }
  }

  if (!userBadges || userBadges.length === 0) {
    return (
      <div className="text-center py-6">
        <Award className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500 mb-2">No super powers earned yet</p>
        <p className="text-sm text-gray-400">Complete activities to earn your first super power</p>
      </div>
    );
  }

  const categoryColors = {
    'collection': 'bg-red-100 text-red-800',
    'social': 'bg-gray-100 text-gray-800',
    'engagement': 'bg-red-50 text-red-700',
    'achievement': 'bg-yellow-100 text-yellow-800'
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-700">
          {userBadges.length} Super Power{userBadges.length !== 1 ? 's' : ''} Earned
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {userBadges.slice(0, 8).map((userBadge: any) => (
          <div 
            key={userBadge.id} 
            className="text-center p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => setLocation('/social?tab=badges')}
          >
            <div className="w-16 h-16 mx-auto mb-2 flex items-center justify-center">
              {userBadge.badge.iconUrl ? (
                <img 
                  src={userBadge.badge.iconUrl} 
                  alt={userBadge.badge.name}
                  className="w-full h-full object-contain rounded-full border-4 border-gray-300"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg border-4 border-red-400">
                  <GetBadgeIcon badgeName={userBadge.badge.name} />
                </div>
              )}
            </div>
            <p className="text-xs font-semibold text-gray-900 mb-2">{userBadge.badge.name}</p>
            <Badge 
              variant="secondary" 
              className={`text-xs ${categoryColors[userBadge.badge.category as keyof typeof categoryColors] || 'bg-gray-100 text-gray-800'}`}
            >
              {userBadge.badge.category}
            </Badge>
          </div>
        ))}
      </div>
      {userBadges.length > 8 && (
        <div className="text-center mt-4">
          <span className="text-sm text-gray-500">
            +{userBadges.length - 8} more super powers
          </span>
        </div>
      )}
    </div>
  );
}

function BlockedUsersSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: blockedUsers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/social/blocked-users"],
    enabled: !!user
  });

  const unblockMutation = useMutation({
    mutationFn: async (blockedUserId: number) => {
      return apiRequest("DELETE", `/api/social/block/${blockedUserId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/social/blocked-users"] });
      toast({
        title: "User Unblocked",
        description: "The user has been unblocked successfully."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Unblock Failed",
        description: error.message || "Failed to unblock user.",
        variant: "destructive"
      });
    }
  });

  return (
    <div>
      <h3 className="font-semibold mb-3">Blocked Users</h3>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : !blockedUsers || blockedUsers.length === 0 ? (
        <div className="text-center py-6">
          <UserX className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 text-sm">You haven't blocked anyone</p>
        </div>
      ) : (
        <div className="space-y-3">
          {blockedUsers.map((blockedUser: any) => (
            <div key={blockedUser.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={blockedUser.photoURL} />
                  <AvatarFallback className="bg-gray-400 text-white text-xs">
                    {(blockedUser.displayName || blockedUser.username || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{blockedUser.displayName || blockedUser.username}</p>
                  {blockedUser.username && blockedUser.displayName && (
                    <p className="text-xs text-gray-500">@{blockedUser.username}</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="bg-white text-black border-gray-300 hover:bg-gray-100"
                onClick={() => unblockMutation.mutate(blockedUser.blockedUserId)}
                disabled={unblockMutation.isPending}
              >
                Unblock
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: user?.displayName || '',
    bio: '',
    location: '',
    website: '',
    address: {
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: ''
    },
    privacySettings: {
      showEmail: false,
      showCollection: true,
      showWishlist: true
    },
    notifications: {
      emailUpdates: true,
      priceAlerts: true,
      friendActivity: true
    }
  });

  // Check if we should show upgrade modal on load (from login flow)
  useEffect(() => {
    const shouldShowUpgrade = sessionStorage.getItem('showUpgradeOnLoad');
    if (shouldShowUpgrade === 'true' && currentUser?.plan === 'SIDE_KICK') {
      sessionStorage.removeItem('showUpgradeOnLoad');
      setShowUpgradeModal(true);
      toast({
        title: "Complete Your Upgrade",
        description: "Click below to finish upgrading to Super Hero!"
      });
    }
  }, [currentUser?.plan]);

  // Fetch user profile data
  const { data: userProfile } = useQuery({
    queryKey: ['/api/user/profile'],
    enabled: !!user
  });

  // Fetch user stats
  const { data: stats } = useQuery({
    queryKey: ['/api/stats'],
    enabled: !!user
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: any) => {
      return apiRequest('PATCH', '/api/user/profile', updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      setIsEditing(false);
      toast({
        title: "Profile Updated",
        description: "Your profile has been updated successfully."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSaveProfile = () => {
    updateProfileMutation.mutate(profileData);
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", "/api/user/account");
      await signOutUser();
      window.location.href = "/";
    } catch (err: any) {
      console.error("Account deletion failed:", err);
      toast({
        title: "Error",
        description: "Failed to delete account. Please try again.",
        variant: "destructive",
      });
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const getPlanBadge = (plan: string) => {
    if (plan === 'SUPER_HERO') {
      return (
        <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500 text-yellow-900">
          <Crown className="w-3 h-3 mr-1" />
          SUPER HERO
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Shield className="w-3 h-3 mr-1" />
        SIDE KICK
      </Badge>
    );
  };

  const getAccountAge = () => {
    if (!user?.metadata?.creationTime) return 'Recently joined';
    const created = new Date(user.metadata.creationTime);
    const now = new Date();
    const months = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30));
    
    if (months < 1) return 'Joined this month';
    if (months === 1) return 'Joined 1 month ago';
    return `Joined ${months} months ago`;
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Please sign in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Profile Header */}
        <Card className="mb-6 border-gray-200 shadow-sm overflow-visible pt-0">
          <div 
            className="relative h-28 bg-gradient-to-r from-red-600 via-red-600 to-red-800 rounded-t-xl"
            style={{
              backgroundImage: "radial-gradient(rgba(255,255,255,0.16) 1.5px, transparent 1.5px), linear-gradient(to right, rgb(220 38 38), rgb(153 27 27))",
              backgroundSize: "16px 16px, 100% 100%",
            }}
          >
            <Star className="absolute top-3 right-6 w-6 h-6 text-yellow-300/70 fill-yellow-300/70" />
            <Star className="absolute bottom-4 right-16 w-3 h-3 text-white/40 fill-white/40" />
            <Star className="absolute top-6 left-1/3 w-2.5 h-2.5 text-white/30 fill-white/30" />
          </div>
          <CardContent className="pt-0 pb-6 px-6">
            <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 -mt-12">
              <div className="relative mx-auto md:mx-0 shrink-0">
                <Avatar className="w-28 h-28 border-4 border-white shadow-lg ring-2 ring-yellow-400">
                  <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                  <AvatarFallback className="text-2xl bg-gray-200">
                    {(user.displayName || currentUser?.username || 'U').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {currentUser?.plan === 'SUPER_HERO' && (
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 border-2 border-white shadow-md flex items-center justify-center">
                    <Crown className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
              
              <div className="flex-1 text-center md:text-left pt-3 md:pt-0 min-w-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 min-w-0">
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 truncate">{user.displayName || 'User'}</h1>
                    <div className="flex items-center justify-center gap-2 shrink-0">
                      {currentUser?.isAdmin && (
                        <Badge className="bg-red-600 rounded-full px-2.5">
                          <Shield className="w-3 h-3 mr-1" />
                          Admin
                        </Badge>
                      )}
                      {getPlanBadge(currentUser?.plan || 'SIDE_KICK')}
                    </div>
                  </div>
                  <Button 
                    onClick={() => setIsEditing(!isEditing)} 
                    size="sm"
                    className="bg-gray-900 text-white hover:bg-gray-800 rounded-full px-4 shrink-0"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    {isEditing ? 'Cancel' : 'Edit Profile'}
                  </Button>
                </div>
                
                <p className="text-muted-foreground mt-1.5">@{currentUser?.username || 'user'}</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4 flex items-center justify-center md:justify-start gap-1">
                  <Calendar className="w-4 h-4" />
                  {getAccountAge()}
                </p>
                
                {/* Quick Stats */}
                <div className="flex flex-wrap justify-center md:justify-start gap-2 text-sm">
                  <div className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-100 rounded-full px-3 py-1">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <span className="font-semibold text-gray-900">{stats?.totalCards || 0}</span>
                    <span className="text-muted-foreground">Cards</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-full px-3 py-1">
                    <Star className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-gray-900">{stats?.insertCards || 0}</span>
                    <span className="text-muted-foreground">Inserts</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-green-50 border border-green-100 rounded-full px-3 py-1">
                    <CreditCard className="w-4 h-4 text-green-500" />
                    <span className="font-semibold text-gray-900">${parseFloat((stats?.totalValue || 0).toString()).toFixed(2)}</span>
                    <span className="text-muted-foreground">Value</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Tabs */}
        <Tabs defaultValue="personal" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-gray-100 p-1 rounded-xl h-auto">
            <TabsTrigger value="personal" className="text-gray-600 font-medium rounded-lg py-2 data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">
              <User className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Personal</span>
            </TabsTrigger>
            <TabsTrigger value="social" className="text-gray-600 font-medium rounded-lg py-2 data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">
              <Users className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Social</span>
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-gray-600 font-medium rounded-lg py-2 data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">
              <CreditCard className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Billing</span>
            </TabsTrigger>
            <TabsTrigger value="privacy" className="text-gray-600 font-medium rounded-lg py-2 data-[state=active]:text-gray-900 data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all">
              <Lock className="w-4 h-4 mr-2" />
              <span className="hidden sm:inline">Privacy</span>
            </TabsTrigger>
          </TabsList>

          {/* Personal Information Tab */}
          <TabsContent value="personal">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="displayName" className="text-sm font-medium text-gray-700">Display Name</Label>
                    <Input
                      id="displayName"
                      value={profileData.displayName}
                      onChange={(e) => setProfileData(prev => ({ ...prev, displayName: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="Your display name"
                      className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-600"
                    />
                  </div>
                  <div>
                    <Label htmlFor="location" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      Location
                    </Label>
                    <Input
                      id="location"
                      value={profileData.location}
                      onChange={(e) => setProfileData(prev => ({ ...prev, location: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="City, Country"
                      className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-600"
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="website" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    Website
                  </Label>
                  <Input
                    id="website"
                    value={profileData.website}
                    onChange={(e) => setProfileData(prev => ({ ...prev, website: e.target.value }))}
                    disabled={!isEditing}
                    placeholder="https://yourwebsite.com"
                    className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-600"
                  />
                </div>

                <div className="space-y-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <div>
                    <Label className="text-sm font-semibold text-gray-900">Shipping Address</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This address will be used for shipping when trading cards
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="street" className="text-sm font-medium text-gray-700">Street Address</Label>
                    <Input
                      id="street"
                      value={profileData.address.street}
                      onChange={(e) => setProfileData(prev => ({ 
                        ...prev, 
                        address: { ...prev.address, street: e.target.value }
                      }))}
                      disabled={!isEditing}
                      placeholder="123 Main Street"
                      className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-600"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city" className="text-sm font-medium text-gray-700">City</Label>
                      <Input
                        id="city"
                        value={profileData.address.city}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, city: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="New York"
                        className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-600"
                      />
                    </div>
                    <div>
                      <Label htmlFor="state" className="text-sm font-medium text-gray-700">State/Province</Label>
                      <Input
                        id="state"
                        value={profileData.address.state}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, state: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="NY"
                        className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-600"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="postalCode" className="text-sm font-medium text-gray-700">Postal Code</Label>
                      <Input
                        id="postalCode"
                        value={profileData.address.postalCode}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, postalCode: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="10001"
                        className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-600"
                      />
                    </div>
                    <div>
                      <Label htmlFor="country" className="text-sm font-medium text-gray-700">Country</Label>
                      <Input
                        id="country"
                        value={profileData.address.country}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, country: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="United States"
                        className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-600"
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="bio" className="text-sm font-medium text-gray-700">Bio</Label>
                  <Textarea
                    id="bio"
                    value={profileData.bio}
                    onChange={(e) => setProfileData(prev => ({ ...prev, bio: e.target.value }))}
                    disabled={!isEditing}
                    placeholder="Tell us about yourself and your collecting interests..."
                    rows={4}
                    className="mt-1.5 bg-white text-black border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-600"
                  />
                </div>

                {isEditing && (
                  <div className="flex gap-2 pt-1">
                    <Button 
                      onClick={handleSaveProfile}
                      disabled={updateProfileMutation.isPending}
                      className="bg-red-600 hover:bg-red-700 text-white rounded-lg"
                    >
                      {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setIsEditing(false)}
                      className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50 rounded-lg"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Social Tab */}
          <TabsContent value="social">
            <div className="space-y-6">
              {/* Friends Section */}
              <Card className="border-gray-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Users className="w-5 h-5 text-gray-500" />
                      Friends
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setLocation('/social')}
                      className="text-red-600 border-red-200 hover:bg-red-50 rounded-full"
                    >
                      View All
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <SocialFriendsSection />
                </CardContent>
              </Card>

              {/* Badges Section */}
              <Card className="border-gray-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Award className="w-5 h-5 text-gray-500" />
                      Super Powers
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setLocation('/social?tab=badges')}
                      className="text-red-600 border-red-200 hover:bg-red-50 rounded-full"
                    >
                      View All
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <SocialBadgesSection />
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card className="border-gray-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <MessageCircle className="w-5 h-5 text-gray-500" />
                    Social Actions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Button 
                      onClick={() => setLocation('/social?tab=messages')}
                      className="bg-red-600 hover:bg-red-700 text-white rounded-lg"
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Send Message
                    </Button>
                    <Button 
                      onClick={() => setLocation('/social?tab=friends')}
                      variant="outline"
                      className="border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Find Friends
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Billing & Subscription</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-100 rounded-xl">
                    <div>
                      <h3 className="font-semibold text-gray-900">Current Plan</h3>
                      <p className="text-sm text-muted-foreground">
                        {userProfile?.plan === 'SUPER_HERO' ? 'SUPER HERO - $5/month' : 'SIDE KICK - Free'}
                      </p>
                    </div>
                    {getPlanBadge(userProfile?.plan || 'SIDE_KICK')}
                  </div>

                  {userProfile?.plan === 'SIDE_KICK' && (
                    <div className="p-5 bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl">
                      <h3 className="font-semibold text-yellow-800 mb-2 flex items-center gap-2">
                        <Crown className="w-4 h-4" />
                        Upgrade to SUPER HERO
                      </h3>
                      <ul className="text-sm text-yellow-700 space-y-1 mb-4">
                        <li>• Unlimited card collection</li>
                        <li>• Access to community features</li>
                        <li>• Advanced analytics</li>
                        <li>• Priority support</li>
                      </ul>
                      <Button 
                        onClick={() => setShowUpgradeModal(true)}
                        className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white rounded-lg"
                      >
                        <Crown className="w-4 h-4 mr-2" />
                        Upgrade Now
                      </Button>
                    </div>
                  )}

                  {userProfile?.plan === 'SUPER_HERO' && userProfile?.stripeCustomerId && (
                    <div className="space-y-4">
                      <Separator />
                      <div>
                        <h3 className="font-semibold mb-2 text-gray-900">Subscription</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Your Super Hero subscription is active. To manage your subscription, visit your Stripe customer portal.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Privacy Tab */}
          <TabsContent value="privacy">
            <Card className="border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Privacy & Notifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3 text-gray-900">Privacy Settings</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700">Show email publicly</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white text-black border-gray-300 hover:bg-gray-100 rounded-full"
                        onClick={() => setProfileData(prev => ({
                          ...prev,
                          privacySettings: {
                            ...prev.privacySettings,
                            showEmail: !prev.privacySettings.showEmail
                          }
                        }))}
                      >
                        {profileData.privacySettings.showEmail ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </Button>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700">Show collection publicly</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white text-black border-gray-300 hover:bg-gray-100 rounded-full"
                        onClick={() => setProfileData(prev => ({
                          ...prev,
                          privacySettings: {
                            ...prev.privacySettings,
                            showCollection: !prev.privacySettings.showCollection
                          }
                        }))}
                      >
                        {profileData.privacySettings.showCollection ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold mb-3 text-gray-900">Notification Preferences</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700">Email updates</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white text-black border-gray-300 hover:bg-gray-100 rounded-full"
                        onClick={() => setProfileData(prev => ({
                          ...prev,
                          notifications: {
                            ...prev.notifications,
                            emailUpdates: !prev.notifications.emailUpdates
                          }
                        }))}
                      >
                        {profileData.notifications.emailUpdates ? 'On' : 'Off'}
                      </Button>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700">Price alerts</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white text-black border-gray-300 hover:bg-gray-100 rounded-full"
                        onClick={() => setProfileData(prev => ({
                          ...prev,
                          notifications: {
                            ...prev.notifications,
                            priceAlerts: !prev.notifications.priceAlerts
                          }
                        }))}
                      >
                        {profileData.notifications.priceAlerts ? 'On' : 'Off'}
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator className="my-6" />

                <BlockedUsersSection />
              </CardContent>
            </Card>

            <Card className="border-red-200 shadow-sm mt-6">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-red-700 mb-1">Delete Account</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Permanently delete your account and all associated data including your collection, wishlist, and profile.
                    </p>
                    <Button
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Account
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Upgrade Modal */}
      <UpgradeModal 
        isOpen={showUpgradeModal} 
        onClose={() => setShowUpgradeModal(false)} 
        currentPlan={userProfile?.plan || 'SIDE_KICK'}
        trigger="profile"
      />

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => !isDeleting && setShowDeleteModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-7 h-7 text-red-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Your Account?</h2>
              <p className="text-gray-500 text-sm mb-6">
                This will permanently delete your account and all your collection data. This cannot be undone.
              </p>
              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete My Account"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}