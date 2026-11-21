import assert from "node:assert/strict";
import { test, after } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, healthPool } from "../db";
import { cards, cardSets, mainSets } from "../../shared/schema";
import { restoreWolverineThenTilNow, wolverineCatalog as config } from "../seeds/restoreWolverineThenTilNow";
import checklist from "../seeds/data/wolverine-then-til-now-i-1991.json";

after(async () => { await pool.end(); await healthPool.end(); });

test("owner checklist retains exact wording and contains base cards 1–45 only", () => {
  assert.deepEqual(checklist.map(row => row.number), Array.from({ length: 45 }, (_, i) => String(i + 1)));
  assert.equal(checklist[16].name, "Come ON");
  assert.equal(checklist[21].name, "otha");
  assert.equal(checklist[44].name, "Checklist");
});

test("restoration preserves Series II identities, creates Series I once, and audits image replacement", async () => {
  const rollback = new Error("Rollback verification");
  await assert.rejects(db.transaction(async tx => {
    // Rehearse inside a transaction; nothing from this test is committed.
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${config.marker}`);
    const before = await tx.execute(sql`SELECT c.* FROM cards c JOIN card_sets s ON s.id=c.set_id
      JOIN main_sets m ON m.id=s.main_set_id WHERE m.slug=${config.secondSlug} ORDER BY c.id`);
    const adapter = { transaction: async (fn: any) => fn(tx) } as unknown as Pick<typeof db, "transaction">;
    assert.equal((await restoreWolverineThenTilNow(adapter)).applied, true);
    const [first] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.firstSlug));
    const firstChildren = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, first.id));
    assert.equal(firstChildren.length, 1);
    assert.equal(firstChildren[0].isInsertSubset, false);
    const firstCards = await tx.select().from(cards).where(eq(cards.setId, firstChildren[0].id));
    assert.equal(firstCards.length, 45);
    for (const row of firstCards) {
      assert.equal(row.name, checklist.find(item => item.number === row.cardNumber)?.name);
      assert.equal(row.isInsert, false);
      assert.equal(row.frontImageUrl, null);
    }
    const [second] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.secondSlug));
    assert.equal(second.name, config.secondName);
    assert.equal(second.isActive, true);
    assert.equal(second.isCanonical, true);
    assert.equal(second.archivedAt, null);
    assert.equal(second.thumbnailImageUrl, config.secondThumbnail);
    assert.equal(first.thumbnailImageUrl, config.firstThumbnail);
    const restored = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, second.id));
    assert.deepEqual(restored.map(row => [row.name, row.totalCards]).sort(), [["Base", 90], ["Prism", 6]]);
    assert.ok(restored.every(row => row.isActive && row.isCanonical && !row.archivedAt && row.year === 1992));
    const after = await tx.execute(sql`SELECT c.* FROM cards c JOIN card_sets s ON s.id=c.set_id
      WHERE s.main_set_id=${second.id} ORDER BY c.id`);
    assert.equal(after.rows.length, 96);
    for (let i = 0; i < before.rows.length; i++) {
      const expected = { ...before.rows[i] };
      if (expected.card_number === "90") {
        expected.front_image_url = config.card90;
        expected.updated_at = after.rows[i].updated_at; // Database update timestamp trigger.
      }
      assert.deepEqual(after.rows[i], expected, "No other card data or IDs may change");
    }
    assert.equal((await restoreWolverineThenTilNow(adapter)).applied, false);
    const finalCount = await tx.execute(sql`SELECT count(*)::int AS count FROM cards WHERE set_id=${firstChildren[0].id}`);
    assert.equal(finalCount.rows[0].count, 45);
    throw rollback;
  }), error => error === rollback);
});
