import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-review-test-'));
process.env.NODE_ENV = 'test';
process.env.SCAN_REVIEW_TEST_DIR = dir;
const review = await import('../services/scanReview');
const bytes = Buffer.from('unaltered original bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const rows = Array.from({ length: 60 }, (_, i) => ({
  scanId: i + 1, imageHash: hash, originalPhotoFile: `originals/${hash}.jpg`,
  candidate: null, prediction: null, references: [],
}));
const datasetHash = 'a'.repeat(64);
await fs.mkdir(path.join(dir, 'originals'));
await fs.writeFile(path.join(dir, 'originals', `${hash}.jpg`), bytes);
await fs.writeFile(path.join(dir, 'review.html'),
  `<script id="dataset" type="application/json">${JSON.stringify({ datasetHash, rows })}</script>`);
await fs.writeFile(path.join(dir, 'provenance.json'), JSON.stringify({
  datasetHash, selectedDistinctPhotos: 60,
  selected: rows.map(row => ({ scanId: row.scanId, imageHash: row.imageHash })),
}));

test('development and admin gate denies non-admin and production requests', () => {
  const previous = process.env.NODE_ENV;
  const result = (nodeEnv: string, user?: unknown) => {
    process.env.NODE_ENV = nodeEnv;
    let status = 200, next = false;
    const res: any = { status(code: number) { status = code; return this; }, json() { return this; } };
    review.requireDevelopmentAdmin({ user } as any, res, () => { next = true; });
    return { status, next };
  };
  try {
    assert.deepEqual(result('production', { isAdmin: true }), { status: 404, next: false });
    assert.deepEqual(result('development'), { status: 403, next: false });
    assert.deepEqual(result('development', { isAdmin: false }), { status: 403, next: false });
    assert.deepEqual(result('development', { isAdmin: true }), { status: 200, next: true });
  } finally { process.env.NODE_ENV = previous; }
});
test('60 frozen scans, persistent atomic decisions, dataset guard and unresolved exclusion', async () => {
  const state = await review.scanReviewState();
  assert.equal(state.dataset.rows.length, 60);
  assert.deepEqual(await review.originalScanBytes(state.dataset.rows[0]), bytes);
  const exists = async (id: number) => id === 99;
  await assert.rejects(review.saveScanDecision(1, { datasetHash: 'wrong', status: 'confirmed', cardId: 99 }, 8, exists), /hash mismatch/);
  await assert.rejects(review.saveScanDecision(1, { datasetHash, status: 'confirmed', cardId: 100 }, 8, exists), /does not exist/);
  await review.saveScanDecision(1, { datasetHash, status: 'confirmed', cardId: 99, note: 'Verified' }, 8, exists);
  await review.saveScanDecision(2, { datasetHash, status: 'unresolved' }, 8, exists);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'decisions.json'), 'utf8'));
  assert.equal(stored.decisions[1].cardId, 99);
  assert.equal(stored.decisions[1].reviewerId, 8);
  assert.match(stored.decisions[1].reviewedAt, /^\d{4}-/);
  assert.equal(stored.decisions[2].cardId, null);
  assert.equal((await review.scanReviewState()).decisions[1].note, 'Verified');
  assert.deepEqual(review.reviewProgress(stored.decisions), {
    total: 60, reviewed: 2, confirmed: 1, unresolved: 1, remaining: 58, percent: 3,
  });
  assert.equal(review.approvedLabels(rows, stored.decisions).length, 1);
  assert.throws(() => review.requireBenchmarkLabels(rows, stored.decisions), /At least 50/);
  const eligible = Object.fromEntries(Array.from({ length: 49 }, (_, i) => [
    String(i + 3), { status: 'confirmed', cardId: 99, note: '', reviewerId: 8, reviewedAt: new Date().toISOString() },
  ]));
  assert.equal(review.requireBenchmarkLabels(rows, { ...stored.decisions, ...eligible }).length, 50);
  assert.equal(review.allLabeledCardsExist([99, 99, 99], new Set([99])), true);
  assert.equal(review.allLabeledCardsExist([99, 100], new Set([99])), false);
  const artifact = { status: 'completed', results: { datasetHash, frozenLabels: [
    { scanId: 1, imageHash: hash, cardId: 99, reviewerId: 8, reviewedAt: stored.decisions[1].reviewedAt },
  ], scans: [{ scanId: 1, matches: [{ cardId: 99, similarity: 0.8 }], latencyMs: 50, top1Top2Margin: null }] } };
  await review.saveScanBenchmark(datasetHash, artifact);
  assert.deepEqual(await review.readScanBenchmark(datasetHash), artifact);
  await review.saveScanBenchmark(datasetHash, { ...artifact, status: 'running' });
  assert.match((await review.readScanBenchmark(datasetHash)).error, /interrupted by server restart/);
  await review.saveScanBenchmark(datasetHash, artifact);
  await assert.rejects(review.readScanBenchmark('different-hash'), /does not match/);
  await assert.rejects(review.saveScanDecision(2, { datasetHash, status: 'unresolved', cardId: 99 }, 8, exists), /cannot have/);
  assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
});
test.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });