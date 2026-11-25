import { Button } from "@/components/ui/button";
import { DollarSign, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  // Fetch pricing data from the database
  const { data: pricingData } = useQuery({
    queryKey: ["/api/card-pricing", cardId],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", `/api/card-pricing/${cardId}`);
        return await response.json();
      } catch (error) {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false
  });

  // Use pricing data from database, fallback to current price prop, then estimated value
  const marketPrice = pricingData?.avgPrice;
  const fallbackPrice = estimatedValue ? parseFloat(estimatedValue) : null;
  const displayPrice = pricingData?.provider === "soldgraph" ? marketPrice : marketPrice || currentPrice || fallbackPrice;

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/card-pricing/${cardId}/refresh`);
      return await response.json();
    },
    onSuccess: (data: any) => {
      // apiRequest opens the upgrade modal. Neither gating nor an existing
      // refresh is a completed price update; leave the cached value untouched.
      if (data.upgradeRequired) return;
      if (data.refreshing) {
        toast({
          title: "Refresh In Progress",
          description: "This card's price is already being refreshed. Please try again shortly."
        });
        return;
      }
      if (data.avgPrice != null) {
        queryClient.invalidateQueries({
          queryKey: ["/api/card-pricing"]
        });
        toast({
          title: "Pricing Updated",
          description: data.provider === "legacy" ? `Value: $${data.avgPrice.toFixed(2)}` : `New price: $${data.avgPrice.toFixed(2)} (${data.salesCount} ${data.provider === "soldgraph" ? "sold comps" : "sales found"})${data.confidence === "limited" ? " — Limited data" : ""}`
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

  const isMarketPrice = marketPrice && marketPrice > 0;
  const formattedPrice = displayPrice.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const limited = pricingData?.confidence === "limited";

  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums shadow-sm ring-1 ring-inset ${
          isMarketPrice
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-slate-50 text-slate-700 ring-slate-200"
        }`}
        title={limited ? "Estimated value based on limited sales data" : "Estimated market value"}
        data-testid={`card-value-${cardId}`}
      >
        {formattedPrice}
      </span>
      {showRefresh && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Refresh value"
          className="h-6 w-6 rounded-full p-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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