import { test } from "node:test";
import assert from "node:assert/strict";
import { awardSessionMilestone, recordAuthenticatedSession, readReviewState, requestMilestoneReview, REVIEW_COOLDOWN_MS } from "./nativeReview";
function fixture(count = 4) {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  for (let i = 1; i <= count; i++) recordAuthenticatedSession(storage, `session-${i}`, i);
  let calls = 0;
  return { storage, options: { userId: 1, native: true, available: true, storage, now: 100,
    request: async () => { calls++; } }, calls: () => calls };
}
test("successful session recorded once despite duplicate callbacks and retries", () => {
  const f = fixture(1);
  for (let i = 0; i < 10; i++) recordAuthenticatedSession(f.storage, "session-1", 20);
  assert.equal(readReviewState(f.storage)?.authenticatedSessionCount, 1);
  assert.equal(readReviewState(f.storage)?.firstAppOpenAt, 1);
});
test("session four or later is eligible when no native request has been attempted", async () => {
  for (const count of [1, 2, 3]) assert.equal(await requestMilestoneReview(fixture(count).options), "skipped");
  for (const count of [4, 5, 10]) assert.equal(await requestMilestoneReview(fixture(count).options), "requested");
});
test("browser and missing plugin never call or record a request", async () => {
  for (const patch of [{ native: false }, { available: false }]) {
    const f = fixture();
    assert.equal(await requestMilestoneReview({ ...f.options, ...patch }), "skipped");
    assert.equal(f.calls(), 0);
    assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, null);
  }
});
test("concurrent mounts claim before OS invocation and obey 120-day suppression", async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([requestMilestoneReview(f.options), requestMilestoneReview(f.options)]), ["requested", "skipped"]);
  assert.equal(await requestMilestoneReview({ ...f.options, now: 100 + REVIEW_COOLDOWN_MS - 1 }), "skipped");
  assert.equal(f.calls(), 1);
});
test("request failure stays claimed, with no dismissal retry", async () => {
  const f = fixture();
  assert.equal(await requestMilestoneReview({ ...f.options, request: async () => { throw Error(); } }), "failed");
  assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, 100);
  assert.equal(await requestMilestoneReview(f.options), "skipped");
});
test("legacy claims are conservatively preserved", async () => {
  const f = fixture();
  f.storage.setItem("mcv:native-review:fourth-launch:1", "requested");
  assert.equal(await requestMilestoneReview(f.options), "skipped");
});
test("blocked or corrupt storage never affects authentication or requests", async () => {
  const storage = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
  assert.equal(recordAuthenticatedSession(storage, "session"), null);
  assert.equal(await requestMilestoneReview({ ...fixture().options, storage }), "skipped");
});
test("badge milestone is independent of OS availability and successful review", async () => {
  const f = fixture();
  let awards = 0;
  await requestMilestoneReview({ ...f.options, available: false });
  const options = { userId: 1, storage: f.storage, award: async () => { awards++; return true; } };
  await awardSessionMilestone(options);
  await awardSessionMilestone(options);
  assert.equal(awards, 1);
  assert.equal(readReviewState(f.storage)?.reviewMilestoneAwarded, true);
  assert.equal(f.calls(), 0);
});
test("unconfigured badge remains pending and can be awarded later without a review", async () => {
  const f = fixture();
  await awardSessionMilestone({ userId: 1, storage: f.storage, award: async () => false });
  assert.equal(readReviewState(f.storage)?.reviewMilestoneAwarded, false);
  recordAuthenticatedSession(f.storage, "later-session");
  await awardSessionMilestone({ userId: 1, storage: f.storage, award: async () => true });
  assert.equal(readReviewState(f.storage)?.reviewMilestoneAwarded, true);
  assert.equal(f.calls(), 0);
});

test("A/B/C/E: old binary session four earns badge; upgrade session five requests once; session six stays quiet", async () => {
  const f = fixture();
  let awards = 0;
  const badge = { userId: 1, storage: f.storage, award: async () => { awards++; return true; } };
  assert.equal(await requestMilestoneReview({ ...f.options, available: false }), "skipped");
  await awardSessionMilestone(badge);
  assert.equal(readReviewState(f.storage)?.authenticatedSessionCount, 4);
  assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, null);
  assert.equal(readReviewState(f.storage)?.reviewMilestoneAwarded, true);
  assert.equal(f.calls(), 0);

  recordAuthenticatedSession(f.storage, "session-5");
  // Verify the date is committed immediately before the actual native invocation.
  assert.equal(await requestMilestoneReview({ ...f.options, now: 200, request: async () => {
    assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, 200);
    await f.options.request();
  } }), "requested");
  await awardSessionMilestone(badge);
  recordAuthenticatedSession(f.storage, "session-6");
  assert.equal(await requestMilestoneReview({ ...f.options, now: 300 }), "skipped");
  await awardSessionMilestone(badge);
  assert.equal(awards, 1);
  assert.equal(f.calls(), 1);
  assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, 200);
});

test("D: 120-day suppression remains enforced; expiration does not create a repeat milestone", async () => {
  const f = fixture(5);
  await requestMilestoneReview(f.options);
  recordAuthenticatedSession(f.storage, "session-6");
  for (const elapsed of [1, REVIEW_COOLDOWN_MS - 1, REVIEW_COOLDOWN_MS, REVIEW_COOLDOWN_MS + 1]) {
    assert.equal(await requestMilestoneReview({ ...f.options, now: 100 + elapsed }), "skipped");
  }
  assert.equal(f.calls(), 1);
});

test("F: multiple 15-second dashboard callbacks make only one native invocation, even while it is unresolved", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(5);
  const results: Promise<string>[] = [];
  let release!: () => void;
  let nativeCalls = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const options = { ...f.options, request: async () => { nativeCalls++; await pending; } };
  for (let i = 0; i < 5; i++) setTimeout(() => { results.push(requestMilestoneReview(options)); }, 15_000);
  t.mock.timers.tick(14_999);
  assert.equal(nativeCalls, 0);
  t.mock.timers.tick(1);
  assert.equal(nativeCalls, 1);
  assert.equal(readReviewState(f.storage)?.lastReviewPromptRequestedAt, 100);
  release();
  assert.deepEqual(await Promise.all(results), ["requested", "skipped", "skipped", "skipped", "skipped"]);
});
