import type { QueryClient } from "@tanstack/react-query";

export interface ValueCard {
  id: number;
  collectionItemId: number;
  quantity: number;
  marketValue: number;
  lineTotal: number;
  priceUpdatedAt: string | null;
  name: string;
  cardNumber: string;
  setId: number;
  isInsert: boolean;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  rarity: string;
  estimatedValue: string | null;
  set: { id: number; name: string; year: number; mainSetId: number | null };
}

export interface CollectionValueResponse {
  cards: ValueCard[];
  total: number;
  hasMore: boolean;
  summary: {
    totalValue: number;
    pricedCards: number;
    unpricedCards: number;
    pricedCopies: number;
    pricesUpdatedAt: string | null;
  };
}

export interface ValueFilters {
  order?: "desc" | "asc";
  hideUnder5?: boolean;
  search?: string;
  setId?: number;
  favorite?: boolean;
  isInsert?: boolean;
}

export const VALUE_QUERY_KEY = "cached-collection-value";
export const formatMarketValue = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function valueEndpoint(username?: string) {
  return username
    ? `/api/collectors/${encodeURIComponent(username)}/top-cards`
    : "/api/collection/value";
}

export function valueParams(filters: ValueFilters, limit = 25, offset = 0) {
  const params = new URLSearchParams({
    order: filters.order ?? "desc",
    hideUnder5: String(filters.hideUnder5 ?? false),
    limit: String(limit),
    offset: String(offset),
  });
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.setId !== undefined) params.set("setId", String(filters.setId));
  if (filters.favorite) params.set("favorite", "true");
  if (filters.isInsert !== undefined) params.set("isInsert", String(filters.isInsert));
  return params.toString();
}

export function invalidateCollectionValues(client: QueryClient) {
  void client.invalidateQueries({ queryKey: [VALUE_QUERY_KEY] });
  void client.invalidateQueries({ queryKey: ["/api/stats"] });
  // Refresh only profile summaries, not every social/profile resource.
  void client.invalidateQueries({
    predicate: query => query.queryKey[0] === "/api/collectors" && (
      query.queryKey.length === 2 ||
      (query.queryKey.length === 3 && typeof query.queryKey[2] === "object" && query.queryKey[2] !== null && "viewerId" in query.queryKey[2])
    ),
  });
}
