import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audit, manifestSchema, type CardIdentity, type Saved } from './scan-accuracy-audit';

// Synthetic engineering fixtures ONLY: never use these as benchmark evidence.
const expected: CardIdentity = {
  cardId: 1, name: 'Test Character', year: 2000, mainSetId: 3,
  mainSetName: 'Test Family', subsetSetId: 4, subsetName: 'Test Subset',
  cardNumber: '1', variation: null,
};
const manifest = {
  reviewedBy: 'synthetic-test-only', reviewedAt: '2026-01-01T00:00:00Z',
  scans: [{ id: 'synthetic-1', front: 'fake.jpg', labelReviewed: true as const,
    labelEvidence: 'Synthetic engineering fixture, not a collector photo', expected, tags: [] }],
};
const saved: Saved = {
  format: 'scan-accuracy-audit-v1', manifest,
  runs: [{ id: 'synthetic-1', error: null, latencyTotalMs: 123, predicted: [
    { ...expected, cardId: 2, mainSetId: 5, mainSetName: 'Other Family', year: 2001, cardNumber: '2' },
    expected,
  ], result: {
    ocrText: 'text', parsed: { characterName: 'Test Character', setName: null, subsetName: null,
      cardNumber: '1', normalizedCardNumber: '1', year: '2000', brand: null, variant: null, setCandidates: [], keywords: [] },
    matches: [
      { cardId: 2, name: 'Other', setName: 'Test Subset', subsetName: null, cardNumber: '2', year: 2001,
        imageUrl: null, confidence: 90, confidenceLevel: 'high', matchReasons: ['Year conflicts (2001)'] },
      { cardId: 1, name: 'Test Character', setName: 'Test Subset', subsetName: null, cardNumber: '1', year: 2000,
        imageUrl: null, confidence: 80, confidenceLevel: 'medium', matchReasons: [] },
    ],
    confidenceLevel: 'high', preprocessed: true, visualVerification: 'unavailable', warnings: [],
  } }],
};

test('rejects unreviewed, incomplete and duplicate labels', () => {
  assert.equal(manifestSchema.safeParse({ ...manifest, scans: [{ ...manifest.scans[0], labelReviewed: false }] }).success, false);
  assert.equal(manifestSchema.safeParse({ ...manifest, scans: [{ ...manifest.scans[0], expected: { cardId: 1 } }] }).success, false);
  assert.equal(manifestSchema.safeParse({ ...manifest, scans: [manifest.scans[0], manifest.scans[0]] }).success, false);
});
test('evaluates exact IDs, main-set join identity, errors and false high', () => {
  const report = audit(saved);
  assert.equal(report.metrics.top1.rate, 0);
  assert.equal(report.metrics.top3.rate, 1);
  assert.equal(report.metrics.falseHigh.count, 1);
  assert.equal(report.metrics.wrongMainSet.wrong, 1);
  assert.equal(report.metrics.wrongYear.wrong, 1);
  assert.equal(report.metrics.wrongNumber.wrong, 1);
  assert.equal(report.metrics.wrongSubset.wrong, 0);
  assert.equal(report.scans[0].top?.identity?.mainSetName, 'Other Family');
  assert.deepEqual(report.scans[0].conflicts, ['Year conflicts (2001)']);
  assert.equal(report.metrics.latency.stageMs, null);
});
test('unknown catalog identity is not silently classified as correct field identity', () => {
  const input = structuredClone(saved);
  input.runs[0].predicted[0] = null;
  assert.equal(audit(input).metrics.wrongMainSet.unknown, 1);
});
test('zero reviewed scans has null rates, not zero accuracy', () => {
  const report = audit({ ...saved, manifest: { ...manifest, scans: [] }, runs: [] });
  assert.equal(report.metrics.top1.rate, null);
  assert.equal(report.metrics.top3.rate, null);
  assert.equal(report.metrics.falseHigh.rateAmongHigh, null);
  assert.equal(report.metrics.latency.totalMs.mean, null);
});
test('rejects missing or extra run records', () => {
  assert.throws(() => audit({ ...saved, runs: [] }), /exactly once/);
});