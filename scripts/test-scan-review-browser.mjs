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
  ocr: { text: '2024' }, vision: null, reviewEvidence: { ocr: '2024', vision: null, note: 'Sanitized review evidence, historical untouched' },
  classification: {
    side: 'uncertain', sideEvidence: 'unknown-default-uncertain',
    ocrTag: 'weak', ocrEvidence: 'unknown-default-weak',
    metadataParsing: { status: 'unreviewed', reason: '' }, unresolvedReason: null,
  },
  evaluationCohort: i === 2 ? { cohort: 'development', reason: 'fixture regression' } : { cohort: 'unassigned', reason: null },
  decision: null, selectedCard: null,
}));
const searchedCard = {
  cardId: 9999, name: 'Manually Found Card', year: 2023, mainSetName: 'Catalog Set',
  subsetName: 'Search Result', cardNumber: '42', imageUrl: null, isArchived: true,
  canonicalActiveId: 9998, equivalentIds: [9998], equivalenceBasis: 'matching metadata',
};
const writes = [];
const flagWrites = [];
const blockedWrites = [];
const classificationWrites = [];
const catalogCalls = [];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="550" viewBox="0 0 400 550">
  <rect width="400" height="550" fill="#962425"/><rect x="18" y="18" width="364" height="514" rx="10" fill="#f2ce88"/>
  <rect x="38" y="65" width="324" height="335" fill="#315391"/><text x="200" y="235" font-size="35" text-anchor="middle" fill="white">SCAN FIXTURE</text>
  <text x="200" y="460" font-size="25" text-anchor="middle" fill="#222">Synthetic photo only</text></svg>`;
const response = () => ({
  datasetHash: 'isolated-fixture-dataset', items: scans, progress: {
    total: 60, reviewed: scans.filter(s => ['confirmed', 'unresolved'].includes(s.decision?.status)).length,
    confirmed: scans.filter(s => s.decision?.status === 'confirmed').length,
    unresolved: scans.filter(s => s.decision?.status === 'unresolved').length,
    skipped: scans.filter(s => s.decision?.status === 'skipped').length,
    remaining: scans.filter(s => !s.decision).length,
    percent: Math.round(scans.filter(s => s.decision && s.decision.status !== 'skipped').length / 60 * 100),
  }, benchmark: { status: 'blocked', message: 'Not authorized', results: null },
  dataQuality: {
    total: 60, confirmed: scans.filter(s => s.decision?.status === 'confirmed').length,
    unresolved: scans.filter(s => s.decision?.status === 'unresolved').length,
    skipped: scans.filter(s => s.decision?.status === 'skipped').length,
    scansBlockedBySearch: scans.filter(s => s.searchBlocked?.blocked).length,
    confirmedCardsWithEquivalentIds: 0,
    confirmedCardsWithFlaggedCatalogImageIssues: scans.filter(s => s.decision?.status === 'confirmed' && s.imageIssues?.length).length,
    confirmedCardsMissingUsableReferenceImages: 0,
    confirmedLabelsSuitableForVisualBenchmark: 0,
    reviewedFront: scans.filter(s => s.decision && s.classification.side === 'front').length,
    reviewedBack: scans.filter(s => s.decision && s.classification.side === 'back').length,
    reviewedUncertain: scans.filter(s => s.decision && s.classification.side === 'uncertain').length,
    frontImageRetrievalEligible: scans.filter(s => s.eligibility?.frontImageRetrieval).length,
    backOcrEligible: scans.filter(s => s.eligibility?.backOcr).length,
    metadataParsingEligible: scans.filter(s => s.eligibility?.metadataParsing).length,
    excludedDueToToolCatalogIssue: scans.filter(s => s.eligibility?.excludedDueToToolCatalogIssue).length,
    confirmedOcrEmpty: scans.filter(s => s.decision?.status === 'confirmed' && s.classification.ocrTag === 'empty').length,
    regressionDevelopmentScans: [3], holdoutAssigned: 0,
  },
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
  if (path === '/api/admin/scan-review/catalog') {
    const params = new URL(request.url()).searchParams;
    catalogCalls.push(Object.fromEntries(params));
    const pageNumber = Number(params.get('page') || '1');
    const candidates = Array.from({ length: pageNumber === 1 ? 30 : 5 }, (_, i) =>
      i === 0 && pageNumber === 1 ? searchedCard : {
        ...searchedCard, cardId: 10000 + (pageNumber - 1) * 30 + i,
        name: `Search match ${pageNumber}-${i}`, isArchived: false, equivalentIds: [],
      });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      cards: candidates, total: 35, page: pageNumber, limit: 30,
      from: pageNumber === 1 ? 1 : 31, to: pageNumber === 1 ? 30 : 35, hasMore: pageNumber === 1,
    }) });
  }
  if (path === '/api/admin/scan-review' && request.method() === 'GET')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  if (/^\/api\/admin\/scan-review\/\d+\/classification$/.test(path) && request.method() === 'PUT') {
    const scanId = Number(path.match(/review\/(\d+)\/classification$/)[1]);
    const body = request.postDataJSON();
    assert.equal(body.datasetHash, 'isolated-fixture-dataset');
    assert.equal(body.unresolvedReason === undefined || scans[scanId - 1].decision?.status === 'unresolved', true);
    classificationWrites.push({ scanId, ...body });
    const scan = scans[scanId - 1];
    scan.classification = {
      ...scan.classification, ...body,
      ...(body.side ? { sideEvidence: 'admin-classification' } : {}),
      ...(body.ocrTag ? { ocrEvidence: 'admin-classification' } : {}),
    };
    scan.imageOnlyCase = scan.classification.ocrTag === 'empty';
    scan.eligibility = {
      frontImageRetrieval: scan.decision?.status === 'confirmed' && scan.classification.side === 'front' && !scan.searchBlocked?.blocked,
      backOcr: scan.decision?.status === 'confirmed' && scan.classification.side === 'back' && scan.classification.ocrTag !== 'empty',
      metadataParsing: scan.decision?.status === 'confirmed' && scan.classification.ocrTag !== 'empty' &&
        scan.classification.metadataParsing.status === 'supported',
      excludedDueToToolCatalogIssue: !!scan.searchBlocked?.blocked,
      reasons: scan.searchBlocked?.blocked ? ['search-tool-blocked'] : [],
    };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  }
  if (/^\/api\/admin\/scan-review\/\d+\/image-issues\/\d+$/.test(path) && request.method() === 'PUT') {
    const [, scanId, cardId] = path.match(/review\/(\d+)\/image-issues\/(\d+)$/);
    const body = request.postDataJSON();
    assert.equal(body.datasetHash, 'isolated-fixture-dataset');
    flagWrites.push({ scanId: Number(scanId), cardId: Number(cardId), ...body });
    scans[Number(scanId) - 1].imageIssues = [{ scanId: Number(scanId), cardId: Number(cardId), type: body.type, note: body.note }];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  }
  if (/^\/api\/admin\/scan-review\/\d+\/search-blocked$/.test(path) && request.method() === 'PUT') {
    const scanId = Number(path.match(/review\/(\d+)\/search-blocked$/)[1]);
    const body = request.postDataJSON();
    blockedWrites.push({ scanId, ...body });
    scans[scanId - 1].searchBlocked = { blocked: body.blocked, note: body.note };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  }
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
    if (scan.scanId === 2) await new Promise(resolve => setTimeout(resolve, 250));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response()) });
  }
  throw new Error(`Unexpected fixture URL ${request.method()} ${path}`);
});
try {
  await page.goto('http://fixture.test/');
  await page.getByText('Scan 1 of 60 shown (60 total)').waitFor({ timeout: 8000 }).catch(async error => {
    console.error('Fixture failed:', errors, (await page.locator('body').innerText()).slice(0, 1600));
    throw error;
  });
  assert.equal(writes.length, 0);
  assert.equal(classificationWrites.length, 0, 'default uncertain/weak display must not save classification');
  await page.getByText('unknown-default-uncertain').waitFor();
  await page.getByRole('button', { name: 'Confirm top match' }).click();
  await page.getByText('Saved scan 1.').waitFor();
  assert.equal(writes.at(-1).cardId, 100);
  await page.locator('p').filter({ hasText: 'Scan ID: 2 · File: scan-2.jpg' }).waitFor();
  await page.getByRole('button', { name: /Card 111.*Candidate 2/ }).click();
  assert.equal(writes.length, 1, 'candidate selection must not auto-save');
  await page.getByRole('button', { name: /Confirm selected card/ }).click();
  await page.getByText('Saving decision…').waitFor();
  await page.keyboard.press('ArrowRight');
  await page.locator('p').filter({ hasText: 'Scan ID: 2 · File: scan-2.jpg' }).waitFor();
  await page.getByText('Saved scan 2.').waitFor();
  await page.locator('p').filter({ hasText: 'Scan ID: 3 · File: scan-3.jpg' }).waitFor();
  for (const query of ['2026 Cyclops', 'Cyclops 2026', 'Topps Chrome Invisible Woman', '1993 Phoenix 41', 'Marvel Masterpieces Phoenix 85']) {
    await page.getByRole('textbox', { name: 'Search catalog' }).fill(query);
    await page.waitForFunction(text => document.querySelector('input[aria-label="Search catalog"]')?.value === text, query);
    await page.waitForTimeout(370);
  }
  assert.deepEqual(
    ['2026 Cyclops', 'Cyclops 2026', 'Topps Chrome Invisible Woman', '1993 Phoenix 41', 'Marvel Masterpieces Phoenix 85']
      .filter(text => !catalogCalls.some(call => call.q === text)), [], 'all five combined queries must reach API');
  await page.getByRole('textbox', { name: 'Search catalog' }).fill('');
  await page.waitForTimeout(370);
  for (const year of ['1993', '2025', '2026']) {
    await page.getByRole('textbox', { name: 'Catalog year' }).fill(year);
    await page.waitForTimeout(100);
    assert.equal(catalogCalls.at(-1).year, year, `standalone ${year} filter reaches backend strictly`);
    assert.equal(catalogCalls.at(-1).q, '');
    await page.getByText(/out-of-year record/).waitFor();
    assert.equal(await page.getByRole('button', { name: /Manually Found Card.*Catalog/ }).count(), 0);
  }
  await page.getByRole('textbox', { name: 'Catalog year' }).fill('1993');
  for (const q of ['Phoenix', 'Marvel Masterpieces', '41']) {
    await page.getByRole('textbox', { name: 'Search catalog' }).fill(q);
    await page.waitForTimeout(370);
    assert.equal(catalogCalls.at(-1).year, '1993', `year + ${q} search keeps strict year filter`);
    assert.equal(catalogCalls.at(-1).q, q);
  }
  await page.getByRole('textbox', { name: 'Catalog year' }).fill('');
  await page.getByRole('textbox', { name: 'Search catalog' }).fill('Marvel Masterpieces Phoenix 85');
  await page.waitForTimeout(370);
  for (const [name, value, param] of [
    ['Catalog year', '2026', 'year'], ['Catalog main set', 'Topps Chrome', 'mainSet'],
    ['Catalog subset', 'Chrome', 'subset'], ['Catalog card number', '41', 'cardNumber'],
  ]) {
    await page.getByRole('textbox', { name }).fill(value);
    await page.waitForTimeout(120);
    assert.equal(catalogCalls.at(-1)[param], value, `structured ${param} reaches API`);
  }
  await page.getByRole('textbox', { name: 'Catalog year' }).fill('');
  await page.getByRole('combobox', { name: 'Catalog record status' }).selectOption('archived');
  await page.waitForTimeout(120);
  assert.equal(catalogCalls.at(-1).status, 'archived');
  await page.getByRole('combobox', { name: 'Catalog record status' }).selectOption('all');
  await page.getByText('35 results').waitFor();
  await page.getByRole('button', { name: 'Next results' }).click();
  await page.getByText(/showing 31–35/).waitFor();
  assert.equal(catalogCalls.at(-1).page, '2');
  await page.getByRole('button', { name: 'Previous results' }).click();
  await page.getByText(/showing 1–30/).waitFor();
  await page.getByText('Archived', { exact: true }).waitFor();
  await page.getByText(/Possible equivalent — matching catalog metadata only/).first().waitFor();
  await page.getByRole('button', { name: /Manually Found Card.*Catalog/ }).locator('..')
    .getByRole('button', { name: 'Flag image issue (independent of card label)' }).click();
  await page.locator('#issue-type-9999').selectOption('wrong-card-image');
  await page.getByRole('textbox', { name: 'Image issue note for card 9999' }).fill('Incorrect stored reference');
  await page.getByRole('button', { name: 'Save image issue only' }).first().click();
  await page.getByText('Catalog image issue saved separately; card identity unchanged.').waitFor();
  assert.equal(writes.length, 2, 'flag must not create a card identity decision');
  assert.equal(flagWrites.at(-1).note, 'Incorrect stored reference');
  await page.getByRole('textbox', { name: 'Search catalog' }).fill('Manually');
  await page.getByRole('button', { name: /Manually Found Card.*Catalog/ }).click();
  assert.equal(writes.length, 2, 'catalog selection must not auto-save');
  await page.getByRole('button', { name: /Confirm selected card/ }).click();
  await page.getByText('Saved scan 3.').waitFor();
  assert.equal(writes.at(-1).cardId, 9999);
  await page.locator('p').filter({ hasText: 'Scan ID: 4 · File: scan-4.jpg' }).waitFor();
  await page.getByRole('combobox', { name: 'Unresolved reason' }).selectOption('search tool could not find card');
  assert.deepEqual(await page.getByRole('combobox', { name: 'Unresolved reason' }).locator('option').allTextContents(), [
    'No reason selected', 'cannot identify exact card', 'search tool could not find card',
    'only back image available', 'bad/missing catalog image', 'duplicate/archived catalog ambiguity',
    'insufficient image quality', 'other',
  ]);
  await page.getByRole('button', { name: 'Mark unresolved' }).click();
  await page.getByText('Saved scan 4.').waitFor();
  assert.equal(writes.at(-1).status, 'unresolved');
  assert.equal(classificationWrites.at(-1).unresolvedReason, 'search tool could not find card');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByText('Saved scan 5.').waitFor();
  assert.equal(writes.at(-1).status, 'skipped');
  await page.getByRole('textbox', { name: 'Search blocker note' }).fill('Could not locate exact card');
  await page.getByRole('button', { name: 'Mark blocked by search' }).click();
  await page.getByText('Blocked by search is saved.').waitFor();
  assert.equal(writes.length, 5, 'search blocker must not create a card label');
  assert.equal(blockedWrites.at(-1).note, 'Could not locate exact card');
  await page.getByRole('textbox', { name: 'Optional note / reason' }).fill('');
  await page.keyboard.press('1');
  assert.equal(writes.length, 5, 'shortcuts do not fire while typing');
  assert.equal(await page.getByRole('textbox', { name: 'Optional note / reason' }).inputValue(), '1');
  await page.getByRole('heading', { name: 'Scan Accuracy Review' }).click();
  await page.keyboard.press('1');
  await page.getByText('Saved scan 6.').waitFor();
  assert.equal(writes.at(-1).cardId, 150);
  assert.equal(writes.at(-1).note, '1');
  await page.keyboard.press('s');
  assert.equal(await page.getByRole('textbox', { name: 'Search catalog' }).evaluate(el => document.activeElement === el), true);
  await page.getByRole('heading', { name: 'Scan Accuracy Review' }).click();
  await page.keyboard.press('u');
  await page.getByText('Saved scan 7.').waitFor();
  assert.equal(classificationWrites.length, 1, 'unresolved reason remains optional');
  await page.keyboard.press('ArrowRight');
  await page.locator('p').filter({ hasText: 'Scan ID: 9 · File: scan-9.jpg' }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await page.locator('p').filter({ hasText: 'Scan ID: 8 · File: scan-8.jpg' }).waitFor();
  await page.getByRole('button', { name: 'Zoom actual scan' }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('1');
  await page.keyboard.press('ArrowRight');
  assert.equal(writes.length, 7, 'shortcuts pause while zoom dialog is open');
  await page.keyboard.press('Escape');
  await page.locator('p').filter({ hasText: 'Scan ID: 8 · File: scan-8.jpg' }).waitFor();
  await page.locator('#status-filter').selectOption('skipped');
  await page.getByText('Skipped for now').waitFor();
  await page.locator('#status-filter').selectOption('all');
  await page.locator('#scan-picker').selectOption('60');
  await page.locator('p').filter({ hasText: 'Scan ID: 60 · File: scan-60.jpg' }).waitFor();
  await page.reload();
  await page.getByText('Scan 1 of 53 shown (60 total)').waitFor();
  await page.locator('#status-filter').selectOption('all');
  await page.locator('#scan-picker').selectOption('1');
  await page.getByText('Saved: Confirmed card ID 100').waitFor();
  await page.getByRole('combobox', { name: 'Actual photo side' }).selectOption('front');
  await page.getByRole('combobox', { name: 'OCR evidence quality' }).selectOption('empty');
  await page.getByRole('button', { name: 'Save classification only' }).click();
  await page.getByText('Classification saved independently of card identity.').waitFor();
  assert.equal(classificationWrites.at(-1).side, 'front');
  assert.equal(classificationWrites.at(-1).ocrTag, 'empty');
  await page.getByText('A · Front image retrieval: Yes').waitFor();
  await page.getByText(/Image-only case: OCR is empty/).waitFor();
  await page.getByText('OCR: 2024').waitFor();
  await page.getByText(/Historical OCR/).first().waitFor();
  assert.equal(writes.length, 7, 'classification must not overwrite card identity');
  await page.getByRole('button', { name: /Card 101.*Candidate 2/ }).locator('..')
    .getByRole('button', { name: 'Flag image issue (independent of card label)' }).click();
  await page.locator('#issue-type-101').selectOption('poor-crop');
  await page.getByRole('button', { name: 'Save image issue only' }).click();
  await page.getByText('Catalog image issue saved separately; card identity unchanged.').waitFor();
  await page.getByText('Saved: Confirmed card ID 100').waitFor();
  assert.equal(flagWrites.at(-1).cardId, 101);
  assert.equal(writes.length, 7, 'candidate image flag must not change confirmed label');
  await page.locator('#scan-picker').selectOption('2');
  await page.getByText('Saved: Confirmed card ID 111').waitFor();
  await page.getByRole('combobox', { name: 'Actual photo side' }).selectOption('back');
  await page.getByRole('combobox', { name: 'OCR evidence quality' }).selectOption('useful');
  await page.getByRole('button', { name: 'Save classification only' }).click();
  await page.getByText('B · Back/OCR: Yes').waitFor();
  await page.getByText('A · Front image retrieval: No').waitFor();
  await page.locator('#scan-picker').selectOption('4');
  await page.getByText('Saved: Unresolved').waitFor();
  await page.getByRole('combobox', { name: 'Unresolved reason' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Unresolved reason' }).inputValue(), 'search tool could not find card');
  await page.locator('#scan-picker').selectOption('5');
  await page.getByText('Skipped for now').waitFor();
  await page.locator('#scan-picker').selectOption('6');
  await page.getByText('Blocked by search is saved.').waitFor();
  await page.locator('#scan-picker').selectOption('3');
  await page.getByText('Saved correct card').waitFor();
  await page.getByRole('combobox', { name: 'Metadata parsing evidence' }).selectOption('supported');
  await page.getByRole('button', { name: 'Save classification only' }).isDisabled().then(disabled => assert.equal(disabled, true, 'supported metadata needs evidence reason'));
  await page.getByRole('textbox', { name: 'Metadata parsing reason' }).fill('Printed number and set visible');
  await page.getByRole('textbox', { name: 'Classification note' }).fill('Independently checked metadata');
  await page.getByRole('combobox', { name: 'OCR evidence quality' }).selectOption('useful');
  await page.getByRole('button', { name: 'Save classification only' }).click();
  await page.getByText('C · Metadata parsing: Yes').waitFor();
  assert.equal(classificationWrites.at(-1).metadataParsing.reason, 'Printed number and set visible');
  assert.equal(classificationWrites.at(-1).note, 'Independently checked metadata');
  await page.getByText(/Engineering regression examples are not untouched holdout scans/).waitFor();
  await page.getByText(/Catalog image issue flagged: wrong card image/).first().waitFor();
  await page.getByText('Manually Found Card').first().waitFor();
  assert.equal((await page.locator('[aria-label="Review progress"]').innerText()).includes('Skipped'), true);
  await mkdir('screenshots', { recursive: true });
  await page.screenshot({ path: 'screenshots/scan-review-browser-mock.png', fullPage: true });
  await page.reload();
  await page.locator('#status-filter').selectOption('all');
  await page.locator('#scan-picker').selectOption('1');
  await page.getByText('Current side: front').waitFor();
  await page.getByText('Current OCR tag: empty').waitFor();
  await page.getByText('Saved: Confirmed card ID 100').waitFor();
  await page.locator('#scan-picker').selectOption('2');
  await page.getByText('Current side: back').waitFor();
  await page.getByText('Saved: Confirmed card ID 111').waitFor();
  await page.locator('#scan-picker').selectOption('3');
  assert.equal(await page.getByRole('combobox', { name: 'Metadata parsing evidence' }).inputValue(), 'supported');
  assert.equal(await page.getByRole('textbox', { name: 'Classification note' }).inputValue(), 'Independently checked metadata');
  await page.getByText('Saved: Confirmed card ID 9999').waitFor();
  await page.locator('#scan-picker').selectOption('4');
  assert.equal(await page.getByRole('combobox', { name: 'Unresolved reason' }).inputValue(), 'search tool could not find card');
  await page.getByText('Saved: Unresolved').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run benchmark (disabled)' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 7);
  console.log('PASS isolated scan review browser: strict years, search/filters/pagination, 60 navigation, shortcuts, skip, separate classification/reasons/flags, refresh restore, authenticated images; benchmark never run.');
} finally {
  await browser.close();
}