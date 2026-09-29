// Isolated browser fixture for the REAL admin React page. Never contacts app/server/Firebase.
// Run: node scripts/test-scan-review-browser.mjs
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const fixturePlugin = {
  name: 'fixture-auth-only-in-test',
  setup(plugin) {
    plugin.onResolve({ filter: /^@\/lib\/(store|queryClient)$/ }, args =>
      ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      loader: 'js',
      contents: args.path.endsWith('/store')
        ? `export const useAppStore = () => ({ currentUser: { id: 7, isAdmin: true } });`
        : `export async function apiRequest(method, url, data) {
            const res = await fetch(url, {
              method, headers: { Authorization: 'Bearer isolated-fixture-token', 'Content-Type': 'application/json' },
              body: data === undefined ? undefined : JSON.stringify(data)
            });
            if (!res.ok) throw new Error(res.status + ': ' + (await res.json()).message);
            return res;
          }`,
    }));
  },
};
const built = await build({
  stdin: {
    resolveDir: process.cwd(),
    sourcefile: 'scan-review-fixture.jsx',
    loader: 'jsx',
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import AdminScanAccuracyReview from './client/src/pages/admin/scan-accuracy-review.tsx';
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {
          retry: false, staleTime: 0, queryFn: async ({queryKey}) => {
            const res = await fetch(queryKey[0], {headers: {Authorization: 'Bearer isolated-fixture-token'}});
            if (!res.ok) throw new Error(res.status + ': ' + (await res.json()).message);
            return res.json();
          }
        }}})}>
          <div className="min-h-screen bg-gray-50"><AdminScanAccuracyReview /></div>
        </QueryClientProvider>
      );
    `,
  },
  bundle: true, platform: 'browser', format: 'iife', write: false,
  jsx: 'automatic', define: { 'import.meta.env.DEV': 'true', 'process.env.NODE_ENV': '"development"' },
  alias: { '@': resolve('client/src'), '@shared': resolve('shared'), '@assets': resolve('attached_assets') },
  plugins: [fixturePlugin],
  loader: { '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
});
const script = built.outputFiles[0].text;
const cssName = (await readdir('dist/public/assets')).find(name => /^index-.*\.css$/.test(name));
const css = cssName ? await readFile(`dist/public/assets/${cssName}`, 'utf8') : '';
const scans = Array.from({ length: 60 }, (_, i) => ({
  scanId: i + 1, imageHash: `image-${i + 1}`, filename: `scan-${i + 1}.jpg`,
  imageUrl: `/api/admin/scan-review/image/scan/${i + 1}`, topCardId: 100 + i * 10,
  candidates: [0, 1, 2].map(j => ({
    cardId: 100 + i * 10 + j, name: `Card ${100 + i * 10 + j}`, year: 2024,
    mainSetName: 'Fixture Set', subsetName: 'Base', cardNumber: String(j + 1),
    imageUrl: `/api/admin/scan-review/image/card/${100 + i * 10 + j}`, confidence: 0.9 - j * 0.1,
  })),
  ocr: { text: '2024' }, vision: null, decision: null, selectedCard: null,
}));
const searchedCard = {
  cardId: 9999, name: 'Manually Found Card', year: 2023, mainSetName: 'Catalog Set',
  subsetName: 'Search Result', cardNumber: '42', imageUrl: null,
};
const writes = [];
let benchmarkStatus = 'idle';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="550" viewBox="0 0 400 550">
  <rect width="400" height="550" fill="#962425"/><rect x="18" y="18" width="364" height="514" rx="10" fill="#f2ce88"/>
  <rect x="38" y="65" width="324" height="335" fill="#315391"/><text x="200" y="235" font-size="35" text-anchor="middle" fill="white">SCAN FIXTURE</text>
  <text x="200" y="460" font-size="25" text-anchor="middle" fill="#222">Synthetic photo only</text></svg>`;
const response = () => ({
  datasetHash: 'isolated-fixture-dataset', items: scans, progress: {
    total: 60, reviewed: scans.filter(s => s.decision).length,
    confirmed: scans.filter(s => s.decision?.status === 'confirmed').length,
    unresolved: scans.filter(s => s.decision?.status === 'unresolved').length,
    remaining: scans.filter(s => !s.decision).length,
    percent: Math.round(scans.filter(s => s.decision).length / 60 * 100),
  }, benchmark: { status: benchmarkStatus, results: null },
});
const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('http://fixture.test/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === '/') return route.fulfill({
    contentType: 'text/html',
    body: '<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  });
  if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
  if (path === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
  assert.equal(request.headers().authorization, 'Bearer isolated-fixture-token', `private request ${path} must be authenticated`);
  if (path.startsWith('/api/admin/scan-review/image/'))
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  if (path === '/api/admin/scan-review/catalog')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ cards: [searchedCard] }) });
  if (path === '/api/admin/scan-review' && request.method() === 'GET')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  if (/^\/api\/admin\/scan-review\/\d+$/.test(path) && request.method() === 'PUT') {
    const scan = scans.find(s => s.scanId === Number(path.split('/').at(-1)));
    const body = request.postDataJSON();
    assert.equal(body.datasetHash, 'isolated-fixture-dataset');
    writes.push({ scanId: scan.scanId, ...body });
    scan.decision = {
      status: body.status, cardId: body.status === 'confirmed' ? body.cardId : null,
      note: body.note, reviewerId: 7, reviewedAt: '2026-09-29T00:00:00.000Z',
    };
    scan.selectedCard = body.status === 'confirmed'
      ? [...scan.candidates, searchedCard].find(card => card.cardId === body.cardId) : null;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  }
  throw new Error(`Unexpected fixture URL ${request.method()} ${path}`);
});
try {
  await page.goto('http://fixture.test/');
  await page.getByText('Scan 1 of 60').waitFor({ timeout: 8000 }).catch(async error => {
    console.error('Fixture failed:', errors, (await page.locator('body').innerText()).slice(0, 1600));
    throw error;
  });
  assert.equal(writes.length, 0);
  await page.getByRole('button', { name: 'Confirm top match' }).click();
  await page.getByText('Saved: Confirmed card ID 100').waitFor();
  assert.equal(writes.at(-1).cardId, 100);

  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByText('Scan 2 of 60').waitFor();
  await page.getByRole('button', { name: /Card 111.*Candidate 2/ }).click();
  assert.equal(writes.length, 1, 'candidate selection must not auto-save');
  await page.getByRole('button', { name: /Confirm selected card/ }).click();
  await page.getByText('Saved: Confirmed card ID 111').waitFor();

  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('textbox', { name: 'Search catalog' }).fill('Manually');
  await page.getByRole('button', { name: /Manually Found Card.*Catalog/ }).click();
  assert.equal(writes.length, 2, 'catalog selection must not auto-save');
  await page.getByRole('button', { name: /Confirm selected card/ }).click();
  await page.getByText('Saved correct card').waitFor();
  assert.equal(writes.at(-1).cardId, 9999);

  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: 'Mark unresolved' }).click();
  await page.getByText('Saved: Unresolved').waitFor();
  assert.equal(writes.at(-1).status, 'unresolved');
  await page.reload();
  await page.getByText('Scan 1 of 60').waitFor();
  await page.getByText('Saved: Confirmed card ID 100').waitFor();
  await page.locator('#scan-picker').selectOption('1');
  await page.getByText('Saved: Confirmed card ID 111').waitFor();
  await page.locator('#scan-picker').selectOption('3');
  await page.getByText('Saved: Unresolved').waitFor();
  await page.locator('#scan-picker').selectOption('2');
  await page.getByText('Saved correct card').waitFor();
  await page.getByText('Manually Found Card').waitFor();
  await page.locator('#scan-picker').selectOption('59');
  await page.getByText('Scan 60 of 60').waitFor();
  await page.locator('p').filter({ hasText: 'Scan ID: 60 · File: scan-60.jpg' }).waitFor();
  await mkdir('screenshots', { recursive: true });
  await page.locator('#scan-picker').selectOption('2');
  await page.screenshot({ path: 'screenshots/scan-review-browser-mock.png', fullPage: true });
  for (const scan of scans.slice(4, 51)) {
    scan.decision = { status: 'confirmed', cardId: scan.topCardId, note: '', reviewerId: 7, reviewedAt: '2026-09-29T00:00:00.000Z' };
    scan.selectedCard = scan.candidates[0];
  }
  benchmarkStatus = 'running';
  await page.reload();
  await page.getByRole('button', { name: 'Benchmark running…' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Benchmark running…' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 4);
  console.log('PASS isolated scan review browser: 60 navigation, 4 explicit writes, refresh restore, authenticated image requests.');
} finally {
  await browser.close();
}