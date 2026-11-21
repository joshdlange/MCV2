import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionActionRequest } from "./cardCollectionActions";
const owned = { id: 42, cardId: 123, quantity: 2 };

test("add is idempotent and never silently increments an already owned card", () => {
  assert.deepEqual(collectionActionRequest("add", 123), {
    method: "POST", url: "/api/collection",
    body: { cardId: 123, condition: "Near Mint", quantity: 1, incrementExisting: false },
  });
});
test("visible plus and minus update the collection row, not catalog card", () => {
  assert.deepEqual(collectionActionRequest("increase", 123, owned), { method: "PATCH", url: "/api/collection/42", body: { quantity: 3 } });
  assert.deepEqual(collectionActionRequest("decrease", 123, owned), { method: "PATCH", url: "/api/collection/42", body: { quantity: 1 } });
});
test("last copy requires explicit removal; removing deletes all copies", () => {
  assert.throws(() => collectionActionRequest("decrease", 123, { ...owned, quantity: 1 }), /Confirm removal/);
  assert.deepEqual(collectionActionRequest("remove", 123, owned), { method: "DELETE", url: "/api/collection/42", body: undefined });
});
test("stale card targets and maximum quantity cannot be mutated", () => {
  assert.throws(() => collectionActionRequest("remove", 456, owned), /Refresh/);
  assert.throws(() => collectionActionRequest("increase", 123), /Refresh/);
  assert.throws(() => collectionActionRequest("increase", 123, { ...owned, quantity: 9999 }), /9,999/);
});
