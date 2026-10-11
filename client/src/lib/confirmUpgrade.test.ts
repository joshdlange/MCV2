import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmUpgrade } from "./confirmUpgrade";

test("activation waits for a fresh upgraded account", async () => {
  let attempts = 0;
  assert.equal(await confirmUpgrade(async () => ++attempts === 3, new AbortController().signal, async () => {}), true);
  assert.equal(attempts, 3);
});
test("unconfirmed payment never produces success and polling is bounded", async () => {
  let attempts = 0;
  assert.equal(await confirmUpgrade(async () => { attempts++; return false; }, new AbortController().signal, async () => {}), false);
  assert.equal(attempts, 12);
});
test("leaving checkout cancels activation confirmation", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(await confirmUpgrade(async () => { throw new Error("must not refresh"); }, controller.signal), false);
});
test("immediate activation needs only one fresh read", async () => {
  let reads = 0;
  assert.equal(await confirmUpgrade(async () => { reads++; return true; }, new AbortController().signal), true);
  assert.equal(reads, 1);
});
test("a response arriving after checkout unmount cannot confirm success", async () => {
  const controller = new AbortController();
  assert.equal(await confirmUpgrade(async () => {
    controller.abort();
    return true;
  }, controller.signal), false);
});
test("background refresh is read-only, visible-only and covers focus and native resume", () => {
  const source = readFileSync("client/src/contexts/AuthContext.tsx", "utf8");
  assert.ok(source.includes('apiRequest("GET", "/api/auth/me"'));
  assert.ok(source.includes("document.visibilityState !== 'visible'"));
  assert.ok(source.includes("window.addEventListener('focus', refresh)"));
  assert.ok(source.includes("App.addListener('appStateChange'"));
  assert.ok(source.includes("60_000"));
  const routes = readFileSync("server/routes.ts", "utf8");
  const handler = routes.slice(routes.indexOf('app.get("/api/auth/me"'), routes.indexOf("// Simple in-memory rate limiter"));
  assert.ok(handler.includes('storage.getUser(req.user.id)'));
  assert.ok(handler.includes('"no-store"'));
});
test("collection UI cannot reject card 501 using a stale device plan", () => {
  for (const path of ["pages/my-collection.tsx", "pages/browse-cards.tsx", "components/cards/card-grid.tsx"]) {
    const source = readFileSync(`client/src/${path}`, "utf8");
    assert.equal(source.includes("COLLECTION_LIMIT ="), false, path);
    assert.ok(source.includes("COLLECTION_LIMIT_REACHED"), path);
  }
  const routes = readFileSync("server/routes.ts", "utf8");
  assert.ok(routes.includes("distinctCardLimit: userData?.plan !== 'SUPER_HERO' ? COLLECTION_LIMIT : undefined"));
});
