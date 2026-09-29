import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { historicalEvidence, loadHistoricalEvidence, resolveHistoricalLabel } from '../services/scanReviewHistorical';
import { loadScanReviewDataset } from '../services/scanReview';
import { loadPhotoOriginAudit } from '../services/scanReviewPhotoAudit';

test('historical scan-linked confirmations are chosen IDs, not model suggestions or feedback-type labels', () => {
  const input = { scanId: 2683, createdAt: '2026-09-17T21:39:39',
    imageUrl: 'https://res.cloudinary.com/example/image/upload/v1/scan_uploads/a.jpg',
    topCardId: 20528, feedback: [{ id: 2207, type: 'correct', selectedCardId: 20408,
      createdAt: '2026-09-17T21:39:55', sameUser: true }] };
  const evidence = historicalEvidence(input);
  assert.equal(evidence.sourceStatus, 'explicit-confirmation');
  assert.equal(evidence.candidateHistoricalCardId, 20408);
  assert.notEqual(evidence.candidateHistoricalCardId, evidence.topCardId);
  assert.equal(resolveHistoricalLabel(evidence, null, 'uncertain', new Set([20408]),
    new Map(), () => false).effectiveLabel?.source, 'historical-user-confirmation');
  assert.equal(resolveHistoricalLabel(evidence, { status: 'confirmed', cardId: 300 }, 'uncertain',
    new Set([20408, 300]), new Map(), () => false).effectiveLabel?.cardId, 300);
  assert.equal(resolveHistoricalLabel(evidence, { status: 'confirmed', cardId: 300 }, 'uncertain',
    new Set([20408, 300]), new Map(), () => false).category, 'DATA INCONSISTENT');
  assert.equal(resolveHistoricalLabel(evidence, { status: 'confirmed', cardId: 300 }, 'uncertain',
    new Set([20408, 300]), new Map([[20408, {
      canonicalActiveId: 300, equivalentIds: [300],
    }]]), () => true).comparison, 'verified-exact-catalog-equivalence');
  assert.equal(resolveHistoricalLabel(evidence, null, 'uncertain', new Set([20408]),
    new Map(), () => true).category, 'POSSIBLE HISTORICAL LABEL BUT AMBIGUOUS');
  assert.equal(resolveHistoricalLabel(evidence, null, 'back', new Set([20408]),
    new Map(), () => false).category, 'BACK PHOTO / SPECIAL CASE');
});
test('null feedback, cross-owner records, later retractions and conflicting selections cannot become labels', () => {
  const row = { scanId: 1, createdAt: '2026-09-17T00:00:00',
    imageUrl: 'https://res.cloudinary.com/example/image/upload/v1/scan_uploads/a.jpg',
    topCardId: 999,
    feedback: [{ id: 4, type: 'not_found', selectedCardId: null,
      createdAt: '2026-09-17T00:00:10', sameUser: true }] };
  assert.equal(historicalEvidence(row).candidateHistoricalCardId, null);
  assert.equal(historicalEvidence(row).sourceStatus, 'no-confirmation');
  assert.equal(historicalEvidence({ ...row, feedback: [
    { ...row.feedback[0], selectedCardId: 1 },
    { ...row.feedback[0], id: 5, selectedCardId: 2 },
  ] }).sourceStatus, 'ambiguous');
  assert.equal(historicalEvidence({ ...row, feedback: [
    { ...row.feedback[0], selectedCardId: 1, sameUser: false },
  ] }).candidateHistoricalCardId, null);
  assert.equal(historicalEvidence({ ...row, feedback: [
    { ...row.feedback[0], selectedCardId: 1 },
    { ...row.feedback[0], id: 5 },
  ] }).sourceStatus, 'ambiguous');
});
test('all 60 private historical records match original scan source and persist separately from decisions', async () => {
  const dataset = await loadScanReviewDataset();
  const before = await fs.readFile('.local/scan-review/decisions.json');
  const records = await loadHistoricalEvidence(dataset);
  assert.equal(records.size, 60);
  assert.equal([...records.values()].filter(item => item.sourceStatus === 'explicit-confirmation').length, 16);
  assert.equal([...records.values()].filter(item => item.sourceStatus === 'no-confirmation').length, 44);
  assert.equal([...records.values()].filter(item => item.sourceStatus === 'ambiguous').length, 0);
  assert.ok([...records.values()].every(item => item.originalImageUrl.includes('/scan_uploads/')));
  const report = JSON.parse(await fs.readFile('.local/scan-review/historical-labels-report.json', 'utf8'));
  assert.equal(report.records.length, 60);
  assert.equal(report.datasetHash, dataset.datasetHash);
  assert.equal(report.candidateOrigin.includes('not a DINO'), true);
  assert.deepEqual(await fs.readFile('.local/scan-review/decisions.json'), before);
});
test('photo audit distinguishes visible context from verified origin and excludes self-linked 3029', async () => {
  const dataset = await loadScanReviewDataset();
  const audit = await loadPhotoOriginAudit(dataset.rows.map(row => row.scanId));
  assert.equal(audit.rows.size, 60);
  assert.equal(audit.counts.integrityVerified, 60);
  assert.equal(audit.counts.visiblePhotoContext, 50);
  assert.equal(audit.counts.indeterminateVisualContext, 10);
  assert.equal(audit.counts.verifiedGenuinePhoneOrCustomerPhotos, null);
  assert.equal(audit.counts.scansWithFetchedLinkedCloudinaryReference, 48);
  assert.equal(audit.counts.uniqueFetchedLinkedCloudinaryUrls, 57);
  assert.equal(audit.counts.exactBytesIndependentCatalogReference, 0);
  assert.equal(audit.counts.nearExactNonidenticalByPixelScreen, 0);
  assert.equal(audit.rows.get(3029)?.overlap, 'exact-self-linked-scan-upload');
  assert.equal([...audit.rows.values()].filter(item => item.overlap === 'no-linked-cloudinary-reference').length, 12);
});