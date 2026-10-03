/**
 * Controlled local browser QA (auth mocked), NOT a real signed-in phone/network
 * benchmark. Run: NODE_ENV=development npx tsx scripts/test-dev-scan-v1-browser.ts
 * Existing Vite preview must already be running. This does not start/restart it.
 * Only the real scan/config and injected telemetry routes reach an isolated
 * loopback Express server. All other APIs and external networks are blocked.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { chromium, type Page } from 'playwright-core';
import { initializeDevScanVisual, type DevScanVisualResult } from '../server/services/devScanVisual';
import { registerDevScanRoutes, type DevScanRouteDependencies } from '../server/devScanRoutes';
import { assertDevScanTelemetryDatabase, type DevScanEventOutcome, type DevScanEventPatch } from '../server/services/devScanTelemetry';

assert.equal(process.env.NODE_ENV, 'development', 'Explicit NODE_ENV=development required');
assert.equal(process.env.SCAN_VISUAL_RETRIEVAL, 'on', 'DEV scan flag required');
assert.ok(!process.env.REPLIT_DEPLOYMENT, 'Never run against a deployment');
assertDevScanTelemetryDatabase(); // verifies Helium DEV target before initializer's catalog read
const preview = new URL(process.env.VAULT_QA_URL || 'http://127.0.0.1:5000');
assert.ok(['127.0.0.1', 'localhost'].includes(preview.hostname), 'Fixture must use local Vite, not production');
const phoneDevUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/scan` : null;
// Vite optimized modules are identity-sensitive. Use the exact current import
// URLs from real transformed source, not an unversioned second module instance.
const transformedScan = await (await fetch(`${preview.origin}/src/pages/scan.tsx`)).text();
const transformedMain = await (await fetch(`${preview.origin}/src/main.tsx`)).text();
const queryModule = transformedScan.match(/from "(\/node_modules\/\.vite\/deps\/@tanstack_react-query\.js[^"]*)"/)?.[1];
const reactModule = transformedScan.match(/from "(\/node_modules\/\.vite\/deps\/react\.js[^"]*)"/)?.[1];
const domModule = transformedMain.match(/from "(\/node_modules\/\.vite\/deps\/react-dom_client\.js[^"]*)"/)?.[1];
assert.ok(queryModule && reactModule && domModule, 'Find actual Vite module identities');
const directory = path.join('.local/scan-v1/qa', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const inputPath = process.env.SCAN_QA_INPUT || '.local/phase-c1/cells/7c9ea014-6228-4fde-bbad-93fd494e26d1-0.jpg';
const input = await readFile(inputPath);
const initializationStart = performance.now();
const service = await initializeDevScanVisual();
assert.ok(service, 'Real frozen arm-C service must initialize');
const initializationMs = performance.now() - initializationStart;

const events = new Map<string, Record<string, unknown>>();
const telemetry = {
  async begin(userId: number) {
    const id = randomUUID();
    events.set(id, { userId });
    return id;
  },
  async finish(id: string, userId: number, outcome: DevScanEventOutcome) {
    assert.equal(events.get(id)?.userId, userId);
    Object.assign(events.get(id)!, outcome);
  },
  async patch(id: string, userId: number, patch: DevScanEventPatch) {
    const event = events.get(id);
    assert.ok(event && event.userId === userId);
    Object.assign(event, patch);
  },
};
const inference: { bytes: number; width?: number; height?: number; timings: DevScanVisualResult['timings'] }[] = [];
const app = express();
app.use(express.json());
registerDevScanRoutes(app, (req, _res, next) => {
  // Test-only identity on the separate ephemeral server, never the live app.
  (req as typeof req & { user: { id: number; plan: string } }).user = { id: 1, plan: 'SUPER_HERO' };
  next();
}, {
  reserveQuota: async () => true,
  telemetry,
  scan: async buffer => {
    const metadata = await sharp(buffer).metadata();
    const result = await service.scan(buffer);
    inference.push({ bytes: buffer.length, width: metadata.width, height: metadata.height, timings: result.timings });
    return result;
  },
} satisfies DevScanRouteDependencies);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const backend = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
const pageErrors: string[] = [];
const unexpectedApis: string[] = [];
const apiCalls: { method: string; path: string; data?: unknown; bytes: number }[] = [];
let realResult: any;
let blank = false;
let photoFailure = false;
let scanFailure = false;
const testTelemetry = true;
// External catalog artwork is substituted solely for isolated layout QA; the
// repeated thumbnails in screenshots are NOT evidence of catalog artwork.
const imageBytes = await sharp(input).resize({ width: 120 }).png().toBuffer();

await page.addInitScript(() => {
  const originalFetch = window.fetch;
  (window as any).__scanQa = { starts: [], painted: [] };
  window.fetch = function(resource, options) {
    if (resource === '/api/cards/scan' && options?.method === 'POST') {
      (window as any).__scanQa.starts.push(performance.now());
    }
    return originalFetch.call(this, resource, options);
  };
  let seen = false;
  new MutationObserver(() => {
    const visible = document.body?.textContent?.includes('Choose the matching card artwork')
      || document.body?.textContent?.includes('No picture matches found');
    if (visible && !seen) {
      seen = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        (window as any).__scanQa.painted.push(performance.now());
      }));
    } else if (!visible) seen = false;
  }).observe(document, { childList: true, subtree: true });
});

let screenshotOrdinal = 0;
async function screenshot(name: string) {
  await page.screenshot({ path: path.join(directory, `${++screenshotOrdinal}-${name}.png`), fullPage: true });
}
async function startScan(target: Page) {
  await target.locator('input[type=file]').first().setInputFiles({ name: 'qa-front.jpg', mimeType: 'image/jpeg', buffer: input });
  await target.getByRole('button', { name: 'Landscape 7:5' }).waitFor();
  const frame = await target.getByRole('slider', { name: 'Drag to position card crop' }).boundingBox();
  assert.ok(frame && Math.abs(frame.width / frame.height - 5 / 7) < 0.01, '5:7 visible crop frame');
  await screenshot('crop-5x7');
  await target.getByRole('button', { name: 'Use front crop' }).click();
}
async function reset() {
  await page.getByRole('button', { name: 'Scan Another Card' }).click();
  await page.getByRole('heading', { name: 'Scan to Add' }).waitFor();
  assert.equal(await page.locator('input[type=file]').first().inputValue(), '');
  assert.equal(await page.getByTestId('scan-dev-elapsed').count(), 0, 'Reset clears prior timing');
}

try {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== preview.origin) {
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/png', body: imageBytes });
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/src/main.tsx') return route.fulfill({
      contentType: 'application/javascript',
      body: `
        import React from '${reactModule}';
        import ReactDOM from '${domModule}';
        import {QueryClientProvider} from '${queryModule}';
        import {queryClient} from '/src/lib/queryClient.ts';
        import Scan from '/src/pages/scan.tsx';
        import {Toaster} from '/src/components/ui/toaster.tsx';
        import '/src/index.css';
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement(QueryClientProvider,{client:queryClient},
            React.createElement(Scan), React.createElement(Toaster)));
      `,
    });
    if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({
      contentType: 'application/javascript',
      // Not a live Firebase token. All consumers reach only the intercepted API
      // mocks or isolated loopback backend; no live API ever receives this value.
      body: `export const useAuth=()=>({user:{getIdToken:async()=>'isolated-QA-not-a-live-token'},loading:false});`,
    });
    if (url.pathname === '/src/lib/firebase.ts') return route.fulfill({
      contentType: 'application/javascript',
      body: `export const auth={currentUser:null};`,
    });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const bytes = request.postDataBuffer()?.length ?? 0;
    const call = { method: request.method(), path: url.pathname, data: undefined as unknown, bytes };
    if (request.headers()['content-type']?.includes('application/json')) call.data = request.postDataJSON();
    apiCalls.push(call);
    if (url.pathname === '/api/cards/scan' && scanFailure) {
      return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
    }
    if (url.pathname === '/api/cards/scan/config' || (url.pathname === '/api/cards/scan' && !blank)
      || (testTelemetry && url.pathname.startsWith('/api/cards/scan/events/'))) {
      const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}`, timeout: 120000 });
      if (url.pathname === '/api/cards/scan') realResult = await response.json();
      return route.fulfill({ response });
    }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/cards/scan/client-event') return json({ ok: true });
    if (url.pathname === '/api/cards/scan' && blank) {
      const id = await telemetry.begin(1);
      await telemetry.finish(id, 1, { status: 'success', topScore: null, margin: null, serverMs: 0 });
      return json({
        ...realResult, scanEventId: id, matches: [], families: [], topScore: null, margin: null, confidenceLevel: 'none',
      });
    }
    if (url.pathname.startsWith('/api/cards/scan/events/')) return json({ success: true });
    if (url.pathname === '/api/cards/scan/usage') return json({ used: 0, limit: 25, remaining: 25, isUnlimited: true });
    if (url.pathname === '/api/card-sets') return json([]);
    if (url.pathname === '/api/v2/search') return json([{
      id: realResult.matches[0].cardId, name: realResult.matches[0].name, cardNumber: realResult.matches[0].cardNumber,
      setName: realResult.matches[0].setName, setYear: realResult.matches[0].year, frontImageUrl: null, isInsert: false, rarity: null,
    }]);
    if (url.pathname === '/api/collection') return json(request.method() === 'GET' ? [] : { success: true });
    if (/^\/api\/cards\/\d+\/upload$/.test(url.pathname)) {
      return json(photoFailure ? { message: 'Controlled QA upload failure' } : { success: true, autoApproved: false }, photoFailure ? 503 : 200);
    }
    if (url.pathname === '/api/user/stats' || url.pathname === '/api/stats') return json({ totalCards: 0 });
    if (url.pathname.startsWith('/api/collection/check/')) return json({ owned: false, quantity: 0 });
    unexpectedApis.push(`${request.method()} ${url.pathname}`);
    return json({ message: 'API blocked by isolated QA fixture' }, 501);
  });
  await page.goto(`${preview.origin}/scan`);
  await page.getByRole('heading', { name: 'Scan to Add' }).waitFor({ timeout: 30000 });
  await startScan(page);
  await page.getByText('Choose the matching card artwork', { exact: true }).waitFor({ timeout: 120000 });
  await page.getByTestId('scan-dev-elapsed').waitFor();
  await page.waitForFunction(() => (window as any).__scanQa.painted.length > 0);
  assert.equal(realResult.mode, 'visual-v1');
  assert.equal(realResult.families.length, 5);
  assert.equal(inference.length, 1, 'Real initialized arm C received actual HTTP multipart bytes');
  assert.ok(inference[0].bytes > 0);
  assert.ok(Math.abs(inference[0].width! / inference[0].height! - 5 / 7) < 0.01, 'Uploaded crop is 5:7');
  const clock = await page.evaluate(() => (window as any).__scanQa);
  const uploadToDisplayedMs = clock.painted[0] - clock.starts[0];
  const timingLabel = await page.getByTestId('scan-dev-elapsed').innerText();
  const familyTiles = page.locator('button').filter({ has: page.locator('p.font-semibold') });
  assert.equal(await familyTiles.count(), 5, 'Exactly five families are displayed');
  assert.equal(apiCalls.filter(c => c.path === '/api/collection' && c.method === 'POST').length, 0, 'No automatic collection write');
  await screenshot('real-results-five-families');
  await page.getByRole('button', { name: 'Not here? Search cards' }).click();
  await page.getByText('Find your card', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to scan results' }).click();
  console.log(JSON.stringify({ label: 'Controlled local browser QA (auth mocked); not phone/network timing', initializationMs, uploadToDisplayedMs, timingLabel, inference: inference[0], phoneDevUrl }));
  await writeFile(path.join(directory, 'timing.json'), JSON.stringify({
    label: 'Controlled local browser QA (auth mocked), existing Vite + loopback HTTP proxy; not actual phone/network',
    initializationMs, uploadToDisplayedMs, timingLabel, inference: inference[0], phoneDevUrl,
  }, null, 2), { flag: 'wx' });
  await familyTiles.first().click();
  await page.getByText('Which version?', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add to My Collection' }).count(), 0, 'Family choice is not version confirmation');
  await screenshot('explicit-version');
  await page.locator('button').filter({ has: page.locator('p.font-semibold') }).first().click();
  await page.getByText('Card details', { exact: true }).waitFor();
  assert.equal(apiCalls.filter(c => c.path === '/api/collection' && c.method === 'POST').length, 0, 'Exact version still requires explicit add');
  await page.getByRole('button', { name: 'Add to My Collection' }).click();
  await page.getByRole('button', { name: 'Scan Another Card' }).waitFor();
  assert.equal(apiCalls.filter(c => c.path.endsWith('/upload')).length, 0, 'Default-off photo choice sends no upload');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(typeof events.get(realResult.scanEventId)?.totalMs === 'number', 'Paint timing reaches injected telemetry');
  assert.ok(typeof events.get(realResult.scanEventId)?.pickedCardId === 'number', 'Exact version reaches injected telemetry');
  assert.ok(!events.get(realResult.scanEventId)?.photoSubmitUsed, 'No photo flag when default off');
  await screenshot('confirmed-default-off');
  await reset();
  blank = true;
  await startScan(page);
  await page.getByText('No picture matches found. Search the catalog to choose your card.', { exact: true }).waitFor();
  await page.getByText('Find your card', { exact: true }).waitFor();
  await screenshot('blank-results');
  await page.getByPlaceholder('Search cards...', { exact: true }).fill(realResult.matches[0].name);
  await page.locator('button').filter({ has: page.locator('p.font-semibold') }).first().click();
  await page.getByText('Card details', { exact: true }).waitFor();
  const checkbox = page.getByRole('checkbox', { name: /Submit your photo for review/ });
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), false, 'Photo opt-in defaults off after search');
  await checkbox.check();
  await page.getByRole('button', { name: 'Add to My Collection' }).click();
  await page.getByText('Your photo was submitted for admin review.', { exact: true }).waitFor();
  assert.equal(apiCalls.filter(c => c.path.endsWith('/upload')).length, 1, 'One mocked multipart upload only after opt-in');
  const upload = apiCalls.find(c => c.path.endsWith('/upload'))!;
  assert.ok(upload.bytes > 0, 'Opt-in sends actual multipart bytes to mocked upload, never remote photo storage');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok([...events.values()].some(event => event.usedSearch === true && event.photoSubmitUsed === true
    && typeof event.pickedCardId === 'number' && typeof event.totalMs === 'number'), 'Search/photo/timing telemetry PATCH reaches isolated backend');
  await screenshot('manual-search-photo-opt-in');
  await reset();
  photoFailure = true;
  await startScan(page);
  await page.getByText('No picture matches found. Search the catalog to choose your card.', { exact: true }).waitFor();
  await page.getByPlaceholder('Search cards...', { exact: true }).fill(realResult.matches[0].name);
  await page.locator('button').filter({ has: page.locator('p.font-semibold') }).first().click();
  await page.getByRole('checkbox', { name: /Submit your photo for review/ }).check();
  await page.getByRole('button', { name: 'Add to My Collection' }).click();
  await page.getByRole('alert').filter({ hasText: 'Your photo was not submitted' }).waitFor();
  await screenshot('photo-failure-card-still-added');
  await reset();
  scanFailure = true;
  await startScan(page);
  await page.getByTestId('scan-recovery').waitFor();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Search instead', exact: true }).waitFor();
  assert.equal(await page.getByTestId('scan-recovery').locator('img').count(), 1, 'Failed request keeps photo preview');
  await screenshot('scan-error-photo-retained');
  scanFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Find your card', { exact: true }).waitFor();
  assert.ok(apiCalls.filter(c => c.path === '/api/cards/scan').length >= 5, 'Retry sent retained crop without selecting another file');
  assert.deepEqual(pageErrors, [], 'No browser JS errors');
  assert.deepEqual(unexpectedApis, [], 'Every API is isolated and explicitly mocked/proxied');
  await writeFile(path.join(directory, 'qa-report.json'), JSON.stringify({
    status: 'passed', fixture: 'auth mocked, APIs isolated, photo uploads mocked, external catalog thumbnails substituted', directory,
    tests: ['real HTTP upload + frozen inference + render', 'five families', '5:7 crop bytes', 'explicit version and add',
      'no automatic writes', 'reset', 'blank results (mocked)', 'manual search confirmation (mocked search)',
      'default-off photo', 'opt-in photo request (mocked)', 'photo failure keeps collection success (mocked)'],
    pageErrors, unexpectedApis, apiCalls, telemetry: [...events.values()],
  }, null, 2), { flag: 'wx' });
  console.log(`PASS isolated browser QA; new artifacts: ${directory}`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  console.error('Isolated QA failure:', error, 'Browser errors:', pageErrors, 'Unexpected APIs:', unexpectedApis);
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const { pool, healthPool } = await import('../server/db');
  await Promise.all([pool.end(), healthPool.end()]);
}