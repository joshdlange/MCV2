import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';

process.env.NODE_ENV = 'development';
const { pool } = await import('../db');
const { registerScanReviewRoutes, reviewEligibility } = await import('../scan-review-routes');
const { loadScanReviewDataset, loadScanMetadata, originalScanBytes } = await import('../services/scanReview');
const root = path.resolve('.local/scan-review');
const dataset = await loadScanReviewDataset();
const metadata = await loadScanMetadata();
const provenance = JSON.parse(await fs.readFile(path.join(root, 'provenance.json'), 'utf8'));
const decisionsBefore = await fs.readFile(path.join(root, 'decisions.json')).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const app = express();
app.use(express.json());
// Isolated Express instance: no Firebase, production connection, or app workflow.
// Catalog is stubbed read-only so these requests cannot query or modify any DB.
(pool as any).query = async () => ({ rows: [] });
const auth = (req: any, res: any, next: any) => {
  const token = req.header('authorization');
  if (token !== 'Bearer admin' && token !== 'Bearer collector') return res.status(401).json({ message: 'Unauthorized' });
  req.user = { id: token === 'Bearer admin' ? 1 : 2, isAdmin: token === 'Bearer admin' };
  next();
};
registerScanReviewRoutes(app, auth);
const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('Missing test server port');
const url = `http://127.0.0.1:${address.port}`;
const request = (route: string, token?: string, method = 'GET') =>
  fetch(url + route, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('real prepared dataset contains exactly 60 original files with valid provenance and SHA256', async () => {
  assert.equal(dataset.rows.length, 60);
  assert.equal(metadata.size, 60);
  assert.equal(provenance.selectedDistinctPhotos, 60);
  assert.equal(new Set(dataset.rows.map(r => r.scanId)).size, 60);
  for (const [index, row] of dataset.rows.entries()) {
    assert.equal(provenance.selected[index].scanId, row.scanId);
    assert.equal(createHash('sha256').update(await originalScanBytes(row)).digest('hex'), row.imageHash);
    assert.ok(metadata.has(row.scanId));
  }
});
test('GET returns all 60 frozen scans; each private image returns original authenticated bytes', async () => {
  const get = await request('/api/admin/scan-review', 'admin');
  assert.equal(get.status, 200);
  const state = await get.json();
  assert.equal(state.items.length, 60);
  assert.equal(state.datasetHash, dataset.datasetHash);
  assert.equal(state.progress.total, 60);
  assert.equal(state.benchmark.status, 'blocked');
  assert.equal(state.provenanceReport.imageTypeAssessment.unknownDeviceOrigin, 60);
  assert.equal(state.provenanceReport.imageTypeAssessment.verifiedPhonePhotos, null);
  assert.equal(state.provenanceReport.imageTypeAssessment.visiblePhotoContext, 50);
  assert.equal(state.provenanceReport.imageTypeAssessment.indeterminateVisualContext, 10);
  assert.equal(state.provenanceReport.imageTypeAssessment.scansWithComparedLinkedReferences, 48);
  assert.equal(state.provenanceReport.imageTypeAssessment.fetchedLinkedCloudinaryReferences, 57);
  assert.equal(state.provenanceReport.imageTypeAssessment.exactSelfLinkedScanUpload, 1);
  assert.equal(state.items.find((item: any) => item.scanId === 3029)
    .imageProvenance.photoAudit.overlap, 'exact-self-linked-scan-upload');
  assert.equal(state.items.find((item: any) => item.scanId === 3029)
    .eligibility.excludedDueToReferenceLeakage, true);
  assert.equal(state.provenanceReport.candidateOrigin.includes('not DINO'), true);
  assert.equal(state.items.find((item: any) => item.scanId === 2683)
    .historicalProvenance.candidateHistoricalCardId, 20408);
  assert.equal(state.items.find((item: any) => item.scanId === 2683)
    .candidates.every((candidate: any) => candidate.candidateSource === 'historical-matcher-snapshot'), true);
  assert.equal(state.items.find((item: any) => item.scanId === 3084).classification.side, 'back');
  assert.equal(state.items.find((item: any) => item.scanId === 3094).imageOnlyCase, true);
  for (const id of [3082, 3120]) {
    const safe = state.items.find((item: any) => item.scanId === id).reviewEvidence;
    assert.equal((safe.vision?.keywords ?? []).includes('null'), false);
  }
  assert.equal(state.items.find((item: any) => item.scanId === 3088).reviewEvidence.cardNumber.validatedCardNumber, null);
  assert.equal(state.dataQuality.holdoutAssigned, 0);
  for (const row of dataset.rows) {
    const item = state.items.find((item: any) => item.scanId === row.scanId);
    assert.ok(item, `Missing scan ${row.scanId}`);
    assert.equal(item.imageHash, row.imageHash);
    assert.equal(item.ocr, metadata.get(row.scanId)?.ocr);
    assert.equal(item.confidence, metadata.get(row.scanId)?.confidence ?? null);
    const image = await request(item.imageUrl, 'admin');
    assert.equal(image.status, 200, `Private original ${row.scanId}`);
    assert.equal(createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex'), row.imageHash);
  }
  // Reading all 60 scans must neither create nor overwrite any real decisions.
  const decisionsAfter = await fs.readFile(path.join(root, 'decisions.json')).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  assert.deepEqual(decisionsAfter, decisionsBefore);
});
test('GET/PUT/catalog/image/benchmark routes reject missing auth, nonadmin, and production', async () => {
  const routes = [
    ['/api/admin/scan-review', 'GET'],
    [`/api/admin/scan-review/${dataset.rows[0].scanId}`, 'PUT'],
    ['/api/admin/scan-review/catalog?q=spider', 'GET'],
    ['/api/admin/scan-review/data-quality', 'GET'],
    [`/api/admin/scan-review/${dataset.rows[0].scanId}/classification`, 'PUT'],
    [`/api/admin/scan-review/${dataset.rows[0].scanId}/search-blocked`, 'PUT'],
    [`/api/admin/scan-review/${dataset.rows[0].scanId}/image-issues/198`, 'PUT'],
    [`/api/admin/scan-review/image/scan/${dataset.rows[0].scanId}`, 'GET'],
    ['/api/admin/scan-review/benchmark', 'POST'],
  ];
  for (const [route, method] of routes) {
    assert.equal((await request(route, undefined, method)).status, 401, `${method} ${route} auth`);
    assert.equal((await request(route, 'collector', method)).status, 403, `${method} ${route} admin`);
    process.env.NODE_ENV = 'production';
    try { assert.equal((await request(route, 'admin', method)).status, 404, `${method} ${route} production`); }
    finally { process.env.NODE_ENV = 'development'; }
  }
  const denied = await request('/api/admin/scan-review/benchmark', 'admin', 'POST');
  assert.equal(denied.status, 423);
  assert.match((await denied.json()).message, /disabled pending explicit user authorization/);
});
test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});
test('3029 self-linked original is excluded from future front accuracy even with a usable confirmed catalog card', () => {
  const decision = { status: 'confirmed', cardId: 315908, note: '' };
  const classification = { side: 'front', ocrTag: 'useful',
    metadataParsing: { status: 'supported', reason: 'independently reviewed' } } as any;
  const cards = new Map([[315908, { cardId: 315908, isArchived: false,
    hasUsableVisualReference: true }]]) as any;
  const flags = { issues: {}, searchBlocked: {} } as any;
  const ordinary = reviewEligibility(3029, decision, classification, flags, cards, new Map());
  assert.equal(ordinary.frontImageRetrieval, true);
  const audit = new Map([[3029, { overlap: 'exact-self-linked-scan-upload' }]]) as any;
  const guarded = reviewEligibility(3029, decision, classification, flags, cards, audit);
  assert.equal(guarded.frontImageRetrieval, false);
  assert.equal(guarded.excludedDueToReferenceLeakage, true);
  assert.equal(guarded.excludedDueToToolCatalogIssue, false);
  assert.equal(guarded.reasons.includes('self-linked-scan-upload-reference-excluded-from-front-accuracy'), true);
});