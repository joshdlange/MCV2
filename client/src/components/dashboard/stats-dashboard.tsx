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
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse stat-card-hover">
            <CardContent className="p-6">
              <div className="h-20 bg-gray-200 rounded"></div>
            </CardContent>
          </Card>
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
      value: stats.totalCards.toLocaleString(),
      change: stats.totalCardsGrowth,
      icon: "layers",
      color: "bg-marvel-red",
      tooltip: "The total amount of cards you've added to your collection. Add more individually, or if you have sets easily add the whole set to your collection from the browse cards page.",
      onClick: () => setLocation("/collection")
    },
    {
      label: "Insert Cards", 
      value: stats.insertCards.toLocaleString(),
      change: stats.insertCardsGrowth,
      icon: "star",
      color: "bg-marvel-gold",
      tooltip: "What's an insert card? These cards are typically rarer and more valuable than base cards, have unique designs and/or themes, and may have their own numbering systems. Examples include autographed cards, memorabilia cards, foil cards, and special edition cards.",
      onClick: () => setLocation("/collection")
    },
    {
      label: "Total Value",
      value: `$${parseFloat(stats.totalValue.toString()).toFixed(2)}`,
      change: stats.totalValueGrowth,
      icon: "dollar",
      color: "bg-green-500",
      tooltip: "We've taken a look at your collection and have averaged the last 5 eBay sales of every card within your collection. This is how much your collection is worth today. Check back daily to see the changes over time.",
      onClick: () => setLocation("/trends")
    },
    {
      label: "Wishlist Items",
      value: stats.wishlistItems.toLocaleString(),
      change: stats.wishlistGrowth,
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

  const getTrendIcon = (change: string) => {
    return change.startsWith('+') ? 
      <TrendingUp className="w-3 h-3" /> : 
      <TrendingDown className="w-3 h-3" />;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat, index) => (
        <Card 
          key={index}
          className="comic-border cursor-pointer hover:shadow-lg transition-shadow duration-200"
          onClick={stat.onClick}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  {stat.tooltip && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button 
                          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Info className="w-3 h-3 text-gray-500" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="max-w-xs p-3 bg-slate-800 text-white border-slate-700">
                        <p className="text-sm">{stat.tooltip}</p>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <p className="text-3xl font-bebas text-card-foreground mt-1">{stat.value}</p>
                <div className="flex items-center mt-2">
                  <span className={`text-xs font-medium flex items-center gap-1 ${
                    stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {getTrendIcon(stat.change)}
                    {stat.change}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">from last month</span>
                </div>
              </div>
              <div className={`w-12 h-12 ${stat.color} rounded-lg flex items-center justify-center`}>
                {getIcon(stat.icon)}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
