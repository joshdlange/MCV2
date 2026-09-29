import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { ScanCandidateRow } from '../services/scanMatching';

process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost:5432/unused';
delete process.env.OPENAI_API_KEY;
const { scanCard, buildParsedScan, rerankVisualMatches } = await import('../services/scanService');
const { rankImageCandidates, sanitizeParsedScan, rankScanCandidates } = await import('../services/scanMatching');

const vision = (fields = {}) => ({
  ocrText: null, characterName: null, setName: null, subsetName: null,
  cardNumber: null, year: null, brand: null, variant: null,
  copyrightLine: null, serialIndicator: null, ...fields,
});
const row = (id: number, fields: Partial<ScanCandidateRow> = {}): ScanCandidateRow => ({
  id, name: 'Spider-Man', cardNumber: '7', setName: 'Marvel Masterpieces',
  setYear: 2024, frontImageUrl: `https://images.example.com/${id}.jpg`,
  variation: null, isInsert: false, ...fields,
});

test('image-only candidate outside OCR shortlist reaches scan results, with timing and coverage', async () => {
  const front = await sharp({ create: { width: 600, height: 840, channels: 3,
    background: '#777777' } }).png().toBuffer();
  let queried = false;
  const result = await scanCard(front, 'image/png', undefined, {
    queryImage: async buffer => {
      assert.ok(buffer.length);
      queried = true;
      return { status: 'partial', matches: [{ cardId: 987, similarity: 0.92 }],
        indexedCount: 20, totalEligible: 100 };
    },
    identify: async () => vision(),
    matchMetadata: async parsed => {
      assert.equal(parsed.cardNumber, null);
      assert.equal(parsed.characterName, null);
      return []; // the correct card is absent from the entire OCR shortlist
    },
    retrieveImageRows: async ids => {
      assert.deepEqual(ids, [987]);
      return [row(987), row(988, { variation: 'Gold' })];
    },
    verify: async (_front, _mime, matches) => ({ matches, status: 'unavailable' }),
  });
  assert.ok(queried);
  assert.deepEqual(result.matches.map(match => match.cardId), [987, 988]);
  assert.equal(result.matches[0].retrievalSource, 'image');
  assert.equal(result.matches[1].retrievalSource, 'image-family');
  assert.equal(result.imageIndex.fallback, 'none');
  assert.equal(result.imageIndex.status, 'partial');
  assert.match(result.warnings.join(' '), /incomplete/);
  assert.ok(result.matches.every(match => match.confidenceLevel !== 'high'));
  for (const value of Object.values(result.timings)) assert.ok(Number.isFinite(value) && value >= 0);
});

test('scans 3082 and 3120: quoted missing names and OCR placeholders never become search evidence', () => {
  // Sanitized copies of the reported missing-name metadata (not historical rows).
  for (const scanId of [3082, 3120]) {
    const result = buildParsedScan(vision({
      characterName: 'null', setName: 'undefined', subsetName: 'none',
      cardNumber: 'null', year: 'undefined', ocrText: 'null undefined none',
    }));
    assert.equal(result.characterName, null, `${scanId}`);
    assert.equal(result.cardNumber, null);
    assert.equal(result.setName, null);
    assert.deepEqual(result.keywords, []);
  }
  assert.deepEqual(buildParsedScan(vision({ characterName: 'Knull',
    ocrText: 'Knull Ultimate Nullifier' })).keywords, ['knull', 'ultimate', 'nullifier']);
});

test('scan 3088: artist credit cannot synthesize MACK-95; explicit numbered formats survive', () => {
  const ocrText = 'RANDOM · DAVID MACK · 95 FLEER ULTRA';
  assert.equal(buildParsedScan(vision({ ocrText, cardNumber: 'MACK-95' })).cardNumber, null);
  assert.equal(buildParsedScan(vision({ ocrText, cardNumber: 'MACK 95' })).cardNumber, null);
  assert.equal(buildParsedScan(vision({ ocrText, cardNumber: '95' })).cardNumber, null);
  assert.equal(buildParsedScan(vision({ ocrText: 'FLEER ULTRA #MM-23' })).cardNumber, 'MM-23');
  assert.equal(buildParsedScan(vision({ ocrText: 'No. 007' })).cardNumber, '7');
});

test('scan 3094: empty OCR remains valid image-first input', () => {
  const result = buildParsedScan(vision({ ocrText: 'none' }));
  assert.equal(result.cardNumber, null);
  assert.deepEqual(result.keywords, []);
});

const historicalMetadataPath = new URL('../../.local/scan-review/scan-metadata.json', import.meta.url);
test('frozen historical scan rows 3082, 3120, 3088 and 3094 sanitize without changing source', {
  skip: !existsSync(historicalMetadataPath) && 'Local frozen scan metadata unavailable',
}, () => {
  // Read only the four named entries; do not copy full records or historical rankings.
  const rows = JSON.parse(readFileSync(historicalMetadataPath, 'utf8')).rows as Array<{
    scanId: number; ocr: string; vision: ReturnType<typeof vision>;
  }>;
  const scan = (id: number) => {
    const historical = rows.find(entry => entry.scanId === id);
    assert.ok(historical, `missing frozen scan ${id}`);
    return {
      parsed: buildParsedScan({ ...historical.vision, ocrText: historical.ocr }),
      sanitized: sanitizeParsedScan(historical.vision as Parameters<typeof sanitizeParsedScan>[0]),
      ocr: historical.ocr,
    };
  };
  for (const id of [3082, 3120]) {
    const { parsed, sanitized } = scan(id);
    assert.equal(parsed.characterName, null);
    assert.equal(parsed.cardNumber, null);
    assert.equal(sanitized.characterName, null);
    assert.equal(sanitized.cardNumber, null);
    assert.ok(!parsed.keywords.includes('null'));
    assert.ok(!sanitized.keywords.includes('null'));
    const matches = rankScanCandidates([
      row(1, { name: 'Knull' }),
      row(2, { name: 'Ultimate Nullifier' }),
    ], sanitized);
    assert.ok(matches.every(match => !match.matchReasons.some(reason => /name matched|OCR keyword/i.test(reason))));
  }
  const artist = scan(3088);
  assert.equal(artist.parsed.cardNumber, null);
  assert.equal(buildParsedScan(vision({ ocrText: artist.ocr, cardNumber: '95' })).cardNumber, null);
  assert.equal(buildParsedScan(vision({ ocrText: 'NO. 95', cardNumber: '95' })).cardNumber, '95');
  assert.equal(buildParsedScan(vision({ ocrText: '#MM-23', cardNumber: 'MM-23' })).cardNumber, 'MM-23');
  const imageOnly = scan(3094);
  assert.equal(imageOnly.parsed.cardNumber, null);
  assert.deepEqual(imageOnly.parsed.keywords, []);
  assert.equal(imageOnly.ocr, '');
});

test('strong similar artwork cannot override conflicting number, product, or year', () => {
  const parsed = buildParsedScan(vision({ cardNumber: '88', setName: 'Metal Universe', year: '1995' }));
  const candidates = rankImageCandidates([row(1)], [{ cardId: 1, similarity: 0.99 }], parsed);
  const [result] = rerankVisualMatches(candidates, [{ cardId: 1, judgement: 'strong' }], parsed);
  assert.equal(result.cardId, 1); // visible for manual review, not silently discarded
  assert.notEqual(result.confidenceLevel, 'high');
  assert.ok(result.metadataConflicts?.some(reason => reason.includes('Set conflicts')));
  assert.ok(result.metadataConflicts?.some(reason => reason.includes('Card number conflicts')));
});

test('clear isolated verified picture can qualify without any checklist number', () => {
  const parsed = buildParsedScan(vision());
  const candidates = rankImageCandidates([row(1)], [{ cardId: 1, similarity: 0.94 }], parsed);
  assert.notEqual(candidates[0].confidenceLevel, 'high');
  assert.equal(rerankVisualMatches(candidates, [{ cardId: 1, judgement: 'strong' }], parsed)[0].confidenceLevel, 'high');
});

test('same-art family variants survive ranking and prevent an ungrounded exact variant', () => {
  const parsed = buildParsedScan(vision());
  const rows = [row(1), ...Array.from({ length: 7 }, (_, i) => row(i + 2, { variation: `Parallel ${i}` }))];
  const candidates = rankImageCandidates(rows, [{ cardId: 1, similarity: 0.96 }], parsed);
  assert.equal(candidates.length, 8); // not truncated to a five-card text shortlist
  const results = rerankVisualMatches(candidates, [{ cardId: 1, judgement: 'strong' }], parsed);
  assert.ok(results.every(match => match.confidenceLevel !== 'high'));
});

test('near-identical image candidates from different families cannot become high', () => {
  const parsed = buildParsedScan(vision());
  const candidates = rankImageCandidates([row(1), row(2, { setName: 'Metal Universe' })],
    [{ cardId: 1, similarity: 0.94 }, { cardId: 2, similarity: 0.93 }], parsed);
  assert.ok(rerankVisualMatches(candidates, [{ cardId: 1, judgement: 'strong' }], parsed)
    .every(match => match.confidenceLevel !== 'high'));
});

test('text-only fallbacks can never earn high from verification alone', () => {
  const parsed = buildParsedScan(vision({ cardNumber: '7' }));
  const candidates = rankImageCandidates([], [], parsed, [{
    cardId: 1, name: 'Spider-Man', setName: 'Marvel Masterpieces', subsetName: null,
    cardNumber: '7', year: 2024, imageUrl: 'https://images.example.com/1.jpg',
    confidence: 160, confidenceLevel: 'high', matchReasons: ['Exact card number match'],
  }]);
  assert.equal(candidates[0].retrievalSource, 'metadata');
  assert.equal(rerankVisualMatches(candidates, [{ cardId: 1, judgement: 'strong' }], parsed)[0].confidenceLevel, 'low');
});

test('unavailable index and unreadable text produce explicit no-candidates fallback', async () => {
  const front = await sharp({ create: { width: 600, height: 840, channels: 3,
    background: '#777777' } }).png().toBuffer();
  const result = await scanCard(front, 'image/png', undefined, {
    queryImage: async () => ({ status: 'unavailable', matches: [], indexedCount: 0, totalEligible: 100 }),
    identify: async () => vision(),
    matchMetadata: async () => [],
    retrieveImageRows: async ids => { assert.deepEqual(ids, []); return []; },
    verify: async (_front, _mime, matches) => ({ matches, status: 'unavailable' }),
  });
  assert.equal(result.confidenceLevel, 'none');
  assert.equal(result.imageIndex.fallback, 'no-candidates');
  assert.match(result.warnings.join(' '), /image search is unavailable/);
  assert.match(result.warnings.join(' '), /No readable identifying text/);
});