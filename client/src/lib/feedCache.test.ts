import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import {
  createReactionLedger, feedPageKey, feedQueryKey, getReactionLedger, mergeFeedEvents,
  patchReaction, reconcileFeedPage, reconcileReactions, recordReaction,
  type FeedAudience, type FeedContentType, type ReactionEvent,
} from "./feedCache";

const event = (id: number, myReaction: string | null = null): ReactionEvent => ({
  id, myReaction, reactions: myReaction ? { [myReaction]: 1 } : {},
});
const result = { eventId: 7, myReaction: "fire_pull", reactions: { fire_pull: 3 } };

test("audience and content isolate every query and pagination session", () => {
  const audiences: FeedAudience[] = ["everyone", "following", "me"];
  const types: FeedContentType[] = ["all", "badges", "cards", "activity"];
  const keys = audiences.flatMap(audience => types.map(type => feedQueryKey(audience, type)));
  assert.equal(new Set(keys.map(key => JSON.stringify(key))).size, 12);
  assert.equal(new Set(audiences.flatMap(audience =>
    types.map(type => feedPageKey(audience, type, "first-page")),
  )).size, 12);
});

test("reaction cache patches keep older pages valid; network replacement invalidates them", () => {
  const page = { events: [event(7)], nextCursor: "older", pageVersion: "network-a" };
  const patched = { ...page, events: page.events.map(e => patchReaction(e, result)) };
  assert.equal(feedPageKey("everyone", "all", page.pageVersion),
    feedPageKey("everyone", "all", patched.pageVersion));
  assert.notEqual(feedPageKey("everyone", "all", page.pageVersion),
    feedPageKey("everyone", "all", "network-b"));
  assert.equal(patched.nextCursor, "older");
});

test("a successful reaction updates all cached audiences/types but not discovery", () => {
  const client = new QueryClient();
  const keys = [feedQueryKey("everyone", "all"), feedQueryKey("following", "badges"), feedQueryKey("me", "cards")];
  for (const key of keys) client.setQueryData(key, { events: [event(7), event(8)], pageVersion: "original" });
  const discovery = { collectors: [{ id: 7 }] };
  client.setQueryData(["/api/feed/discover"], discovery);
  client.setQueriesData<{ events: ReactionEvent[]; pageVersion: string }>(
    { queryKey: ["/api/feed"] },
    old => old ? { ...old, events: old.events.map(e => patchReaction(e, result)) } : old,
  );
  for (const key of keys) {
    const page = client.getQueryData<{ events: ReactionEvent[]; pageVersion: string }>(key)!;
    assert.equal(page.events[0].myReaction, "fire_pull");
    assert.equal(page.events[0].reactions.fire_pull, 3);
    assert.equal(page.events[1].myReaction, null);
    assert.equal(page.pageVersion, "original");
  }
  assert.deepEqual(client.getQueryData(["/api/feed/discover"]), discovery);
  client.clear();
});

test("first-page and older-page requests begun before success cannot overwrite myReaction", () => {
  const ledger = createReactionLedger();
  const requestVersion = ledger.version;
  recordReaction(ledger, result);
  for (const stalePage of [[event(7)], [event(8), event(7)]]) {
    const reconciled = reconcileReactions(stalePage, ledger, requestVersion);
    assert.equal(reconciled.find(e => e.id === 7)?.myReaction, "fire_pull");
    assert.equal(reconciled.find(e => e.id === 7)?.reactions.fire_pull, 3);
  }
});

test("reaction removal and switching reaction use the latest authoritative result", () => {
  const ledger = createReactionLedger();
  recordReaction(ledger, result);
  recordReaction(ledger, { eventId: 7, myReaction: "hero_move", reactions: { fire_pull: 2, hero_move: 1 } });
  assert.equal(reconcileReactions([event(7)], ledger, 0)[0].myReaction, "hero_move");
  recordReaction(ledger, { eventId: 7, myReaction: null, reactions: { fire_pull: 2 } });
  const removed = reconcileReactions([event(7, "hero_move")], ledger, 0)[0];
  assert.equal(removed.myReaction, null);
  assert.deepEqual(removed.reactions, { fire_pull: 2 });
});

test("requests begun after reaction success remain authoritative for new community counts", () => {
  const ledger = createReactionLedger();
  recordReaction(ledger, result);
  const latest = { ...event(7, "fire_pull"), reactions: { fire_pull: 9 } };
  assert.deepEqual(reconcileReactions([latest], ledger, ledger.version), [latest]);
});

test("reconciliation at Query cache commit covers success after queryFn returned", async () => {
  const client = new QueryClient();
  const ledger = createReactionLedger();
  const key = feedQueryKey("following", "activity");
  await client.fetchQuery({
    queryKey: key,
    queryFn: async () => {
      const returnedPage = { events: [event(7)], pageVersion: "new-page", reactionVersion: ledger.version };
      // Model the microtask gap before React Query commits queryFn's result.
      queueMicrotask(() => recordReaction(ledger, result));
      return returnedPage;
    },
    structuralSharing: (_old, incoming) => reconcileFeedPage(
      incoming as { events: ReactionEvent[]; pageVersion: string; reactionVersion: number }, ledger,
    ),
  });
  assert.equal(client.getQueryData<{ events: ReactionEvent[] }>(key)?.events[0].myReaction, "fire_pull");
  client.clear();
});

test("first-page events win overlapping cursor pages without duplicate event cards", () => {
  const latest = event(7, "fire_pull");
  assert.deepEqual(mergeFeedEvents([latest, event(8)], [event(7), event(9), event(9)]),
    [latest, event(8), event(9)]);
  assert.deepEqual(mergeFeedEvents([], []), []);
});

test("ledger ownership follows the cache, not a Feed mount or another cache", () => {
  const cacheOwner = {};
  const firstMount = getReactionLedger(cacheOwner);
  recordReaction(firstMount, result);
  assert.equal(getReactionLedger(cacheOwner), firstMount);
  assert.equal(getReactionLedger(cacheOwner).version, 1);
  assert.equal(getReactionLedger({}).version, 0);
});

test("inactive cache callbacks after remount use the latest reaction, not the old mount's result", async () => {
  const client = new QueryClient();
  const previousMountLedger = getReactionLedger(client);
  const key = feedQueryKey("me", "all");
  await client.fetchQuery({
    queryKey: key,
    queryFn: async () => ({ events: [event(7)], reactionVersion: 0 }),
    structuralSharing: (_old, incoming) => reconcileFeedPage(
      incoming as { events: ReactionEvent[]; reactionVersion: number }, previousMountLedger,
    ),
  });
  recordReaction(previousMountLedger, result);
  const newMountLedger = getReactionLedger(client);
  const removed = { eventId: 7, reactions: { fire_pull: 2 }, myReaction: null };
  recordReaction(newMountLedger, removed);
  client.setQueriesData<{ events: ReactionEvent[]; reactionVersion: number }>(
    { queryKey: ["/api/feed"] },
    old => old ? { ...old, events: old.events.map(e => patchReaction(e, removed)) } : old,
  );
  assert.equal(client.getQueryData<{ events: ReactionEvent[] }>(key)?.events[0].myReaction, null);
  client.clear();
});
