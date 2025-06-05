import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CardValueProps {
  cardId: number;
  showRefresh?: boolean;
}

interface PricingData {
  avgPrice: number;
  salesCount: number;
  lastFetched: string;
}

export function CardValue({ cardId, showRefresh = false }: CardValueProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: pricing, isLoading } = useQuery<PricingData>({
    queryKey: ["/api/card-pricing", cardId],
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: false
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/refresh-card-pricing/${cardId}`, {
        method: "POST"
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        queryClient.invalidateQueries({
          queryKey: ["/api/card-pricing", cardId]
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

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <DollarSign className="w-3 h-3" />
        <span>...</span>
      </div>
    );
  }

  if (!pricing || !pricing.avgPrice || pricing.avgPrice <= 0) {
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

  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs font-semibold">
        <DollarSign className="w-3 h-3 mr-1" />
        ${pricing.avgPrice.toFixed(2)}
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