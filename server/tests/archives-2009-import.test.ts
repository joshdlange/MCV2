import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { completeArchivesChecklist } from '../seeds/completeXMenArchives2009';

test('Archives import preserves existing IDs, images and collections and is repeat-safe', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const snapshot = async () => (await tx.execute(sql`SELECT c.id,c.front_image_url,c.back_image_url,
      (SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM user_collections u WHERE u.card_id=c.id) AS ownership
      FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
      WHERE m.slug='2009-rittenhouse-x-men-archives' ORDER BY c.id`)).rows;
    const before = await snapshot();
    console.log(await completeArchivesChecklist(tx));
    const after = await snapshot();
    for (const old of before) assert.deepEqual(after.find(c => c.id === old.id), old);
    assert.equal(after.length, 195);
    const counts = await tx.execute(sql`SELECT s.name,count(c.id)::int AS count
      FROM card_sets s JOIN main_sets m ON m.id=s.main_set_id JOIN cards c ON c.set_id=s.id
      WHERE m.slug='2009-rittenhouse-x-men-archives' GROUP BY s.id`);
    assert.equal(counts.rows.length, 8);
    assert.equal(counts.rows.find(s => s.name === 'Base')?.count, 72);
    assert.equal(counts.rows.find(s => s.name === 'Colored Sketch Cards')?.count, 86);
    assert.equal(counts.rows.find(s => s.name === 'Legendary Heroes')?.count, 10);
    assert.deepEqual(await completeArchivesChecklist(tx), { added: 0, total: 195, subsets: 8 });
    assert.deepEqual(await snapshot(), after);
    throw new Rollback();
  }), e => e instanceof Rollback);
});
test.after(() => pool.end());
