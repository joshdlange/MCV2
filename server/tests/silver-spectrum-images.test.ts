import assert from "node:assert/strict";
import { test, after } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, healthPool } from "../db";
import { cards, cardSets } from "../../shared/schema";
import { manualImageOnlySlug, assertAutomaticImageAllowed, saveAutomaticImage } from "../services/automaticImagePolicy";
import { resetSilverSpectrumAutographImages, silverImageRepair } from "../seeds/resetSilverSpectrumAutographImages";

after(async () => { await pool.end(); await healthPool.end(); });

test("repair retains card identities, clears only this subset and applies once", async () => {
  const rollback = new Error("test rollback");
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${silverImageRepair.marker}`);
    const auditBefore = await tx.execute(sql`SELECT count(*)::int AS count FROM admin_audit_logs
      WHERE notes LIKE ${'%"source":"' + silverImageRepair.marker + '"%'}`);
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, manualImageOnlySlug));
    const before = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
    const outsideBefore = await tx.execute(sql`SELECT md5(string_agg(id::text || coalesce(front_image_url,'') ||
      coalesce(back_image_url,''), ',' ORDER BY id)) AS digest FROM cards WHERE set_id <> ${set.id}`);
    assert.equal((await resetSilverSpectrumAutographImages(tx)).applied, true);
    assert.equal((await resetSilverSpectrumAutographImages(tx)).applied, false);
    const afterRows = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
    assert.equal(afterRows.filter(c => c.frontImageUrl).length, 2);
    assert.equal(afterRows.filter(c => c.backImageUrl || c.alternateImages).length, 0);
    const identity = (row: typeof before[number]) => {
      const { frontImageUrl, backImageUrl, alternateImages, updatedAt, ...rest } = row;
      return rest;
    };
    assert.deepEqual(afterRows.map(identity), before.map(identity));
    for (const row of afterRows) assert.equal(row.frontImageUrl, silverImageRepair.images[row.cardNumber] ?? null);
    const audit = await tx.execute(sql`SELECT count(*)::int AS count FROM admin_audit_logs
      WHERE notes LIKE ${'%"source":"' + silverImageRepair.marker + '"%'}`);
    assert.equal(Number(audit.rows[0].count) - Number(auditBefore.rows[0].count), 90);
    const outsideAfter = await tx.execute(sql`SELECT md5(string_agg(id::text || coalesce(front_image_url,'') ||
      coalesce(back_image_url,''), ',' ORDER BY id)) AS digest FROM cards WHERE set_id <> ${set.id}`);
    assert.deepEqual(outsideAfter.rows, outsideBefore.rows);
    throw rollback;
  }), error => error === rollback);
});

test("automatic finders cannot search or assign protected subset images", async () => {
  const result = await db.execute(sql`SELECT c.id FROM cards c JOIN card_sets s ON s.id=c.set_id
    WHERE s.slug=${manualImageOnlySlug} LIMIT 1`);
  const id = Number(result.rows[0].id);
  await assert.rejects(assertAutomaticImageAllowed(id), /manually approved/);
  assert.equal(await saveAutomaticImage(id, "https://example.com/must-not-save.png"), false);
});
