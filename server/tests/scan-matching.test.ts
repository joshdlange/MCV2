import test from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedScan, ScanCandidateRow } from '../services/scanMatching';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

// Ranking tests need no database connection or external vision service.
const databaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost:5432/unused';
const { rankScanCandidates, normalizeCardNumber, retrieveCandidates, extractKeywords, normalizeText } = await import('../services/scanMatching');

const parsed: ParsedScan = {
  characterName: 'Spider-Man', setName: 'Marvel Masterpieces', subsetName: null,
  cardNumber: '#7', year: '2024', brand: null, variant: null,
  copyrightLine: null, serialIndicator: null, keywords: [],
};
const row = (id: number, overrides: Partial<ScanCandidateRow> = {}): ScanCandidateRow => ({
  id, name: 'Spider-Man', cardNumber: '7', frontImageUrl: null,
  variation: null, isInsert: false, setName: 'Marvel Masterpieces',
  setYear: 2024, ...overrides,
});

test('historical missing-value strings cannot retrieve or score null-themed cards', async () => {
  const missing = { ...parsed, characterName: 'null', setName: 'undefined',
    subsetName: 'none', cardNumber: 'null', year: 'none',
    keywords: ['null', 'undefined', 'none', ''] };
  assert.equal(normalizeText('null'), '');
  assert.equal(normalizeCardNumber('undefined'), '');
  assert.deepEqual(extractKeywords('null undefined none'), []);
  const matches = rankScanCandidates([
    row(1, { name: 'Knull', cardNumber: '1' }),
    row(2, { name: 'Ultimate Nullifier', cardNumber: '2' }),
  ], missing);
  assert.ok(matches.every(match => !match.matchReasons.some(reason => /matched/i.test(reason))));
  let calls = 0;
  const retrieved = await retrieveCandidates(missing, async () => { calls++; return []; });
  assert.deepEqual(retrieved, []);
  assert.equal(calls, 0);
});

test('normalized number is precise; shared digits across prefixes are contradictions', () => {
  assert.equal(normalizeCardNumber('No. 007'), '7');
  const results = rankScanCandidates([
    row(1, { cardNumber: 'AV-7' }),
    row(2, { cardNumber: '007' }),
    row(3, { cardNumber: '17' }),
  ], parsed);
  assert.equal(results[0].cardId, 2);
  assert.match(results[0].matchReasons.join(' '), /Exact card number/);
  assert.ok(results.every(m => !m.matchReasons.some(r => r.includes('digits match'))));
  assert.ok(results[0].confidence > (results.find(m => m.cardId === 1)?.confidence ?? 0));
});

test('contradicting year, set and variation lose to matching print identity', () => {
  const scan = { ...parsed, subsetName: 'Canvas' };
  const results = rankScanCandidates([
    row(1, { variation: 'Gold', setYear: 2023 }),
    row(2, { variation: 'Canvas' }),
    row(3, { variation: 'Canvas', setName: 'Fleer Ultra' }),
  ], scan);
  assert.equal(results[0].cardId, 2);
  assert.equal(results[0].confidenceLevel, 'high');
  assert.ok(results[0].confidence > results[1].confidence);
});

test('separate subset set rows supply subset evidence and parent set context', () => {
  const matches = rankScanCandidates([
    row(1, { setName: 'Canvas', mainSetName: 'Marvel Masterpieces', isInsertSubset: true }),
    row(2),
  ], { ...parsed, subsetName: 'Canvas' });
  assert.equal(matches[0].cardId, 1);
  assert.equal(matches[0].subsetName, 'Canvas');
  assert.equal(matches[0].confidenceLevel, 'high');
});

test('same character alone never establishes high exact-card confidence', () => {
  const matches = rankScanCandidates([row(1)], {
    ...parsed, cardNumber: null, setName: null, year: null,
    keywords: ['spider', 'marvel', 'masterpieces'],
  });
  assert.equal(matches[0].confidenceLevel, 'medium');
});

test('near-tied prints are ambiguous regardless of deterministic id ordering', () => {
  const matches = rankScanCandidates([row(9), row(3)], parsed);
  assert.deepEqual(matches.map(m => m.cardId), [3, 9]);
  assert.equal(matches[0].confidenceLevel, 'medium');
  assert.equal(matches[1].confidenceLevel, 'medium');
});

test('explicit year contradiction cannot earn high confidence from other signals', () => {
  const matches = rankScanCandidates([row(1, { setYear: 2023 })], parsed);
  assert.equal(matches[0].confidenceLevel, 'medium');
  assert.match(matches[0].matchReasons.join(' '), /Year conflicts/);
});

test('absent fields do not cause duplicate retrieval queries', async () => {
  let calls = 0;
  const candidates = await retrieveCandidates({
    ...parsed, cardNumber: null, setName: null, year: null,
  }, async () => {
    calls++;
    return [];
  });
  assert.deepEqual(candidates, []);
  assert.equal(calls, 1);
});

test('retrieval finds a late exact print despite 100 earlier shared numbers, then falls back after contradictory year', {
  skip: !databaseUrl && 'Read-only PostgreSQL needed for SQL predicate validation',
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const dialect = new PgDialect();
  const calls: string[] = [];
  // CTE shadows production tables; the entire test executes SELECTs over
  // deterministic in-memory VALUES, never reads or changes catalog cards.
  const fixture = `WITH cards AS (
    SELECT g AS id, CASE WHEN g = 101 THEN 'Spider-Man' ELSE 'Iron Man' END AS name,
      CASE WHEN g = 101 THEN '001' ELSE '1' END AS card_number,
      CASE WHEN g = 101 THEN 2 ELSE 1 END AS set_id, NULL::text AS variation
    FROM generate_series(1, 101) g
  ), card_sets AS (
    SELECT 1 AS id, 'Fleer Ultra'::text AS name, 2023 AS year
    UNION ALL SELECT 2, 'Marvel Masterpieces', 2024
  ), main_sets AS (SELECT 999 AS id, 'Other'::text AS name) `;
  try {
    const fetch = async (condition: Parameters<Parameters<typeof retrieveCandidates>[1]>[0], limit: number) => {
      const query = dialect.sqlToQuery(condition);
      calls.push(query.sql);
      const result = await pool.query(`${fixture}
        SELECT cards.id, cards.name, cards.card_number AS "cardNumber",
          card_sets.name AS "setName", card_sets.year AS "setYear"
        FROM cards JOIN card_sets ON cards.set_id = card_sets.id
        LEFT JOIN main_sets ON false
        WHERE ${query.sql} ORDER BY cards.id LIMIT ${limit}`, query.params);
      return result.rows.map(r => row(r.id, {
        name: r.name, cardNumber: r.cardNumber, setName: r.setName, setYear: r.setYear,
      }));
    };
    const scan = { ...parsed, cardNumber: '#1', characterName: 'Spider Man' };
    const candidates = await retrieveCandidates(scan, fetch);
    assert.ok(candidates.some(c => c.id === 101), 'stored 001 and Spider-Man must survive selective retrieval');
    assert.equal(rankScanCandidates(candidates, scan)[0].cardId, 101);

    const contradictory = await retrieveCandidates({ ...scan, year: '2022' }, fetch);
    assert.ok(contradictory.some(c => c.id === 101), 'wrong year must not prevent fallback');
    assert.ok(calls.length < 15, `duplicate/absent filters should not issue 15 queries (got ${calls.length / 2} per scan)`);
  } finally {
    await pool.end();
  }
});