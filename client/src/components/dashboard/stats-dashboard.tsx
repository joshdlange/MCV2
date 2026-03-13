import { useQuery } from "@tanstack/react-query";
import { Layers, DollarSign, Heart, Zap, ChevronRight, Plus, Sparkles, TrendingUp } from "lucide-react";
import type { CollectionStats } from "@shared/schema";
import { useLocation } from "wouter";

export function StatsDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = useQuery<CollectionStats>({
    queryKey: ["/api/stats"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: userBadges } = useQuery<any[]>({
    queryKey: ["/api/social/user-badges"],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl bg-gray-100 animate-pulse h-28" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const totalCards = stats.totalCards || 0;
  const totalValue = stats.totalValue ? parseFloat(stats.totalValue.toString()) : 0;
  const wishlistItems = (stats as any).wishlistItems || (stats as any).wishlistCount || 0;
  const superpowersCount = userBadges?.length || 0;

  const valueDisplay = totalValue >= 10000
    ? `$${(totalValue / 1000).toFixed(1)}K`
    : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const statCards = [
    {
      label: "Cards",
      value: totalCards.toLocaleString(),
      icon: Layers,
      gradient: "from-red-500 via-red-600 to-red-700",
      shadowColor: "shadow-red-200",
      hint: totalCards === 0 ? "Add your first card →" : totalCards < 50 ? "Keep building →" : "View collection →",
      onClick: () => setLocation("/my-collection"),
    },
    {
      label: "Value",
      value: valueDisplay,
      icon: TrendingUp,
      gradient: "from-emerald-400 via-green-500 to-emerald-600",
      shadowColor: "shadow-emerald-200",
      hint: "See market trends →",
      onClick: () => setLocation("/trends"),
    },
    {
      label: "Wishlist",
      value: wishlistItems.toLocaleString(),
      icon: Heart,
      gradient: "from-pink-400 via-rose-500 to-pink-600",
      shadowColor: "shadow-pink-200",
      hint: wishlistItems === 0 ? "Start your wishlist →" : "Manage wishlist →",
      onClick: () => setLocation("/wishlist"),
    },
    {
      label: "Powers",
      value: superpowersCount.toLocaleString(),
      icon: Zap,
      gradient: "from-violet-500 via-purple-500 to-indigo-600",
      shadowColor: "shadow-purple-200",
      hint: "Earn more powers →",
      onClick: () => setLocation("/social?tab=superpowers"),
    },
  ];

  const showEmptyBanner = totalCards === 0;
  const showGrowthBanner = totalCards > 0 && totalCards < 50;
  const showWishlistNudge = totalCards >= 50 && wishlistItems < 5;
  const showPowersNudge = totalCards >= 50 && wishlistItems >= 5 && superpowersCount < 5;

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((stat) => (
          <button
            key={stat.label}
            onClick={stat.onClick}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${stat.gradient} p-4 text-white text-center shadow-lg ${stat.shadowColor} hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer`}
          >
            {/* Decorative glow blob */}
            <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-white/10 blur-xl pointer-events-none" />

            {/* Icon */}
            <div className="flex justify-center mb-2">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                <stat.icon
                  className="w-5 h-5 text-white"
                  strokeWidth={2.5}
                  fill={stat.icon === Heart || stat.icon === Zap ? "currentColor" : "none"}
                />
              </div>
            </div>

            {/* Value */}
            <div className="text-2xl font-black tracking-tight leading-none mb-1">{stat.value}</div>

            {/* Label */}
            <div className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-2">
              {stat.label}
            </div>

            {/* CTA hint */}
            <div className="flex items-center justify-center gap-0.5 text-[11px] font-medium text-white/80 group-hover:text-white transition-colors">
              <span>{stat.hint}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Contextual action banner */}
      {showEmptyBanner && (
        <div
          onClick={() => setLocation("/browse")}
          className="cursor-pointer flex items-center justify-between bg-gradient-to-r from-red-600 to-red-700 rounded-2xl px-5 py-4 text-white shadow-lg hover:from-red-700 hover:to-red-800 transition-all"
        >
          <div>
            <p className="font-bold text-base">Build your first Marvel vault</p>
            <p className="text-red-100 text-sm mt-0.5">Browse 190k+ cards and start tracking your collection.</p>
          </div>
          <div className="flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-xl px-3 py-2 ml-4 flex-shrink-0 transition-colors">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-semibold">Start</span>
          </div>
        </div>
      )}

      {showGrowthBanner && (
        <div
          onClick={() => setLocation("/browse")}
          className="cursor-pointer flex items-center justify-between bg-gradient-to-r from-gray-800 to-gray-900 rounded-2xl px-5 py-4 text-white shadow-lg hover:from-gray-700 hover:to-gray-800 transition-all"
        >
          <div>
            <p className="font-bold text-base">Nice start — keep building!</p>
            <p className="text-gray-300 text-sm mt-0.5">You have <span className="text-white font-semibold">{totalCards} cards</span>. Hit 50 to unlock richer insights.</p>
          </div>
          <div className="flex items-center gap-1 bg-red-600 hover:bg-red-700 rounded-xl px-3 py-2 ml-4 flex-shrink-0 transition-colors">
            <Plus className="w-4 h-4" />
            <span className="text-sm font-semibold">Browse</span>
          </div>
        </div>
      )}

      {showWishlistNudge && (
        <div
          onClick={() => setLocation("/wishlist")}
          className="cursor-pointer flex items-center justify-between bg-gradient-to-r from-pink-500 to-rose-600 rounded-2xl px-5 py-4 text-white shadow-lg hover:from-pink-600 hover:to-rose-700 transition-all"
        >
          <div>
            <p className="font-bold text-base">Start tracking cards you want</p>
            <p className="text-pink-100 text-sm mt-0.5">Add cards to your wishlist and get price alerts when they drop.</p>
          </div>
          <div className="flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-xl px-3 py-2 ml-4 flex-shrink-0 transition-colors">
            <Heart className="w-4 h-4 fill-current" />
            <span className="text-sm font-semibold">Wishlist</span>
          </div>
        </div>
      )}

      {showPowersNudge && (
        <div
          onClick={() => setLocation("/social?tab=superpowers")}
          className="cursor-pointer flex items-center justify-between bg-gradient-to-r from-violet-500 to-indigo-600 rounded-2xl px-5 py-4 text-white shadow-lg hover:from-violet-600 hover:to-indigo-700 transition-all"
        >
          <div>
            <p className="font-bold text-base">Unlock your superpowers</p>
            <p className="text-violet-100 text-sm mt-0.5">Complete challenges and earn badges that showcase your collection mastery.</p>
          </div>
          <div className="flex items-center gap-1 bg-white/20 hover:bg-white/30 rounded-xl px-3 py-2 ml-4 flex-shrink-0 transition-colors">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-semibold">Explore</span>
          </div>
        </div>
      )}
    </div>
  );
}
