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

export function StatsDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = useQuery<CollectionStats>({
    queryKey: ["/api/stats"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  
  const { data: userBadges } = useQuery<any[]>({
    queryKey: ["/api/user-badges"],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 animate-pulse">
                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-3 bg-gray-200 rounded w-16 mb-2"></div>
                  <div className="h-5 bg-gray-200 rounded w-12"></div>
                </div>
              </div>
            ))}
          </div>
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
      gradient: "from-red-500 to-red-700",
      bgColor: "bg-red-50",
      iconColor: "text-white",
      tooltip: "Total cards in your collection. Add more from the Browse Cards page.",
      onClick: () => setLocation("/my-collection")
    },
    {
      label: "VALUE",
      value: totalValue >= 10000 
        ? `$${(totalValue / 1000).toFixed(1)}K` 
        : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      icon: DollarSign,
      gradient: "from-emerald-500 to-green-600",
      bgColor: "bg-emerald-50",
      iconColor: "text-white",
      tooltip: "Estimated value based on recent eBay sales data.",
      onClick: () => setLocation("/trends")
    },
    {
      label: "WISHLIST",
      value: wishlistItems.toLocaleString(),
      icon: Heart,
      gradient: "from-pink-500 to-rose-600",
      bgColor: "bg-pink-50",
      iconColor: "text-white",
      tooltip: "Cards you're chasing. Add cards to track what you want.",
      onClick: () => setLocation("/wishlist")
    },
    {
      label: "SUPERPOWERS",
      value: superpowersCount.toLocaleString(),
      icon: Zap,
      gradient: "from-purple-500 to-indigo-600",
      bgColor: "bg-purple-50",
      iconColor: "text-white",
      tooltip: "Badges and achievements you've earned. Collect them all!",
      onClick: () => setLocation("/social?tab=superpowers")
    },
  ];

  return (
    <div className="space-y-4">
      {/* Compact Stats Bar */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {statItems.map((stat, index) => (
            <div
              key={index}
              onClick={stat.onClick}
              className="group relative flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
              data-testid={`stat-${stat.label.toLowerCase().replace(' ', '-')}`}
            >
              {/* Icon with gradient background */}
              <div className={`relative w-10 h-10 rounded-full bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg`}>
                <stat.icon className={`w-5 h-5 ${stat.iconColor}`} strokeWidth={2.5} fill={stat.icon === Heart || stat.icon === Zap ? "currentColor" : "none"} />
                <div className="absolute inset-0 rounded-full bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </div>
              
              {/* Label & Value */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">
                    {stat.label}
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button 
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Info className="w-3 h-3 text-gray-400" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-xs p-3 text-sm">
                      {stat.tooltip}
                    </PopoverContent>
                  </Popover>
                </div>
                <span className="text-lg font-bold text-gray-900 tracking-tight block truncate">
                  {stat.value}
                </span>
              </div>
            </div>
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
                variant="ghost"
                onClick={() => setLocation("/browse")}
                className="text-white hover:bg-white/10 text-sm"
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
  );
}
