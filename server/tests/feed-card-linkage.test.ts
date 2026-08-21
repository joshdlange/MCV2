import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFirstCardFeedEvent,
  resolveVisibleFeedRelation,
} from "../services/feedService";

test("new first-card events persist the exact card relationship", () => {
  const event = buildFirstCardFeedEvent(42, 535657);

  assert.equal(event.eventType, "first_card");
  assert.equal(event.relatedType, "card");
  assert.equal(event.relatedId, 535657);
  assert.equal(event.dedupeKey, "first_card:42");
});

test("legacy first-card events resolve to a card even when image enrichment is empty", () => {
  const relation = resolveVisibleFeedRelation({
    eventType: "first_card",
    relatedType: null,
    relatedId: null,
    firstCardId: 79703,
    canExposeCard: true,
  });

  assert.deepEqual(relation, { relatedType: "card", relatedId: 79703 });
});

test("a persisted first-card ID wins over the legacy fallback", () => {
  const relation = resolveVisibleFeedRelation({
    eventType: "first_card",
    relatedType: "card",
    relatedId: 535657,
    firstCardId: 79703,
    canExposeCard: true,
  });

  assert.deepEqual(relation, { relatedType: "card", relatedId: 535657 });
});

test("card relationships remain visible to their owner when collection sharing is off", () => {
  const relation = resolveVisibleFeedRelation({
    eventType: "first_card",
    relatedType: "card",
    relatedId: 79703,
    firstCardId: 79703,
    canExposeCard: true,
  });

  assert.deepEqual(relation, { relatedType: "card", relatedId: 79703 });
});

test("card relationships are removed for other viewers when collection sharing is off", () => {
  const relation = resolveVisibleFeedRelation({
    eventType: "image_approved",
    relatedType: "card",
    relatedId: 79703,
    canExposeCard: false,
  });

  assert.deepEqual(relation, { relatedType: null, relatedId: null });
});