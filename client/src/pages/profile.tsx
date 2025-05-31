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
  EyeOff
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { User as UserType } from "@shared/schema";

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: user?.displayName || '',
    bio: '',
    location: '',
    website: '',
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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
              <Avatar className="w-24 h-24">
                <AvatarImage src={user.photoURL || ''} alt={user.displayName || 'User'} />
                <AvatarFallback className="text-2xl">
                  {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              
              <div className="flex-1 text-center md:text-left">
                <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold">{user.displayName || 'User'}</h1>
                  {user.isAdmin && (
                    <Badge className="bg-red-600">
                      <Shield className="w-3 h-3 mr-1" />
                      Admin
                    </Badge>
                  )}
                  {getPlanBadge(userProfile?.plan || 'SIDE_KICK')}
                </div>
                
                <p className="text-muted-foreground mb-2">{user.email}</p>
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
                    <span className="font-medium">${stats?.totalValue || 0}</span>
                    <span className="text-muted-foreground">Value</span>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={() => setIsEditing(!isEditing)}
                variant={isEditing ? "outline" : "default"}
              >
                <Settings className="w-4 h-4 mr-2" />
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Profile Tabs */}
        <Tabs defaultValue="personal" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="personal">
              <User className="w-4 h-4 mr-2" />
              Personal
            </TabsTrigger>
            <TabsTrigger value="social">
              <Users className="w-4 h-4 mr-2" />
              Social
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="w-4 h-4 mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="privacy">
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
                  />
                  <Globe className="w-4 h-4 inline mr-1 mt-1 text-muted-foreground" />
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
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Social Tab */}
          <TabsContent value="social">
            <Card>
              <CardHeader>
                <CardTitle>Social & Friends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Friends & Social Features</h3>
                  <p className="text-muted-foreground mb-4">
                    Connect with other collectors, share your collection, and discover new cards together.
                  </p>
                  <Badge variant="outline">Coming Soon</Badge>
                </div>
              </CardContent>
            </Card>
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
                        {userProfile?.plan === 'SUPER_HERO' ? 'SUPER HERO - $4/month' : 'SIDE KICK - Free'}
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
                      <Button className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600">
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
                        <Badge variant="outline">Stripe Integration Coming Soon</Badge>
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
    </div>
  );
}