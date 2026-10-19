// Catalog metadata changes infrequently. Keep new releases discoverable without
// downloading thousands of subsets every 30 seconds. Mutations still invalidate.
export const catalogQueryOptions = {
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
} as const;
