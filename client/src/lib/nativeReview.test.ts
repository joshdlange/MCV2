import { test } from "node:test";
import assert from "node:assert/strict";
import { requestMilestoneReview } from "./nativeReview";

function fixture() {
  const data = new Map<string, string>();
  let calls = 0;
  return {
    options: {
      userId: 1, nativeMobileLogins: 4, available: true,
      storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } },
      request: async () => { calls++; },
    },
    calls: () => calls,
  };
}
test("native fourth launch requests once, including concurrent mounts and later visits", async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([requestMilestoneReview(f.options), requestMilestoneReview(f.options)]), ["requested", "skipped"]);
  assert.equal(await requestMilestoneReview({ ...f.options, nativeMobileLogins: 10 }), "skipped");
  assert.equal(f.calls(), 1);
});
test("web, old binaries and early launches never claim the milestone", async () => {
  const f = fixture();
  for (const patch of [{ available: false }, { nativeMobileLogins: 3 }]) {
    assert.equal(await requestMilestoneReview({ ...f.options, ...patch }), "skipped");
  }
  assert.equal(await requestMilestoneReview(f.options), "requested");
});
test("existing eligible users catch up, while account markers stay separate", async () => {
  const f = fixture();
  await requestMilestoneReview({ ...f.options, nativeMobileLogins: 20 });
  await requestMilestoneReview({ ...f.options, userId: 2 });
  assert.equal(f.calls(), 2);
});
test("OS suppression resolves normally; failures do not loop or redirect", async () => {
  const f = fixture();
  assert.equal(await requestMilestoneReview({ ...f.options, request: async () => { throw new Error("unavailable"); } }), "failed");
  assert.equal(await requestMilestoneReview(f.options), "skipped");
});
test("denied storage skips safely", async () => {
  const f = fixture();
  assert.equal(await requestMilestoneReview({ ...f.options, storage: {
    getItem: () => { throw new Error("denied"); }, setItem: () => {},
  } }), "skipped");
  assert.equal(f.calls(), 0);
});