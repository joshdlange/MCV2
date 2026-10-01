// DEV-ONLY Phase C1 §3: load the frozen production catalog snapshot into a THROWAWAY local
// Postgres (unix socket under MCV_DEV_DATA/phase-c1/pg, no TCP) so the existing text matcher's
// SQL runs unchanged against production's catalog. Catalog columns only. Refuses any other host.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import { devDataPath } from '../server/devData';

export const LOCAL_DB = { host: devDataPath('phase-c1', 'pg', 'sock'), port: 55433, user: 'c1', database: 'c1catalog' };

if (process.argv[1]?.endsWith('dev-phase-c1-localdb.ts')) {
  const snap = JSON.parse(await fs.readFile(devDataPath('phase-c0', 'prod-catalog', 'cards.json'), 'utf8'));
  const flags = JSON.parse(await fs.readFile(devDataPath('phase-c1', 'set-flags.json'), 'utf8'));
  const insertSubset = new Map<number, boolean>(flags.sets.map((s: any) => [s.id, s.isInsertSubset]));
  assert(LOCAL_DB.host.startsWith('/'), 'unix socket only');
  const client = new pg.Client(LOCAL_DB);
  await client.connect();
  await client.query(`DROP TABLE IF EXISTS cards, card_sets, main_sets;
    CREATE TABLE main_sets (id int PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, archived_at timestamp);
    CREATE TABLE card_sets (id int PRIMARY KEY, name text NOT NULL, year int, main_set_id int, is_insert_subset boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true, archived_at timestamp);
    CREATE TABLE cards (id int PRIMARY KEY, set_id int NOT NULL, name text NOT NULL, card_number text NOT NULL, front_image_url text,
      variation text, is_insert boolean NOT NULL DEFAULT false, archived_at timestamp);`);
  const mains = new Map<number, string>(), sets = new Map<number, any>();
  let missingFlags = 0;
  for (const c of snap.cards) {
    if (c.mainSetId != null) mains.set(c.mainSetId, c.mainSetName);
    if (!sets.has(c.setId)) {
      if (!insertSubset.has(c.setId)) missingFlags++;
      sets.set(c.setId, [c.setId, c.setName, c.year, c.mainSetId, insertSubset.get(c.setId) ?? false]);
    }
  }
  const insert = async (sql: string, rows: any[][], width: number) => {
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000);
      const params = chunk.flat();
      const values = chunk.map((_, r) => `(${Array.from({ length: width }, (_, k) => `$${r * width + k + 1}`).join(',')})`).join(',');
      await client.query(`${sql} VALUES ${values}`, params);
    }
  };
  await insert('INSERT INTO main_sets (id, name)', [...mains].map(([id, name]) => [id, name]), 2);
  await insert('INSERT INTO card_sets (id, name, year, main_set_id, is_insert_subset)', [...sets.values()], 5);
  // archived_at only matters as NULL / NOT NULL; the matcher does not filter it.
  await insert('INSERT INTO cards (id, set_id, name, card_number, front_image_url, variation, archived_at)',
    snap.cards.map((c: any) => [c.id, c.setId, c.name, c.cardNumber ?? '', c.imageUrl, c.variation, c.archived ? '2000-01-01' : null]), 7);
  await client.query('CREATE INDEX ON cards (set_id, card_number); ANALYZE');
  const count = (await client.query('SELECT count(*)::int AS n FROM cards')).rows[0].n;
  assert.equal(count, snap.count);
  await client.end();
  console.log(JSON.stringify({ cards: count, sets: sets.size, mainSets: mains.size, setsWithoutFlag: missingFlags, snapshotHash: snap.hash.slice(0, 16) }));
}
