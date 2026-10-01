// DEV-ONLY Phase C1 §7 (docs/scan-plan-phase-c1.md): one read-only transaction on the approved
// production host. (1) Top 500 active cards with no usable image, ranked by collection rows;
// aggregate counts only, no user IDs. (2) card_sets.is_insert_subset for the C1 text matcher.
// Writes MCV_DEV_DATA/phase-c1/{image-gaps-top500.csv,set-flags.json}. Never writes to production.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import { CATALOG, PLACEHOLDER_IMAGE_FILE } from '../server/services/catalogVisual';
import { devDataPath } from '../server/devData';

const APPROVED_HOST = 'ep-lingering-waterfall-a6jtu4k4.us-west-2.aws.neon.tech';
const OUT = devDataPath('phase-c1');
process.umask(0o077);
const url = new URL(process.env.NEON_DATABASE_URL!);
assert.equal(url.hostname, APPROVED_HOST, 'only the approved production host');
console.log(`read-only query on host=${url.hostname} db=${url.pathname.slice(1)}`);
const client = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, options: '-c default_transaction_read_only=on' });
await client.connect();
let gaps: any[], flags: any[], takenAt: string, totals: any;
try {
  await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
  takenAt = (await client.query('SELECT now() AS t')).rows[0].t.toISOString();
  // Negation of the image part of ELIGIBLE; card/set activity part kept as-is.
  const ACTIVE = `c.archived_at IS NULL AND s.is_active AND s.archived_at IS NULL
    AND (m.id IS NULL OR (m.is_active AND m.archived_at IS NULL))`;
  const REASON = `CASE WHEN c.front_image_url IS NULL OR btrim(c.front_image_url) = '' THEN 'none'
    WHEN c.front_image_url ~* '/${PLACEHOLDER_IMAGE_FILE}$' THEN 'placeholder'
    WHEN c.front_image_url !~ '^https?://' THEN 'not-http'
    WHEN c.front_image_url ~* '^https?://([^/]*\\.)?(drive\\.google\\.com|docs\\.google\\.com|googleusercontent\\.com)(/|:)' THEN 'google-drive'
    END`;
  const GAP = `${ACTIVE} AND (${REASON}) IS NOT NULL`;
  totals = (await client.query(`SELECT ${REASON} AS reason, count(*)::int AS cards ${CATALOG} WHERE ${GAP} GROUP BY 1 ORDER BY 2 DESC`)).rows;
  gaps = (await client.query(`WITH uc AS (SELECT card_id, count(*)::int AS rows, count(DISTINCT user_id)::int AS collectors
      FROM user_collections GROUP BY card_id)
    SELECT c.id, c.name, c.card_number AS "cardNumber", c.variation, s.name AS "setName", m.name AS "mainSetName", s.year,
      ${REASON} AS reason, coalesce(uc.rows, 0) AS "collectionRows", coalesce(uc.collectors, 0) AS collectors
    ${CATALOG} LEFT JOIN uc ON uc.card_id = c.id WHERE ${GAP}
    ORDER BY "collectionRows" DESC, collectors DESC, c.id LIMIT 500`)).rows;
  flags = (await client.query('SELECT id, is_insert_subset AS "isInsertSubset" FROM card_sets ORDER BY id')).rows;
  await client.query('ROLLBACK');
} finally { await client.end(); }
await fs.mkdir(OUT, { recursive: true });
const csv = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ['rank', 'id', 'name', 'cardNumber', 'variation', 'setName', 'mainSetName', 'year', 'reason', 'collectionRows', 'collectors'];
await fs.writeFile(path.join(OUT, 'image-gaps-top500.csv'),
  [cols.join(','), ...gaps.map((g, i) => cols.map(c => csv(c === 'rank' ? i + 1 : g[c])).join(','))].join('\n') + '\n');
await fs.writeFile(path.join(OUT, 'set-flags.json'), JSON.stringify({ takenAt, sets: flags }));
await fs.writeFile(path.join(OUT, 'image-gaps-summary.json'), JSON.stringify({ takenAt, totals,
  top500: { collectionRows: gaps.reduce((s, g) => s + g.collectionRows, 0), withCollectors: gaps.filter(g => g.collectors > 0).length } }, null, 2));
console.log(JSON.stringify({ takenAt, totals, gaps: gaps.length, sets: flags.length }));
