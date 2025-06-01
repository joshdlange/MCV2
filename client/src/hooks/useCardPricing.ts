import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CardPricing {
  avgPrice: number;
  salesCount: number;
  lastFetched: Date;
}

export function useCardPricing(cardId: number) {
  return useQuery({
    queryKey: ["/api/card-pricing", cardId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/card-pricing/${cardId}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null; // No pricing data available
        }
        throw new Error("Failed to fetch pricing data");
      }
      return response.json() as Promise<CardPricing>;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: false,
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