// Browser QA only. Install Playwright externally or supply PLAYWRIGHT_MODULE;
// no browser runner or test bridge is included in the application bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  headless: true, args: ['--no-sandbox'],
});
const base = process.env.VAULT_QA_URL || 'http://127.0.0.1:5000';
const screenshots = '/tmp/vault-launch-qa';
await fs.mkdir(screenshots, { recursive: true });
let checks = 0;
try {
  // Real app, no bridge: both desktop and mobile browser sessions load no frames.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport });
    const frames = [];
    page.on('request', r => { if (/frame-\d.*webp/.test(r.url())) frames.push(r.url()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-vault-launch]').count(), 0);
    assert.equal(frames.length, 0);
    await page.close(); checks++;
  }

  // Exact visual layer at requested portrait ratios; controls remain outside phone.
  const studio = await browser.newPage({ viewport: { width: 1250, height: 1100 } });
  await studio.goto(`${base}/__dev/vault`, { waitUntil: 'networkidle' });
  for (let device = 0; device < 4; device++) {
    await studio.selectOption('#vault-device', String(device));
    await studio.getByRole('button', { name: /Play sequence|Replay sequence/ }).click();
    await studio.waitForTimeout(3150);
    await studio.screenshot({ path: `${screenshots}/device-${device}-open.png` });
    assert.deepEqual(await studio.locator('[data-vault-frame]').evaluateAll(nodes =>
      nodes.map(n => Number(n.getAttribute('data-vault-frame')))), [1, 2, 3, 4, 5, 6]);
    await studio.waitForTimeout(900);
    assert.equal(await studio.locator('[data-vault-launch]').count(), 0);
    checks++;
  }
  await studio.close();

  // Replace only test responses, never source files or production auth.
  // This isolates the real native gate with a controllable existing loading state.
  async function nativePage(platform, reducedMotion = 'no-preference', assetFailure = false, slowFrame = false) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion });
    page.on('pageerror', error => console.error('Browser error:', error.message));
    await page.addInitScript(platform => {
      if (platform === 'android') window.androidBridge = {};
      if (platform === 'ios') window.webkit = { messageHandlers: { bridge: {} } };
      window.__vaultLoading = true;
    }, platform);
    await page.route('**/src/contexts/AuthContext.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'export function useAuth(){return {loading: window.__vaultLoading}}',
    }));
    await page.route('**/src/App.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `import React from '/node_modules/.vite/deps/react.js';
        import {NativeVaultLaunch} from '/src/components/vault-launch/NativeVaultLaunch.tsx';
        export default function App(){
          const [,render]=React.useState(0);
          React.useEffect(()=>{window.__vaultRender=()=>render(x=>x+1)},[]);
          return React.createElement(React.Fragment,null,
            React.createElement('button',{onClick:()=>render(x=>x+1)},'Underlying app works'),
            React.createElement(NativeVaultLaunch));
        }`,
    }));
    if (assetFailure) await page.route('**/frame-2.webp', route => route.abort());
    if (slowFrame) await page.route('**/frame-1.webp', async route => {
      await new Promise(resolve => setTimeout(resolve, 5500));
      await route.abort().catch(() => {});
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    return page;
  }
  for (const platform of ['ios', 'android']) {
    console.log('Testing native bridge:', platform);
    const page = await nativePage(platform);
    await page.locator('[data-vault-launch]').waitFor({ state: 'attached' });
    const began = Date.now();
    await page.getByRole('button', { name: 'Underlying app works' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-vault-launch]'), null, { polling: 20, timeout: 4200 });
    assert.ok(Date.now() - began <= 4100, 'deadline exceeded');
    await page.getByRole('button', { name: 'Underlying app works' }).click();
    assert.equal(await page.locator('[data-vault-launch]').count(), 0);
    await page.close(); checks++;
  }
  const fast = await nativePage('ios');
  await fast.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await fast.evaluate(() => { window.__vaultLoading = false; window.__vaultRender(); });
  await fast.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 500 });
  await fast.close(); checks++;
  const reduced = await nativePage('android', 'reduce');
  await reduced.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  assert.equal(await reduced.locator('[data-vault-frame]').count(), 1);
  await reduced.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 650 });
  await reduced.close(); checks++;
  const failed = await nativePage('ios', 'no-preference', true);
  await failed.waitForTimeout(1000);
  assert.equal(await failed.locator('[data-vault-launch]').count(), 0);
  await failed.close(); checks++;
  const landscape = await nativePage('android');
  await landscape.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await landscape.setViewportSize({ width: 852, height: 393 });
  await landscape.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 500 });
  await landscape.close(); checks++;
  const background = await nativePage('ios');
  await background.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await background.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await background.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 500 });
  await background.close(); checks++;
  const slow = await nativePage('android', 'no-preference', false, true);
  await slow.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  const slowBegan = Date.now();
  await slow.waitForFunction(() => !document.querySelector('[data-vault-launch]'), null, { polling: 20, timeout: 4200 });
  assert.ok(Date.now() - slowBegan <= 4100, 'asset loading reset the hard deadline');
  await slow.close(); checks++;
  console.log(`PASS ${checks} browser checks; screenshots: ${screenshots}. Bridge simulation only, not physical native-device verification.`);
} finally {
  await browser.close();
}