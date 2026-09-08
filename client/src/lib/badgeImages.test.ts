import { test } from "node:test";
import assert from "node:assert/strict";

import { BADGE_IMAGE_VERSION, getBadgeImageUrl } from "./badgeImages";

test("local badge PNGs use versioned WebP derivatives", () => {
  assert.equal(
    getBadgeImageUrl("/uploads/badges/vault-regular.png"),
    `/uploads/badges/thumbs/vault-regular.webp?v=${BADGE_IMAGE_VERSION}`,
  );
  assert.equal(
    getBadgeImageUrl("/badge_images/round_250.png", "large"),
    `/badge_images/large/round_250.webp?v=${BADGE_IMAGE_VERSION}`,
  );
});

test("external badge images remain unchanged", () => {
  const url = "https://example.com/badge.png";
  assert.equal(getBadgeImageUrl(url), url);
});