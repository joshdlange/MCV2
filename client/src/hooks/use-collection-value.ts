import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { VALUE_QUERY_KEY, valueEndpoint, valueParams, type ValueFilters, type CollectionValueResponse } from "@/lib/collectionValue";

export function useCollectionValue(filters: ValueFilters = {}, username?: string, preview = false) {
  const limit = preview ? 5 : 25;
  const endpoint = valueEndpoint(username);
  const viewerId = useAppStore(state => state.currentUser?.id);
  return useInfiniteQuery<CollectionValueResponse>({
    queryKey: [VALUE_QUERY_KEY, viewerId, endpoint, valueParams(filters, limit)],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) =>
      (await apiRequest("GET", `${endpoint}?${valueParams(filters, limit, Number(pageParam))}`, undefined, signal)).json(),
    getNextPageParam: (last, pages) =>
      !preview && last.hasMore ? pages.reduce((count, page) => count + page.cards.length, 0) : undefined,
    staleTime: 60_000,
    retry: false,
    enabled: !!viewerId,
  });
}
