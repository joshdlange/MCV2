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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5 rounded-full bg-gradient-to-r from-gray-800/80 to-gray-900/80 border border-gray-700/50 animate-pulse w-full justify-center">
            <div className="w-5 h-5 bg-gray-600 rounded-full flex-shrink-0"></div>
            <div className="flex flex-col gap-0.5">
              <div className="h-3 bg-gray-600 rounded w-16"></div>
              <div className="h-4 bg-gray-600 rounded w-12"></div>
            </div>
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
      case "layers": return <Layers className="w-4 h-4 text-white" />;
      case "star": return <Star className="w-4 h-4 text-white" />;
      case "dollar": return <DollarSign className="w-4 h-4 text-white" />;
      case "heart": return <Heart className="w-4 h-4 text-white" />;
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {statCards.map((stat, index) => (
        <div
          key={index}
          className="group flex items-center gap-2 px-3 py-2.5 rounded-full cursor-pointer transition-all duration-200 hover:scale-105 border border-gray-700/50 bg-gradient-to-r from-gray-800/80 to-gray-900/80 hover:from-gray-700/80 hover:to-gray-800/80 w-full justify-center"
          onClick={stat.onClick}
        >
          {/* Icon */}
          <div className={`w-5 h-5 ${stat.color} rounded-full flex items-center justify-center flex-shrink-0`}>
            {getIcon(stat.icon)}
          </div>
          
          {/* Content */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-gray-300 truncate leading-tight">{stat.label}</span>
              <span className="text-base font-bold text-white leading-tight">{stat.value}</span>
            </div>
            
            {/* Info tooltip */}
            {stat.tooltip && (
              <Popover>
                <PopoverTrigger asChild>
                  <button 
                    className="p-0.5 hover:bg-white/10 rounded-full transition-colors opacity-60 hover:opacity-100 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info className="w-3 h-3 text-gray-400" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="max-w-xs p-3 bg-slate-900 text-white border-slate-700/80 rounded-xl shadow-2xl">
                  <p className="text-sm leading-relaxed">{stat.tooltip}</p>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
