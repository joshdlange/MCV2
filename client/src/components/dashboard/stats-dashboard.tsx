import { useQuery } from "@tanstack/react-query";
import { StatCard } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Layers, 
  Star, 
  DollarSign, 
  Heart,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import type { CollectionStats } from "@shared/schema";

export function StatsDashboard() {
  const { data: stats, isLoading } = useQuery<CollectionStats>({
    queryKey: ["/api/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
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
        <p className="text-gray-500">Failed to load statistics</p>
      </div>
    );
  }

  const statCards: StatCard[] = [
    {
      label: "Total Cards",
      value: stats.totalCards.toLocaleString(),
      change: "+12.5%",
      icon: "layers",
      color: "bg-marvel-red",
    },
    {
      label: "Insert Cards", 
      value: stats.insertCards.toLocaleString(),
      change: "+3.2%",
      icon: "star",
      color: "bg-marvel-gold",
    },
    {
      label: "Total Value",
      value: `$${stats.totalValue.toLocaleString()}`,
      change: "+18.7%",
      icon: "dollar",
      color: "bg-green-500",
    },
    {
      label: "Wishlist Items",
      value: stats.wishlistItems.toLocaleString(),
      change: "-5.1%",
      icon: "heart",
      color: "bg-red-500",
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
        <Card key={index} className="comic-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                <p className="text-3xl font-bebas text-gray-900 mt-1">{stat.value}</p>
                <div className="flex items-center mt-2">
                  <span className={`text-xs font-medium flex items-center gap-1 ${
                    stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {getTrendIcon(stat.change)}
                    {stat.change}
                  </span>
                  <span className="text-xs text-gray-500 ml-1">from last month</span>
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
