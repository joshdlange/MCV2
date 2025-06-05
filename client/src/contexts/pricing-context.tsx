import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface PricingData {
  avgPrice: number;
  salesCount: number;
  lastFetched: string;
}

interface PricingContextType {
  getPricing: (cardId: number) => PricingData | null;
  isLoading: (cardId: number) => boolean;
  refreshPricing: (cardId: number) => Promise<void>;
}

const PricingContext = createContext<PricingContextType | null>(null);

interface PricingProviderProps {
  children: ReactNode;
}

export function PricingProvider({ children }: PricingProviderProps) {
  const [pricingCache, setPricingCache] = useState<Map<number, PricingData>>(new Map());
  const [loadingCards, setLoadingCards] = useState<Set<number>>(new Set());
  const [requestQueue, setRequestQueue] = useState<Set<number>>(new Set());

  // Process pricing requests in batches to prevent overwhelming the server
  useEffect(() => {
    if (requestQueue.size === 0) return;

    const timer = setTimeout(async () => {
      const cardsToFetch = Array.from(requestQueue).slice(0, 5); // Process 5 at a time
      setRequestQueue(prev => {
        const newQueue = new Set(prev);
        cardsToFetch.forEach(cardId => newQueue.delete(cardId));
        return newQueue;
      });

      setLoadingCards(prev => {
        const newLoading = new Set(prev);
        cardsToFetch.forEach(cardId => newLoading.add(cardId));
        return newLoading;
      });

      // Fetch pricing for batch of cards
      const promises = cardsToFetch.map(async (cardId) => {
        try {
          const response = await fetch(`/api/card-pricing/${cardId}`);
          if (response.ok) {
            const data = await response.json();
            return { cardId, data };
          }
        } catch (error) {
          console.warn(`Failed to fetch pricing for card ${cardId}:`, error);
        }
        return { cardId, data: null };
      });

      const results = await Promise.all(promises);
      
      setPricingCache(prev => {
        const newCache = new Map(prev);
        results.forEach(({ cardId, data }) => {
          if (data) {
            newCache.set(cardId, data);
          }
        });
        return newCache;
      });

      setLoadingCards(prev => {
        const newLoading = new Set(prev);
        cardsToFetch.forEach(cardId => newLoading.delete(cardId));
        return newLoading;
      });
    }, 100); // Small delay to batch requests

    return () => clearTimeout(timer);
  }, [requestQueue]);

  const getPricing = (cardId: number): PricingData | null => {
    // Check if we already have the data
    if (pricingCache.has(cardId)) {
      return pricingCache.get(cardId)!;
    }

    // Add to request queue if not already loading
    if (!loadingCards.has(cardId) && !requestQueue.has(cardId)) {
      setRequestQueue(prev => new Set(prev).add(cardId));
    }

    return null;
  };

  const isLoading = (cardId: number): boolean => {
    return loadingCards.has(cardId) || requestQueue.has(cardId);
  };

  const refreshPricing = async (cardId: number): Promise<void> => {
    setLoadingCards(prev => new Set(prev).add(cardId));
    
    try {
      const response = await fetch(`/api/refresh-card-pricing/${cardId}`, {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPricingCache(prev => {
            const newCache = new Map(prev);
            newCache.set(cardId, {
              avgPrice: data.avgPrice,
              salesCount: data.salesCount,
              lastFetched: new Date().toISOString()
            });
            return newCache;
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to refresh pricing for card ${cardId}:`, error);
    } finally {
      setLoadingCards(prev => {
        const newLoading = new Set(prev);
        newLoading.delete(cardId);
        return newLoading;
      });
    }
  };

  return (
    <PricingContext.Provider value={{ getPricing, isLoading, refreshPricing }}>
      {children}
    </PricingContext.Provider>
  );
}

export function usePricing() {
  const context = useContext(PricingContext);
  if (!context) {
    throw new Error('usePricing must be used within a PricingProvider');
  }
  return context;
}