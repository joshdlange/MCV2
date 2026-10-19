import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { importFoxKids1995 } from '../seeds/importFoxKids1995';

test('repairs an already-imported hidden Fox Kids set without duplicating cards', async () => {
  const rollback = new Error('intentional test rollback');
  try {
    await assert.rejects(db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('import_fox_kids_1995_canonical'))`);
      const before = await tx.execute(sql`
        SELECT c.id,c.card_number,c.name,c.is_insert,c.front_image_url,c.set_id
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
        WHERE m.slug='1995-fleer-ultra-fox-kids-network' ORDER BY c.id`);
      assert.equal(before.rows.length, 184);
      await tx.execute(sql`DELETE FROM startup_migrations WHERE name='import_fox_kids_1995_canonical'`);
      await tx.execute(sql`UPDATE main_sets SET is_canonical=false,canonical_source=NULL
        WHERE slug='1995-fleer-ultra-fox-kids-network'`);
      await tx.execute(sql`UPDATE card_sets SET is_canonical=false,canonical_source=NULL
        WHERE main_set_id=(SELECT id FROM main_sets WHERE slug='1995-fleer-ultra-fox-kids-network')`);
      // Run the real importer inside this test's rollback-only transaction.
      const database = { transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
      const result = await importFoxKids1995(database as Pick<typeof db, 'transaction'>);
      assert.equal(result.imported, true);
      assert.equal(result.inserted, 0);
      assert.equal((await importFoxKids1995(database as Pick<typeof db, 'transaction'>)).imported, false);
      const visible = await tx.execute(sql`
        SELECT m.id FROM main_sets m
        WHERE m.slug='1995-fleer-ultra-fox-kids-network' AND m.is_active=true AND m.is_canonical=true
        AND EXISTS(SELECT 1 FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE s.main_set_id=m.id)`);
      assert.equal(visible.rows.length, 1);
      const subsets = await tx.execute(sql`
        SELECT s.name,s.is_canonical,s.canonical_source,count(c.id)::int AS count
        FROM card_sets s JOIN main_sets m ON m.id=s.main_set_id JOIN cards c ON c.set_id=s.id
        WHERE m.slug='1995-fleer-ultra-fox-kids-network' GROUP BY s.id ORDER BY s.name`);
      assert.deepEqual(subsets.rows.map(r => [r.name,r.count]), [
        ['Base',150],['Power Popup',24],['Suspended Animation Cels',10],
      ]);
      assert.ok(subsets.rows.every(r => r.is_canonical && r.canonical_source === 'csv_master'));
      const after = await tx.execute(sql`
        SELECT c.id,c.card_number,c.name,c.is_insert,c.front_image_url,c.set_id
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
        WHERE m.slug='1995-fleer-ultra-fox-kids-network' ORDER BY c.id`);
      assert.deepEqual(after.rows, before.rows);
      throw rollback;
    }), error => error === rollback);
  } finally {
    await pool.end();
  }
});
