import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface BatchPricingResult {
  [cardId: number]: {
    avgPrice: number;
    salesCount: number;
    lastFetched: Date;
  };
}

export function useBatchCardPricing(cardIds: number[], enabled: boolean = false) {
  return useQuery<BatchPricingResult>({
    queryKey: ["/api/card-pricing/batch", cardIds.sort().join(",")],
    queryFn: async () => {
      if (!cardIds.length) return {};
      
      const response = await apiRequest("POST", "/api/card-pricing/batch", { cardIds });
      return response;
    },
    enabled: false, // Never auto-fetch - only fetch when explicitly requested
    staleTime: Infinity, // Never mark as stale - data persists until manually refreshed
    gcTime: Infinity, // Never garbage collect - keep cached forever
    retry: false, // Don't retry automatically
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}