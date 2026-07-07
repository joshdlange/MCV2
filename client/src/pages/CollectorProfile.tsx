import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowLeft, MapPin, Globe, Calendar, MessageCircle, UserPlus, UserCheck, UserX,
  ShieldOff, Flag, MoreVertical, Star, Award, Image, ShoppingBag, Heart,
  Package, Edit, Zap, TrendingUp, CheckCircle, Clock, EyeOff, Repeat2,
  Instagram, ExternalLink, Settings, Sparkles, UserCircle
} from "lucide-react";
import type { XpProgress } from "@shared/xp";
import { XP_PER_APPROVED_IMAGE, XP_FIRST_APPROVED_IMAGE_BONUS } from "@shared/xp";
import BadgeIcon from "@/components/profile/BadgeIcon";

interface CollectorUser {
  id: number;
  username: string;
  displayName: string;
  photoURL?: string;
  bio?: string;
  location?: string;
  website?: string;
  instagramUrl?: string;
  whatnotUrl?: string;
  isAdmin: boolean;
  plan: string;
  createdAt: string;
  sellerRating?: string;
}

interface CollectorStats {
  totalCards: number;
  totalValue: number;
  wishlistItems: number;
  friendsCount: number;
  badgesCount: number;
}

interface CollectorProfile {
  user: CollectorUser;
  stats: CollectorStats;
  xp: XpProgress;
  isOwnProfile: boolean;
  canViewCollection: boolean;
  canViewWishlist: boolean;
  friendStatus: string;
  friendRequestId: number | null;
  approvedContributions: number;
}

interface WishlistCard {
  id: number;
  cardId: number;
  priority: string;
  maxPrice?: number;
  cardName: string;
  cardNumber: string;
  setName: string;
  rarity: string;
  frontImageUrl?: string;
  estimatedValue?: number;
}

interface EarnedBadge {
  id: number;
  badgeId: number;
  earnedAt: string;
  badge?: {
    id: number;
    name: string;
    description: string;
    iconUrl?: string;
    category: string;
    rarity: string;
    points: number;
  };
  name?: string;
  description?: string;
  category?: string;
  rarity?: string;
  points?: number;
  iconUrl?: string;
}

function StatPill({ value, label, icon }: { value: string | number; label: string; icon?: JSX.Element }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-xl backdrop-blur-sm border border-white/20 min-w-[70px]">
      {icon && <div className="text-white/70 mb-1">{icon}</div>}
      <span className="text-white font-bold text-lg leading-none">{value}</span>
      <span className="text-white/70 text-xs mt-0.5 text-center leading-tight">{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: JSX.Element; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-gray-300 mb-4">{icon}</div>
      <p className="text-lg font-semibold text-gray-600 mb-1">{title}</p>
      {subtitle && <p className="text-sm text-gray-400 max-w-xs">{subtitle}</p>}
    </div>
  );
}

export default function CollectorProfile() {
  const { username } = useParams<{ username: string }>();
  const [, setLocation] = useLocation();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (!currentUser) return {};
    const token = await currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  };

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<CollectorProfile>({
    queryKey: ["/api/collectors", username],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/collectors/${username}`, { headers });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load profile");
      }
      return res.json();
    },
    enabled: !!username && !!currentUser,
  });

  const { data: badgesData = [], isLoading: badgesLoading } = useQuery<EarnedBadge[]>({
    queryKey: ["/api/collectors", username, "badges"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/collectors/${username}/badges`, { headers });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!username && !!currentUser,
  });

  const { data: wishlistData, isLoading: wishlistLoading } = useQuery<{ cards: WishlistCard[]; private: boolean }>({
    queryKey: ["/api/collectors", username, "wishlist"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/collectors/${username}/wishlist`, { headers });
      if (!res.ok) return { cards: [], private: false };
      return res.json();
    },
    enabled: !!username && !!currentUser,
  });

  const { data: tradeBlockData } = useQuery<{ cards: any[]; total: number }>({
    queryKey: ["/api/collectors", username, "trade-block"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/collectors/${username}/trade-block`, { headers });
      if (!res.ok) return { cards: [], total: 0 };
      return res.json();
    },
    enabled: !!username && !!currentUser,
  });

  const { data: contributions } = useQuery<{ approved: number; pending: number; xpEarned?: number; showAttribution?: boolean }>({
    queryKey: ["/api/collectors", username, "contributions"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/collectors/${username}/contributions`, { headers });
      if (!res.ok) return { approved: 0, pending: 0 };
      return res.json();
    },
    enabled: !!username && !!currentUser,
  });

  const sendFriendRequestMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/social/friend-request", { recipientId: profile?.user.id }),
    onSuccess: () => {
      toast({ title: "Friend request sent!" });
      queryClient.invalidateQueries({ queryKey: ["/api/collectors", username] });
    },
    onError: (e: any) => toast({ title: "Failed to send friend request", description: e.message, variant: "destructive" }),
  });

  const blockMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/social/block", { blockedUserId: profile?.user.id }),
    onSuccess: () => {
      toast({ title: "User blocked" });
      setShowBlockModal(false);
      setLocation("/social");
    },
    onError: (e: any) => toast({ title: "Failed to block user", description: e.message, variant: "destructive" }),
  });

  const reportMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/report", { contentType: "user", contentId: profile?.user.id, reason: reportReason }),
    onSuccess: () => {
      toast({ title: "Report submitted", description: "We review all reports within 24 hours." });
      setShowReportModal(false);
      setReportReason(null);
    },
    onError: (e: any) => toast({ title: "Failed to submit report", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="h-48 bg-gradient-to-r from-red-700 to-red-500 animate-pulse" />
        <div className="max-w-4xl mx-auto px-4 -mt-16">
          <div className="w-32 h-32 rounded-full bg-gray-300 animate-pulse border-4 border-white mb-4" />
          <div className="h-6 bg-gray-200 rounded w-48 mb-2 animate-pulse" />
          <div className="h-4 bg-gray-200 rounded w-32 animate-pulse" />
        </div>
      </div>
    );
  }

  if (profileError || !profile) {
    const msg = (profileError as Error)?.message || "";
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          {msg.includes("not available") ? (
            <ShieldOff className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          ) : (
            <UserX className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          )}
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            {msg.includes("not available") ? "Profile Not Available" : "Collector Not Found"}
          </h1>
          <p className="text-gray-500 mb-6">
            {msg.includes("not available")
              ? "You can't view this collector's profile."
              : `No collector found with username "${username}".`}
          </p>
          <Button onClick={() => setLocation("/social")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Social Hub
          </Button>
        </div>
      </div>
    );
  }

  const { user, stats, xp, isOwnProfile, canViewWishlist, friendStatus, approvedContributions } = profile;
  const isSuperHero = user.plan === "SUPER_HERO";
  const displayName = user.displayName || user.username;
  const wishlistCards = wishlistData?.cards ?? [];
  const wishlistPrivate = wishlistData?.private ?? false;
  const tradeCards = tradeBlockData?.cards ?? [];
  const earnedBadges = badgesData;

  const friendButtonLabel = () => {
    if (friendStatus === "accepted") return "Friends";
    if (friendStatus === "pending") return "Request Sent";
    return "Add Friend";
  };

  const handleMessageClick = () => {
    setLocation(`/social?message=${user.id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Banner */}
      <div className="relative h-44 md:h-56 bg-gradient-to-br from-red-800 via-red-600 to-red-500 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute text-white text-6xl font-black opacity-20 select-none"
              style={{ top: `${(i * 37) % 100}%`, left: `${(i * 53) % 100}%`, transform: "rotate(-15deg)" }}
            >
              ★
            </div>
          ))}
        </div>
        <div className="absolute top-4 left-4">
          <Button
            size="sm"
            onClick={() => window.history.back()}
            className="bg-white/95 text-gray-900 hover:bg-white shadow-md font-semibold rounded-full px-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        {/* Avatar + Identity row */}
        <div className="flex items-end justify-between -mt-16 md:-mt-20 mb-4">
          <div className="relative">
            <Avatar className={`w-28 h-28 md:w-36 md:h-36 border-4 shadow-xl ${isSuperHero ? "border-yellow-400" : "border-white"}`}>
              <AvatarImage src={user.photoURL} alt={displayName} />
              <AvatarFallback className="bg-red-600 text-white text-4xl font-bold">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {isSuperHero && (
              <div className="absolute -bottom-1 -right-1 bg-yellow-400 rounded-full p-1 shadow-md">
                <Star className="w-4 h-4 text-yellow-900 fill-yellow-900" />
              </div>
            )}
          </div>

          {/* CTA Buttons (desktop) */}
          <div className="flex items-center gap-2 mb-2">
            {isOwnProfile ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation("/profile")}
                className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Settings className="w-4 h-4 mr-1.5" /> Settings
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={handleMessageClick}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <MessageCircle className="w-4 h-4 mr-1.5" /> Message
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => friendStatus === "none" && sendFriendRequestMutation.mutate()}
                  disabled={friendStatus !== "none" || sendFriendRequestMutation.isPending}
                  className={`border-gray-300 bg-white ${friendStatus === "accepted" ? "text-green-600" : "text-gray-700"}`}
                >
                  {friendStatus === "accepted" ? (
                    <><UserCheck className="w-4 h-4 mr-1.5" /> Friends</>
                  ) : friendStatus === "pending" ? (
                    <><Clock className="w-4 h-4 mr-1.5" /> Pending</>
                  ) : (
                    <><UserPlus className="w-4 h-4 mr-1.5" /> Add Friend</>
                  )}
                </Button>
                <div className="relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOverflowMenu(v => !v)}
                    className="text-gray-500 hover:text-gray-700 px-2"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                  {showOverflowMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[140px]">
                      <button
                        className="w-full text-left px-4 py-2.5 text-sm text-orange-600 hover:bg-orange-50 flex items-center gap-2"
                        onClick={() => { setShowBlockModal(true); setShowOverflowMenu(false); }}
                      >
                        <ShieldOff className="w-4 h-4" /> Block User
                      </button>
                      <button
                        className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        onClick={() => { setShowReportModal(true); setShowOverflowMenu(false); }}
                      >
                        <Flag className="w-4 h-4" /> Report User
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Name + badges */}
        <div className="mb-4">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
            <span className="inline-flex items-center gap-1 bg-gradient-to-r from-red-600 to-red-500 text-white px-2 py-0.5 rounded-full text-xs font-bold shadow-sm">
              <Sparkles className="w-3 h-3" /> LVL {xp.level}
            </span>
            {isSuperHero && (
              <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-0.5 rounded-full text-xs font-bold">
                <Star className="w-3 h-3 fill-yellow-600 text-yellow-600" /> SUPER HERO
              </span>
            )}
            {user.isAdmin && (
              <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 border border-red-300 px-2 py-0.5 rounded-full text-xs font-bold">
                <Zap className="w-3 h-3" /> Admin
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm mb-2">@{user.username}</p>
          {user.bio && <p className="text-gray-700 text-sm mb-3 max-w-xl">{user.bio}</p>}

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            {user.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" /> {user.location}
              </span>
            )}
            {user.website && (
              <a href={user.website.startsWith("http") ? user.website : `https://${user.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-red-600 hover:underline">
                <Globe className="w-3.5 h-3.5" /> {user.website}
              </a>
            )}
            {user.instagramUrl && (
              <a href={user.instagramUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-pink-600 hover:underline">
                <Instagram className="w-3.5 h-3.5" /> Instagram
              </a>
            )}
            {user.whatnotUrl && (
              <a href={user.whatnotUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-purple-600 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" /> Whatnot
              </a>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Joined {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
        </div>

        {/* Stats pills */}
        <div className="bg-gradient-to-r from-red-700 to-red-500 rounded-2xl p-4 mb-6 shadow-md">
          <div className="flex flex-wrap gap-3 justify-around">
            <StatPill value={stats.totalCards.toLocaleString()} label="Cards" icon={<Package className="w-4 h-4" />} />
            <StatPill value={stats.wishlistItems} label="Wishlist" icon={<Heart className="w-4 h-4" />} />
            <StatPill value={tradeCards.length} label="For Trade" icon={<Repeat2 className="w-4 h-4" />} />
            <StatPill value={stats.friendsCount} label="Friends" icon={<UserCheck className="w-4 h-4" />} />
            <StatPill value={earnedBadges.length} label="Badges" icon={<Award className="w-4 h-4" />} />
            <StatPill value={approvedContributions} label="Images" icon={<Image className="w-4 h-4" />} />
          </div>

          {/* Hero XP / Level progress bar */}
          <div className="mt-4 bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/20">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white font-bold text-sm flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-yellow-300" /> Level {xp.level}
                <span className="text-white/60 font-normal">/ {50}</span>
              </span>
              <span className="text-white/90 text-xs font-medium">
                {xp.isMaxLevel ? "MAX LEVEL" : `${xp.xpIntoLevel.toLocaleString()} / ${xp.xpForNextLevel.toLocaleString()} XP`}
              </span>
            </div>
            <div className="h-3 bg-black/25 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 rounded-full transition-all duration-500"
                style={{ width: `${xp.progressPct}%` }}
              />
            </div>
            <div className="text-white/70 text-[11px] mt-1.5">
              {xp.totalXp.toLocaleString()} total XP
              {!xp.isMaxLevel && ` · ${(xp.xpForNextLevel - xp.xpIntoLevel).toLocaleString()} XP to Level ${xp.level + 1}`}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="pb-10">
          <TabsList className="flex w-full overflow-x-auto justify-start gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-6 shadow-sm no-scrollbar">
            {[
              { value: "overview", label: "Overview" },
              { value: "trade-block", label: "Trade Block" },
              { value: "wishlist", label: "Wishlist" },
              { value: "collections", label: "Collections" },
              { value: "badges", label: "Badges" },
              { value: "contributions", label: "Images" },
              { value: "ratings", label: "Ratings" },
            ].map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="shrink-0 px-3 py-1.5 text-sm whitespace-nowrap data-[state=active]:bg-red-600 data-[state=active]:text-white rounded-lg"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-6">
            {/* Collector Stats card */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <TrendingUp className="w-5 h-5 text-red-500" /> Collector Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: "Cards Collected", value: stats.totalCards.toLocaleString(), color: "text-red-600" },
                    { label: "Collection Value", value: `$${Number(stats.totalValue || 0).toLocaleString()}`, color: "text-green-600" },
                    { label: "Wishlist Items", value: stats.wishlistItems, color: "text-purple-600" },
                    { label: "Friends", value: stats.friendsCount, color: "text-pink-600" },
                    { label: "Badges Earned", value: earnedBadges.length, color: "text-yellow-600" },
                    { label: "Collector Level", value: `Lvl ${xp.level}`, color: "text-blue-600" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-50 rounded-xl p-4 text-center">
                      <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
                      <div className="text-xs text-gray-500">{label}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent badges preview */}
            {earnedBadges.length > 0 && (
              <Card className="border border-gray-200 shadow-sm">
                <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                    <Award className="w-5 h-5 text-yellow-500" /> Recent Super Powers
                  </CardTitle>
                  <button onClick={() => setActiveTab("badges")} className="text-xs text-red-600 hover:underline">
                    View all →
                  </button>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-4">
                    {earnedBadges.slice(0, 6).map((b) => {
                      const badgeName = b.badge?.name ?? b.name ?? "Badge";
                      const rarity = b.badge?.rarity ?? b.rarity ?? "bronze";
                      const iconUrl = b.badge?.iconUrl ?? b.iconUrl;
                      return (
                        <div key={b.id} className="flex flex-col items-center gap-1.5 w-16 text-center">
                          <BadgeIcon name={badgeName} iconUrl={iconUrl} rarity={rarity} size="md" />
                          <span className="text-[11px] font-medium text-gray-600 leading-tight line-clamp-2">{badgeName}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Trade block preview */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Repeat2 className="w-5 h-5 text-blue-500" /> Trade Block Preview
                </CardTitle>
                <button onClick={() => setActiveTab("trade-block")} className="text-xs text-red-600 hover:underline">
                  View all →
                </button>
              </CardHeader>
              <CardContent className="p-4">
                {tradeCards.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No cards available for trade yet.</p>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {tradeCards.slice(0, 6).map((c: any) => (
                      <div key={c.id} className="aspect-[2/3] bg-gray-100 rounded-lg overflow-hidden">
                        {c.frontImageUrl && <img src={c.frontImageUrl} alt={c.cardName} className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Wishlist preview */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-gray-100 flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Heart className="w-5 h-5 text-red-500" /> Wishlist Preview
                </CardTitle>
                <button onClick={() => setActiveTab("wishlist")} className="text-xs text-red-600 hover:underline">
                  View all →
                </button>
              </CardHeader>
              <CardContent className="p-4">
                {wishlistPrivate ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-4 justify-center">
                    <EyeOff className="w-4 h-4" /> Wishlist is private
                  </div>
                ) : wishlistCards.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No wishlist cards yet.</p>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {wishlistCards.slice(0, 6).map((c) => (
                      <div key={c.id} className="aspect-[2/3] bg-gray-100 rounded-lg overflow-hidden">
                        {c.frontImageUrl
                          ? <img src={c.frontImageUrl} alt={c.cardName} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs text-center p-1">{c.cardName}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Trade Block ── */}
          <TabsContent value="trade-block">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Repeat2 className="w-5 h-5 text-blue-500" /> Trade Block
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tradeCards.length === 0 ? (
                  <EmptyState
                    icon={<Repeat2 className="w-14 h-14" />}
                    title="No cards available for trade yet."
                    subtitle={isOwnProfile ? "Mark cards in your collection as available for trade to show them here." : `${displayName} hasn't added any trade cards yet.`}
                  />
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3 p-4">
                    {tradeCards.map((c: any) => (
                      <div key={c.id} className="aspect-[2/3] bg-gray-100 rounded-xl overflow-hidden shadow-sm">
                        {c.frontImageUrl && <img src={c.frontImageUrl} alt={c.cardName} className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Wishlist ── */}
          <TabsContent value="wishlist">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Heart className="w-5 h-5 text-red-500" /> Wishlist
                  {!wishlistPrivate && <span className="text-sm font-normal text-gray-400">({wishlistCards.length} cards)</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {wishlistPrivate ? (
                  <EmptyState
                    icon={<EyeOff className="w-14 h-14" />}
                    title="Wishlist is private"
                    subtitle={`${displayName} has their wishlist set to private.`}
                  />
                ) : wishlistLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : wishlistCards.length === 0 ? (
                  <EmptyState
                    icon={<Heart className="w-14 h-14" />}
                    title="No wishlist cards yet."
                    subtitle={isOwnProfile ? "Add cards to your wishlist from any card detail page." : `${displayName} hasn't added any wishlist cards yet.`}
                  />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
                    {wishlistCards.map((c) => (
                      <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                        <div className="aspect-[2/3] bg-gray-100 relative">
                          {c.frontImageUrl
                            ? <img src={c.frontImageUrl} alt={c.cardName} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-gray-300 text-sm text-center p-2">{c.cardName}</div>}
                          {c.priority === "high" && (
                            <span className="absolute top-2 right-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">High</span>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="font-semibold text-gray-800 text-sm leading-tight truncate">{c.cardName}</p>
                          <p className="text-xs text-gray-400 truncate">{c.setName}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-400">#{c.cardNumber}</span>
                            {c.estimatedValue && (
                              <span className="text-xs font-medium text-green-600">${Number(c.estimatedValue).toFixed(2)}</span>
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

          {/* ── Personal Collections ── */}
          <TabsContent value="collections">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <ShoppingBag className="w-5 h-5 text-purple-500" /> Personal Collections
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<ShoppingBag className="w-14 h-14" />}
                  title="Personal Collections coming soon."
                  subtitle={isSuperHero || user.plan === "SUPER_HERO"
                    ? "Custom personal collections are coming soon for SUPER HERO collectors."
                    : "Personal Collections are a SUPER HERO feature — coming soon!"}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Badges ── */}
          <TabsContent value="badges">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Award className="w-5 h-5 text-yellow-500" /> Super Powers
                  <span className="text-sm font-normal text-gray-400">({earnedBadges.length} earned)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {badgesLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : earnedBadges.length === 0 ? (
                  <EmptyState
                    icon={<Award className="w-14 h-14" />}
                    title="No badges earned yet."
                    subtitle={isOwnProfile ? "Keep collecting and engaging with the community to earn badges." : `${displayName} hasn't earned any badges yet.`}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
                    {earnedBadges.map((b) => {
                      const badgeName = b.badge?.name ?? b.name ?? "Badge";
                      const description = b.badge?.description ?? b.description ?? "";
                      const rarity = b.badge?.rarity ?? b.rarity ?? "bronze";
                      const iconUrl = b.badge?.iconUrl ?? b.iconUrl;
                      const points = b.badge?.points ?? b.points ?? 0;
                      return (
                        <div key={b.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white shadow-sm">
                          <BadgeIcon name={badgeName} iconUrl={iconUrl} rarity={rarity} size="md" glow className="flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-sm text-gray-800">{badgeName}</p>
                              <span className="text-xs text-gray-400 capitalize">{rarity}</span>
                            </div>
                            {description && <p className="text-xs text-gray-500 truncate">{description}</p>}
                            <p className="text-xs text-gray-400 mt-0.5">Earned {new Date(b.earnedAt).toLocaleDateString()}</p>
                          </div>
                          {points > 0 && (
                            <div className="text-xs font-bold text-red-500 flex items-center gap-0.5"><Sparkles className="w-3 h-3" />+{points}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Image Contributions ── */}
          <TabsContent value="contributions">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Image className="w-5 h-5 text-blue-500" /> Image Contributions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {(contributions?.approved ?? 0) === 0 && (contributions?.pending ?? 0) === 0 ? (
                  <EmptyState
                    icon={<Image className="w-14 h-14" />}
                    title="No image contributions yet."
                    subtitle={isOwnProfile ? "Submit card images from any card detail page to help build the community's card library — you'll earn XP for every approved image." : `${displayName} hasn't contributed any card images yet.`}
                  />
                ) : (
                  <div className="space-y-5">
                    <div className={`grid gap-4 ${isOwnProfile ? "grid-cols-3" : "grid-cols-2"} max-w-md mx-auto`}>
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                        <CheckCircle className="w-7 h-7 text-green-500 mx-auto mb-1.5" />
                        <div className="text-2xl md:text-3xl font-bold text-green-700">{contributions?.approved ?? 0}</div>
                        <div className="text-xs md:text-sm text-green-600 mt-1">Approved</div>
                      </div>
                      {isOwnProfile && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
                          <Clock className="w-7 h-7 text-yellow-500 mx-auto mb-1.5" />
                          <div className="text-2xl md:text-3xl font-bold text-yellow-700">{contributions?.pending ?? 0}</div>
                          <div className="text-xs md:text-sm text-yellow-600 mt-1">Pending</div>
                        </div>
                      )}
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                        <Sparkles className="w-7 h-7 text-red-500 mx-auto mb-1.5" />
                        <div className="text-2xl md:text-3xl font-bold text-red-700">{(contributions?.xpEarned ?? 0).toLocaleString()}</div>
                        <div className="text-xs md:text-sm text-red-600 mt-1">XP Earned</div>
                      </div>
                    </div>

                    {/* Attribution status */}
                    <div className="flex items-center justify-center gap-2 text-sm">
                      {contributions?.showAttribution === false ? (
                        <span className="inline-flex items-center gap-1.5 text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
                          <EyeOff className="w-4 h-4" /> Contributions shown anonymously
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-green-700 bg-green-50 px-3 py-1.5 rounded-full">
                          <UserCircle className="w-4 h-4" /> Credited on contributed images
                        </span>
                      )}
                    </div>

                    {isOwnProfile && (
                      <p className="text-center text-xs text-gray-400 max-w-sm mx-auto">
                        You earn {XP_PER_APPROVED_IMAGE} XP per approved image, plus a one-time {XP_FIRST_APPROVED_IMAGE_BONUS} XP bonus for your first contribution.
                        Manage whether your name appears on images in the Settings tab.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Trade Ratings ── */}
          <TabsContent value="ratings">
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <CardTitle className="flex items-center gap-2 text-base text-gray-800">
                  <Star className="w-5 h-5 text-yellow-500" /> Trade Ratings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<Star className="w-14 h-14" />}
                  title="No completed trade ratings yet."
                  subtitle="Trade ratings will appear here once trades are completed."
                />
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Block Confirmation Modal */}
      <Dialog open={showBlockModal} onOpenChange={setShowBlockModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-orange-600">Block {displayName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            They won't be able to see your profile, message you, or interact with you. This will also remove any existing friendship.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowBlockModal(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => blockMutation.mutate()} disabled={blockMutation.isPending}>
              {blockMutation.isPending ? "Blocking..." : "Block User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Modal */}
      <Dialog open={showReportModal} onOpenChange={setShowReportModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Report {displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Why are you reporting this user?</p>
            <Select value={reportReason ?? ""} onValueChange={setReportReason}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spam">Spam or fake account</SelectItem>
                <SelectItem value="harassment">Harassment or bullying</SelectItem>
                <SelectItem value="inappropriate">Inappropriate content</SelectItem>
                <SelectItem value="scam">Scam or fraud</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReportModal(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => reportMutation.mutate()}
              disabled={!reportReason || reportMutation.isPending}
            >
              {reportMutation.isPending ? "Submitting..." : "Submit Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Click outside to close overflow menu */}
      {showOverflowMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
      )}
    </div>
  );
}
