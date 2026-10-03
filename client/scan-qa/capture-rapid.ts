/**
 * npx tsx --tsconfig client/tsconfig.json client/scan-qa/capture-rapid.ts
 * Isolated production BUILD of actual Scan page. Fake canvas rear camera,
 * mock auth and every API, no live API/DB/recognition, HMR or workflow restart.
 * Outputs are confined to client/scan-qa. No deployed/production writes.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";

assert.ok(!process.env.REPLIT_DEPLOYMENT, "Isolated development QA only");
const root = process.cwd();
const qa = path.join(root, "client/scan-qa");
const output = path.join(qa, "build/rapid");
const evidenceDir = path.join(qa, "screenshots/rapid");
await mkdir(evidenceDir, { recursive: true });
await build({
  configFile: false, root: path.join(qa, "rapid"), mode: "production", publicDir: false,
  plugins: [{
    name: "isolated-rapid-auth", enforce: "pre",
    resolveId(id) {
      if (id === "@/contexts/AuthContext" || /\/contexts\/AuthContext(?:\.tsx)?$/.test(id)) return path.join(qa, "auth.ts");
      if (id === "./firebase" || /\/lib\/firebase(?:\.ts)?$/.test(id)) return path.join(qa, "firebase.ts");
      return null;
    },
  }, react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  css: { postcss: root }, build: { outDir: output, emptyOutDir: true, minify: true }, logLevel: "warn",
});
const fixture = JSON.parse(await readFile(path.join(qa, "catalog-fixture.json"), "utf8"));
const base = fixture.families[0].options[0];
// Controlled QA-only identities, not assertions about a real catalog match.
const parallel = (id: number, subset: string) => ({ ...base, cardId: id, mainSetId: 910, setId: 910, mainSetName: "QA 1992 Masterpieces", setName: `QA 1992 Masterpieces - ${subset}`, subsetName: `QA 1992 Masterpieces - ${subset}` });
const crossSet = { ...parallel(96002, "Base"), mainSetId: 911, setId: 911, year: 2024, mainSetName: "QA 2024 Masterpieces", setName: "QA 2024 Masterpieces - Base", subsetName: "Base" };
const missing = { ...parallel(96003, "Silver"), imageUrl: null };
const strong = (card = base) => ({ mode: "visual-v1", topScore: .93, margin: .12, confidenceLevel: "high", parsed: {}, matches: [card], families: [{ familyKey: `qa-${card.cardId}`, score: .93, representativeCardId: card.cardId, options: [card] }] });
const ambiguous = { ...strong(), topScore: .98, margin: .19, matches: [base], families: [{ familyKey: "qa-shared-art", score: .98, representativeCardId: 95000, options: [...["Base", "Gold", "Silver", "Blue", "Red", "Green", "Orange"].map((name, i) => parallel(95000 + i, name)), crossSet] }] };
let visual = true;
let scanSequence = 0;
let scenario = "main";
let holdRecognition = false;
let addFailure = true;
let undoFailure = true;
let uploadFailure = true;
let addActive = 0;
let maxAddActive = 0;
const writes: { method: string; path: string; body?: unknown }[] = [];
const scans: { width: number; height: number; bytes: number; corners: number[][] }[] = [];
const unexpected: string[] = [];
const owned = new Map<number, number>([[96002, 777]]);
const undone = new Set<number>();
const app = express();
app.use(express.json());
app.get("/api/cards/scan/config", (_req, res) => res.json({ visualV1: visual }));
app.get("/api/cards/scan/usage", (_req, res) => res.json({ used: 2, limit: null, unlimited: true, remaining: null }));
app.get("/api/stats", (_req, res) => res.json({ totalCards: 127 }));
app.get("/api/collection", (_req, res) => res.json([]));
app.get(["/api/notifications", "/api/cards/scan/browse/years", "/api/cards/picker/years"], (_req, res) => res.json([]));
app.get(["/api/social/unread-count", "/api/notifications/unread-count"], (_req, res) => res.json({ count: 0 }));
app.post("/api/cards/scan/client-event", (_req, res) => res.json({ ok: true }));
app.get("/api/cards/scan/search", (req, res) => res.json(req.query.q === "duplicate" ? [base] : req.query.q === "missing" ? [missing] : []));
app.post("/api/cards/scan", express.raw({ type: "multipart/form-data", limit: "6mb" }), async (req, res) => {
  assert.equal(req.headers.authorization, "Bearer isolated-QA-not-live-token");
  const buffer = req.body as Buffer;
  assert.ok(buffer.includes(Buffer.from('name="image"')));
  assert.ok(!buffer.includes(Buffer.from('name="backImage"')));
  const start = buffer.indexOf(Buffer.from("\r\n\r\n")) + 4;
  const boundary = String(req.headers["content-type"]).split("boundary=")[1];
  const end = buffer.indexOf(Buffer.from(`\r\n--${boundary}`), start);
  const image = buffer.subarray(start, end);
  const meta = await sharp(image).metadata();
  const decoded = await sharp(image).removeAlpha().raw().toBuffer();
  const corners = [0, (meta.width! - 1) * 3, (meta.height! - 1) * meta.width! * 3].map(offset => [...decoded.subarray(offset, offset + 3)]);
  scans.push({ width: meta.width!, height: meta.height!, bytes: image.length, corners });
  const n = scanSequence++;
  if (holdRecognition) await new Promise(resolve => setTimeout(resolve, 1800));
  if (scenario !== "main") return res.json(strong());
  if (n === 0) return res.json(strong());
  if (n === 1) return res.json(ambiguous);
  if (n === 2) return res.json({ ...strong(), confidenceLevel: "none", families: [], matches: [] });
  return res.status(503).json({ message: "Controlled QA recognition failure" });
});
app.post("/api/cards/scan/collection", async (req, res) => {
  writes.push({ method: "POST", path: req.path, body: req.body });
  addActive++; maxAddActive = Math.max(maxAddActive, addActive);
  await new Promise(resolve => setTimeout(resolve, 160));
  addActive--;
  if (req.body.cardId === 96003 && addFailure) return res.status(503).json({ message: "Controlled per-card save failure. Retry safely." });
  const existing = owned.get(req.body.cardId);
  if (existing) return res.json({ created: false, ownedRow: { id: existing, cardId: req.body.cardId }, undoToken: null });
  const id = 800 + owned.size;
  owned.set(req.body.cardId, id);
  return res.json({ created: true, ownedRow: { id, cardId: req.body.cardId }, undoToken: `qa-new-${id}` });
});
app.delete("/api/cards/scan/collection/:id", (req, res) => {
  const id = Number(req.params.id);
  writes.push({ method: "DELETE", path: req.path, body: req.body });
  assert.notEqual(id, 777, "Never delete the preexisting row");
  assert.equal(req.body.undoToken, `qa-new-${id}`);
  if (undoFailure && id === owned.get(base.cardId)) return res.status(503).json({ message: "Controlled undo failure. Retry Undo." });
  undone.add(id);
  return res.json({ ok: true });
});
app.post("/api/cards/:id/upload", express.raw({ type: "multipart/form-data", limit: "6mb" }), async (req, res) => {
  writes.push({ method: "POST", path: req.path });
  assert.equal(Number(req.params.id), missing.cardId);
  assert.ok((req.body as Buffer).includes(Buffer.from('name="frontImage"')));
  await new Promise(resolve => setTimeout(resolve, 300));
  return uploadFailure ? res.status(503).json({ message: "Controlled photo failure" }) : res.json({ autoApproved: false });
});
app.post("/api/cards/:id/report-image", express.raw({ type: "multipart/form-data", limit: "6mb" }), (req, res) => {
  const data = req.body as Buffer;
  writes.push({ method: "POST", path: req.path, body: { attached: data.includes(Buffer.from('name="frontImage"')), reason: data.toString().includes("wrong_card") } });
  res.json({ success: true, pendingImage: null, autoApproved: false });
});
app.get("/scan-hero-clean.png", (_req, res) => res.type("html").send("<html>Missing clean asset fallback</html>"));
app.use(express.static(output));
app.use(express.static(path.join(root, "client/public")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) { unexpected.push(`${req.method} ${req.path}`); return res.status(501).json({ message: "Unexpected QA API" }); }
  res.sendFile(path.join(output, "index.html"));
});
const server = app.listen(5199, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = "http://127.0.0.1:5199";
if (process.env.SCAN_QA_SERVE_ONLY === "1") {
  console.log(`Isolated QA only: ${origin}`);
  await new Promise(() => {});
}
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
const errors: string[] = [];
const sockets: string[] = [];
const checks: string[] = [];
async function fakeCamera(page: Page) {
  const install = () => {
    const w = window as any;
    w.__qaCamera = { opens: 0, stops: 0, denied: false, playFails: false, delayMs: 0, constraints: [], created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); w.__qaCamera.created.push(url); return url; };
    URL.revokeObjectURL = url => { w.__qaCamera.revoked.push(url); revoke(url); };
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { return w.__qaCamera.playFails ? Promise.reject(new DOMException("QA autoplay blocked", "NotAllowedError")) : originalPlay.call(this); };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async (constraints: unknown) => {
        w.__qaCamera.constraints.push(constraints);
        if (w.__qaCamera.delayMs) await new Promise(resolve => setTimeout(resolve, w.__qaCamera.delayMs));
        if (w.__qaCamera.denied) throw new DOMException("QA denied permission", "NotAllowedError");
        w.__qaCamera.opens++;
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext("2d")!;
        let frame = 0;
        const draw = () => {
          context.fillStyle = "#30282d"; context.fillRect(0, 0, 640, 480);
          context.fillStyle = "#bc2029"; context.fillRect(155, 28, 330, 424);
          context.fillStyle = "#f7eadf"; context.font = "bold 35px sans-serif";
          context.fillText("ISOLATED QA", 196, 155);
          context.font = "22px sans-serif"; context.fillText("FAKE TEST CARD", 218, 198);
          context.fillText(`FRAME ${frame++}`, 239, 350);
          // Three corner markers prove capture includes the entire camera frame.
          context.fillStyle = "#df9d25"; context.fillRect(0, 0, 25, 25);
          context.fillStyle = "#328954"; context.fillRect(615, 0, 25, 25);
          context.fillStyle = "#bc2029"; context.fillRect(0, 455, 25, 25);
        };
        draw();
        const stream = canvas.captureStream(15);
        const timer = setInterval(draw, 65);
        stream.getTracks().forEach(track => {
          const stop = track.stop.bind(track);
          track.stop = () => { w.__qaCamera.stops++; clearInterval(timer); stop(); };
        });
        return stream;
      },
    } });
  };
  // tsx's keepNames helper is not otherwise in the browser serialization scope.
  await page.addInitScript({ content: `var __name = window.__name = (fn) => fn; (${install.toString()})();` });
}
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await fakeCamera(page);
page.on("pageerror", error => errors.push(error.message));
page.on("websocket", socket => sockets.push(socket.url()));
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return route.continue();
  if (fixture.images?.[url.href]) return route.fulfill({ body: await readFile(path.resolve(fixture.images[url.href])), contentType: "image/jpeg" });
  return route.abort();
});
async function capture(label: string) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal overflow`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(evidenceDir, `${label}-390-mock-auth-fake-camera.png`) });
  await page.screenshot({ path: path.join(evidenceDir, `${label}-390-mock-auth-fake-camera-full.png`), fullPage: true });
}
async function openRapid() {
  await page.goto(origin);
  await page.getByTestId("scan-rapid-start").click();
  await page.getByTestId("rapid-camera").waitFor();
}
async function snap() {
  try {
    await page.waitForFunction(() => {
      const v = document.querySelector("video")!;
      return v && v.videoWidth > 0 && v.readyState >= 2;
    }, undefined, { timeout: 8000 });
  } catch (error) {
    console.log("Camera QA diagnostic", await page.evaluate(() => ({ camera: (window as any).__qaCamera, state: document.querySelector("[data-camera-state]")?.getAttribute("data-camera-state"), video: [...document.querySelectorAll("video")].map(v => ({ width: v.videoWidth, height: v.videoHeight, ready: v.readyState, paused: v.paused, stream: !!v.srcObject })), hidden: document.hidden })), errors);
    throw error;
  }
  await page.getByTestId("rapid-capture").click();
}
const cards = () => page.getByTestId("rapid-review-item");
try {
  await openRapid();
  await capture("live-empty");
  for (let i = 0; i < 4; i++) { await snap(); await page.waitForTimeout(220); }
  await page.getByTestId("rapid-tray").getByText("Scan error", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("rapid-tray").locator("[data-tone=green]").count(), 1);
  assert.equal(await page.getByTestId("rapid-tray").locator("[data-tone=amber]").count(), 1);
  assert.equal(await page.getByTestId("rapid-tray").locator("[data-tone=red]").count(), 2);
  assert.ok((await page.getByTestId("rapid-tray").innerText()).includes("Suggested: Darkhawk #11"));
  assert.equal(await page.evaluate(() => (window as any).__qaCamera.opens), 1);
  assert.equal(await page.evaluate(() => (window as any).__qaCamera.constraints[0].video.facingMode.ideal), "environment");
  assert.equal(writes.length, 0);
  assert.ok(scans.every(scan => scan.width === 640 && scan.height === 480 && scan.corners[0][0] > 190 && scan.corners[1][1] > 90 && scan.corners[2][0] > 140));
  await capture("live-tray");
  await page.getByTestId("rapid-tray").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await capture("live-tray-errors");
  await page.getByTestId("rapid-tray").evaluate(element => { element.scrollLeft = 0; });
  await page.getByTestId("rapid-review").click();
  await cards().nth(1).getByRole("button", { name: "Choose set / version", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__qaCamera.stops), 1);
  await capture("review");
  assert.match(await page.locator(".rapid-footer").innerText(), /1 chosen \/ provisional · 3 need review/);
  assert.match(await cards().nth(1).innerText(), /Suggested: Darkhawk/);
  assert.match(await cards().nth(1).innerText(), /Set \/ version not selected/);
  await cards().nth(1).getByRole("button", { name: "Choose set / version", exact: true }).click();
  assert.equal(await page.getByTestId("scan-set-choice").count(), 2);
  assert.equal(await page.locator("[data-testid=scan-version-chips] .scan-chip").count(), 3);
  await capture("choice-collapsed");
  await page.getByRole("button", { name: "+4 more versions", exact: true }).click();
  assert.equal(await page.locator("[data-testid=scan-version-chips] .scan-chip").count(), 7);
  assert.equal(await page.getByTestId("scan-set-choice").count(), 2);
  assert.ok(!(await page.locator("[data-testid=scan-version-chips]").innerText()).includes("QA 1992 Masterpieces"), "Parent identity not repeated in variant chips");
  await capture("choice-expanded");
  await page.getByRole("button", { name: "Fewer versions", exact: true }).click();
  await page.getByTestId("scan-set-choice").nth(1).getByTestId("scan-option-select").click();
  assert.equal(writes.length, 0, "Selection callback does not add ownership");
  await cards().nth(2).getByRole("button", { name: "Search", exact: true }).click();
  await page.getByTestId("rapid-search-input").fill("duplicate");
  await page.getByTestId("scan-option-select").click();
  await cards().nth(3).getByRole("button", { name: "Search", exact: true }).click();
  await page.getByTestId("rapid-search-input").fill("missing");
  await page.getByTestId("scan-option-select").click();
  assert.equal(await page.getByTestId("rapid-photo-offer").count(), 0, "No photo offer before save");
  assert.match(await cards().nth(2).innerText(), /Duplicate · skipped/);
  await capture("review-chosen-dedup");
  await page.getByTestId("rapid-add-all").click();
  await cards().nth(3).getByText(/Controlled per-card save failure/).waitFor();
  assert.equal(maxAddActive, 1);
  assert.deepEqual(writes.filter(w => w.path === "/api/cards/scan/collection").map(w => (w.body as any).cardId), [base.cardId, 96002, 96003]);
  assert.match(await cards().nth(1).innerText(), /Existing ownership and quantity left unchanged/);
  assert.equal(writes.filter(w => /\/upload$/.test(w.path)).length, 0);
  await capture("partial-success");
  addFailure = false;
  await page.getByTestId("rapid-add-all").click();
  await page.getByTestId("rapid-photo-offer").waitFor();
  assert.deepEqual(writes.filter(w => w.path === "/api/cards/scan/collection").map(w => (w.body as any).cardId), [base.cardId, 96002, 96003, 96003]);
  await capture("success");
  const photo = page.getByTestId("rapid-photo-offer");
  assert.ok(await photo.getByRole("button", { name: "Submit photo for review" }).isDisabled());
  await photo.getByRole("checkbox").check();
  await photo.getByRole("button", { name: "Submit photo for review" }).click();
  assert.ok(await page.getByRole("button", { name: "Exit", exact: true }).isDisabled());
  await cards().nth(3).getByText("Controlled photo failure", { exact: true }).waitFor();
  uploadFailure = false;
  await photo.getByRole("button", { name: "Retry photo submission" }).click();
  await photo.getByText(/Photo sent for review/).waitFor();
  assert.equal(owned.size, 3, "Photo effects do not change ownership");
  const ownershipWrites = writes.filter(w => /scan\/collection/.test(w.path)).length;
  await cards().first().getByRole("button", { name: "Report wrong image (optional photo)", exact: true }).click();
  await page.getByRole("button", { name: "Wrong card", exact: true }).click();
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await page.getByTestId("report-image-dialog").waitFor({ state: "hidden" });
  await cards().first().getByRole("button", { name: "Report wrong image (optional photo)", exact: true }).click();
  await page.getByRole("button", { name: "Wrong card", exact: true }).click();
  await page.getByTestId("report-image-file").setInputFiles({ name: "explicit-report.jpg", mimeType: "image/jpeg", buffer: await sharp({ create: { width: 200, height: 280, channels: 3, background: "#ad212c" } }).jpeg().toBuffer() });
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await page.getByTestId("report-image-dialog").waitFor({ state: "hidden" });
  assert.equal(writes.filter(w => /scan\/collection/.test(w.path)).length, ownershipWrites);
  assert.deepEqual(writes.filter(w => /report-image$/.test(w.path)).map(w => (w.body as any).attached), [false, true]);
  checks.push("Wrong-image reports with no photo / explicit optional attachment leave ownership unchanged");
  checks.push("Sequential partial Add all; duplicate skipped; preexisting quantity unchanged; retries skip successes; explicit post-save search-only photo consent / failure / retry; exit locked pending photo");
  await page.getByTestId("rapid-undo-all").click();
  await cards().first().getByText(/Controlled undo failure/).waitFor();
  assert.match(await cards().nth(3).innerText(), /Only this new ownership was undone/);
  await capture("undo-partial-failure");
  undoFailure = false;
  await page.getByTestId("rapid-undo-all").click();
  await cards().first().getByText(/Only this new ownership was undone/).waitFor();
  assert.deepEqual(writes.filter(w => w.method === "DELETE").map(w => w.path), [`/api/cards/scan/collection/${owned.get(base.cardId)}`, `/api/cards/scan/collection/${owned.get(96003)}`, `/api/cards/scan/collection/${owned.get(base.cardId)}`]);
  checks.push("Undo only returned tokens/new rows; per-card failure visible; retry excludes already-undone rows; preexisting row never deleted");
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  const urls = await page.evaluate(() => (window as any).__qaCamera);
  assert.ok(urls.created.every((url: string) => urls.revoked.includes(url)), "All object URLs revoked on exit");

  scenario = "fallback";
  await openRapid();
  await snap();
  await page.getByTestId("rapid-tray").getByText("Strong match", { exact: true }).waitFor();
  await page.evaluate(() => {
    (window as any).__qaCamera.denied = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Resume camera", exact: true }).click();
  await page.locator('[data-camera-state="fallback"]').waitFor();
  assert.equal(await page.getByTestId("rapid-tray").locator(".rapid-thumb").count(), 1, "Permission failure retains existing batch");
  await capture("permission-fallback-retained-batch");
  await page.getByTestId("rapid-file-input").setInputFiles({ name: "picker.jpg", mimeType: "image/jpeg", buffer: await sharp({ create: { width: 800, height: 1100, channels: 3, background: "#ad212c" } }).jpeg().toBuffer() });
  await page.waitForFunction(() => document.querySelectorAll(".rapid-thumb").length === 2);
  await page.getByTestId("rapid-review").click();
  assert.equal(await cards().count(), 2);
  checks.push("Permission denied after background pause stops camera, retains batch, picker prepares full frame and appends capture");

  scenario = "interrupt";
  await openRapid();
  holdRecognition = true;
  const beforeScans = scans.length;
  await snap();
  await page.waitForFunction(() => document.querySelector(".rapid-thumb") != null);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1900);
  assert.equal(scans.length, beforeScans + 1, "Interrupted recognition never silently resubmits / charges again");
  assert.equal(await page.getByRole("button", { name: "Resume camera", exact: true }).count(), 1);
  await page.getByTestId("rapid-review").click();
  await page.getByText(/It may have counted as a scan/).waitFor();
  await capture("interrupted-explicit-retry");
  holdRecognition = false;
  await page.getByRole("button", { name: "Retry scan", exact: true }).click();
  await cards().first().getByText("Strong match", { exact: true }).waitFor();
  assert.equal(scans.length, beforeScans + 2);
  checks.push("Background stops tracks; active request abort shown as explicit retry/error; no automatic replay; camera requires Resume");

  scenario = "queue";
  await openRapid();
  holdRecognition = true;
  for (let i = 0; i < 9; i++) { await snap(); await page.waitForTimeout(55); }
  assert.ok(await page.getByTestId("rapid-capture").isDisabled());
  assert.equal(await page.locator(".rapid-thumb").count(), 9);
  holdRecognition = false;
  await page.waitForFunction(() => document.querySelectorAll(".rapid-thumb [data-tone=green]").length === 9, { timeout: 15000 });
  for (let i = 0; i < 9; i++) { await snap(); await page.waitForTimeout(180); }
  await page.waitForFunction(() => document.querySelectorAll(".rapid-thumb").length === 18);
  assert.ok(await page.getByTestId("rapid-capture").isDisabled());
  await page.getByTestId("rapid-review").click();
  assert.match(await page.locator(".rapid-footer").innerText(), /17 duplicate captures skipped/);
  await cards().last().getByRole("button", { name: "Remove capture 18", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Capture more", exact: true }).isDisabled(), "18 total accepted captures even if an item removed");
  checks.push("Bounded queue 9; session 18; deleted items do not bypass session cap; identity dedup prevents increment");

  await openRapid();
  await page.evaluate(() => (window as any).__qaCamera.playFails = true);
  // Resume path after a stopped stream exercises video.play rejection.
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); });
  await page.getByRole("button", { name: "Resume camera", exact: true }).click();
  await page.locator('[data-camera-state="fallback"]').waitFor();
  assert.ok(await page.evaluate(() => (window as any).__qaCamera.stops >= 2));
  await capture("autoplay-fallback");
  checks.push("Rejected play/autoplay stops opened stream and exposes picker fallback");

  await page.goto(origin);
  await page.getByTestId("scan-rapid-start").waitFor();
  await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined }));
  await page.getByTestId("scan-rapid-start").click();
  await page.locator('[data-camera-state="fallback"]').waitFor();
  await page.getByTestId("rapid-picker").waitFor();
  await capture("camera-unavailable-fallback");
  checks.push("Missing getUserMedia exposes the current picker without discarding a session");

  await page.goto(origin);
  await page.getByTestId("scan-rapid-start").waitFor();
  await page.evaluate(() => (window as any).__qaCamera.delayMs = 900);
  await page.getByTestId("scan-rapid-start").click();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await page.getByTestId("scan-idle").waitFor();
  await page.waitForTimeout(1200);
  const lateCamera = await page.evaluate(() => (window as any).__qaCamera);
  assert.equal(lateCamera.opens, 1);
  assert.equal(lateCamera.stops, 1, "Late permission grant after exit cannot leak a track");
  checks.push("Late camera permission grant after unmount is ignored and every opened track stopped");

  scenario = "stale";
  holdRecognition = true;
  await openRapid();
  await snap();
  await page.waitForTimeout(220);
  await page.getByTestId("rapid-review").click();
  const beforeSkip = await page.evaluate(() => (window as any).__qaCamera);
  await cards().first().getByRole("button", { name: "Remove capture 1", exact: true }).click();
  await page.getByText("No captures yet.", { exact: true }).waitFor();
  await page.waitForTimeout(1900);
  assert.equal(await cards().count(), 0, "Late recognition does not resurrect removed capture");
  const afterSkip = await page.evaluate(() => (window as any).__qaCamera);
  assert.ok(beforeSkip.created.every((url: string) => afterSkip.revoked.includes(url)));
  holdRecognition = false;
  checks.push("Skip aborts an active recognition, revokes the URL immediately and ignores late results");

  visual = false;
  await page.goto(origin);
  assert.equal(await page.getByTestId("scan-rapid-start").count(), 0);
  visual = true;
  await page.goto(origin);
  let pickerOpened = false;
  page.once("filechooser", () => { pickerOpened = true; });
  await page.getByTestId("scan-start").click();
  await page.waitForTimeout(100);
  assert.ok(pickerOpened, "Single-photo mode still launches existing picker");
  checks.push("Rapid gated on visual-v1; legacy no rapid entry; single-photo picker preserved");
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, [], "No HMR");
  assert.deepEqual(unexpected, []);
  checks.push("No runtime errors / HMR / unexpected API; full 640×480 frame plus three corner markers verified; all sources transient; all URLs revoked on exit");
  await writeFile(path.join(evidenceDir, "evidence.json"), JSON.stringify({ provenance: "ISOLATED production-built actual Scan page; synthetic canvas camera; mock auth, recognition, collection, uploads and undo. Cached catalog thumbnails for decoration, synthetic choices intentionally QA-labeled. No live writes, no OCR/model changes, no real hardware verification.", checks, errors, sockets, unexpected, writes, scans, maxAddActive, undidRows: [...undone] }, null, 2));
  console.log(`PASS: ${checks.length} check groups; screenshots/evidence: ${evidenceDir}`);
} finally {
  await browser.close();
  if (process.env.SCAN_QA_HOLD !== "1") await new Promise<void>(resolve => server.close(() => resolve()));
}