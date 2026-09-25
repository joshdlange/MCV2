import { test } from "node:test";
import assert from "node:assert/strict";
import { cropForCard, moveCrop, resizeCrop } from "./cardCrop";

test("portrait and landscape images produce a centered 2:3 crop within image bounds", () => {
  for (const [width, height] of [[1200, 1800], [1800, 1200], [3000, 1000]]) {
    const crop = cropForCard(width, height);
    assert.equal(crop.height / crop.width, 1.5);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= width && crop.y + crop.height <= height);
  }
});

test("a landscape card can be cropped 3:2 without rotating its artwork", () => {
  const crop = cropForCard(1800, 1200, 0.9, "landscape");
  assert.equal(crop.width / crop.height, 1.5);
  assert.equal(crop.x, 90);
  assert.equal(crop.y, 60);
});

test("dragging and resizing clamp crop to the image, keeping exact ratio", () => {
  const original = cropForCard(1800, 1200);
  const moved = moveCrop(original, 10000, -10000, 1800, 1200);
  assert.equal(moved.x + moved.width, 1800);
  assert.equal(moved.y, 0);
  const resized = resizeCrop(moved, 1800, 1200, 0.4);
  assert.equal(resized.height / resized.width, 1.5);
  assert.ok(resized.x >= 0 && resized.y >= 0);
  assert.ok(resized.x + resized.width <= 1800 && resized.y + resized.height <= 1200);
});