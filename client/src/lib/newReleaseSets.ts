/** Rank the full catalog before filtering, so older sets don't become "new" in search. */
export function getNewReleaseSetIds(
  sets: readonly { id: number; createdAt: Date | string | null }[],
): Set<number> {
  const timestamp = (value: Date | string | null) => {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  return new Set([...sets]
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || b.id - a.id)
    .slice(0, 3)
    .map(set => set.id));
}