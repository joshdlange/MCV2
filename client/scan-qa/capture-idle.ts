/**
 * npx tsx client/scan-qa/capture-idle.ts
 * Production-built real Scan + MobileHeader. All APIs mocked, no DB/inference,
 * no live auth changes, no HMR, no workflow restart, no dist/public writes.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import sharp from "sharp";

const root = process.cwd();
const qa = path.join(root, "client/scan-qa");
const output = path.join(qa, "build/idle");
const evidenceDir = path.join(qa, "screenshots/idle");
await mkdir(evidenceDir, { recursive: true });
if (process.env.SCAN_QA_SERVE_ONLY !== "1") await build({
  configFile: false, root: path.join(qa, "idle"), mode: "production", publicDir: false,
  plugins: [{
    name: "isolated-idle-auth", enforce: "pre",
    resolveId(id) {
      if (id === "@/contexts/AuthContext" || /\/contexts\/AuthContext(?:\.tsx)?$/.test(id)) return path.join(qa, "auth.ts");
      if (id === "./firebase" || /\/lib\/firebase(?:\.ts)?$/.test(id)) return path.join(qa, "firebase.ts");
      return null;
    },
  }, react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  css: { postcss: root }, build: { outDir: output, emptyOutDir: true, minify: true }, logLevel: "warn",
});
const fixtures = JSON.parse(await readFile(path.join(qa, "catalog-fixture.json"), "utf8"));
const candidates = fixtures.families.flatMap((f: any) => f.options).filter((c: any) => c.imageUrl && fixtures.images?.[c.imageUrl]);
const distinct = [...new Map(candidates.map((c: any) => [c.cardId, c])).values()] as any[];
const owned = distinct.slice(0, 8).map((card, index) => ({
  id: 100 + index, cardId: card.cardId, acquiredDate: `2026-10-0${index + 1}T12:00:00Z`,
  quantity: 1,
  card: { id: card.cardId, name: card.name, cardNumber: card.cardNumber, set: { id: card.setId, name: card.setName, year: card.year },
    frontImageUrl: `/qa-owned/${index}.jpg`, backImageUrl: `/qa-owned/${index}.jpg` },
}));
assert.equal(owned.length, 8, "Need enough owned cards to verify last-six slicing");
// Deliberately unordered: the UI must sort by acquiredDate, not API order.
owned.reverse();
let visual = true;
let limit = false;
let cleanMode = false;
let brokenWebp = false;
let collectionMode = "owned";
const writes: string[] = [];
const app = express();
app.use(express.json());
app.get("/api/cards/scan/config", (_req, res) => res.json({ visualV1: visual }));
app.get("/api/cards/scan/usage", (_req, res) => res.json({ used: limit ? 5 : 2, limit: 5, unlimited: false, remaining: limit ? 0 : 3 }));
app.get("/api/stats", (_req, res) => res.json({ totalCards: 127 }));
app.get("/api/collection", (_req, res) => collectionMode === "error" ? res.status(503).json({ message: "Mock collection unavailable" }) : res.json(collectionMode === "empty" ? [] : owned));
app.post("/api/cards/scan/client-event", (_req, res) => res.json({ ok: true }));
app.get("/api/cards/scan/search", (_req, res) => res.json([]));
app.get(["/api/cards/picker/years", "/api/cards/scan/browse/years"], (_req, res) => res.json([2024, 1992]));
app.get("/api/notifications", (_req, res) => res.json([]));
app.get(["/api/card-sets", "/api/main-sets", "/api/pc-binders", "/api/wishlist"], (_req, res) => res.json([]));
app.get("/api/card-pricing/:id", (_req, res) => res.status(404).json({ message: "No cached mock pricing" }));
app.get(["/api/social/unread-count", "/api/notifications/unread-count"], (_req, res) => res.json({ count: 0 }));
app.get("/qa-owned/:index.jpg", async (req, res) => {
  if (collectionMode === "broken" && Number(req.params.index) === 7) return res.status(404).end();
  const card = distinct[Number(req.params.index)];
  res.type("jpg").send(await readFile(path.resolve(fixtures.images[card.imageUrl])));
});
const syntheticClean = await sharp({ create: { width: 1904, height: 640, channels: 3, background: "#b51f27" } }).png().toBuffer();
app.get("/scan-hero-clean.png", (_req, res) => cleanMode ? res.type("png").send(syntheticClean) : res.type("html").send("<html>SPA missing file fallback</html>"));
app.get("/scan-hero.webp", (_req, res, next) => brokenWebp ? res.status(404).end() : next());
app.use(express.static(output));
app.use(express.static(path.join(root, "client/public")));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) { writes.push(`${req.method} ${req.path}`); return res.status(501).json({ message: "Unexpected mock API" }); }
  return res.sendFile(path.join(output, "index.html"));
});
const server = app.listen(5198, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const origin = "http://127.0.0.1:5198";
if (process.env.SCAN_QA_SERVE_ONLY === "1") await new Promise(() => {});
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors: string[] = [];
const sockets: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("websocket", socket => sockets.push(socket.url()));
await page.route("**/*", route => {
  const url = new URL(route.request().url());
  // Permit only existing public font assets; remote catalog/API requests stay blocked.
  return url.origin === origin || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) ? route.continue() : route.abort();
});
const layouts: unknown[] = [];
async function load() {
  await page.goto(origin);
  await page.getByTestId("scan-idle").waitFor();
   if (collectionMode !== "empty" && collectionMode !== "error") await page.getByText("127 cards in your collection", { exact: true }).waitFor();
  await page.locator(".scan-idle-banner img").evaluate(async (img: HTMLImageElement) => { await img.decode(); });
  await page.evaluate(() => document.fonts.ready);
}
async function check(label: string) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, scrollY }));
   assert.ok(dimensions.documentWidth <= dimensions.width, `${label} no horizontal scrolling: ${JSON.stringify(dimensions)}`);
   assert.ok(dimensions.documentHeight > dimensions.height, `${label} idle page scrolls normally`);
  assert.equal(dimensions.scrollY, 0);
   for (const selector of [".scan-idle-banner", ".scan-idle-tips", ".scan-idle-primary", ".scan-idle-search"]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.y >= 64 && box.y + box.height <= dimensions.height - 22, `${label} ${selector} fully visible above QA label`);
  }
  const banner = await page.locator(".scan-idle-banner img").boundingBox();
  assert.ok(banner && Math.abs(banner.width / banner.height - 1904 / 640) < .01, "Original aspect ratio, no crop");
  assert.ok((await page.getByTestId("scan-start").boundingBox())!.height >= 56);
   const undersized = await page.getByTestId("scan-idle").evaluate(root => Array.from(root.querySelectorAll("*"))
     .filter(el => Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
     .filter(el => parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent));
   assert.deepEqual(undersized, [], `${label} all idle text at least 12px`);
   assert.equal(await page.getByTestId("scan-rapid-start").count(), 1);
   const footer = await page.locator(".scan-idle-footer").boundingBox();
   assert.ok(footer && footer.y > (await page.locator(".scan-idle-help").boundingBox())!.y, "Footer follows content");
   await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
   assert.ok(await page.evaluate(() => scrollY > 0), "Can scroll to the collection footer");
   await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.locator(".scan-idle-headline").count(), cleanMode ? 1 : 0);
  layouts.push({ label, ...dimensions });
}
try {
  await load();
  await page.locator(".scan-idle-recent img").first().waitFor();
   await page.getByText("RECENTLY ADDED", { exact: true }).waitFor();
  await check("390x844 original");
   assert.deepEqual(await page.locator(".scan-idle-step strong").allTextContents(), ["Snap", "Match", "Add"]);
   assert.deepEqual(await page.locator(".scan-idle-step p").allTextContents(), ["Take a photo, no crop needed", "We search 90,000+ card images", "One tap to your vault"]);
   assert.deepEqual(await page.locator(".scan-idle-guide-list li").allTextContents(), ["Good lighting", "Whole card in view", "Front of card", "Sleeves & toploaders OK", "Browse by year & set", "Type a search", "Pick the exact version", "Report a wrong image"]);
   assert.equal(await page.locator(".scan-idle-help p").textContent(), "Card missing a picture? Add yours after you scan, and every photo you submit helps the next collector find it faster.");
   assert.equal(await page.locator(".scan-idle-guides button, .scan-idle-help button").count(), 0, "Informational guides, no dead buttons");
   assert.ok(!/ocr|file size/i.test(await page.getByTestId("scan-idle").innerText()));
  assert.ok((await page.locator(".scan-idle-banner").boundingBox())!.y < 145, "Banner at top of start content, not vertically centered");
   assert.deepEqual(await page.locator(".scan-idle-recent img").evaluateAll(imgs => imgs.map(img => img.getAttribute("src"))), [7, 6, 5, 4, 3, 2].map(i => `/qa-owned/${i}.jpg`));
  assert.equal(await page.getByText("Your next card. In your vault.", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Snap a photo of your card. We'll find it in seconds.", { exact: true }).count(), 1);
   await page.screenshot({ path: path.join(evidenceDir, "mobile-390x844-mock-auth.png"), fullPage: true });
   const actionPositions = await page.locator(".scan-idle-primary, .scan-idle-search").evaluateAll(els => els.map(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })));
   // Original 18px section spacing, 56px capture and 44px search. Tips only grow 1px.
   assert.ok(Math.abs(actionPositions[0].top - 355) < 2, `Original mobile capture geometry (1px minimum-font adjustment): ${JSON.stringify(actionPositions)}`);
   const rapidBox = await page.getByTestId("scan-rapid-start").boundingBox();
   assert.ok(rapidBox && rapidBox.y > actionPositions[0].top && rapidBox.y < actionPositions[1].top, "Rapid entry between scan and search");
   for (let i = 0; i < 6; i++) {
     await page.locator(".scan-idle-recent button").nth(i).click();
     await page.getByTestId("button-close-modal").waitFor();
     await page.getByRole("dialog").getByText(`#${owned[i].card.cardNumber}`, { exact: true }).first().waitFor();
     assert.equal(await page.getByRole("dialog").getByAltText(owned[i].card.name, { exact: true }).getAttribute("src"), owned[i].card.frontImageUrl, "Each recent opens the actual selected owned card");
     if (i === 0) {
       await page.getByTestId("button-flip-card").click();
       await page.getByRole("dialog").getByAltText(`${owned[i].card.name} back`).waitFor();
     }
     await page.getByTestId("button-close-modal").click();
     await page.getByRole("dialog").waitFor({ state: "hidden" });
   }
   await page.getByRole("link", { name: "View collection" }).click();
   await page.waitForURL("**/my-collection");
   await page.getByPlaceholder("Search your collection...").waitFor();
   await page.goBack();
   await page.getByTestId("scan-idle").waitFor();
   await page.evaluate(() => window.scrollTo(0, 0));
  let picked = false;
  page.once("filechooser", () => { picked = true; });
  await page.getByTestId("scan-start").click();
  await page.waitForTimeout(100);
  assert.ok(picked, "Existing capture handler opens picker");
  await page.getByTestId("scan-file-input").dispatchEvent("cancel");
  await page.getByRole("button", { name: "Search instead", exact: true }).click();
  await page.getByRole("button", { name: "Type search", exact: true }).click();
  await page.getByTestId("scan-search-input").waitFor();
  await load();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-area-top", "47px");
    document.documentElement.style.setProperty("--safe-area-bottom", "34px");
  });
  await check("390x844 with 47/34px safe areas");
   await page.screenshot({ path: path.join(evidenceDir, "mobile-safe-areas-mock-auth.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 844 });
  await load();
  await check("1280x844 desktop");
  assert.ok((await page.locator(".scan-idle-layout").boundingBox())!.width <= 720);
   await page.screenshot({ path: path.join(evidenceDir, "desktop-1280x844-mock-auth.png"), fullPage: true });
   await page.setViewportSize({ width: 320, height: 844 });
   await load();
   await check("320x844 narrow");
   assert.equal(await page.locator(".scan-idle-guides").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  brokenWebp = true;
  await load();
  assert.ok((await page.locator(".scan-idle-banner img").getAttribute("src"))?.endsWith(".png"), "WebP failure falls back to original PNG");
  brokenWebp = false;
  cleanMode = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".scan-idle-headline").waitFor();
  await check("Simulated late clean asset, HTML headline");
  cleanMode = false;
  collectionMode = "empty";
  await load();
   assert.equal(await page.getByTestId("scan-idle-recent-section").count(), 0);
   collectionMode = "broken";
   await load();
   await page.getByLabel("Card image unavailable").waitFor();
   assert.equal(await page.locator(".scan-idle-recent button").count(), 6, "Broken images never hide owned cards");
   const missing = owned[0].card.frontImageUrl;
   owned[0].card.frontImageUrl = "";
   await load();
   assert.equal(await page.locator(".scan-idle-recent button").count(), 6, "Missing image never hides owned card");
   owned[0].card.frontImageUrl = missing;
  collectionMode = "error";
  await load();
  assert.equal(await page.locator(".scan-idle-recent img").count(), 0);
  collectionMode = "owned";
  limit = true;
  await load();
  assert.equal(await page.getByTestId("scan-start").isDisabled(), true);
  await page.getByRole("button", { name: "View plans" }).waitFor();
  await check("Scan limit preserves Search and plans");
  limit = false;
  visual = false;
  await page.goto(origin);
  await page.getByText("Scan to Add", { exact: true }).first().waitFor();
  assert.equal(await page.getByTestId("scan-idle").count(), 0, "Legacy config does not use DEV banner");
  visual = true;
  await load();
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, [], "Production-built, no HMR");
  assert.deepEqual(writes, [], "No collection mutation or unexpected API");
  await writeFile(path.join(evidenceDir, "evidence.json"), JSON.stringify({ provenance: "ISOLATED production-built actual Scan and actual MobileHeader; mock auth/count/ownership; real cached catalog thumbnails. Clean-asset test uses synthetic flat image. No live auth verification.", layouts, errors, sockets, writes, pngBytes: (await readFile(path.join(root, "client/public/scan-hero.png"))).length, webpBytes: (await readFile(path.join(root, "client/public/scan-hero.webp"))).length }, null, 2));
  console.log(`PASS: ${layouts.length} layouts; captures/evidence: ${evidenceDir}`);
} finally {
  await browser.close();
  if (process.env.SCAN_QA_HOLD !== "1") await new Promise<void>(resolve => server.close(() => resolve()));
}