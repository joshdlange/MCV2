import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { VALUE_QUERY_KEY, formatMarketValue, invalidateCollectionValues, valueEndpoint, valueParams } from "./collectionValue";
import { fixtureValueResponse, valueFixtureCards } from "../dev/value-fixtures";

test("value requests default to descending, 25-card pagination with no price threshold", () => {
  assert.equal(valueEndpoint(), "/api/collection/value");
  assert.equal(valueParams({}), "order=desc&hideUnder5=false&limit=25&offset=0");
  const params = new URLSearchParams(valueParams({ order: "asc", hideUnder5: false, search: " Wolverine ", setId: 7, favorite: true, isInsert: false }, 25, 50));
  assert.equal(params.get("offset"), "50");
  assert.equal(params.get("order"), "asc");
  assert.equal(params.get("hideUnder5"), "false");
  assert.equal(params.get("search"), "Wolverine");
  assert.equal(params.get("setId"), "7");
  assert.equal(params.get("favorite"), "true");
  assert.equal(params.get("isInsert"), "false");
  assert.equal(new URLSearchParams(valueParams({}, 5)).get("limit"), "5");
});

test("Top Cards pages include the highest card once, preserve quantities and fetch 25 at a time", () => {
  const first = fixtureValueResponse(new URLSearchParams(valueParams({})));
  const second = fixtureValueResponse(new URLSearchParams(valueParams({}, 25, 25)));
  assert.equal(first.cards.length, 25);
  assert.equal(second.cards.length, 25);
  assert.equal(first.cards[0].id, 101);
  assert.equal(first.cards[0].quantity, 2);
  const combined = [...first.cards, ...second.cards];
  assert.equal(new Set(combined.map(card => card.collectionItemId)).size, 50);
  assert.equal(combined.filter(card => card.id === first.cards[0].id).length, 1);
  assert.ok(combined.every((card, index) => index === 0 || combined[index - 1].marketValue >= card.marketValue));
  assert.equal(first.total, valueFixtureCards.length, "sub-$5 cards are included");
  assert.equal(first.summary.totalValue, second.summary.totalValue);
  const ascending = fixtureValueResponse(new URLSearchParams(valueParams({ order: "asc" })));
  assert.ok(ascending.cards[0].marketValue < 5, "controlled ascending includes inexpensive cards");
  assert.equal(ascending.summary.totalValue, first.summary.totalValue);
});

test("collector endpoint safely encodes usernames", () => {
  assert.equal(valueEndpoint("ink/vault"), "/api/collectors/ink%2Fvault/top-cards");
});

test("quantity-inclusive values are formatted from cached prices, never estimatedValue", () => {
  const fixture = valueFixtureCards[0];
  assert.notEqual(fixture.id, fixture.collectionItemId);
  assert.equal(formatMarketValue(fixture.marketValue), "$284.57");
  assert.equal(formatMarketValue(fixture.lineTotal), "$569.14");
  assert.notEqual(fixture.marketValue, Number(fixture.estimatedValue));
});

test("price/collection mutations invalidate all value modes and previews but not unrelated profile resources", async () => {
  const client = new QueryClient();
  const keys = [[VALUE_QUERY_KEY, 1, "/api/collection/value", "desc"], [VALUE_QUERY_KEY, 2, "/api/collectors/inkvault/top-cards", "preview"], ["/api/stats"], ["/api/collectors", "inkvault", { viewerId: "viewer-one" }], ["/api/collectors", "inkvault", "badges"]];
  keys.forEach(key => client.setQueryData(key, {}));
  invalidateCollectionValues(client);
  for (const key of keys.slice(0, 4)) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  assert.equal(client.getQueryState(keys[4])?.isInvalidated, false);
  client.clear();
});
