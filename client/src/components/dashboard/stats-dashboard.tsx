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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-8 py-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col items-center text-center animate-pulse">
            <div className="w-12 h-12 bg-gray-400 rounded-full mb-3"></div>
            <div className="h-4 bg-gray-400 rounded w-16 mb-1"></div>
            <div className="h-8 bg-gray-400 rounded w-20"></div>
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

  const getIcon = (iconName: string, color: string) => {
    const iconClass = "w-12 h-12 drop-shadow-lg";
    const colorMap = {
      "bg-marvel-red": "text-red-500",
      "bg-marvel-gold": "text-yellow-500", 
      "bg-green-500": "text-green-500",
      "bg-pink-500": "text-pink-500"
    };
    const iconColor = colorMap[color as keyof typeof colorMap] || "text-gray-500";
    
    switch (iconName) {
      case "layers": return <Layers className={`${iconClass} ${iconColor}`} strokeWidth={2.5} />;
      case "star": return <Star className={`${iconClass} ${iconColor}`} strokeWidth={2.5} fill="currentColor" />;
      case "dollar": return <DollarSign className={`${iconClass} ${iconColor}`} strokeWidth={2.5} />;
      case "heart": return <Heart className={`${iconClass} ${iconColor}`} strokeWidth={2.5} fill="currentColor" />;
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-8 py-4">
      {statCards.map((stat, index) => (
        <div
          key={index}
          className="group flex flex-col items-center text-center cursor-pointer transition-all duration-300 hover:scale-110 hover:-translate-y-1"
          onClick={stat.onClick}
        >
          {/* Comic Style Icon */}
          <div className="relative mb-3 group-hover:animate-pulse">
            {getIcon(stat.icon, stat.color)}
            
            {/* Comic shadow effect */}
            <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-black/20 rounded-full blur-sm -z-10"></div>
          </div>
          
          {/* Comic Style Label */}
          <div className="flex flex-col items-center">
            <span className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-1 group-hover:text-gray-500 transition-colors">
              {stat.label}
            </span>
            
            {/* Comic Style Number */}
            <span className="text-3xl font-black text-gray-900 group-hover:text-gray-800 transition-colors tracking-tight" 
                  style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '2px 2px 0px rgba(0,0,0,0.1)' }}>
              {stat.value}
            </span>
          </div>
          
          {/* Hidden tooltip for speech bubble effect */}
          {stat.tooltip && (
            <Popover>
              <PopoverTrigger asChild>
                <button 
                  className="absolute top-0 right-0 w-4 h-4 bg-blue-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="w-2.5 h-2.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs p-3 bg-yellow-300 text-black border-2 border-black rounded-lg shadow-lg relative">
                {/* Speech bubble tail */}
                <div className="absolute -top-2 left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-yellow-300"></div>
                <div className="absolute -top-3 left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-black"></div>
                <p className="text-sm font-medium leading-relaxed">{stat.tooltip}</p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      ))}
    </div>
  );
}
