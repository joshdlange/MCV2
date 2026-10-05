export type FeedAudience = "everyone" | "following" | "me";
export type FeedContentType = "all" | "badges" | "cards" | "activity";

export const feedQueryKey = (audience: FeedAudience, type: FeedContentType) =>
  ["/api/feed", audience, type] as const;

// Only a network first-page replacement changes this token. Cache patches must
// not reset pagination, unlike Query's dataUpdatedAt (which changes on both).
export const feedPageKey = (audience: FeedAudience, type: FeedContentType, version?: string) =>
  `${audience}:${type}:${version ?? ""}`;

export interface ReactionEvent {
  id: number;
  reactions: Record<string, number>;
  myReaction: string | null;
}

export interface ReactionResult {
  eventId: number;
  reactions: Record<string, number>;
  myReaction: string | null;
}

export interface ReactionLedger {
  version: number;
  patches: Map<number, ReactionResult & { version: number }>;
}

export function createReactionLedger(): ReactionLedger {
  return { version: 0, patches: new Map() };
}

const ledgers = new WeakMap<object, ReactionLedger>();

// Inactive cached queries retain their structuralSharing callback across Feed
// remounts. They must all use the same ledger, not a previous mount's patches.
export function getReactionLedger(cacheOwner: object): ReactionLedger {
  let ledger = ledgers.get(cacheOwner);
  if (!ledger) {
    ledger = createReactionLedger();
    ledgers.set(cacheOwner, ledger);
  }
  return ledger;
}

export function recordReaction(ledger: ReactionLedger, result: ReactionResult) {
  ledger.patches.set(result.eventId, { ...result, version: ++ledger.version });
}

export function patchReaction<T extends ReactionEvent>(event: T, result: ReactionResult): T {
  return event.id === result.eventId
    ? { ...event, reactions: result.reactions, myReaction: result.myReaction }
    : event;
}

// A request started before a successful reaction may contain stale personal
// state. Reconcile only those races; requests started later remain authoritative
// so other collectors' new reaction counts are not frozen by a local overlay.
export function reconcileReactions<T extends ReactionEvent>(
  events: T[], ledger: ReactionLedger, requestVersion: number,
): T[] {
  return events.map(event => {
    const patch = ledger.patches.get(event.id);
    return patch && patch.version > requestVersion ? patchReaction(event, patch) : event;
  });
}

export function reconcileFeedPage<T extends {
  events: ReactionEvent[];
  reactionVersion?: number;
}>(page: T, ledger: ReactionLedger): T {
  return {
    ...page,
    events: reconcileReactions(page.events, ledger, page.reactionVersion ?? ledger.version),
  };
}

export function mergeFeedEvents<T extends { id: number }>(first: T[], older: T[]): T[] {
  const seen = new Set<number>();
  return [...first, ...older].filter(event => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}
