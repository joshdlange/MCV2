import { useState } from "react";
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
  UserPlus
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User as UserType } from "@/types/schema";
import { useLocation } from "wouter";
import { useAppStore } from "@/lib/store";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";

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

export default function Profile() {
  const { user } = useAuth();
  const { currentUser } = useAppStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
              <Avatar className="w-24 h-24">
                <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                <AvatarFallback className="text-2xl">
                  {(user.displayName || currentUser?.username || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 text-center md:text-left">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-2">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <h1 className="text-3xl font-bold">{user.displayName || 'User'}</h1>
                    {currentUser?.isAdmin && (
                      <Badge className="bg-red-600">
                        <Shield className="w-3 h-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                    {getPlanBadge(currentUser?.plan || 'SIDE_KICK')}
                  </div>
                  <Button 
                    onClick={() => setIsEditing(!isEditing)} 
                    variant="outline" 
                    size="sm"
                    className="bg-background border-border text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    {isEditing ? 'Cancel' : 'Edit Profile'}
                  </Button>
                </div>
                
                <p className="text-muted-foreground mb-2">@{currentUser?.username || 'user'}</p>
                <p className="text-sm text-muted-foreground mb-4">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  {getAccountAge()}
                </p>
                
                {/* Quick Stats */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <span className="font-medium">{stats?.totalCards || 0}</span>
                    <span className="text-muted-foreground">Cards</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-blue-500" />
                    <span className="font-medium">{stats?.insertCards || 0}</span>
                    <span className="text-muted-foreground">Inserts</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <CreditCard className="w-4 h-4 text-green-500" />
                    <span className="font-medium">${parseFloat((stats?.totalValue || 0).toString()).toFixed(2)}</span>
                    <span className="text-muted-foreground">Value</span>
                  </div>
                </div>
              </div>
              

            </div>
          </CardContent>
        </Card>

        {/* Profile Tabs */}
        <Tabs defaultValue="personal" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-gray-100 border border-gray-300">
            <TabsTrigger value="personal" className="text-gray-700 font-medium data-[state=active]:text-white data-[state=active]:bg-gray-900 hover:text-gray-900">
              <User className="w-4 h-4 mr-2" />
              Personal
            </TabsTrigger>
            <TabsTrigger value="social" className="text-gray-700 font-medium data-[state=active]:text-white data-[state=active]:bg-gray-900 hover:text-gray-900">
              <Users className="w-4 h-4 mr-2" />
              Social
            </TabsTrigger>
            <TabsTrigger value="billing" className="text-gray-700 font-medium data-[state=active]:text-white data-[state=active]:bg-gray-900 hover:text-gray-900">
              <CreditCard className="w-4 h-4 mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="privacy" className="text-gray-700 font-medium data-[state=active]:text-white data-[state=active]:bg-gray-900 hover:text-gray-900">
              <Lock className="w-4 h-4 mr-2" />
              Privacy
            </TabsTrigger>
          </TabsList>

          {/* Personal Information Tab */}
          <TabsContent value="personal">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="displayName">Display Name</Label>
                    <Input
                      id="displayName"
                      value={profileData.displayName}
                      onChange={(e) => setProfileData(prev => ({ ...prev, displayName: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="Your display name"
                      className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                    />
                  </div>
                  <div>
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      value={profileData.location}
                      onChange={(e) => setProfileData(prev => ({ ...prev, location: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="City, Country"
                      className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                    />
                    <MapPin className="w-4 h-4 inline mr-1 mt-1 text-muted-foreground" />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={profileData.website}
                    onChange={(e) => setProfileData(prev => ({ ...prev, website: e.target.value }))}
                    disabled={!isEditing}
                    placeholder="https://yourwebsite.com"
                    className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                  />
                  <Globe className="w-4 h-4 inline mr-1 mt-1 text-muted-foreground" />
                </div>

                <div className="space-y-4">
                  <Label className="text-base font-semibold">Shipping Address</Label>
                  <p className="text-xs text-muted-foreground">
                    This address will be used for shipping when buying/selling cards through the marketplace
                  </p>
                  
                  <div>
                    <Label htmlFor="street">Street Address</Label>
                    <Input
                      id="street"
                      value={profileData.address.street}
                      onChange={(e) => setProfileData(prev => ({ 
                        ...prev, 
                        address: { ...prev.address, street: e.target.value }
                      }))}
                      disabled={!isEditing}
                      placeholder="123 Main Street"
                      className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={profileData.address.city}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, city: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="New York"
                        className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                      />
                    </div>
                    <div>
                      <Label htmlFor="state">State/Province</Label>
                      <Input
                        id="state"
                        value={profileData.address.state}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, state: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="NY"
                        className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="postalCode">Postal Code</Label>
                      <Input
                        id="postalCode"
                        value={profileData.address.postalCode}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, postalCode: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="10001"
                        className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                      />
                    </div>
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        value={profileData.address.country}
                        onChange={(e) => setProfileData(prev => ({ 
                          ...prev, 
                          address: { ...prev.address, country: e.target.value }
                        }))}
                        disabled={!isEditing}
                        placeholder="United States"
                        className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea
                    id="bio"
                    value={profileData.bio}
                    onChange={(e) => setProfileData(prev => ({ ...prev, bio: e.target.value }))}
                    disabled={!isEditing}
                    placeholder="Tell us about yourself and your collecting interests..."
                    rows={4}
                    className="bg-white text-black border-gray-300 disabled:bg-gray-100 disabled:text-black"
                  />
                </div>

                {isEditing && (
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleSaveProfile}
                      disabled={updateProfileMutation.isPending}
                    >
                      {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setIsEditing(false)}
                      className="bg-gray-800 text-white border-gray-800 hover:bg-gray-900 hover:text-white hover:border-gray-900"
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
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Friends
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setLocation('/social')}
                      className="text-red-600 border-red-600 hover:bg-red-50"
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
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Award className="w-5 h-5" />
                      Super Powers
                    </CardTitle>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setLocation('/social?tab=badges')}
                      className="text-red-600 border-red-600 hover:bg-red-50"
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
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageCircle className="w-5 h-5" />
                    Social Actions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Button 
                      onClick={() => setLocation('/social?tab=messages')}
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Send Message
                    </Button>
                    <Button 
                      onClick={() => setLocation('/social?tab=friends')}
                      variant="outline"
                      className="border-red-600 text-red-600 hover:bg-red-50"
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
            <Card>
              <CardHeader>
                <CardTitle>Billing & Subscription</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h3 className="font-semibold">Current Plan</h3>
                      <p className="text-sm text-muted-foreground">
                        {userProfile?.plan === 'SUPER_HERO' ? 'SUPER HERO - $5/month' : 'SIDE KICK - Free'}
                      </p>
                    </div>
                    {getPlanBadge(userProfile?.plan || 'SIDE_KICK')}
                  </div>

                  {userProfile?.plan === 'SIDE_KICK' && (
                    <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg">
                      <h3 className="font-semibold text-yellow-800 mb-2">Upgrade to SUPER HERO</h3>
                      <ul className="text-sm text-yellow-700 space-y-1 mb-3">
                        <li>• Unlimited card collection</li>
                        <li>• Access to marketplace</li>
                        <li>• Advanced analytics</li>
                        <li>• Priority support</li>
                      </ul>
                      <Button 
                        onClick={() => setShowUpgradeModal(true)}
                        className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
                      >
                        <Crown className="w-4 h-4 mr-2" />
                        Upgrade Now
                      </Button>
                    </div>
                  )}

                  {userProfile?.plan === 'SUPER_HERO' && (
                    <div className="space-y-4">
                      <Separator />
                      <div>
                        <h3 className="font-semibold mb-2">Payment Method</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Payment and subscription management will be integrated with Stripe.
                        </p>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          Stripe Integration Coming Soon
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Privacy Tab */}
          <TabsContent value="privacy">
            <Card>
              <CardHeader>
                <CardTitle>Privacy & Notifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Privacy Settings</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4" />
                        <span className="text-sm">Show email publicly</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        <span className="text-sm">Show collection publicly</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
                  <h3 className="font-semibold mb-3">Notification Preferences</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4" />
                        <span className="text-sm">Email updates</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-sm">Price alerts</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
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
      />
    </div>
  );
}