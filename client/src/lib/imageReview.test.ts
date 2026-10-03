import { test } from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { bulkApprovableImageIds, canApproveImageReview, imageReportReasonLabel, isWrongImageReport, reportCardImage } from "./imageReview";

test("report-only multipart uses Firebase bearer and sends no photo or ownership request", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(url, "/api/cards/418/report-image");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer firebase-token");
    const body = init?.body as FormData;
    assert.equal(body.get("reason"), "wrong_card");
    assert.equal(body.has("frontImage"), false);
    return new Response(JSON.stringify({ success: true, pendingImage: { id: 31 }, autoApproved: false }));
  };
  try {
    const result = await reportCardImage(418, "wrong_card", null, async () => "firebase-token");
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test("explicit report attachment is the only supplied photo; failures reject for dialog retry", async () => {
  const original = globalThis.fetch;
  const file = new File(["freshly-chosen"], "replacement.webp", { type: "image/webp" }) as unknown as globalThis.File;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = init?.body as FormData;
    assert.equal(body.get("reason"), "poor_quality");
    assert.equal((body.get("frontImage") as globalThis.File).name, "replacement.webp");
    return new Response(JSON.stringify({ message: "Review unavailable" }), { status: 503 });
  };
  try {
    await assert.rejects(reportCardImage(418, "poor_quality", file, async () => "token"), /Review unavailable/);
    assert.equal(calls, 1);
    await assert.rejects(reportCardImage(418, "poor_quality", new File(["bad"], "photo.gif", { type: "image/gif" }) as unknown as globalThis.File, async () => "token"), /JPEG/);
    await assert.rejects(reportCardImage(418, "poor_quality", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }) as unknown as globalThis.File, async () => "token"), /5MB/);
    await assert.rejects(reportCardImage(418, "poor_quality", null, async () => undefined), /sign in/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("an OK response without successful report acknowledgement is not success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false }));
  try { await assert.rejects(reportCardImage(418, "other", null, async () => "token"), /could not be sent/); }
  finally { globalThis.fetch = original; }
});

test("admin report approval requires a photo or valid replacement and bulk excludes all reports", () => {
  const report = { id: 1, source: "wrong_image:wrong_card", reviewKind: "wrong_image" as const, frontImageUrl: null };
  const supplied = { ...report, id: 2, frontImageUrl: "https://cards.example/front.webp" };
  const legacy = { id: 3, source: "scan_to_add", frontImageUrl: "https://cards.example/front.jpg" };
  const sourceOnly = { id: 4, source: "wrong_image:back_image" };
  assert.equal(isWrongImageReport(report), true);
  assert.equal(isWrongImageReport(sourceOnly), true);
  assert.equal(canApproveImageReview(report), false);
  assert.equal(canApproveImageReview(report, "not a url"), false);
  assert.equal(canApproveImageReview(report, "javascript:alert(1)"), false);
  assert.equal(canApproveImageReview(report, "https://cards.example/replacement.png"), true);
  assert.equal(canApproveImageReview(supplied), true);
  assert.equal(canApproveImageReview(legacy), true);
  assert.deepEqual(bulkApprovableImageIds([report, supplied, legacy, sourceOnly], new Set([1, 2, 3, 4])), [3]);
  assert.equal(imageReportReasonLabel("back_image"), "Card back");
});