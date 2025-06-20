import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info } from "lucide-react";
import { 
  Layers, 
  Star, 
  DollarSign, 
  Heart,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import type { CollectionStats } from "@shared/schema";
import { useLocation } from "wouter";

export function StatsDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = useQuery<CollectionStats>({
    queryKey: ["/api/stats"],
    staleTime: 0, // Always fetch fresh data for stats
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-gradient-to-br from-[#1f2022] to-[#2a2d32] rounded-2xl p-6 border border-gray-800/50 animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 bg-gray-600 rounded-xl"></div>
              <div className="w-4 h-4 bg-gray-600 rounded-full"></div>
            </div>
            <div className="h-4 bg-gray-600 rounded w-20 mb-2"></div>
            <div className="h-8 bg-gray-600 rounded w-16 mb-3"></div>
            <div className="h-5 bg-gray-600 rounded w-12"></div>
          </div>
        ))}
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

  const statCards: StatCard[] = [
    {
      label: "Total Cards",
      value: (stats.totalCards || 0).toLocaleString(),
      change: String(stats.totalCardsGrowth || '+0%'),
      icon: "layers",
      color: "bg-marvel-red",
      tooltip: "The total amount of cards you've added to your collection. Add more individually, or if you have sets easily add the whole set to your collection from the browse cards page.",
      onClick: () => setLocation("/collection")
    },
    {
      label: "Insert Cards", 
      value: (stats.insertCards || 0).toLocaleString(),
      change: String(stats.insertCardsGrowth || '+0%'),
      icon: "star",
      color: "bg-marvel-gold",
      tooltip: "What's an insert card? These cards are typically rarer and more valuable than base cards, have unique designs and/or themes, and may have their own numbering systems. Examples include autographed cards, memorabilia cards, foil cards, and special edition cards.",
      onClick: () => setLocation("/collection")
    },
    {
      label: "Total Value",
      value: `$${(stats.totalValue ? parseFloat(stats.totalValue.toString()) : 0).toFixed(2)}`,
      change: String(stats.totalValueGrowth || '+0%'),
      icon: "dollar",
      color: "bg-green-500",
      tooltip: "We've taken a look at your collection and have averaged the last 5 eBay sales of every card within your collection. This is how much your collection is worth today. Check back daily to see the changes over time.",
      onClick: () => setLocation("/trends")
    },
    {
      label: "Wishlist Items",
      value: ((stats as any).wishlistItems || (stats as any).wishlistCount || 0).toLocaleString(),
      change: String((stats as any).wishlistGrowth || '+0%'),
      icon: "heart",
      color: "bg-pink-500",
      tooltip: "Your wishlist is a great place to track the cards you're currently chasing - browse sets or cards and if you don't have it add it to your wishlist. You can easily add it to your collection once you have it in person.",
      onClick: () => setLocation("/wishlist")
    },
  ];

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case "layers": return <Layers className="text-white text-xl" />;
      case "star": return <Star className="text-white text-xl" />;
      case "dollar": return <DollarSign className="text-white text-xl" />;
      case "heart": return <Heart className="text-white text-xl" />;
      default: return null;
    }
  };

  const getTrendIcon = (change: string | number) => {
    const changeStr = String(change || '0');
    return changeStr.startsWith('+') ? 
      <TrendingUp className="w-3 h-3" /> : 
      <TrendingDown className="w-3 h-3" />;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {statCards.map((stat, index) => (
        <div
          key={index}
          className="group relative bg-gradient-to-br from-[#1f2022] to-[#2a2d32] rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:shadow-black/20 hover:scale-[1.02] border border-gray-800/50"
          onClick={stat.onClick}
        >
          {/* Gradient overlay for depth */}
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/10 rounded-2xl"></div>
          
          {/* Content */}
          <div className="relative z-10">
            {/* Icon and Info */}
            <div className="flex items-center justify-between mb-4">
              <div className={`w-10 h-10 ${stat.color} rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow`}>
                {getIcon(stat.icon)}
              </div>
              {stat.tooltip && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button 
                      className="p-1.5 hover:bg-white/10 rounded-full transition-colors opacity-60 hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Info className="w-3.5 h-3.5 text-gray-300" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="max-w-xs p-3 bg-slate-900 text-white border-slate-700/80 rounded-xl shadow-2xl">
                    <p className="text-sm leading-relaxed">{stat.tooltip}</p>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {/* Title */}
            <p className="text-sm font-medium text-gray-300 mb-2">{stat.label}</p>
            
            {/* Main Value */}
            <p className="text-2xl lg:text-3xl font-bold text-white mb-3 tracking-tight">{stat.value}</p>
            
            {/* Growth Indicator */}
            <div className="flex items-center">
              <span className={`text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-full ${
                String(stat.change || '0').startsWith('+') 
                  ? 'text-emerald-400 bg-emerald-400/10' 
                  : 'text-red-400 bg-red-400/10'
              }`}>
                {getTrendIcon(stat.change)}
                {stat.change || '0'}
              </span>
            </div>
          </div>

          {/* Subtle shine effect on hover */}
          <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>
        </div>
      ))}
    </div>
  );
}
