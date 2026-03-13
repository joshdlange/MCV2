import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info, Layers, DollarSign, Heart, Plus, ArrowRight, Zap } from "lucide-react";
import type { CollectionStats } from "@shared/schema";
import { useLocation } from "wouter";
import { motion } from "framer-motion";

const TILE_STYLES = [
  {
    key: "cards",
    accent: "#ef4444",
    animClass: "stat-ember",
    iconGrad: "from-red-600 to-red-800",
    ringColor: "rgba(239,68,68,0.35)",
  },
  {
    key: "value",
    accent: "#10b981",
    animClass: "stat-shimmer",
    iconGrad: "from-emerald-500 to-green-700",
    ringColor: "rgba(16,185,129,0.35)",
  },
  {
    key: "wishlist",
    accent: "#ec4899",
    animClass: "stat-pulse",
    iconGrad: "from-pink-500 to-rose-700",
    ringColor: "rgba(236,72,153,0.35)",
  },
  {
    key: "powers",
    accent: "#a855f7",
    animClass: "stat-flicker",
    iconGrad: "from-purple-500 to-indigo-700",
    ringColor: "rgba(168,85,247,0.35)",
  },
];

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
      <div className="bg-[#111] rounded-xl p-3 border border-white/10 shadow-xl">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 animate-pulse">
              <div className="w-9 h-9 bg-white/10 rounded-full flex-shrink-0" />
              <div className="flex-1">
                <div className="h-2.5 bg-white/10 rounded w-12 mb-2" />
                <div className="h-5 bg-white/10 rounded w-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Failed to load statistics</p>
      </div>
    );
  }

  const totalCards = stats.totalCards || 0;
  const totalValue = stats.totalValue ? parseFloat(stats.totalValue.toString()) : 0;
  const wishlistItems = (stats as any).wishlistItems || (stats as any).wishlistCount || 0;
  const superpowersCount = userBadges?.length || 0;

  const statItems = [
    {
      label: "CARDS",
      value: totalCards.toLocaleString(),
      icon: Layers,
      tooltip: "Total cards in your collection.",
      onClick: () => setLocation("/my-collection"),
      style: TILE_STYLES[0],
      fillIcon: false,
    },
    {
      label: "VALUE",
      value: totalValue >= 10000
        ? `$${(totalValue / 1000).toFixed(1)}K`
        : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      icon: DollarSign,
      tooltip: "Estimated value based on recent eBay sales data.",
      onClick: () => setLocation("/trends"),
      style: TILE_STYLES[1],
      fillIcon: false,
    },
    {
      label: "WISHLIST",
      value: wishlistItems.toLocaleString(),
      icon: Heart,
      tooltip: "Cards you're chasing.",
      onClick: () => setLocation("/wishlist"),
      style: TILE_STYLES[2],
      fillIcon: true,
    },
    {
      label: "POWERS",
      value: superpowersCount.toLocaleString(),
      icon: Zap,
      tooltip: "Badges and achievements you've earned.",
      onClick: () => setLocation("/social?tab=superpowers"),
      style: TILE_STYLES[3],
      fillIcon: true,
    },
  ];

  return (
    <>
      <style>{`
        @keyframes ember-sweep {
          0%   { opacity: 0.15; transform: translateX(-100%); }
          50%  { opacity: 0.4; }
          100% { opacity: 0.15; transform: translateX(100%); }
        }
        @keyframes shimmer-up {
          0%   { opacity: 0; transform: translateY(6px); }
          50%  { opacity: 0.5; }
          100% { opacity: 0; transform: translateY(-6px); }
        }
        @keyframes pulse-pink {
          0%, 100% { opacity: 0.2; transform: scale(0.9); }
          50%       { opacity: 0.45; transform: scale(1.05); }
        }
        @keyframes flicker-purple {
          0%, 100% { opacity: 0.15; }
          25%      { opacity: 0.45; }
          50%      { opacity: 0.2; }
          75%      { opacity: 0.5; }
        }
        .stat-ember .stat-anim  { animation: ember-sweep 3s ease-in-out infinite; }
        .stat-shimmer .stat-anim { animation: shimmer-up 2.5s ease-in-out infinite; }
        .stat-pulse .stat-anim   { animation: pulse-pink 2s ease-in-out infinite; }
        .stat-flicker .stat-anim { animation: flicker-purple 1.8s ease-in-out infinite; }
      `}</style>

      <div className="space-y-4">
        {/* ── Dark outer container ── */}
        <div className="bg-[#111] rounded-xl p-3 border border-white/[0.08] shadow-xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {statItems.map((stat, index) => (
              <motion.div
                key={index}
                onClick={stat.onClick}
                className={`stat-${stat.style.key} group relative flex items-center gap-3 p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] cursor-pointer overflow-hidden`}
                whileHover={{ y: -2, boxShadow: `0 8px 24px -4px ${stat.style.ringColor}` }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {/* Per-tile ambient energy effect */}
                <div
                  className="stat-anim absolute inset-0 rounded-lg pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at 50% 50%, ${stat.style.accent}55 0%, transparent 70%)` }}
                />

                {/* Hover bottom energy line */}
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-lg"
                  style={{ background: `linear-gradient(90deg, transparent, ${stat.style.accent}, transparent)` }}
                  initial={{ opacity: 0, scaleX: 0.3 }}
                  whileHover={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.2 }}
                />

                {/* Icon */}
                <motion.div
                  className={`relative flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br ${stat.style.iconGrad} flex items-center justify-center shadow-md`}
                  whileHover={{ scale: 1.1, rotate: index === 3 ? 15 : 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <stat.icon
                    className="w-4 h-4 text-white"
                    strokeWidth={2.5}
                    fill={stat.fillIcon ? "currentColor" : "none"}
                  />
                  {/* Icon glow ring on hover */}
                  <div
                    className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ boxShadow: `0 0 12px 3px ${stat.style.accent}88` }}
                  />
                </motion.div>

                {/* Text */}
                <div className="relative flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">
                      {stat.label}
                    </span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Info className="w-2.5 h-2.5 text-white/40" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs p-3 text-sm">
                        {stat.tooltip}
                      </PopoverContent>
                    </Popover>
                  </div>
                  <span className="text-xl font-black text-white tracking-tight block truncate leading-none mt-0.5">
                    {stat.value}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Onboarding / Next Steps Card */}
        {totalCards === 0 ? (
          <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-xl p-5 text-white shadow-lg">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-1">Let's build your first Marvel vault.</h3>
                <p className="text-red-100 text-sm">
                  Add a few cards to unlock stats, total value, and set progress tracking.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => setLocation("/browse")}
                  className="bg-white text-red-600 hover:bg-red-50 font-semibold shadow-md"
                  data-testid="button-add-first-cards"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Cards
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/browse")}
                  className="border-white text-white bg-white/10 hover:bg-white/20 text-sm font-semibold"
                  data-testid="link-explore-sets"
                >
                  Explore sets first
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        ) : totalCards < 50 ? (
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-5 text-white shadow-lg">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1">Nice start! Keep building your collection.</h3>
                <p className="text-gray-300 text-sm">
                  You've added <span className="text-white font-semibold">{totalCards} cards</span> so far.
                  Add more to unlock richer value insights and set completion tracking.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={() => setLocation("/browse")}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold shadow-md"
                  data-testid="button-add-more-cards"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add More Cards
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/browse")}
                  className="text-gray-300 hover:bg-white/10 text-sm"
                  data-testid="link-view-sets"
                >
                  View All Sets
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
