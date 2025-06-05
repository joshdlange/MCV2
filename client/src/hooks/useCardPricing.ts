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
    enabled: cardId > 0 && autoFetch, // Disabled auto-fetch to reduce API calls
    staleTime: 1000 * 60 * 30, // 30 minutes - longer cache for better performance
    retry: (failureCount, error) => {
      // Retry up to 2 times for network errors, but not for 404s
      return failureCount < 2 && !error.message.includes('404');
    },
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
    refetchOnMount: true, // Always fetch when component mounts
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