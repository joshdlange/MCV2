import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CardValueProps {
  cardId: number;
  showRefresh?: boolean;
  estimatedValue?: string | null;
  currentPrice?: number | null;
}

export function CardValue({ cardId, showRefresh = false, estimatedValue, currentPrice }: CardValueProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use current price from cache, fallback to estimated value
  const fallbackPrice = estimatedValue ? parseFloat(estimatedValue) : null;
  const displayPrice = currentPrice || fallbackPrice;

  const refreshMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/refresh-card-pricing/${cardId}`);
    },
    onSuccess: (data: any) => {
      if (data.success) {
        queryClient.invalidateQueries({
          queryKey: ["/api/card-pricing"]
        });
        toast({
          title: "Pricing Updated",
          description: `New price: $${data.avgPrice.toFixed(2)}`
        });
      } else {
        toast({
          title: "Pricing Unavailable",
          description: "Unable to fetch current market data",
          variant: "destructive"
        });
      }
    },
    onError: () => {
      toast({
        title: "Refresh Failed",
        description: "Unable to update pricing data",
        variant: "destructive"
      });
    }
  });

  const hasValidPrice = displayPrice && displayPrice > 0;

  if (!hasValidPrice) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <DollarSign className="w-3 h-3" />
        <span>N/A</span>
        {showRefresh && (
          <Button
            size="sm"
            variant="ghost"
            className="h-4 w-4 p-0 ml-1"
            onClick={(e) => {
              e.stopPropagation();
              refreshMutation.mutate();
            }}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
        )}
      </div>
    );
  }

  const isMarketPrice = currentPrice && currentPrice > 0;
  const badgeColor = isMarketPrice 
    ? "bg-green-50 text-green-700 border-green-200" 
    : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className={`${badgeColor} text-xs font-semibold`}>
        <DollarSign className="w-3 h-3 mr-1" />
        ${displayPrice.toFixed(2)}
        {!isMarketPrice && (
          <span className="ml-1 text-xs opacity-60">est</span>
        )}
      </Badge>
      {showRefresh && (
        <Button
          size="sm"
          variant="ghost"
          className="h-4 w-4 p-0"
          onClick={(e) => {
            e.stopPropagation();
            refreshMutation.mutate();
          }}
          disabled={refreshMutation.isPending}
        >
          <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </div>
  );
}