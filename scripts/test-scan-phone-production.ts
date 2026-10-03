/**
 * Production-built, explicitly mock-auth QA of the REAL Scan page.
 * Never builds into dist/public, never serves the live app, never uses Vite dev.
 * NODE_ENV=development SCAN_VISUAL_RETRIEVAL=on npx tsx scripts/test-scan-phone-production.ts
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { initializeDevScanVisual, type DevScanVisualResult } from "../server/services/devScanVisual";
import { registerDevScanRoutes, type DevScanRouteDependencies } from "../server/devScanRoutes";
import { assertDevScanTelemetryDatabase, type DevScanEventOutcome, type DevScanEventPatch } from "../server/services/devScanTelemetry";

assert.equal(process.env.NODE_ENV, "development");
assert.equal(process.env.SCAN_VISUAL_RETRIEVAL, "on");
assert.ok(!process.env.REPLIT_DEPLOYMENT, "Local DEV QA only");
assertDevScanTelemetryDatabase();
const root = process.cwd();
const directory = path.resolve(".local/scan-v1/qa", `production-phone-${Date.now()}`);
const fixture = path.join(directory, "fixture");
const output = path.join(directory, "public");
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
await writeFile(path.join(fixture, "auth.ts"), "export const useAuth=()=>({user:{getIdToken:async()=>'isolated-QA-not-live-token'},loading:false});");
await writeFile(path.join(fixture, "firebase.ts"), "export const auth={currentUser:{getIdToken:async()=>'isolated-QA-not-live-token'}};");
await writeFile(path.join(fixture, "main.tsx"), `
import React from 'react';
import ReactDOM from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '@/lib/queryClient';
import Scan from '@/pages/scan';
import {Toaster} from '@/components/ui/toaster';
import '@/index.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <div style={{minHeight:'100dvh',background:'#f9fafb'}}>
      <header style={{height:64,position:'fixed',top:0,left:0,right:0,display:'flex',alignItems:'center',padding:'0 16px',background:'#161616',color:'#fafafa'}}>MARVEL CARD VAULT · isolated mock-auth QA</header>
      <main style={{paddingTop:64}}><Scan /></main>
    </div>
    <Toaster />
  </QueryClientProvider>);
`);
// Isolated build-time aliases only; NO auth bypass is added to shipped sources.
const backendNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
await build({
  configFile: false,
  root: fixture,
  mode: "production",
  publicDir: false,
  plugins: [{
    name: "isolated-qa-auth-only",
    enforce: "pre",
    resolveId(id) {
      if (id === "@/contexts/AuthContext" || /\/contexts\/AuthContext(?:\.tsx)?$/.test(id)) return path.join(fixture, "auth.ts");
      if (id === "./firebase" || /\/lib\/firebase(?:\.ts)?$/.test(id)) return path.join(fixture, "firebase.ts");
      return null;
    },
  }, react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  css: { postcss: root },
  define: { "import.meta.env.PHONE_PREVIEW": "true" },
  build: { outDir: output, emptyOutDir: true, minify: true },
});
process.env.NODE_ENV = backendNodeEnv;

const input = await readFile(process.env.SCAN_QA_INPUT || ".local/phase-c1/cells/7c9ea014-6228-4fde-bbad-93fd494e26d1-0.jpg");
const landscape = await sharp(input).resize(4032, 3024, { fit: "contain", background: "#e7e4e0" }).jpeg({ quality: 91 }).toBuffer();
const portrait = await sharp(input).resize(3024, 4032, { fit: "contain", background: "#e7e4e0" }).jpeg({ quality: 91 }).toBuffer();
const thumbnail = await sharp(input).resize({ width: 120 }).png().toBuffer();
const initializationStart = performance.now();
const service = await initializeDevScanVisual();
assert.ok(service, "Real frozen arm-C inference initialized");
const initializationMs = performance.now() - initializationStart;
const events = new Map<string, Record<string, unknown>>();
const telemetry = {
  async begin(userId: number) { const id = randomUUID(); events.set(id, { userId }); return id; },
  async finish(id: string, userId: number, outcome: DevScanEventOutcome) { assert.equal(events.get(id)?.userId, userId); Object.assign(events.get(id)!, outcome); },
  async patch(id: string, userId: number, patch: DevScanEventPatch) { assert.equal(events.get(id)?.userId, userId); Object.assign(events.get(id)!, patch); },
};
const inference: { bytes: number; width: number; height: number; timings: DevScanVisualResult["timings"] }[] = [];
const phases: Record<string, unknown>[] = [];
const writes: Record<string, unknown>[] = [];
const reviewUploads: { width: number; height: number }[] = [];
let lastResult: any;
let controlledFailure = false;
let replayRetry = false;
let existingOwnership = false;
let changedOwnership = false;
const undoRequests: { id: number; token: string }[] = [];
const owned = new Map<number, { id: number; cardId: number; token: string }>();
const app = express();
app.use(express.json());
app.post("/api/cards/scan/client-event", (req, res) => { phases.push(req.body); res.json({ ok: true }); });
registerDevScanRoutes(app, (req, _res, next) => {
  // Only this ephemeral isolated server has a test identity, never live routes.
  (req as typeof req & { user: { id: number; plan: string } }).user = { id: 1, plan: "SUPER_HERO" };
  next();
}, {
  reserveQuota: async () => true,
  telemetry,
  scan: async buffer => {
    const metadata = await sharp(buffer).metadata();
    const result = await service.scan(buffer);
    inference.push({ bytes: buffer.length, width: metadata.width!, height: metadata.height!, timings: result.timings });
    return result;
  },
} satisfies DevScanRouteDependencies);
app.use(express.static(output));
app.get("/scan", (_req, res) => res.sendFile(path.join(output, "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
const errors: string[] = [];
const unexpected: string[] = [];
const resources: string[] = [];
const sockets: string[] = [];
const layouts: Record<string, unknown>[] = [];
const scans: Record<string, unknown>[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => resources.push(request.url()));
page.on("websocket", socket => sockets.push(socket.url()));
await page.addInitScript(() => {
  const qa = (window as any).__scanQa = { urls: new Set<string>(), canvases: [] as HTMLCanvasElement[], decodeNames: [] as string[] };
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); qa.urls.add(url); return url; };
  URL.revokeObjectURL = url => { qa.urls.delete(url); revoke(url); };
  const createElement = document.createElement.bind(document);
  document.createElement = ((...args: any[]) => {
    const element = (createElement as any)(...args);
    if (args[0] === "canvas") qa.canvases.push(element);
    return element;
  }) as typeof document.createElement;
  const bitmap = window.createImageBitmap.bind(window);
  window.createImageBitmap = ((blob: Blob, ...args: any[]) => {
    qa.decodeNames.push((blob as File).name ?? "converted-blob");
    return (bitmap as any)(blob, ...args);
  }) as typeof window.createImageBitmap;
});
await page.route("**/*", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    if (request.resourceType() === "image") return route.fulfill({ contentType: "image/png", body: thumbnail });
    return route.abort("blockedbyclient");
  }
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  if (url.pathname === "/api/cards/scan" && controlledFailure) return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Controlled bad gateway</h1>" });
  if (url.pathname === "/api/cards/scan" && replayRetry) return json(lastResult);
  if (url.pathname === "/api/cards/scan") {
    const response = await route.fetch();
    lastResult = await response.json();
    // Catalog artwork is unavailable in isolated QA. Preserve actual inference
    // candidates/scores, but null URLs to exercise optional photo-review controls.
    lastResult.matches.forEach((card: any) => { card.imageUrl = null; });
    lastResult.families.forEach((family: any) => family.options.forEach((card: any) => { card.imageUrl = null; }));
    return json(lastResult);
  }
  if (url.pathname === "/api/cards/scan/config" || url.pathname === "/api/cards/scan/client-event" || url.pathname.startsWith("/api/cards/scan/events/")) return route.continue();
  if (url.pathname === "/api/cards/scan/usage") return json({ used: inference.length, limit: null, remaining: 25, unlimited: true });
  if (url.pathname === "/api/cards/scan/collection" && request.method() === "POST") {
    const payload = request.postDataJSON();
    writes.push(payload);
    const row = { id: 71000 + writes.length, cardId: payload.cardId, token: `qa-new-row-${writes.length}` };
    if (!existingOwnership) owned.set(row.id, row);
    return json({ created: !existingOwnership, ownedRow: { id: row.id, cardId: row.cardId }, undoToken: existingOwnership ? null : row.token });
  }
  if (/^\/api\/cards\/scan\/collection\/\d+$/.test(url.pathname) && request.method() === "DELETE") {
    const id = Number(url.pathname.split("/").pop());
    const token = request.postDataJSON().undoToken;
    undoRequests.push({ id, token });
    assert.equal(owned.get(id)?.token, token, "Undo uses the created owned row capability, never a card id");
    if (changedOwnership) return json({ message: "This row changed. Undo left it untouched." }, 409);
    owned.delete(id);
    return json({ undone: true, ownedRowId: id });
  }
  if (url.pathname === "/api/cards/scan/search") {
    const card = lastResult.matches[0];
    return json([
      // Parallel deliberately arrives first and has no per-card variation. The
      // explicit checklist base flag, never alphabetical order, wins selection.
      { cardId: card.cardId + 1, name: card.name, cardNumber: card.cardNumber, imageUrl: null, setName: "QA Set - Amber", mainSetName: "QA Set", year: 2024, setId: 124, mainSetId: 456, subsetName: null, isBase: false, exactNumber: true },
      { cardId: card.cardId, name: card.name, cardNumber: card.cardNumber, imageUrl: null, setName: "QA Set - Base", mainSetName: "QA Set", year: 2024, setId: 123, mainSetId: 456, subsetName: null, isBase: true, exactNumber: true },
    ]);
  }
  if (url.pathname === "/api/cards/picker/years") return json([2024, 2023]);
  if (url.pathname === "/api/cards/picker/sets") return json([{ id: 456, name: "QA Set", type: "main_set", subset_count: 2 }]);
  if (url.pathname === "/api/cards/picker/subsets") return json([{ id: 123, name: "Base", isInsertSubset: false, totalCards: 17 }]);
  if (url.pathname === "/api/cards/picker/cards") {
    const card = lastResult.matches[0];
    return json([{ id: card.cardId, name: card.name, cardNumber: card.cardNumber, frontImageUrl: null, variation: null, isInsert: false }]);
  }
  if (url.pathname === "/api/stats" || url.pathname === "/api/user/stats") return json({ totalCards: writes.length });
  if (url.pathname === "/api/card-sets") return json([]);
  if (/^\/api\/card-sets\/\d+\/first-card-image$/.test(url.pathname)) return json({ imageUrl: null });
  if (url.pathname.startsWith("/api/collection/check/")) return json({ owned: false, quantity: 0 });
  if (url.pathname === "/api/collection") { if (request.method() === "POST") writes.push(request.postDataJSON()); return json({ success: true }); }
  if (url.pathname === "/api/v2/search") {
    const card = lastResult.matches[0];
    return json([{ id: card.cardId, name: card.name, cardNumber: card.cardNumber, frontImageUrl: null, setName: card.setName, setYear: card.year, isInsert: false, rarity: null }]);
  }
  if (/^\/api\/cards\/\d+\/upload$/.test(url.pathname)) {
    const body = request.postDataBuffer()!;
    const start = body.indexOf(Buffer.from("\r\n\r\n")) + 4;
    const end = body.indexOf(Buffer.from("\r\n--"), start);
    const metadata = await sharp(body.subarray(start, end)).metadata();
    reviewUploads.push({ width: metadata.width!, height: metadata.height! });
    return json({ success: true, autoApproved: false });
  }
  unexpected.push(`${request.method()} ${url.pathname}`);
  return json({ message: "Blocked isolated QA API" }, 501);
});

async function checkLayout(label: string, sticky = false) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
    scrollY,
    stage: document.querySelector("[data-testid=scan-workspace]")?.getAttribute("data-stage"),
  }));
  assert.ok(dimensions.documentWidth <= dimensions.width, `${label}: no horizontal overflow`);
  assert.ok(dimensions.documentHeight <= dimensions.height, `${label}: no document overflow ${JSON.stringify(dimensions)}`);
  assert.equal(dimensions.scrollY, 0, `${label}: page never scrolls`);
  if (sticky) {
    for (const id of ["scan-sticky-actions", "scan-add", "scan-not-here"]) {
      const box = await page.getByTestId(id).boundingBox();
      assert.ok(box && box.y >= 64 && box.y + box.height <= dimensions.height, `${label}: ${id} is fully visible`);
    }
  }
  layouts.push({ label, ...dimensions, sticky });
}
async function resourceCounts() {
  return page.evaluate(() => {
    const qa = (window as any).__scanQa;
    return { liveUrls: qa.urls.size, liveCanvasPixels: qa.canvases.reduce((sum: number, canvas: HTMLCanvasElement) => sum + canvas.width * canvas.height, 0), decodeNames: qa.decodeNames };
  });
}
try {
  await page.goto(`${origin}/scan`);
  await page.getByTestId("scan-start").waitFor();
  // Synthetic lifecycle/error events check codes, not browser/device lifecycle.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new ErrorEvent("error", { message: "QA-secret-must-not-be-recorded" }));
    window.dispatchEvent(new Event("unhandledrejection"));
  });
  await checkLayout("393 idle");
  await page.setViewportSize({ width: 360, height: 640 });
  await checkLayout("360 idle");
  await page.screenshot({ path: path.join(directory, "360-idle.png") });
  await page.setViewportSize({ width: 393, height: 852 });
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    const buffer = index % 2 ? portrait : landscape;
    await page.getByTestId("scan-file-input").setInputFiles({ name: `camera-${index + 1}.jpg`, mimeType: "image/jpeg", buffer });
    await page.getByTestId("scan-result-list").waitFor({ timeout: 120000 });
    await page.getByTestId("scan-dev-elapsed").waitFor();
    assert.equal(await page.getByRole("slider", { name: "Drag to position card crop" }).count(), 0, "No recognition crop");
    assert.equal(inference.length, index + 1, "One real inference request per selected photo");
    assert.deepEqual([inference[index].width, inference[index].height], index % 2 ? [1200, 1600] : [1600, 1200], "Full-frame aspect and bounded dimensions preserved");
    await checkLayout(`393 scan ${index + 1} results`, true);
    const retained = await resourceCounts();
    assert.equal(retained.liveUrls, 1, "Only reduced full-frame preview URL retained");
    assert.equal(retained.liveCanvasPixels, 0, "Preparation canvases released");
    assert.equal(writes.length, index, "No automatic write on recognition");
    await page.screenshot({ path: path.join(directory, `scan-${index + 1}-results.png`) });
    assert.equal(await page.getByTestId("scan-add").isDisabled(), false, "Top artwork/version is preselected");
    assert.equal(await page.getByTestId("scan-exact-confirm").count(), 0, "No forced confirmation");
    assert.equal(await page.getByTestId("scan-version-list").count(), 0, "No forced version screen");
    const expectedTop = lastResult.families[0].representativeCardId;
    const chosenChip = page.getByTestId("scan-artwork-option").first().locator('[aria-pressed="true"]');
    assert.equal(await chosenChip.count(), 1, "Exactly one inline version preselected");
    existingOwnership = index === 4;
    await page.getByTestId("scan-add").click();
    await page.getByTestId("scan-start").waitFor();
    assert.equal(writes.length, index + 1, "Exactly one tap writes the collection");
    assert.equal(writes[index].cardId, expectedTop, "Representative visual version, not arbitrary first alternative");
    if (index < 4) {
      await page.getByTestId("scan-undo").click();
      await page.getByText("Addition undone", { exact: true }).waitFor();
      assert.equal(undoRequests.at(-1)?.id, 71001 + index);
    } else {
      await page.getByText("Already in your collection", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("scan-undo").count(), 0, "Existing ownership has no Undo");
    }
    const resetResources = await resourceCounts();
    assert.equal(resetResources.liveUrls, 0, "Reset revokes all preview URLs");
    assert.equal(resetResources.liveCanvasPixels, 0, "Reset releases review canvases");
    scans.push({ ordinal: index + 1, inference: inference[index], wallMs: performance.now() - start, retained, resetResources });
  }
  assert.equal(writes.length, 5);
   assert.equal(reviewUploads.length, 0, "Visual adds never gate on a missing-photo offer");
  // Separate controlled error/retry uses a replay, not a sixth inference claim.
  controlledFailure = true;
  await page.getByTestId("scan-file-input").setInputFiles({ name: "retry-test.jpg", mimeType: "image/jpeg", buffer: landscape });
  await page.getByTestId("scan-recovery").waitFor();
  await page.setViewportSize({ width: 360, height: 640 });
  await checkLayout("360 error");
  const beforeRetry = await resourceCounts();
  controlledFailure = false;
  replayRetry = true;
  await page.getByTestId("scan-retry").click();
  await page.getByTestId("scan-result-list").waitFor();
  await checkLayout("360 retry results", true);
  assert.deepEqual((await resourceCounts()).decodeNames, beforeRetry.decodeNames, "Retry uses retained reduced file without decode");
  await page.getByTestId("scan-not-here").click();
   await page.getByTestId("scan-browse-list").waitFor();
   await checkLayout("360 hinted browse");
   if (lastResult.browseHint) {
     assert.equal(await page.getByTestId("scan-workspace").getAttribute("data-stage"), "picker-card", "Top10 common set hint prefilters the checklist");
     await page.getByRole("button", { name: "Back to change context" }).click();
     assert.ok(["picker-subset", "picker-set"].includes(await page.getByTestId("scan-workspace").getAttribute("data-stage") ?? ""), "Back changes browse context");
   }
   await page.getByRole("button", { name: "Type search", exact: true }).click();
  await page.getByTestId("scan-search-list").waitFor();
   await page.getByTestId("scan-search-input").fill("1");
   await page.getByTestId("scan-option-add").waitFor();
   assert.equal(await page.getByTestId("scan-artwork-option").count(), 1, "Base + parallel collapsed as one family");
   await page.getByRole("button", { name: "+1 versions", exact: true }).click();
   assert.equal(await page.getByTestId("scan-version-chips").locator("button").count(), 2, "Inline search parallels");
   assert.equal(await page.getByTestId("scan-version-chips").locator('[aria-pressed=true]').getAttribute("data-card-id"), String(lastResult.matches[0].cardId), "True base wins even when a no-variation parallel arrives first");
  await checkLayout("360 search");
   existingOwnership = false;
   await page.getByTestId("scan-option-add").click();
   await page.getByTestId("scan-photo-offer").waitFor();
   assert.equal(writes.at(-1)?.cardId, lastResult.matches[0].cardId, "Collapsed search Add uses the real base representative");
   await checkLayout("360 post-add optional offer");
   assert.equal((await resourceCounts()).liveUrls, 1, "Photo retained until offer resolved");
   changedOwnership = true;
   await page.getByTestId("scan-undo").click();
   await page.getByText("Undo left your collection unchanged", { exact: true }).waitFor();
   assert.ok(owned.has(71006), "Changed ownership left untouched");
   changedOwnership = false;
   await page.getByTestId("scan-review-crop").click();
   await page.getByRole("button", { name: "Use front crop" }).waitFor();
   await checkLayout("360 optional review crop");
   await page.getByRole("button", { name: "Use front crop" }).click();
   await page.getByTestId("scan-photo-offer").waitFor();
   await page.getByTestId("scan-submit-photo").click();
   await page.getByTestId("scan-start").waitFor();
   assert.equal(reviewUploads.length, 1);
   assert.ok(Math.abs(reviewUploads[0].width / reviewUploads[0].height - 5 / 7) < 0.01, "Optional crop changes review upload only");
   // Replay controlled candidates: UI coverage, not another real inference.
   const top = lastResult.families[0];
   const variant = { ...top.options[0], cardId: 99001, subsetName: "Gold" };
   const alternative = { ...top.options[0], cardId: 99002, name: "QA alternative artwork" };
   lastResult = { ...lastResult, margin: 0.01, families: [
     { ...top, options: [variant, ...top.options] },
     { familyKey: "qa-other", score: top.score - 0.01, representativeCardId: alternative.cardId, options: [alternative] },
   ] };
   await page.getByTestId("scan-file-input").setInputFiles({ name: "ambiguous-ui-only.jpg", mimeType: "image/jpeg", buffer: landscape });
   await page.getByTestId("scan-result-list").waitFor();
   assert.equal(await page.getByTestId("scan-artwork-option").count(), 2, "Ambiguous artwork side by side, each with Add");
   await checkLayout("360 ambiguous artworks", true);
   await page.screenshot({ path: path.join(directory, "360-ambiguous.png") });
   await page.getByTestId("scan-version-chips").first().getByRole("button", { name: "Gold", exact: true }).click();
   await page.getByTestId("scan-add").click();
   await page.getByTestId("scan-start").waitFor();
   assert.equal(writes.at(-1)?.cardId, 99001, "Inline chip changes one-tap Add version");
   assert.equal((await resourceCounts()).liveUrls, 0, "Repeat reset releases photos");
   await page.getByTestId("scan-file-input").setInputFiles({ name: "offer-skip-ui-only.jpg", mimeType: "image/jpeg", buffer: landscape });
   await page.getByTestId("scan-result-list").waitFor();
   await page.getByTestId("scan-not-here").click();
   await page.getByRole("button", { name: "Type search", exact: true }).click();
   await page.getByTestId("scan-search-input").fill("1");
   await page.getByTestId("scan-option-add").click();
   await page.getByTestId("scan-photo-offer").waitFor();
   assert.equal((await resourceCounts()).liveUrls, 1);
   await page.getByTestId("scan-offer-skip").click();
   await page.getByTestId("scan-start").waitFor();
   assert.equal((await resourceCounts()).liveUrls, 0, "Skip resolves the photo offer and releases retained bytes");
  assert.equal(inference.length, 5);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(sockets, [], "No Vite HMR websocket");
  assert.equal(resources.some(url => /\/@vite\/client|\/src\/.*\.[tj]sx?(?:\?|$)|\/node_modules\/\.vite\//.test(url)), false, "Only production-built assets");
  for (const code of ["page_load", "stage_change", "decode_start", "decode_ready", "request_started", "results_ready"]) assert.ok(phases.some(event => event.code === code), `Diagnostic ${code} observed`);
  for (const code of ["page_visible", "page_hide", "page_show", "client_error"]) assert.ok(phases.some(event => event.code === code), `Synthetic lifecycle ${code} observed`);
  assert.equal(JSON.stringify(phases).includes("QA-secret"), false, "No raw error messages in diagnostics");
  const evidence = { harness: "Production-built real Scan page; test-only mocked auth; isolated real arm-C inference; NOT a signed-in device benchmark", buildNodeEnv: "production", directory, initializationMs, scans, inference, layouts, writes, reviewUploads, phases, errors, unexpected, sockets, resources };
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ success: true, evidence: path.join(directory, "evidence.json"), realScans: inference.length, writes: writes.length, layouts: layouts.length, reviewUploads }, null, 2));
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}