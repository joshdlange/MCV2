import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { auditSlugs, repairOwnerBaseAuditTx } from '../seeds/repairOwnerBaseAudit';

test('owner audit repair preserves quantities, references, protected exceptions and repeat safety', async () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.NEON_DATABASE_URL);
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx => {
    const quantities = async () => (await tx.execute(sql`SELECT user_id,sum(quantity)::text quantity
      FROM user_collections GROUP BY user_id ORDER BY user_id`)).rows;
    const protectedRows = async () => (await tx.execute(sql`SELECT to_jsonb(c) card FROM cards c
      JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id WHERE s.slug IN (
        '1994-1994-flair-marvel-annual-base','2021-2021-upper-deck-marvel-black-diamond-base',
        'marvel-2024-marvel-masterpieces-xl') OR m.name='2024 SkyBox Marvel Masterpieces XL'
      OR c.name='Box' ORDER BY c.id`)).rows;
    const before = await quantities(), protectedBefore = await protectedRows();
    const oldImages = (await tx.execute(sql`SELECT c.id,c.front_image_url,c.back_image_url FROM cards c
      JOIN card_sets s ON s.id=c.set_id WHERE s.slug IN (${sql.join(Object.values(auditSlugs).map(v => sql`${v}`), sql`,`)})`)).rows;
    console.log(await repairOwnerBaseAuditTx(tx));
    assert.deepEqual(await quantities(), before);
    assert.deepEqual(await protectedRows(), protectedBefore);
    for (const image of oldImages) {
      const after = (await tx.execute(sql`SELECT id,front_image_url,back_image_url FROM cards WHERE id=${image.id}`)).rows[0];
      assert.ok(after);
      // Existing image-bearing originals survive (including archived merge sources).
      if (image.front_image_url) assert.equal(after.front_image_url, image.front_image_url);
      if (image.back_image_url) assert.equal(after.back_image_url, image.back_image_url);
    }
    const dangling = await tx.execute(sql`SELECT c.id FROM cards c WHERE c.archive_reason='owner_base_audit_corrections'
      AND (EXISTS(SELECT 1 FROM user_collections u WHERE u.card_id=c.id)
        OR EXISTS(SELECT 1 FROM user_wishlists w WHERE w.card_id=c.id)
        OR EXISTS(SELECT 1 FROM pc_binder_cards b WHERE b.card_id=c.id)
        OR EXISTS(SELECT 1 FROM listings l WHERE l.card_id=c.id))`);
    assert.equal(dangling.rows.length, 0);
    const mismatchedGold = await tx.execute(sql`SELECT b.card_number FROM cards b
      JOIN card_sets s ON s.id=b.set_id JOIN card_sets gs ON gs.slug=${auditSlugs.gold18}
      LEFT JOIN cards g ON g.set_id=gs.id AND g.card_number=b.card_number AND g.archived_at IS NULL
      WHERE s.slug=${auditSlugs.masterpieces18} AND b.archived_at IS NULL AND b.name IS DISTINCT FROM g.name`);
    assert.equal(mismatchedGold.rows.length, 0);
    assert.deepEqual(await repairOwnerBaseAuditTx(tx), { added: 0, merged: 0, moved: 0, renumbered: 0 });
    assert.deepEqual(await quantities(), before);
    throw new Rollback();
  }), e => e instanceof Rollback);
});
test.after(() => pool.end());
