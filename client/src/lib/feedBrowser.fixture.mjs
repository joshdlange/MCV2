// Browser-only fixture. Real components, mocked auth, all API requests intercepted.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The workflow may serve a production phone build without source modules.
// A disposable, loopback-only Vite fixture does not touch/restart that workflow.
const fixtureServer = process.env.VAULT_QA_URL ? null : await createServer({
  configFile: false, root: path.resolve("client"), plugins: [react()],
  define: { "import.meta.env.PHONE_PREVIEW": "true" },
  resolve: { alias: {
    "@": path.resolve("client/src"), "@shared": path.resolve("shared"),
    "@assets": path.resolve("attached_assets"),
  } },
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
});
await fixtureServer?.listen();
const base = process.env.VAULT_QA_URL || "http://127.0.0.1:5179";
const output = ".local/feed-filter-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const reports = [];
const collector = id => ({
  id, username: `fixture-collector-${id}`, displayName: null, photoURL: null,
  collectorAvatarKey: null, collectorLevel: 4,
});

async function mount(page, component) {
  const source = await (await page.request.get(`${base}/src/lib/queryClient.ts`)).text();
  const queryModule = source.match(/"(\/node_modules\/\.vite\/deps\/@tanstack_react-query\.js\?v=[^"]+)"/)?.[1];
  assert.ok(queryModule, "running Vite React Query module");
  await page.route("**/src/contexts/AuthContext.tsx*", route => route.fulfill({
    contentType: "application/javascript",
    body: `export const useAuth=()=>({user:{uid:'fixture-only',getIdToken:async()=>'fixture-only'},loading:false});
      export const AuthProvider=({children})=>children;`,
  }));
  await page.route("**/src/main.tsx*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {QueryClientProvider} from '${queryModule}';
      import {queryClient} from '/src/lib/queryClient.ts';
      import {useAppStore} from '/src/lib/store.ts';
      import Component from '/src/pages/${component}.tsx';
      import {Toaster} from '/src/components/ui/toaster.tsx';
      import '/src/index.css';
      useAppStore.setState({currentUser:{id:1,username:'fixture-viewer',displayName:'Fixture viewer'}});
      window.__fixtureQueryClient=queryClient;
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement(QueryClientProvider,{client:queryClient},
          React.createElement(React.Fragment,null,React.createElement(Component),React.createElement(Toaster))));
    `,
  }));
}

try {
  for (const width of [1280, 393, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 852 } });
    const errors = [], requests = [], writes = [];
    const reactions = new Map();
    let delayedMutation;
    let releaseMutation;
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, "Feed");
    const makeEvents = (type, older) => {
      const kind = type === "all" ? "badges" : type;
      const start = kind === "badges" ? 101 : kind === "cards" ? 201 : 301;
      return Array.from({ length: older ? 3 : 10 }, (_, i) => {
        const id = start + i + (older ? 10 : 0);
        return {
          id, eventType: kind === "badges" ? "badge_earned" : kind === "cards" ? "first_card" : "level_milestone",
          title: kind === "badges" ? `earned fixture badge ${id}` : kind === "cards" ? `added fixture card ${id}` : `reached fixture level ${id}`,
          metadata: { level: 4 }, image: null, previewImages: null, relatedType: null, relatedId: null,
          user: collector(id), createdAt: new Date().toISOString(),
          ...(reactions.get(id) || { reactions: {}, myReaction: null }),
        };
      });
    };
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      requests.push(`${method} ${url.pathname}${url.search}`);
      let result;
      if (url.pathname === "/api/feed") {
        assert.ok(["everyone", "following", "me"].includes(url.searchParams.get("filter")));
        assert.ok(["all", "badges", "cards", "activity"].includes(url.searchParams.get("type")));
        const older = url.searchParams.has("before");
        result = { events: makeEvents(url.searchParams.get("type"), older), nextCursor: older ? null : "fixture-older" };
      } else if (/^\/api\/feed\/\d+\/react$/.test(url.pathname)) {
        writes.push(`${method} ${url.pathname}`);
        const id = Number(url.pathname.split("/")[3]);
        const reaction = method === "DELETE" ? null : request.postDataJSON().reaction;
        result = { reactions: reaction ? { [reaction]: 1 } : {}, myReaction: reaction, xpAwarded: 0 };
        reactions.set(id, result);
        if (delayedMutation) {
          delayedMutation = false;
          await new Promise(resolve => { releaseMutation = resolve; });
        }
      } else if (url.pathname === "/api/feed/following") result = { viewerId: 1, ids: [101] };
      else if (url.pathname === "/api/subscription-status") result = { plan: "SIDE_KICK", subscriptionStatus: "active" };
      else {
        errors.push(`Unexpected API ${method} ${url.pathname}`);
        return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(`${base}/feed`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("feed-event-101").waitFor();
    assert.equal(await page.getByTestId("button-filter-friends").count(), 0);
    const picker = page.getByTestId("button-feed-audience");
    const pickerContent = page.getByTestId(width < 768 ? "feed-audience-sheet" : "feed-audience-menu");
    const labels = { everyone: "Everyone", following: "Friends & Following", me: "My activity" };
    let selectedAudience = "everyone";
    const chooseAudience = async audience => {
      await picker.click();
      await pickerContent.waitFor();
      assert.equal(
        await page.getByTestId(`feed-audience-${selectedAudience}`).getAttribute(width < 768 ? "aria-pressed" : "aria-checked"),
        "true", "reopened picker exposes current selection",
      );
      await page.getByTestId(`feed-audience-${audience}`).click();
      await pickerContent.waitFor({ state: "hidden" });
      assert.equal(await picker.getAttribute("aria-label"), `Feed audience: ${labels[audience]}`, "picker names current audience");
      assert.equal(await picker.getAttribute("title"), `Feed audience: ${labels[audience]}`, "picker tooltip names current audience");
      if (width >= 640) assert.equal(await picker.innerText(), labels[audience], "wide picker shows current audience");
      selectedAudience = audience;
    };
    assert.equal(await picker.getAttribute("aria-label"), "Feed audience: Everyone");
    const checkHeader = async () => {
      const bounds = await page.evaluate(() => {
        const get = id => {
          const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        return {
          trade: get("tab-trade"), picker: get("button-feed-audience"),
          tabs: ["tab-activity", "tab-leaderboards", "tab-trade"].map(get),
          filter: get("button-type-all"),
        };
      });
      assert.ok(bounds.picker.left >= bounds.trade.right, "picker sits beside Trade Feed");
      assert.ok(bounds.picker.top < bounds.trade.bottom && bounds.picker.bottom > bounds.trade.top, "picker and tabs share one row");
      for (const box of [...bounds.tabs, bounds.picker]) {
        assert.ok(box.left >= 0 && box.right <= width, `tab/control fits ${width}px`);
      }
      assert.ok(bounds.filter.top >= bounds.picker.bottom, "content filters remain below header");
      if (width < 640) {
        assert.equal(await page.getByTestId("feed-audience-label").isVisible(), false, "phone trigger is compact");
        assert.ok(await picker.locator("svg.lucide-sliders-horizontal").isVisible());
      } else {
        assert.equal(await page.getByTestId("feed-audience-label").isVisible(), true, "wide trigger shows label");
      }
    };
    await checkHeader();
    assert.equal(await page.getByTestId("button-filter-following").count(), 0, "old audience row is gone");
    await picker.click();
    await pickerContent.waitFor();
    assert.equal(await page.getByTestId("feed-audience-following").innerText(), "Friends & Following");
    assert.equal(await page.getByTestId("feed-audience-me").innerText(), "My activity");
    assert.equal(await page.getByTestId("feed-audience-everyone").getAttribute(width < 768 ? "aria-pressed" : "aria-checked"), "true");
    assert.equal(await page.getByTestId("feed-audience-everyone").locator("svg.lucide-check").count(), 1, "selected checkmark");
    if (width < 768) {
      await page.waitForTimeout(550);
      const box = await pickerContent.boundingBox();
      assert.ok(Math.abs(box.y + box.height - 852) <= 2, "phone picker anchored to bottom");
      await page.screenshot({ path: `${output}/feed-audience-sheet-${width}.png` });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await pickerContent.waitFor({ state: "hidden" });
      assert.equal(await picker.getAttribute("aria-label"), "Feed audience: Everyone", "dismissal preserves selected audience");
    } else {
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/feed-audience-menu-1280.png` });
      await page.keyboard.press("Escape");
      await pickerContent.waitFor({ state: "hidden" });
      await picker.focus();
      await page.keyboard.press("ArrowDown");
      await pickerContent.waitFor();
      await page.keyboard.press("Home");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "feed-audience-everyone");
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "feed-audience-following");
      await page.keyboard.press("Enter");
      await pickerContent.waitFor({ state: "hidden" });
      assert.equal(await picker.innerText(), "Friends & Following", "desktop arrow/enter keyboard selection");
      selectedAudience = "following";
      await chooseAudience("everyone");
    }
    await picker.click();
    await pickerContent.waitFor();
    await page.keyboard.press("Escape");
    await pickerContent.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "button-feed-audience");
    assert.equal(await picker.getAttribute("aria-label"), "Feed audience: Everyone", "Escape dismisses without selection");
    for (const type of ["badges", "cards"]) {
      await page.getByTestId(`button-type-${type}`).click();
      const first = type === "badges" ? 101 : 201;
      await page.getByTestId(`feed-event-${first}`).waitFor();
      await page.getByTestId("feed-infinite-sentinel").scrollIntoViewIfNeeded();
      await page.getByTestId(`feed-event-${first + 10}`).waitFor();
      assert.ok(requests.some(request => request.includes(`type=${type}&before=`)), `${type} pagination includes content type`);
      if (type === "cards") {
        await page.getByTestId("reaction-hero_move-211").click();
        await page.waitForFunction(() => document.querySelector('[data-testid="reaction-hero_move-211"]')?.getAttribute("aria-pressed") === "true");
        assert.equal(await page.getByTestId("feed-event-211").count(), 1, "reaction keeps older pages");
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => window.__fixtureQueryClient.refetchQueries({ queryKey: ["/api/feed", "everyone", "cards"], exact: true }));
        await page.getByTestId("feed-event-211").waitFor({ state: "detached" });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.getByTestId("button-type-badges").click();
    await page.getByTestId("reaction-fire_pull-101").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="reaction-fire_pull-101"]')?.getAttribute("aria-pressed") === "true");
    assert.match(await page.getByTestId("reaction-fire_pull-101").innerText(), /1/);
    for (const audience of ["following", "me", "everyone"]) {
      await chooseAudience(audience);
      await checkHeader();
      await page.getByTestId("feed-event-101").waitFor();
      assert.equal(await page.getByTestId("reaction-fire_pull-101").getAttribute("aria-pressed"), "true");
      assert.match(await page.getByTestId("reaction-fire_pull-101").innerText(), /1/);
    }
    // Switch audiences while a removal is in flight, then return to a cache
    // populated before that removal. Every cache must receive the result.
    delayedMutation = true;
    await page.getByTestId("reaction-fire_pull-101").click();
    await page.waitForTimeout(100);
    assert.ok(releaseMutation);
    await chooseAudience("following");
    releaseMutation();
    await page.waitForFunction(() => document.querySelector('[data-testid="reaction-fire_pull-101"]')?.getAttribute("aria-pressed") === "false");
    await chooseAudience("everyone");
    await page.waitForFunction(() => document.querySelector('[data-testid="reaction-fire_pull-101"]')?.getAttribute("aria-pressed") === "false");
    assert.equal(await page.getByTestId("reaction-fire_pull-101").getAttribute("title"), "Add Fire Pull reaction");
    await page.getByTestId("button-type-activity").click();
    await page.getByTestId("feed-event-301").waitFor();
    await page.getByTestId("button-type-all").click();
    await page.getByTestId("feed-event-101").waitFor();
    await chooseAudience("following");
    await page.getByTestId("tab-trade").click();
    assert.equal(await page.getByTestId("button-feed-audience").count(), 0, "audience control is limited to Activity");
    assert.equal(await page.getByTestId("button-type-all").count(), 0, "content filters are limited to Activity");
    await page.getByTestId("tab-activity").click();
    assert.equal(await picker.getAttribute("aria-label"), "Feed audience: Friends & Following", "lifted audience survives tab switch");
    await chooseAudience("everyone");
    await page.getByTestId("feed-event-101").waitFor();
    await checkHeader();
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
    await page.screenshot({ path: `${output}/feed-${width}.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, ["POST /api/feed/211/react", "POST /api/feed/101/react", "DELETE /api/feed/101/react"]);
    reports.push({
      component: "Feed", width, status: "passed", requests, interceptedWrites: writes,
      checks: ["single-row tabs and picker without overflow", "responsive current-audience label", "activity-only picker and retained audience across tabs", "audience picker labels and selected state", "Escape dismissal and restored focus", "content filters", "badges/cards pagination", "older-page reactions", "refresh replacement", "cross-audience reaction state",
        width < 768 ? "phone bottom sheet and close dismissal" : "desktop dropdown keyboard selection"],
    });
    await page.close();
  }

  for (const width of [1280, 393]) {
    const page = await browser.newPage({ viewport: { width, height: 852 }, hasTouch: width === 393, isMobile: width === 393 });
    const errors = [], writes = [];
    const requests = [];
    let failThreads = false;
    let delayThreads = false;
    page.on("pageerror", error => errors.push(error.message));
    await mount(page, "Social");
    const friend = { ...collector(2), displayName: "Fixture conversation", isFollowing: true, followsYou: true, isFriend: true };
    const messages = Array.from({ length: 38 }, (_, i) => ({
      id: i + 1, senderId: i % 2 ? 1 : 2, recipientId: i % 2 ? 2 : 1,
      content: i === 37 ? "Newest fixture message" : `Fixture conversation message ${i + 1}. Checking the cards from last weekend.`,
      imageUrl: i === 35 ? `${base}/fixture-delayed-image.svg` : null,
      isRead: true, createdAt: new Date().toISOString(), sender: collector(i % 2 ? 1 : 2),
    }));
    let releaseImage;
    await page.route("**/fixture-delayed-image.svg", async route => {
      await new Promise(resolve => { releaseImage = resolve; });
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#813329"/></svg>' });
    });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      requests.push(`${method} ${url.pathname}`);
      if (method !== "GET") writes.push(`${method} ${url.pathname}`);
      let result;
      if (url.pathname === "/api/social/relationships") result = { friends: [friend], following: [friend], followers: [friend] };
      else if (url.pathname === "/api/social/message-threads") {
        if (delayThreads) await new Promise(resolve => setTimeout(resolve, 350));
        if (failThreads) {
          failThreads = false;
          return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Fixture unavailable"}' });
        }
        result = [{ user: friend, lastMessage: messages.at(-1), unreadCount: 0 }];
      }
      else if (url.pathname === "/api/social/messages/2") result = messages;
      else if (url.pathname === "/api/social/messages" && method === "POST") {
        result = appendIncoming(route.request().postDataJSON().content, 1);
      }
      else if (url.pathname === "/api/social/unread-count") result = { count: 0 };
      else if (url.pathname === "/api/subscription-status") result = { plan: "SIDE_KICK", subscriptionStatus: "active" };
      else { errors.push(`Unexpected API ${method} ${url.pathname}`); result = []; }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(`${base}/social?tab=messages&user=2`, { waitUntil: "domcontentloaded" });
    const newest = page.locator("p:visible").filter({ hasText: /^Newest fixture message$/ }).last();
    await newest.waitFor();
    const scrollBox = newest.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    const metrics = () => scrollBox.evaluate(el => ({
      top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight,
      gap: el.scrollHeight - el.clientHeight - el.scrollTop,
    }));
    await page.waitForTimeout(200);
    const before = await metrics();
    console.log("Social initial scroll", width, before, errors);
    await page.screenshot({ path: `${output}/social-initial-${width}.png` });
    const constrained = before.total > before.height;
    if (constrained) assert.ok(before.gap <= 2, `opens at bottom: ${JSON.stringify(before)}`);
    assert.ok(releaseImage, "delayed shared image requested");
    releaseImage();
    await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Shared"]')].every(img => img.complete && img.naturalHeight > 0));
    await page.waitForTimeout(200);
    const after = await metrics();
    assert.ok(after.total > before.total, "delayed image expands conversation");
    if (constrained) assert.ok(after.gap <= 2, `stays at bottom after image: ${JSON.stringify(after)}`);

    const appendIncoming = (content, senderId = 2) => {
      const message = { ...messages[0], id: messages.length + 1, senderId, content, imageUrl: null, sender: collector(senderId) };
      messages.push(message);
      return message;
    };
    const visibleMessage = text => page.locator("p:visible").filter({ hasText: text }).last();
    const endpointCount = endpoint => requests.filter(request => request === `GET ${endpoint}`).length;
    // Refresh must update the open conversation and thread preview in place,
    // without pulling someone reading older messages back to the bottom.
    await scrollBox.evaluate(el => { el.scrollTop = 180; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    appendIncoming("Manual refresh incoming fixture");
    const manualStart = requests.length;
    await page.getByTestId("button-refresh-messages").click();
    await visibleMessage("Manual refresh incoming fixture").waitFor();
    await page.waitForFunction(() =>
      window.__fixtureQueryClient.getQueryData(["social/message-threads"])?.[0]?.lastMessage?.content === "Manual refresh incoming fixture");
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await metrics()).top - 180) <= 1, "manual refresh preserves older reading position");
    for (const endpoint of ["/api/social/message-threads", "/api/social/messages/2", "/api/social/unread-count"]) {
      assert.ok(requests.slice(manualStart).includes(`GET ${endpoint}`), `manual refresh fetches ${endpoint}`);
    }
    // Direct double dispatch exercises the synchronous guard before React
    // commits disabled=true, while one request remains in flight.
    delayThreads = true;
    const beforeDouble = endpointCount("/api/social/message-threads");
    await page.getByTestId("button-refresh-messages").evaluate(button => { button.click(); button.click(); });
    await page.waitForTimeout(450);
    assert.equal(endpointCount("/api/social/message-threads") - beforeDouble, 1, "synchronous duplicate refresh guard");
    delayThreads = false;
    failThreads = true;
    await page.getByTestId("button-refresh-messages").click();
    await page.getByText("Could not refresh messages", { exact: true }).waitFor();
    await page.getByText(/Tap Refresh to retry/).first().waitFor();
    appendIncoming("Recovered refresh fixture");
    await page.getByTestId("button-refresh-messages").click();
    await visibleMessage("Recovered refresh fixture").waitFor();
    // Real ten-second interval, not a test-triggered refetch.
    const pollStart = endpointCount("/api/social/messages/2");
    appendIncoming("Polling incoming fixture");
    await visibleMessage("Polling incoming fixture").waitFor({ timeout: 14_000 });
    await page.waitForFunction(() =>
      window.__fixtureQueryClient.getQueryData(["social/message-threads"])?.[0]?.lastMessage?.content === "Polling incoming fixture");
    assert.ok(endpointCount("/api/social/messages/2") > pollStart, "poll fetched conversation without remount");
    assert.ok(Math.abs((await metrics()).top - 180) <= 1, "poll preserves older reading position");
    await scrollBox.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
    appendIncoming("Near bottom incoming fixture");
    await page.getByTestId("button-refresh-messages").click();
    await visibleMessage("Near bottom incoming fixture").waitFor();
    await page.waitForTimeout(100);
    assert.ok((await metrics()).gap <= 2, "new messages follow when already near bottom");

    if (width === 393) {
      const session = await page.context().newCDPSession(page);
      const gesture = async (dy, type = "touchEnd") => {
        const box = await scrollBox.boundingBox();
        const x = box.x + 30, y = Math.max(box.y + 30, 80);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy }] });
        await session.send("Input.dispatchTouchEvent", { type, touchPoints: [] });
      };
      // Window is at top but nested conversation is not: no refresh.
      await page.evaluate(() => window.scrollTo(0, 0));
      await scrollBox.evaluate(el => { el.scrollTop = 180; });
      const notTopCount = endpointCount("/api/social/messages/2");
      await gesture(110);
      await page.waitForTimeout(150);
      assert.equal(endpointCount("/api/social/messages/2"), notTopCount, "no pull refresh away from nested top");
      await scrollBox.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
      const canceledCount = endpointCount("/api/social/messages/2");
      await gesture(110, "touchCancel");
      await gesture(20);
      await page.waitForTimeout(150);
      assert.equal(endpointCount("/api/social/messages/2"), canceledCount, "canceled and short pulls do not refresh");
      appendIncoming("Touch pull incoming fixture");
      await scrollBox.evaluate(el => { el.scrollTop = 0; });
      await gesture(110);
      await visibleMessage("Touch pull incoming fixture").waitFor({ timeout: 3000 });
      assert.ok(endpointCount("/api/social/messages/2") > canceledCount, "native phone touch pull refreshes nested chat");
      await session.detach();
    } else {
      await page.locator('[role="tab"][data-state]').first().click();
      await page.waitForTimeout(200);
      const inactiveCount = endpointCount("/api/social/messages/2");
      const inactiveThreads = endpointCount("/api/social/message-threads");
      await page.waitForTimeout(10_500);
      assert.equal(endpointCount("/api/social/messages/2"), inactiveCount, "no conversation poll on inactive tab");
      assert.equal(endpointCount("/api/social/message-threads"), inactiveThreads, "no inbox poll on inactive tab");
      await page.locator('[role="tab"][data-state]').nth(1).click();
      await page.waitForTimeout(150);
      assert.ok((await metrics()).gap <= 2, "reopening messages follows newest");
    }
    await page.locator("textarea:visible").fill("Sent fixture reply");
    await page.locator("textarea:visible").press("Enter");
    await visibleMessage("Sent fixture reply").waitFor();
    await page.waitForTimeout(100);
    assert.ok((await metrics()).gap <= 2, "own sends follow newest");
    await page.screenshot({ path: `${output}/social-${width}.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, ["POST /api/social/messages"]);
    reports.push({
      component: "Social", width, status: constrained ? "passed" : "failed",
      ...(constrained ? {} : { issue: "Mobile chat has no bounded height; message area expands to content height and cannot scroll to the newest message." }),
      beforeImage: before, afterImage: after, interceptedWrites: writes, requests,
      checks: ["manual refresh", "duplicate guard", "error recovery", "10s polling", "older-reader scroll preservation", "near-bottom follow", "own-send follow",
        width === 393 ? "native phone touch pulls and cancellation" : "inactive-tab polling disabled"],
    });
    await page.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(reports, null, 2));
  await browser.close();
  await fixtureServer?.close();
}
console.log(JSON.stringify(reports, null, 2));
if (reports.some(report => report.status === "failed")) process.exitCode = 1;
