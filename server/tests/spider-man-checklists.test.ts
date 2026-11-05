import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { repairSpiderManChecklist, spiderManTargets } from '../seeds/repairSpiderManChecklists';

test('owner checklists preserve all existing images and references, isolate review rows, and repeat safely', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const snapshot = async () => (await tx.execute(sql`
      SELECT c.id, c.card_number, c.front_image_url, c.back_image_url, c.alternate_images,
        (SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM user_collections u WHERE u.card_id=c.id) ownership,
        (SELECT jsonb_agg(to_jsonb(w)) FROM user_wishlists w WHERE w.card_id=c.id) wishlist,
        (SELECT jsonb_agg(to_jsonb(b)) FROM pc_binder_cards b WHERE b.card_id=c.id) binders
      FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
      WHERE m.slug IN ('1995-fleer-ultra-spider-man','2002-topps-spider-man') ORDER BY c.id`)).rows;
    const before = await snapshot();
    console.log(await repairSpiderManChecklist(tx));
    const after = await snapshot();
    for (const old of before) assert.deepEqual(after.find(c => c.id === old.id), old);
    for (const target of spiderManTargets) {
      const actual = await tx.execute(sql`SELECT c.card_number AS number,c.name
        FROM cards c JOIN card_sets s ON s.id=c.set_id
        WHERE s.slug=${target.slug} AND c.archived_at IS NULL ORDER BY c.card_number::int`);
      assert.deepEqual(actual.rows, target.checklist);
    }
    const reviews = await tx.execute(sql`SELECT c.name,c.card_number FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE s.slug LIKE '%-checklist-review' AND s.main_set_id=(SELECT id FROM main_sets WHERE slug='1995-fleer-ultra-spider-man')`);
    assert.ok(reviews.rows.some(c => c.name === 'Sealed Box'));
    assert.ok(reviews.rows.some(c => c.name === 'Fortunato'));
    assert.ok(reviews.rows.some(c => c.name === 'Spider-Man' && c.card_number === '9'));
    assert.deepEqual(await repairSpiderManChecklist(tx), { added: 0, reviewed: 0 });
    assert.deepEqual(await snapshot(), after);
    throw new Rollback();
  }), e => e instanceof Rollback);
});
test.after(() => pool.end());
