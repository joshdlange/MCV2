import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCorrection, submitScanPhoto } from "./scanConfirmation";

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