import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-review-classification-'));
process.env.NODE_ENV = 'test';
process.env.SCAN_REVIEW_TEST_DIR = dir;
const classification = await import('../services/scanReviewClassification');
const historical = JSON.parse(await fs.readFile('.local/scan-review/scan-metadata.json', 'utf8'));
const row = (id: number) => historical.rows.find((item: any) => item.scanId === id);
const datasetHash = 'a'.repeat(64);

test('historical null contamination is omitted from review evidence, never rewritten as a card name', () => {
  for (const id of [3082, 3120]) {
    const item = row(id);
    assert.ok(item);
    const cleaned: any = classification.sanitizeVision(item.vision);
    assert.equal((cleaned.keywords ?? []).includes('null'), false);
    assert.notEqual(cleaned.characterName, 'null');
    assert.equal(classification.sanitizeOcr(item.ocr).toLowerCase().includes('null'), false);
  }
  assert.equal(classification.isMissingToken('null'), true);
  assert.equal(classification.isMissingToken('undefined'), true);
  assert.equal(classification.isMissingToken('none'), true);
  assert.equal(classification.isMissingToken('Knull'), false); // Legitimate card name remains searchable.
});
test('3088 artist surname plus year-like number is rejected without strong catalog evidence', async () => {
  const item = row(3088);
  const parsed = await classification.cardNumberEvidence(item.ocr, item.vision, async () => false);
  assert.equal(parsed.raw, 'MACK-95');
  assert.equal(parsed.validatedCardNumber, null);
  assert.equal(parsed.status, 'rejected');
  const supported = await classification.cardNumberEvidence(item.ocr, item.vision, async () => true);
  assert.equal(supported.validatedCardNumber, 'MACK-95');
});
test('3084 reviewer-note back and 3094 OCR-empty image-only retain uncertain/front separation', () => {
  const back = classification.effectiveClassification(3084,
    { status: 'unresolved', note: 'This is the back of a card, not the front.' }, undefined, row(3084).ocr);
  assert.equal(back.side, 'back');
  assert.equal(back.sideEvidence, 'reviewer-note-3084');
  const imageOnly = classification.effectiveClassification(3094, { status: 'confirmed' }, undefined, row(3094).ocr);
  assert.equal(imageOnly.ocrTag, 'empty');
  assert.equal(imageOnly.side, 'uncertain'); // No fabricated front label.
  assert.equal(classification.REVIEW_DEVELOPMENT_CASES[3080], 'strict 1993 search year');
  assert.equal(classification.REVIEW_DEVELOPMENT_CASES[3120], 'vision literal-null fields and keyword');
});
test('separate durable classifications validate reasons without modifying original decisions', async () => {
  const original = await fs.readFile('.local/scan-review/decisions.json');
  await classification.saveReviewClassification(datasetHash, 3084, {
    datasetHash, side: 'back', ocrTag: 'useful',
    unresolvedReason: 'only back image available',
    metadataParsing: { status: 'contradictory', reason: 'Card number refers to back copy' },
  }, 88, 'unresolved');
  let file = await classification.readReviewClassifications(datasetHash);
  assert.equal(file.classifications[3084].side, 'back');
  assert.equal(file.classifications[3084].unresolvedReason, 'only back image available');
  await assert.rejects(classification.saveReviewClassification(datasetHash, 3094,
    { datasetHash, unresolvedReason: 'other' }, 88, 'confirmed'), /requires an unresolved review/);
  await classification.saveReviewClassification(datasetHash, 3094, {
    datasetHash, side: 'front', ocrTag: 'empty',
  }, 88, 'confirmed');
  file = await classification.readReviewClassifications(datasetHash);
  assert.equal(file.classifications[3094].ocrTag, 'empty');
  assert.deepEqual(await fs.readFile('.local/scan-review/decisions.json'), original);
});
test.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });