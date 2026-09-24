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
          mediaTime: overlay.querySelector('video')?.currentTime,
          ended: overlay.querySelector('video')?.ended,
          phase: overlay.dataset.vaultPhase,
          revealDuration: getComputedStyle(overlay).getPropertyValue('--vault-reveal').trim(),
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
  if (samples.some(s => s.mediaTime !== undefined)) {
    const holdSamples = samples.filter(s => s.phase === 'black');
    const revealSamples = samples.filter(s => s.phase === 'revealing');
    assert.ok(holdSamples.at(-1).time - holdSamples[0].time >= 80, 'longer full-black hold must be visible');
    assert.ok(revealSamples.at(-1).time - revealSamples[0].time >= 240, 'app fade-up must not be cut short');
    assert.ok(revealSamples.every(s => s.revealDuration === '300ms'), 'normal app reveal is 300ms');
    assert.ok(samples.some(s => s.ended && s.mediaTime >= 3.55), 'whole media must end before removal');
    assert.ok(samples.filter(s => s.overlay < 1).every(s => s.ended), 'reveal waits for media ended');
    assert.ok(samples.some(s => s.overlay > 0 && s.overlay < .2), 'reveal must finish, not be truncated');
  }
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
  async function nativePage(platform, reducedMotion = 'no-preference', assetFailure = false, slowFrame = false, rejectPlay = false, initiallyReady = false, realApp = false, loadDelay = 0) {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion });
    page.vaultErrors = [];
    page.on('pageerror', error => { page.vaultErrors.push(error.message); console.error('Browser error:', error.message); });
    await page.addInitScript(({ platform, initiallyReady }) => {
      if (platform === 'android') window.androidBridge = { postMessage() {} };
      if (platform === 'ios') window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      window.Capacitor = { nativePromise: async () => 'qa-listener', PluginHeaders: [{ name: 'App', methods: [
        { name: 'addListener', rtype: 'promise' }, { name: 'removeListener', rtype: 'promise' },
      ] }] };
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
      body: `import React from '/node_modules/.vite/deps/react.js';
        const context=React.createContext({});
        export function useAuth(){return React.useContext(context)}
        export function AuthProvider({children}){
          const [,render]=React.useState(0);
          React.useEffect(()=>{window.__vaultRender=()=>render(x=>x+1)},[]);
          return React.createElement(context.Provider,{value:{
            loading:window.__vaultLoading,user:null,syncError:null,
            refreshUser:async()=>{},retrySync:async()=>{},signOutAfterSyncError:async()=>{}
          }},children);
        }`,
    }));
    if (!realApp) await page.route('**/src/App.tsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `import React from '/node_modules/.vite/deps/react.js';
        export default function App(){
          const [,render]=React.useState(0);
          React.useEffect(()=>{window.__vaultRender=()=>render(x=>x+1)},[]);
          return React.createElement('main',{style:{background:'#fff',minHeight:'100vh'}},
            React.createElement('button',{onClick:()=>render(x=>x+1)},'Underlying app works'));
        }`,
    }));
    if (assetFailure) await page.route('**/vault-entry.mp4', route => route.abort());
    if (loadDelay) await page.route('**/vault-entry.mp4', async route => {
      await new Promise(resolve => setTimeout(resolve, loadDelay));
      await route.continue();
    });
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
  await fast.evaluate(() => { window.__vaultLoading = false; window.__vaultRender(); });
  await fast.waitForTimeout(700);
  assert.equal(await fast.locator('[data-vault-launch]').count(), 1, 'auth ready must not interrupt playback');
  await fast.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 4000 });
  await assertBlackHandoff(fast);
  await fast.close(); checks++;
  const ready = await nativePage('ios', 'no-preference', false, false, false, true);
  await ready.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await sampleHandoff(ready);
  await ready.waitForTimeout(700);
  assert.equal(await ready.locator('[data-vault-launch]').count(), 1, 'initially ready app still plays');
  await ready.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 4000 });
  await assertBlackHandoff(ready);
  assert.ok(await ready.evaluate(() => window.__videoRequests.length) > 0);
  await ready.close(); checks++;
  // REAL App.tsx, AuthenticatedApp, Login, route tree and root integration.
  // Only auth state is controlled in browser responses; no source/auth edits.
  for (const [platform, initiallyReady] of [['ios', true], ['android', false]]) {
    const actual = await nativePage(platform, 'no-preference', false, false, false, initiallyReady, true, 150);
    await actual.locator('[data-vault-launch]').waitFor({ state: 'attached' });
    await sampleHandoff(actual);
    await actual.waitForFunction(() => document.querySelector('video')?.currentTime > .3);
    await actual.evaluate(() => {
      window.__sameOverlay = document.querySelector('[data-vault-launch]');
      window.__vaultLoading = false; window.__vaultRender();
      history.pushState({}, '', '/browse'); dispatchEvent(new PopStateEvent('popstate'));
    });
    await actual.waitForTimeout(400);
    assert.ok(await actual.evaluate(() => window.__sameOverlay === document.querySelector('[data-vault-launch]')));
    // Cross App's shared-route early return (auth subtree actually unmounts).
    await actual.evaluate(() => {
      history.pushState({}, '', '/share/vault-qa-nonexistent'); dispatchEvent(new PopStateEvent('popstate'));
    });
    await actual.waitForTimeout(100);
    assert.ok(await actual.evaluate(() => window.__sameOverlay === document.querySelector('[data-vault-launch]')));
    await actual.evaluate(() => {
      history.pushState({}, '', '/browse'); dispatchEvent(new PopStateEvent('popstate'));
    });
    await actual.screenshot({ path: `${screenshots}/real-${platform}-playing.png` });
    await actual.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 4000 });
    await assertBlackHandoff(actual);
    await actual.screenshot({ path: `${screenshots}/real-${platform}-revealed.png` });
    assert.ok(await actual.locator('input').count() > 0, 'real Login is underneath, not a test backdrop');
    assert.deepEqual(actual.vaultErrors, [], 'real app must reveal without a runtime error overlay');
    await actual.close(); checks++;
  }

  // Capture actual composited pixels over the REAL Login screen. Pause just
  // the reveal animation at deterministic positions (deadline stays active).
  const pixels = await nativePage('ios', 'no-preference', false, false, false, true, true);
  await pixels.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await pixels.evaluate(() => {
    const overlay = document.querySelector('[data-vault-launch]');
    new MutationObserver(() => {
      if (overlay.dataset.vaultPhase !== 'revealing' || window.__reveal) return;
      window.__reveal = overlay.getAnimations().find(a => a.animationName === 'vault-reveal');
      window.__reveal.pause(); window.__reveal.currentTime = 0;
    }).observe(overlay, { attributes: true, attributeFilter: ['data-vault-phase'] });
  });
  await pixels.waitForFunction(() => window.__reveal, null, { polling: 10 });
  const blackImage = await pixels.screenshot({ path: `${screenshots}/real-app-black.png` });
  await pixels.evaluate(() => { window.__reveal.currentTime = 150; });
  const middleImage = await pixels.screenshot({ path: `${screenshots}/real-app-fade.png` });
  await pixels.evaluate(() => { window.__reveal.play(); });
  await pixels.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 500 });
  const visibleImage = await pixels.screenshot({ path: `${screenshots}/real-app-visible.png` });
  assert.deepEqual(pixels.vaultErrors, []);
  const { default: sharp } = await import('sharp');
  const luminance = async buffer => {
    const { channels } = await sharp(buffer).stats();
    return channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
  };
  const levels = await Promise.all([blackImage, middleImage, visibleImage].map(luminance));
  assert.ok(levels[0] < 1, `opaque black screenshot: ${levels}`);
  assert.ok(levels[1] > levels[0] + 1 && levels[1] < levels[2] - 1, `real app fades in: ${levels}`);
  console.log('Real app screenshot luminance (black / fading / visible):', levels);
  await pixels.close(); checks++;
  // Fresh PRODUCTION bundle: actual compiled main/App/AuthProvider, not Vite
  // component fixtures. Serve build files through test responses, not a server.
  const built = await nativePage('ios', 'no-preference', false, false, false, true, true);
  await built.route(`${base}/production-vault-qa`, route => route.fulfill({
    contentType: 'text/html', path: 'dist/public/index.html',
  }));
  await built.route(`${base}/assets/*`, async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const extension = name.split('.').pop();
    const types = { js: 'application/javascript', css: 'text/css', mp4: 'video/mp4',
      webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg' };
    await route.fulfill({ path: `dist/public/assets/${name}`, contentType: types[extension] || 'application/octet-stream' });
  });
  built.vaultErrors = [];
  await built.goto(`${base}/production-vault-qa`, { waitUntil: 'domcontentloaded' });
  await built.locator('[data-vault-launch]').waitFor({ state: 'attached' });
  await sampleHandoff(built);
  await built.locator('[data-vault-launch]').waitFor({ state: 'detached', timeout: 4200 });
  await assertBlackHandoff(built);
  assert.deepEqual(built.vaultErrors, [], 'compiled real App must have no runtime errors');
  await built.screenshot({ path: `${screenshots}/production-real-app-revealed.png` });
  await built.close(); checks++;
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