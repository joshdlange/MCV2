import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import { boundedScanDimensions, MAX_SCAN_INPUT_BYTES, readVisualScanResponse, requestVisualScan, scanFileError, clearScanCameraPending, scanCameraInterrupted, setScanCameraPending, SCAN_CAMERA_MARKER, scanClientEvent } from "./scanRecovery";
import { convertHeicScanFile, prepareScanImage, scanImageDimensions } from "./scanImage";

const photo = () => new File(["photo"], "camera.jpg", { type: "image/jpeg" }) as unknown as globalThis.File;
const success = { mode: "visual-v1", matches: [], families: [], confidenceLevel: "none", parsed: {} };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("HTTP HTML, auth, malformed JSON and malformed success bodies produce actionable failures", async () => {
  await assert.rejects(readVisualScanResponse(new Response("<html>Gateway</html>", { status: 502 })), /502/);
  await assert.rejects(readVisualScanResponse(new Response("Unauthorized", { status: 401 })), /sign-in/);
  await assert.rejects(readVisualScanResponse(new Response("broken JSON")), /unreadable response/);
  await assert.rejects(readVisualScanResponse(json({ ...success, matches: [{}] })), /unreadable response/);
  await assert.rejects(readVisualScanResponse(json({ ...success, families: [{}] })), /unreadable response/);
  assert.deepEqual(await readVisualScanResponse(json(success)), success);
});

test("malformed response retains the caller's source and crop; explicit retry sends same bytes", async () => {
  const source = photo();
  const crop = photo();
  const state = { source, crop, preview: "blob:retained", stage: "scanning", error: "" };
  const received: unknown[] = [];
  const request = () => requestVisualScan({
    front: state.crop, getToken: async () => "mock-token", controller: new AbortController(),
    isCurrent: () => true, onFetchStarted: () => {},
    fetcher: (async (_url, options) => {
      received.push(await (options!.body as FormData).get("image")!.arrayBuffer());
      return received.length === 1 ? new Response("malformed") : json(success);
    }) as typeof fetch,
  });
  try { await request(); } catch (error) {
    state.stage = "error";
    state.error = (error as Error).message;
  }
  assert.equal(state.stage, "error");
  assert.match(state.error, /unreadable/);
  assert.strictEqual(state.source, source);
  assert.strictEqual(state.crop, crop);
  assert.equal(state.preview, "blob:retained");
  await request();
  assert.deepEqual(received[0], received[1]);
});

test("token failure or missing token never posts; network and timeout are recoverable", async () => {
  let posts = 0;
  const run = (getToken: () => Promise<string | undefined>, fetcher?: typeof fetch, timeoutMs?: number) =>
    requestVisualScan({
      front: photo(), getToken, controller: new AbortController(), isCurrent: () => true, onFetchStarted: () => {},
      fetcher: fetcher ?? (async () => { posts++; return json(success); }) as typeof fetch, timeoutMs,
    });
  await assert.rejects(run(async () => { throw new Error("Firebase"); }), /sign-in/);
  await assert.rejects(run(async () => undefined), /sign-in/);
  assert.equal(posts, 0);
  await assert.rejects(run(async () => "mock", (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch), /connection/);
  const controller = new AbortController();
  await assert.rejects(requestVisualScan({
    front: photo(), getToken: async () => "mock", controller, isCurrent: () => true, onFetchStarted: () => {},
    fetcher: (() => new Promise(() => {})) as typeof fetch, timeoutMs: 5,
  }), /60 seconds/);
  assert.equal(controller.signal.aborted, true);
  await assert.rejects(run(() => new Promise(() => {}), undefined, 5), /60 seconds/);
});

test("empty camera MIME is allowed by image extension; 40MB ceiling is explicit", () => {
  assert.equal(scanFileError({ name: "IMG_9132.JPG", type: "", size: MAX_SCAN_INPUT_BYTES }), null);
  assert.equal(scanFileError({ name: "IMG_9132.HEIC", type: "", size: 8132 }), null);
  assert.match(scanFileError({ name: "huge.jpg", type: "image/jpeg", size: MAX_SCAN_INPUT_BYTES + 1 })!, /40 MB/);
  assert.match(scanFileError({ name: "data.txt", type: "", size: 10 })!, /image file/);
  assert.deepEqual(boundedScanDimensions(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(boundedScanDimensions(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(boundedScanDimensions(700, 980), { width: 700, height: 980 });
});

test("HEIC conversion failure retains original; converter is local/injected, no real camera fixture claim", async () => {
  const source = new File(["not-real-heic"], "camera.HEIC", { type: "" }) as unknown as globalThis.File;
  await assert.rejects(convertHeicScanFile(source, async () => { throw Error("decode"); }), /HEIC.*search instead/);
  assert.equal(source.name, "camera.HEIC");
  assert.equal(source.size, 13);
  const jpeg = new Blob(["converted"], { type: "image/jpeg" });
  assert.strictEqual(await convertHeicScanFile(source, async ({ blob }) => {
    assert.strictEqual(blob, source); return jpeg;
  }), jpeg);
  const normal = photo();
  assert.strictEqual(await convertHeicScanFile(normal, async () => { throw Error("must not run"); }), normal);
});

test("native decoding errors retain input and are recoverable on second attempt", async () => {
  const originalImage = globalThis.Image;
  const originalElement = globalThis.HTMLImageElement;
  class FailingImage {
    onerror?: () => void;
    set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); }
  }
  Object.assign(globalThis, { Image: FailingImage, HTMLImageElement: FailingImage });
  const source = photo();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(prepareScanImage(source, 0), /Could not open this image.*search instead/);
      assert.equal(await source.text(), "photo");
    }
  } finally {
    Object.assign(globalThis, { Image: originalImage, HTMLImageElement: originalElement });
  }
});

test("PNG header dimensions use bounded reads", async () => {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(16, 4032); view.setUint32(20, 3024);
  assert.deepEqual(await scanImageDimensions(new Blob([header])), { width: 4032, height: 3024 });
});

test("scan UI failure branch is gated and never resets photo; search back restores recovery", () => {
  const source = readFileSync(new URL("../pages/scan.tsx", import.meta.url), "utf8");
  const failure = source.slice(source.indexOf("onError: (err: Error, { epoch, front })"), source.indexOf("const feedbackMutation"));
  assert.match(failure, /if \(visualV1\)[\s\S]*setScanError[\s\S]*setStage\("error"\)/);
  assert.doesNotMatch(failure, /setSourceFile|setFrontFile|setPreviewUrl|handleReset/);
  assert.match(source, /if \(!visualV1\) setSourceFile\(null\)/);
  assert.match(source, /else if \(visualV1 && scanError\) setStage\("error"\)/);
  assert.match(source, /onSearchInstead=\{visualV1 \? openSearch : undefined\}/);
});

test("camera interruption marker is scalar, DEV gated, and clears on selection/reset/cancel", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  assert.equal(scanCameraInterrupted(true, storage), false);
  setScanCameraPending(storage);
  assert.deepEqual([...values.entries()], [[SCAN_CAMERA_MARKER, "1"]]);
  assert.equal(scanCameraInterrupted(false, storage), false, "legacy ignores marker");
  assert.equal(scanCameraInterrupted(true, storage), true, "fresh DEV mount sees interrupted picker");
  clearScanCameraPending(storage);
  assert.equal(scanCameraInterrupted(true, storage), false);
  const blocked = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); }, removeItem: () => { throw Error("blocked"); } };
  assert.equal(scanCameraInterrupted(true, blocked), false);
  assert.doesNotThrow(() => setScanCameraPending(blocked));
  assert.doesNotThrow(() => clearScanCameraPending(blocked));
  const source = readFileSync(new URL("../pages/scan.tsx", import.meta.url), "utf8");
  assert.match(source, /function launchPhotoPicker\(\)[\s\S]*if \(visualV1\) \{[\s\S]*setScanCameraPending/);
  assert.match(source, /function handleFileChange[^]*?clearScanCameraPending/);
  assert.match(source, /function handleReset[^]*?clearScanCameraPending/);
  assert.match(source, /addEventListener\("cancel", clearMarker\)/);
});

test("client diagnostics contain only allowlisted scalar metadata, never filenames/photos/URLs", () => {
  const opened = scanClientEvent("camera_open");
  assert.equal(opened.code, "camera_open");
  assert.ok(opened.pageId && opened.sequence > 0 && opened.elapsedMs >= 0);
  const selected = scanClientEvent("photo_selected", { name: "private-name.HEIC", type: "", size: 9182374 });
  assert.equal(selected.kind, "heic");
  assert.equal(selected.bytes, 9182374);
  assert.ok(!JSON.stringify(selected).includes("private-name"));
  assert.equal(selected.pageId, opened.pageId);
  assert.ok(selected.sequence > opened.sequence);
  assert.equal(scanClientEvent("request_failed", { name: "private-name.jpg", type: "image/jpeg", size: 2e9 }).bytes, 1e9);
});