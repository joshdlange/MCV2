import assert from "node:assert/strict";
import { test, after } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, healthPool } from "../db";
import { cards, cardSets } from "../../shared/schema";
import { redSpectrumManualImageSlug, assertAutomaticImageAllowed, saveAutomaticImage } from "../services/automaticImagePolicy";
import { resetRedSpectrumImages, redImageRepair } from "../seeds/resetRedSpectrumImages";

after(async () => { await pool.end(); await healthPool.end(); });

test("Red Spectrum reset preserves cards, isolates the subset and never repeats", async () => {
  const rollback = new Error("test rollback");
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${redImageRepair.marker}`);
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, redSpectrumManualImageSlug));
    const before = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
    const outsideBefore = await tx.execute(sql`SELECT md5(string_agg(id::text || coalesce(front_image_url,'') ||
      coalesce(back_image_url,''), ',' ORDER BY id)) AS digest FROM cards WHERE set_id <> ${set.id}`);
    assert.equal((await resetRedSpectrumImages(tx)).applied, true);
    const afterRows = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
    const identity = (row: typeof before[number]) => {
      const { frontImageUrl, backImageUrl, alternateImages, updatedAt, ...rest } = row;
      return rest;
    };
    assert.deepEqual(afterRows.map(identity), before.map(identity));
    assert.equal(afterRows.filter(c => c.frontImageUrl).length, 2);
    for (const row of afterRows) {
      assert.equal(row.frontImageUrl, redImageRepair.images[row.cardNumber] ?? null);
      assert.equal(row.backImageUrl, null);
      assert.equal(row.alternateImages, null);
    }
    // A subsequent owner's manual change must survive every later startup.
    await tx.update(cards).set({ frontImageUrl: "https://example.com/later-manual-image.png" })
      .where(eq(cards.id, afterRows[0].id));
    assert.equal((await resetRedSpectrumImages(tx)).applied, false);
    const [manual] = await tx.select().from(cards).where(eq(cards.id, afterRows[0].id));
    assert.equal(manual.frontImageUrl, "https://example.com/later-manual-image.png");
    const outsideAfter = await tx.execute(sql`SELECT md5(string_agg(id::text || coalesce(front_image_url,'') ||
      coalesce(back_image_url,''), ',' ORDER BY id)) AS digest FROM cards WHERE set_id <> ${set.id}`);
    assert.deepEqual(outsideAfter.rows, outsideBefore.rows);
    throw rollback;
  }), error => error === rollback);
});

test("automatic search and its final write are blocked for Red Spectrum", async () => {
  const result = await db.execute(sql`SELECT c.id FROM cards c JOIN card_sets s ON s.id=c.set_id
    WHERE s.slug=${redSpectrumManualImageSlug} LIMIT 1`);
  const id = Number(result.rows[0].id);
  await assert.rejects(assertAutomaticImageAllowed(id), /manually approved/);
  assert.equal(await saveAutomaticImage(id, "https://example.com/must-not-save.png"), false);
});
