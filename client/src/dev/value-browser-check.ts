import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright-core";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { fixtureValueResponse, valueFixtureCards } from "./value-fixtures";

const isListing = (url: string) => url.startsWith("/api/collection/value?") || url.includes("/top-cards?");

async function checkShowcase(page: Page, requests: string[], scenario: string, output: string) {
  const tiles = page.locator('[data-testid^="value-card-"]');
  await page.getByTestId("value-grail").waitFor();
  assert.equal(await tiles.count(), 25, `${scenario}: hero counts as first of 25`);
  assert.equal(await page.getByTestId("value-grid").locator("button").count(), 24);
  assert.equal(await page.getByTestId("value-card-101").count(), 1, "no duplicate hero");
  assert.ok((await tiles.first().innerText()).includes("$284.57"));
  assert.ok((await tiles.first().innerText()).includes("×2"));
  assert.equal(await page.getByRole("button", { name: /High → Low|Low → High|Hide under \$5/ }).count(), 0);
  assert.equal(await page.getByLabel("Value filters").count(), 0);
  const initialCalls = requests.filter(isListing);
  for (const url of initialCalls) {
    const params = new URL(url, "http://fixture.local").searchParams;
    assert.equal(params.get("order"), "desc");
    assert.equal(params.get("hideUnder5"), "false");
    assert.equal(params.get("offset"), "0");
  }
  assert.equal(initialCalls.filter(url => url.includes("limit=25")).length, 1);
  assert.equal(requests.some(url => /card-pricing|\/refresh|\/api\/cards\/\d+/.test(url)), false, "listing makes no detail or price calls");
  const heroImage = await page.getByTestId("value-grail").locator("img").boundingBox();
  const tileImage = await page.getByTestId("value-grid").locator("img").first().boundingBox();
  const trophy = await page.getByTestId("value-grail").locator("svg").boundingBox();
  assert.ok(heroImage && tileImage && trophy);
  assert.ok(heroImage.height > tileImage.height, "hero image is larger");
  assert.ok(trophy.x >= heroImage.x + heroImage.width, "trophy is beside, not over card");
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.evaluate(() => {
    const hero = document.querySelector(".value-grail")!;
    window.scrollTo(0, hero.getBoundingClientRect().top + window.scrollY - 16);
  });
  await page.screenshot({ path: `${output}/${scenario}-hero-grid-390.png` });
  if (scenario === "value") {
    await page.setViewportSize({ width: 1280, height: 1200 });
    const desktopHero = await page.getByTestId("value-grail").locator("img").boundingBox();
    const desktopTile = await page.getByTestId("value-grid").locator("img").first().boundingBox();
    assert.ok(desktopHero && desktopTile && desktopHero.height > desktopTile.height, "desktop hero image is larger");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/value-hero-grid-1280.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Scrolling to the bottom is deliberately not an automatic pagination trigger.
  await page.getByRole("button", { name: "Load more", exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  assert.equal(requests.filter(isListing).length, initialCalls.length);
  await Promise.all([
    page.waitForResponse(response => response.url().includes("offset=25")),
    page.getByRole("button", { name: "Load more", exact: true }).click(),
  ]);
  if (scenario === "page-error") {
    await page.getByText("Couldn't load the latest values.").waitFor();
    assert.equal(await tiles.count(), 25, "pagination errors keep loaded cards");
    await Promise.all([
      page.waitForResponse(response => response.url().includes("offset=25") && response.ok()),
      page.getByRole("button", { name: "Retry", exact: true }).click(),
    ]);
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="value-card-"]').length === 50);
  assert.equal(await tiles.count(), 50);
  assert.equal(await page.getByTestId("value-grid").locator("button").count(), 49);
  assert.equal(await page.getByTestId("value-card-101").count(), 1);
  assert.equal(requests.filter(isListing).length, initialCalls.length + (scenario === "page-error" ? 2 : 1));
  assert.equal(requests.some(url => /card-pricing|\/refresh/.test(url)), false);
  await page.getByTestId("value-card-101").click();
  if (scenario === "detail-error") {
    await page.getByText("Couldn't load card details").waitFor();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
  }
  await page.getByTestId("button-close-modal").waitFor();
  await page.getByText("Gold Spectrum", { exact: true }).waitFor();
  await page.getByText("Catalog detail fixture: original illustration and full card metadata.", { exact: true }).waitFor();
  assert.ok(requests.some(url => url === "/api/cards/101"));
  assert.equal(requests.some(url => url.includes("/refresh")), false);
  await page.getByTestId("button-close-modal").click();
}

async function checkBanner(page: Page) {
  const banner = page.getByTestId("value-page-banner");
  await banner.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('[data-testid="value-page-banner"]');
    return image?.complete && image.naturalWidth > 0;
  });
  const dimensions = await banner.evaluate(image => {
    const img = image as HTMLImageElement;
    const bounds = img.getBoundingClientRect();
    return { width: img.naturalWidth, height: img.naturalHeight, renderedWidth: bounds.width, renderedHeight: bounds.height, objectFit: getComputedStyle(img).objectFit };
  });
  assert.equal(dimensions.width, 1024);
  assert.equal(dimensions.height, 344);
  assert.ok(Math.abs(dimensions.renderedWidth / dimensions.renderedHeight - 1024 / 344) < 0.01, "banner is uncropped");
  assert.notEqual(dimensions.objectFit, "cover");
  const heading = page.getByRole("heading", { name: "Most Valuable Cards", exact: true });
  assert.ok(!(await heading.getAttribute("class"))?.includes("sr-only"), "heading is visible, not screen-reader-only");
  assert.equal(await heading.isVisible(), true);
  assert.equal(await page.getByText("Your collection, ranked by cached market price.", { exact: true }).count(), 0);
  const collectionLink = page.getByRole("link", { name: "My Collection", exact: true });
  const trendsLink = page.getByRole("link", { name: "Market Trends", exact: true });
  assert.equal(await collectionLink.getAttribute("href"), "/my-collection");
  assert.equal(await trendsLink.getAttribute("href"), "/trends");
  const titleBounds = await heading.boundingBox();
  const bannerBounds = await banner.boundingBox();
  const collectionBounds = await collectionLink.boundingBox();
  const trendsBounds = await trendsLink.boundingBox();
  assert.ok(titleBounds && bannerBounds && collectionBounds && trendsBounds);
  assert.ok(titleBounds.y + titleBounds.height <= bannerBounds.y, "visible heading precedes banner");
  assert.ok(collectionBounds.y >= bannerBounds.y + bannerBounds.height, "My Collection is below banner");
  assert.ok(trendsBounds.y >= bannerBounds.y + bannerBounds.height, "Market Trends is below banner");
  assert.ok(Math.abs(collectionBounds.y - trendsBounds.y) < 1, "navigation links share a row");
  assert.ok(Math.abs(collectionBounds.width - trendsBounds.width) < 1, "navigation links are balanced");
  assert.ok(collectionBounds.height >= 44 && trendsBounds.height >= 44, "comfortable navigation touch targets");
  assert.ok((await page.getByTestId("value-summary").innerText()).includes("Includes every priced copy in your collection."));
  assert.equal(await page.getByText("Includes every priced copy, regardless of filters.", { exact: true }).count(), 0);
}

// Run: npx tsx client/src/dev/value-browser-check.ts
// Optional: VALUE_UI_BASE_URL, VALUE_UI_CHROMIUM (browser executable).
// This script never signs in and never sends API requests to the backend.
// Bundles the real components in memory, so it also works against the existing
// phone-preview server without rebuilding it or restarting any workflow.
async function main() {
const base = process.env.VALUE_UI_BASE_URL ?? "http://127.0.0.1:5000";
const output = "client/src/dev/screenshots";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true, executablePath: process.env.VALUE_UI_CHROMIUM || undefined,
  args: ["--no-sandbox"],
});
const summary = fixtureValueResponse().summary;
const xp = { totalXp: 174, level: 3, xpIntoLevel: 24, xpForNextLevel: 100, progressPct: 24, isMaxLevel: false };
const bundle = await build({
  entryPoints: ["client/src/dev/value-harness.tsx"], bundle: true, write: false,
  outdir: "client/src/dev/.browser-bundle", platform: "browser", format: "esm", jsx: "automatic",
  alias: { "@": `${process.cwd()}/client/src`, "@shared": `${process.cwd()}/shared`, "@assets": `${process.cwd()}/attached_assets` },
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
  define: { "import.meta.env": JSON.stringify({ DEV: true, PROD: false, PHONE_PREVIEW: false }), "import.meta.glob": "__fixtureGlob", "process.env.NODE_ENV": '"development"' },
  banner: { js: "const __fixtureGlob = () => ({});" },
  plugins: [{
    name: "test-only-auth-module",
    setup(builder) {
      builder.onLoad({ filter: /contexts\/AuthContext\.tsx$/ }, () => ({
        contents: 'export const useAuth = () => ({user:{uid:"ui-fixture-viewer",getIdToken:async()=>"ui-test-token"},loading:false}); export const AuthProvider = ({children}) => children;',
        loader: "tsx",
      }));
      builder.onLoad({ filter: /lib\/firebase\.ts$/ }, () => ({
        contents: 'export const auth = {currentUser:null};',
        loader: "ts",
      }));
    },
  }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
const css = (await postcss([tailwindcss({ config: "tailwind.config.ts" })]).process(bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text, { from: "client/src/index.css" })).css;
let checks = 0;
try {
  for (const scenario of ["value", "dashboard", "collection", "trends", "profile-owner", "profile-visitor", "profile-private", "profile-friends", "profile-hidden", "empty", "error", "loading", "page-error", "detail-error"]) {
    console.log(`Checking ${scenario}`);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [], requests: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(scenario, error.message); });
    await page.route("**/src/dev/value-harness.html*", route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__value_ui/bundle.css"></head><body><div id="root"></div><script type="module" src="/__value_ui/bundle.js"></script></body></html>',
    }));
    await page.route("**/__value_ui/bundle.js", route => route.fulfill({ contentType: "application/javascript", body: js }));
    await page.route("**/__value_ui/bundle.css", route => route.fulfill({ contentType: "text/css", body: css }));
    // Test-run-only module interception, scoped to this standalone dev entry.
    // No bypass is added to AuthContext or any production route.
    await page.route("**/src/contexts/AuthContext.tsx*", route => route.fulfill({
      contentType: "application/javascript",
      body: 'export const useAuth = () => ({user:{getIdToken:async()=>"ui-test-token"},loading:false}); export const AuthProvider = ({children}) => children;',
    }));
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname + url.search);
      let response: unknown = [];
      if (url.pathname === "/api/collection/value" || url.pathname.endsWith("/top-cards")) {
        if (scenario === "loading") { await new Promise(resolve => setTimeout(resolve, 3500)); }
        if ((scenario === "error" && requests.filter(isListing).length === 1) ||
          (scenario === "page-error" && url.searchParams.get("offset") === "25" && requests.filter(path => path.includes("offset=25")).length === 1)) {
          return route.fulfill({ status: 503, json: { message: "Test service unavailable" } });
        }
        response = scenario === "empty" ? { cards: [], total: 0, hasMore: false, summary: { ...summary, totalValue: 0, pricedCards: 0, pricedCopies: 0 } } : fixtureValueResponse(url.searchParams);
      } else if (url.pathname === "/api/collectors/inkvault") {
        const allowed = scenario === "profile-owner" || scenario === "profile-visitor";
        response = {
          user: { id: 1, username: "inkvault", displayName: "Ink Vault", plan: "SIDE_KICK", createdAt: "2024-04-12T10:00:00Z", isAdmin: false },
          stats: { totalCards: 1080, totalValue: allowed ? summary.totalValue : null, wishlistItems: 14, friendsCount: 8, badgesCount: 0 },
          xp, isOwnProfile: scenario === "profile-owner", canViewTopCards: allowed,
          canViewCollection: scenario === "profile-friends", canViewWishlist: false,
          friendStatus: "none", friendRequestId: null, approvedContributions: 0,
        };
      } else if (url.pathname === "/api/stats") response = { totalCards: 1080, totalValue: summary.totalValue, wishlistItems: 14 };
      else if (url.pathname === "/api/user/xp-summary") response = { ...xp, breakdown: { cardXp: 98, imageXp: 42, badgeXp: 34, shareXp: 0, totalXp: 174 }, recentXpEvents: [] };
      else if (url.pathname === "/api/collection") response = valueFixtureCards.slice(0, 30).map(card => ({ id: card.collectionItemId, cardId: card.id, quantity: card.quantity, isFavorite: card.id % 2 === 0, condition: "Near Mint", card }));
      else if (url.pathname === "/api/card-sets") response = [{ ...valueFixtureCards[0].set, totalCards: 1043 }];
      else if (url.pathname === "/api/main-sets") response = [{ id: 1, name: "Marvel Masterpieces", year: 2024 }];
      else if (url.pathname === "/api/market-trends") response = { marketMovement: { averagePrice: 0, percentChange: 0, totalSold: 0, highestSale: 0, lowestSale: 0 }, trendData: [], topGainers: [], topLosers: [], recentSales: [] };
      else if (url.pathname.endsWith("/pc-binders")) response = { binders: [], private: true };
      else if (url.pathname.endsWith("/wishlist")) response = { cards: [], private: true };
      else if (url.pathname.endsWith("/trade-block")) response = { cards: [], total: 0 };
      else if (url.pathname.endsWith("/contributions")) response = { approved: 0, pending: 0 };
      else if (url.pathname.endsWith("/follow-info")) response = { followerCount: 9, followingCount: 12, friendCount: 8, isFollowing: false, followsYou: false, isFriend: false, canFollow: true };
      else if (url.pathname.startsWith("/api/card-pricing/")) response = { avgPrice: 284.57, salesCount: 7 };
      else if (/^\/api\/cards\/\d+$/.test(url.pathname)) {
        if (scenario === "detail-error" && requests.filter(path => /^\/api\/cards\/\d+$/.test(path)).length === 1) {
          return route.fulfill({ status: 503, json: { message: "Test detail unavailable" } });
        }
        const card = valueFixtureCards.find(item => item.id === Number(url.pathname.split("/").pop()))!;
        response = { ...card, description: "Catalog detail fixture: original illustration and full card metadata.", variation: "Gold Spectrum", set: { ...card.set, slug: "marvel-masterpieces-2024", description: "Full catalog set detail." } };
      }
      await route.fulfill({ json: response });
    });
    const screen = scenario.startsWith("profile") ? "profile" : ["empty", "error", "loading", "page-error", "detail-error"].includes(scenario) ? "value" : scenario;
    await page.goto(`${base}/src/dev/value-harness.html?screen=${screen}&network=1`);
    if (scenario === "loading") await page.getByRole("status", { name: "Loading card values" }).waitFor();
    else if (scenario === "error") await page.getByText("Couldn't load card values").waitFor();
    else if (scenario === "empty") await page.getByText("No priced cards yet").waitFor();
    else if (scenario.startsWith("profile")) {
      await page.getByText("@inkvault", { exact: true }).waitFor();
      if (scenario === "profile-owner" || scenario === "profile-visitor") {
        await page.getByTestId("value-preview").waitFor();
        await page.getByTestId("value-preview").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/${scenario}-overview-390.png` });
        assert.ok(requests.some(url => url.includes("limit=5") && url.includes("hideUnder5=false")));
        await page.getByRole("tab", { name: "Top Cards", exact: true }).click();
        await page.getByTestId("value-summary").waitFor();
        await page.evaluate(() => {
          const tab = document.querySelector('[role="tablist"]');
          if (tab) window.scrollTo(0, tab.getBoundingClientRect().top + window.scrollY - 16);
        });
      } else {
        assert.equal(await page.getByRole("tab", { name: "Top Cards", exact: true }).count(), 0);
        assert.equal(await page.getByText("Collection Value", { exact: true }).count(), 0);
        assert.equal(requests.some(url => url.includes("/top-cards")), false);
      }
    } else if (scenario === "dashboard") await page.getByText("VALUE", { exact: true }).waitFor();
    else if (scenario === "collection") await page.getByRole("button", { name: "Most valuable", exact: true }).waitFor();
    else if (scenario === "trends") await page.getByRole("heading", { name: "Your top cards" }).waitFor();
    else await page.getByTestId("value-card-101").waitFor().catch(async error => {
      await page.screenshot({ path: `${output}/debug-${scenario}.png` });
      console.error(await page.locator("body").innerText(), requests);
      throw error;
    });
    await page.screenshot({ path: `${output}/${scenario}-390.png`, fullPage: scenario === "trends" });
    if (scenario === "value") {
      await checkBanner(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/value-banner-top-390.png` });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await checkBanner(page);
      await page.screenshot({ path: `${output}/value-banner-top-1280.png` });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > 390), false, `${scenario} horizontal overflow`);
    if (["value", "page-error", "detail-error"].includes(scenario)) {
      assert.ok((await page.getByTestId("value-summary").innerText()).includes(summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
      assert.equal(await page.locator('[data-testid^="value-card-"]').count(), 25);
      await checkShowcase(page, requests, scenario, output);
      if (scenario === "value") {
        await page.getByRole("link", { name: "Market Trends", exact: true }).click();
        await page.getByRole("heading", { name: "Your top cards" }).waitFor();
        await page.getByRole("link", { name: "See all →" }).click();
        await page.getByTestId("value-page-banner").waitFor();
        await page.getByRole("link", { name: "My Collection", exact: true }).click();
        await page.getByRole("combobox", { name: "Collection sort" }).waitFor();
        assert.equal(await page.getByTestId("value-page-banner").count(), 0, "back navigation reaches My Collection");
      }
    }
    if (scenario === "error") {
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.getByTestId("value-grail").waitFor();
      assert.equal(await page.locator('[data-testid^="value-card-"]').count(), 25);
      assert.equal(requests.filter(isListing).length, 2);
    }
    if (scenario === "profile-owner" || scenario === "profile-visitor") {
      await checkShowcase(page, requests, scenario, output);
    }
    if (scenario === "dashboard") {
      await page.getByText("VALUE", { exact: true }).click();
      await page.getByRole("heading", { name: "Most Valuable Cards", exact: true }).waitFor();
      await page.getByTestId("value-summary").waitFor();
    }
    if (scenario === "collection") {
      await page.getByRole("combobox", { name: "Collection sort" }).click();
      await Promise.all([page.waitForResponse(response => response.url().includes("order=asc")), page.getByRole("option", { name: "Value: Low → High" }).click()]);
      assert.ok(requests.some(url => url.includes("limit=25")));
      await page.waitForTimeout(150);
      assert.equal(await page.getByTestId("value-grail").count(), 0, "ascending collection has no highest-value hero");
      assert.ok(requests.some(url => url.includes("order=asc") && url.includes("hideUnder5=false")));
      assert.equal(await page.locator('[data-testid^="value-card-"]').count(), 25);
      await page.screenshot({ path: `${output}/collection-value-sort-390.png` });
      await page.getByRole("combobox", { name: "Collection sort" }).click();
      await Promise.all([page.waitForResponse(response => response.url().includes("order=desc")), page.getByRole("option", { name: "Value: High → Low" }).click()]);
      await page.getByTestId("value-card-101").waitFor();
      assert.equal(await page.getByTestId("value-grail").count(), 0, "My Collection stays separate from showcase");
    }
    if (scenario === "trends") {
      await page.getByRole("link", { name: "See all →" }).click();
      await page.getByRole("heading", { name: "Most Valuable Cards", exact: true }).waitFor();
    }
    assert.deepEqual(errors, [], `${scenario} runtime errors`);
    checks++;
    await page.close();
  }
  console.log(`Passed ${checks} actual-component scenarios at 390px. Screenshots: ${output}. UI fixtures only; no backend/privacy/performance certification.`);
} finally {
  await browser.close();
}
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
