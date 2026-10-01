// DEV-ONLY Phase C0 addendum: frozen read-only snapshot of the PRODUCTION catalog
// (catalog of record for C0). One read-only transaction against the approved host;
// catalog metadata only (no users, collections or scans). Writes .local/phase-c0/prod-catalog.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { CATALOG, ELIGIBLE } from '../server/services/catalogVisual';

const APPROVED_HOST = 'ep-lingering-waterfall-a6jtu4k4.us-west-2.aws.neon.tech';
const OUT = '.local/phase-c0/prod-catalog';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

process.umask(0o077);
assert(!existsSync(path.join(OUT, 'manifest.json')), 'production snapshot already frozen');
const url = new URL(process.env.NEON_DATABASE_URL!);
assert.equal(url.hostname, APPROVED_HOST, 'only the approved production host');
console.log(`read-only snapshot from host=${url.hostname} db=${url.pathname.slice(1)}`);
const client = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, options: '-c default_transaction_read_only=on' });
await client.connect();
let entries: { url: string; cardIds: number[] }[], cards: any[], takenAt: string;
try {
  await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
  takenAt = (await client.query('SELECT now() AS t')).rows[0].t.toISOString();
  // Same eligibility SQL as the dev manifest (placeholder excluded).
  entries = (await client.query(`SELECT c.front_image_url AS url, array_agg(c.id ORDER BY c.id) AS "cardIds"
    ${CATALOG} WHERE ${ELIGIBLE} GROUP BY c.front_image_url ORDER BY min(c.id)`)).rows;
  cards = (await client.query(`SELECT c.id, c.name, c.card_number AS "cardNumber", c.variation,
      c.set_id AS "setId", s.name AS "setName", s.year, s.main_set_id AS "mainSetId", m.name AS "mainSetName",
      (s.is_active AND s.archived_at IS NULL AND (m.id IS NULL OR (m.is_active AND m.archived_at IS NULL))) AS "setActive",
      (c.archived_at IS NOT NULL) AS archived, c.front_image_url AS "imageUrl"
    FROM cards c JOIN card_sets s ON s.id = c.set_id LEFT JOIN main_sets m ON m.id = s.main_set_id ORDER BY c.id`)).rows;
  await client.query('ROLLBACK');
} finally { await client.end(); }
await fs.mkdir(OUT, { recursive: true });
const manifest = { createdAt: takenAt, source: `production ${APPROVED_HOST} (read-only, one transaction)`, count: entries.length,
  cardRows: entries.reduce((s, e) => s + e.cardIds.length, 0), hash: sha(JSON.stringify(entries)), entries };
await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
await fs.writeFile(path.join(OUT, 'cards.json'), JSON.stringify({ createdAt: takenAt, count: cards.length, hash: sha(JSON.stringify(cards)), cards }));
console.log(JSON.stringify({ takenAt, eligibleImages: manifest.count, eligibleCardRows: manifest.cardRows, manifestHash: manifest.hash.slice(0, 16), cards: cards.length }));
