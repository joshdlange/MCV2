import { chromium, webkit } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = "generated-artifacts/native-review-qa";
await mkdir(root, { recursive: true });
const url = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const results: unknown[] = [];
for (const mobile of [false, true]) {
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(17000);
    assert.equal(await page.getByText("Welcome to the Vault", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Review on the App Store", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Review on Google Play", { exact: true }).count(), 0);
    assert.equal(errors.filter(e => /InAppReview|not implemented|plugin/i.test(e)).length, 0);
    await page.screenshot({ path: `${root}/${mobile ? "mobile-chromium" : "desktop-chromium"}.png` });
    results.push({ browser: mobile ? "Mobile Chromium emulation" : "Desktop Chromium", loginPageLoaded: true, nativePluginErrors: 0, pageErrors: errors, authenticatedFlow: "Not verified: no dedicated test-account credentials supplied" });
  } finally { await browser.close(); }
}
try {
  const browser = await webkit.launch({ headless: true });
  await browser.close();
  results.push({ browser: "WebKit", status: "Available, requires additional authenticated QA" });
} catch {
  results.push({ browser: "Mobile Safari / WebKit", status: "Not verified: WebKit executable unavailable; real iOS Safari requires device testing" });
}
await writeFile(`${root}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
