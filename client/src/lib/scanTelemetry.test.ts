import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanEventRecorder, type ScanEventUpdate } from "./scanTelemetry";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("selection updates are serialized and timing cannot clear a picked ID or flags", async () => {
  const calls: Array<{ path: string; update: ScanEventUpdate }> = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const recorder = createScanEventRecorder("17", async (path, update) => {
    calls.push({ path, update });
    if (calls.length === 1) await blocked;
  }, () => true, () => assert.fail("unexpected telemetry error"));
  recorder.record({ pickedCardId: 100 });
  recorder.record({ pickedCardId: 200 });
  recorder.record({ usedSearch: true });
  recorder.record({ totalMs: 123.456 });
  await settle();
  assert.equal(calls.length, 1);
  release();
  await settle();
  assert.deepEqual(calls, [
    { path: "/api/cards/scan/events/17", update: { pickedCardId: 100 } },
    { path: "/api/cards/scan/events/17", update: { pickedCardId: 200 } },
    { path: "/api/cards/scan/events/17", update: { usedSearch: true } },
    { path: "/api/cards/scan/events/17", update: { totalMs: 123.456 } },
  ]);
});

test("telemetry failure warns once per scan and does not block later records", async () => {
  let warnings = 0;
  const updates: ScanEventUpdate[] = [];
  const recorder = createScanEventRecorder("1", async (_path, update) => {
    updates.push(update);
    throw new Error("offline");
  }, () => true, () => { warnings += 1; });
  recorder.record({ usedSearch: true });
  recorder.record({ pickedCardId: 20 });
  recorder.record({ photoSubmitUsed: true });
  await settle();
  assert.equal(warnings, 1);
  assert.equal(updates.length, 3);
});

test("reset epochs suppress queued writes and stale failure toasts", async () => {
  let current = true;
  let calls = 0;
  let warnings = 0;
  let reject!: (error: Error) => void;
  const blocked = new Promise<void>((_resolve, fail) => { reject = fail; });
  const recorder = createScanEventRecorder("1", async () => {
    calls += 1;
    await blocked;
  }, () => current, () => { warnings += 1; });
  recorder.record({ pickedCardId: 20 });
  recorder.record({ totalMs: 0 });
  await settle();
  current = false;
  reject(new Error("old scan failed"));
  await settle();
  assert.equal(calls, 1);
  assert.equal(warnings, 0);
});

test("each queued record snapshots its allowed partial update including actual zero timing", async () => {
  const updates: ScanEventUpdate[] = [];
  const recorder = createScanEventRecorder("1", async (_path, update) => {
    updates.push(update);
  }, () => true, () => assert.fail("unexpected telemetry error"));
  const update = { totalMs: 0 };
  recorder.record(update);
  update.totalMs = 999;
  await settle();
  assert.deepEqual(updates, [{ totalMs: 0 }]);
});