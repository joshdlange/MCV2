import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { ScanCandidateRow } from '../services/scanMatching';

process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost:5432/unused';
delete process.env.OPENAI_API_KEY;
const { scanCard, buildParsedScan, rerankVisualMatches } = await import('../services/scanService');
const { rankImageCandidates } = await import('../services/scanMatching');

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