import { test } from "node:test";
import assert from "node:assert/strict";

import { pickMission } from "./dailyMission";

const stats = {
  totalCards: 0,
  wishlistItems: 0,
};

test("the fourth tracked login receives the review mission", () => {
  const mission = pickMission(stats, undefined, 4);
  assert.equal(mission.headline, "Help the Vault");
  assert.equal(mission.cta, "Leave a Review");
  assert.equal(mission.review, true);
});

test("the review mission does not replace other mission days", () => {
  assert.equal(pickMission(stats, undefined, 3).review, undefined);
  assert.equal(pickMission(stats, undefined, 5).review, undefined);
});