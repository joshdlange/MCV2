import { test } from "node:test";
import assert from "node:assert/strict";
import { hasUsableScanCardImage, scanCorrection, submitScanPhoto } from "./scanConfirmation";

test("manual correction reports the chosen card rather than marking a wrong suggestion correct", () => {
  assert.equal(scanCorrection(10, 10), "correct");
  assert.equal(scanCorrection(10, 11), "wrong");
  assert.equal(scanCorrection(undefined, 11), "not_found");
});

test("photo submission status reflects review response, not collection save", async () => {
  assert.equal(await submitScanPhoto(async () => ({ autoApproved: false })), "submitted");
  assert.equal(await submitScanPhoto(async () => ({ autoApproved: true })), "approved");
  assert.equal(await submitScanPhoto(async () => { throw Error("review failed"); }), "failed");
});

test("missing, non-HTTP, and known placeholder card images are unusable, including queries", () => {
  for (const url of [null, undefined, "", "  ", "not a URL", "/images/placeholder.png",
    "data:image/png;base64,abc", "blob:https://example.com/id", "ftp://example.com/card.jpg",
    "https://via.placeholder.com/200?text=Card", "https://placehold.co/200x280?text=Card",
    "https://example.com/images/placeholder.png?version=2",
    "https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png?cache=1#front"]) {
    assert.equal(hasUsableScanCardImage(url), false, String(url));
  }
  assert.equal(hasUsableScanCardImage("https://example.com/real-card.jpg?version=2"), true);
  assert.equal(hasUsableScanCardImage("http://example.com/front.webp"), true);
});