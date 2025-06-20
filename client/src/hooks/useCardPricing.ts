import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CardPricing {
  avgPrice: number;
  salesCount: number;
  lastFetched: Date;
}

export function useCardPricing(cardId: number, autoFetch: boolean = false) {
  return useQuery({
    queryKey: ["/api/card-pricing", cardId],
    queryFn: async () => {
      if (!cardId || cardId <= 0) {
        return null; // Invalid card ID
      }
      const response = await apiRequest("GET", `/api/card-pricing/${cardId}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null; // No pricing data available
        }
        throw new Error("Failed to fetch pricing data");
      }
      return response.json() as Promise<CardPricing>;
    },
    enabled: false, // Never auto-fetch - only fetch when explicitly requested or refreshed
    staleTime: Infinity, // Never mark as stale - data persists until manually refreshed
    gcTime: Infinity, // Never garbage collect - keep cached forever
    retry: false, // Don't retry automatically
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
    refetchOnMount: false, // Don't refetch when component mounts
  });
}

export function useRefreshCardPricing() {
  return async (cardId: number) => {
    const response = await apiRequest("POST", `/api/card-pricing/${cardId}/refresh`);
    if (!response.ok) {
      throw new Error("Failed to refresh pricing data");
    }
    return response.json() as Promise<CardPricing>;
  };
}