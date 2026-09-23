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
// Sample computed compositor values, not just timers/classes: footage must
// disappear against fully opaque black before any underlying app is revealed.
async function sampleHandoff(page) {
  await page.evaluate(() => {
    window.__handoffSamples = [];
    let seen = false;
    const sample = () => {
      const overlay = document.querySelector('[data-vault-launch]');
      const surface = overlay?.querySelector('.vault-launch__surface');
      if (!overlay && seen) return;
      if (surface) {
        seen = true;
        window.__handoffSamples.push({
          time: performance.now(),
          overlay: Number(getComputedStyle(overlay).opacity),
          surface: Number(getComputedStyle(surface).opacity),
          background: getComputedStyle(overlay).backgroundColor,
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}
async function assertBlackHandoff(page) {
  const samples = await page.evaluate(() => window.__handoffSamples);
  const black = samples.findIndex(s => s.surface === 0 && s.overlay === 1 && s.background === 'rgb(0, 0, 0)');
  assert.ok(black >= 0, 'must paint a fully black frame with no app visible');
  const reveal = samples.findIndex(s => s.overlay > 0 && s.overlay < 1);
  assert.ok(reveal > black, 'app reveal must follow the full-black frame');
  assert.ok(samples.every(s => s.overlay === 1 || s.surface === 0), 'never crossfade footage directly into app');
  assert.ok(samples.some(s => s.surface > 0 && s.surface < 1 && s.overlay === 1), 'footage fades into opaque black');
}
try {
  // Real app, no bridge: both desktop and mobile browser sessions load no frames.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 393, height: 852 }]) {
    const page = await browser.newPage({ viewport });
    const frames = [];
    page.on('request', r => { if (/vault-entry\.mp4|vault-poster\.webp|frame-\d.*webp/.test(r.url())) frames.push(r.url()); });
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
    await sampleHandoff(studio);
    await studio.getByRole('button', { name: /Play sequence|Replay sequence/ }).click();
    await studio.waitForTimeout(1000);
    await studio.screenshot({ path: `${screenshots}/device-${device}-unlock.png` });
    await studio.waitForTimeout(2050);
    await studio.screenshot({ path: `${screenshots}/device-${device}-open.png` });
    assert.equal(await studio.locator('[data-vault-video]').count(), 1);
    const playback = await studio.locator('video').evaluate(v => ({
      time: v.currentTime, muted: v.muted, inline: v.playsInline, loop: v.loop,
    }));
    assert.ok(playback.time > 2, 'continuous footage should advance');
    assert.ok(playback.muted && playback.inline && !playback.loop);
    await studio.waitForTimeout(900);
    assert.equal(await studio.locator('[data-vault-launch]').count(), 0);
    await assertBlackHandoff(studio);
    checks++;
  }
  await studio.close();

  // Replace only test responses, never source files or production auth.
  // This isolates the real native gate with a controllable existing loading state.
  async function nativePage(platform, reducedMotion = 'no-preference', assetFailure = false, slowFrame = false, rejectPlay = false, initiallyReady = false) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion });
    page.on('pageerror', error => console.error('Browser error:', error.message));
    await page.addInitScript(({ platform, initiallyReady }) => {
      if (platform === 'android') window.androidBridge = {};
      if (platform === 'ios') window.webkit = { messageHandlers: { bridge: {} } };
      window.__vaultLoading = !initiallyReady;
    }, { platform, initiallyReady });
    if (rejectPlay) await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
    });
    await page.addInitScript(() => {
      window.__videoRequests = [];
      window.__pausedVideos = 0;
      const original = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function() {
        window.__pausedVideos++;
        return original.call(this);
      };
    });
    page.on('request', r => {
      // Vite's ?import request is a tiny JS URL export, not video data.
      if (/vault-entry\.mp4/.test(r.url()) && !new URL(r.url()).searchParams.has('import')) {
        page.evaluate(() => window.__videoRequests.push(true)).catch(() => {});
      }
    });
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
    if (assetFailure) await page.route('**/vault-entry.mp4', route => route.abort());
    if (slowFrame) await page.route('**/vault-entry.mp4', async route => {
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
    await sampleHandoff(page);
    const began = Date.now();
    await page.getByRole('button', { name: 'Underlying app works' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-vault-launch]'), null, { polling: 20, timeout: 4200 });
    assert.ok(Date.now() - began <= 4100, 'deadline exceeded');
    await assertBlackHandoff(page);
    await page.getByRole('button', { name: 'Underlying app works' }).click();
    assert.equal(await page.locator('[data-vault-launch]').count(), 0);
    assert.ok(await page.evaluate(() => window.__pausedVideos >= 1), 'unmount pauses the decoder');
    await page.close(); checks++;
  }
  const fast = await nativePage('ios');
  await fast.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await fast.waitForFunction(() => document.querySelector('video')?.currentTime > .1);
  await sampleHandoff(fast);
  const fastBegan = Date.now();
  await fast.evaluate(() => { window.__vaultLoading = false; window.__vaultRender(); });
  await fast.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 500 });
  assert.ok(Date.now() - fastBegan < 450, 'ready app must not wait for the whole clip');
  await assertBlackHandoff(fast);
  await fast.close(); checks++;
  const ready = await nativePage('ios', 'no-preference', false, false, false, true);
  await ready.waitForTimeout(500);
  assert.equal(await ready.locator('[data-vault-launch]').count(), 0);
  assert.equal(await ready.evaluate(() => window.__videoRequests.length), 0);
  await ready.close(); checks++;
  const reduced = await nativePage('android', 'reduce');
  await reduced.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  assert.equal(await reduced.locator('[data-vault-poster]').count(), 1);
  assert.equal(await reduced.locator('video').count(), 0);
  await reduced.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 650 });
  assert.equal(await reduced.evaluate(() => window.__videoRequests.length), 0);
  await reduced.close(); checks++;
  const failed = await nativePage('ios', 'no-preference', true);
  await failed.waitForTimeout(1000);
  assert.equal(await failed.locator('[data-vault-launch]').count(), 0);
  await failed.close(); checks++;
  const rejected = await nativePage('ios', 'no-preference', false, false, true);
  await rejected.waitForTimeout(800);
  assert.equal(await rejected.locator('[data-vault-launch]').count(), 0);
  await rejected.close(); checks++;
  const stalled = await nativePage('android');
  await stalled.locator('video').waitFor({ state: 'attached' });
  await stalled.waitForFunction(() => document.querySelector('video')?.currentTime > .1);
  await stalled.locator('video').evaluate(v => { v.pause(); v.dispatchEvent(new Event('stalled')); });
  await stalled.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 700 });
  await stalled.close(); checks++;
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