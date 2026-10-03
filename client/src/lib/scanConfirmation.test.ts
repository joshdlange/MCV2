import { test } from "node:test";
import assert from "node:assert/strict";
import { hasUsableScanCardImage, runDevScanAction, scanCorrection, submitScanPhoto } from "./scanConfirmation";

test("matched Add executes ownership once and never invokes upload, even without a catalog image", async () => {
  for (const missingImage of [true, false]) {
    let adds = 0;
    let uploads = 0;
    const result = await runDevScanAction({ source: "match", missingImage, hasPhoto: true }, "add", {
      add: async () => { adds++; return { created: true, cardId: 418 }; },
      upload: async () => { uploads++; throw new Error("Must not upload on matched Add"); },
    });
    assert.equal(adds, 1);
    assert.equal(uploads, 0);
    assert.equal(result.next, "next");
    assert.equal(result.saved?.cardId, 418);
  }
});

test("search-picked usable image adds without offer or upload", async () => {
  let uploads = 0;
  const result = await runDevScanAction({ source: "search", missingImage: false, hasPhoto: true }, "add", {
    add: async () => "owned", upload: async () => { uploads++; return {}; },
  });
  assert.equal(result.saved, "owned");
  assert.equal(result.next, "next");
  assert.equal(uploads, 0);
});

test("a missing search image with no retained photo adds without an unusable offer", async () => {
  let uploads = 0;
  const result = await runDevScanAction({ source: "search", missingImage: true, hasPhoto: false }, "add", {
    add: async () => "owned", upload: async () => { uploads++; return {}; },
  });
  assert.equal(result.next, "next");
  assert.equal(uploads, 0);
});

test("missing search image offers; only explicit Yes uploads; Skip has no effects", async () => {
  let adds = 0, uploads = 0;
  const policy = { source: "search" as const, missingImage: true, hasPhoto: true };
  const effects = {
    add: async () => { adds++; return "owned"; },
    upload: async () => { uploads++; return { autoApproved: false }; },
  };
  assert.equal((await runDevScanAction(policy, "add", effects)).next, "offer");
  assert.equal(adds, 1);
  assert.equal(uploads, 0);
  assert.equal((await runDevScanAction(policy, "skip", effects)).next, "next");
  assert.equal(adds, 1);
  assert.equal(uploads, 0);
  assert.equal((await runDevScanAction(policy, "yes", effects)).photoResult?.autoApproved, false);
  assert.equal(adds, 1);
  assert.equal(uploads, 1);
});

test("policy rejects unintended Yes and propagates failures for retry instead of false success", async () => {
  let uploads = 0;
  const effects = { add: async () => { throw new Error("Ownership failed"); }, upload: async () => { uploads++; throw new Error("Upload failed"); } };
  await assert.rejects(runDevScanAction({ source: "match", missingImage: true, hasPhoto: true }, "yes", effects), /not eligible/);
  await assert.rejects(runDevScanAction({ source: "search", missingImage: false, hasPhoto: true }, "yes", effects), /not eligible/);
  await assert.rejects(runDevScanAction({ source: "search", missingImage: true, hasPhoto: false }, "yes", effects), /not eligible/);
  assert.equal(uploads, 0);
  await assert.rejects(runDevScanAction({ source: "match", missingImage: true, hasPhoto: true }, "add", effects), /Ownership failed/);
  await assert.rejects(runDevScanAction({ source: "search", missingImage: true, hasPhoto: true }, "yes", effects), /Upload failed/);
  assert.equal(uploads, 1);
});

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