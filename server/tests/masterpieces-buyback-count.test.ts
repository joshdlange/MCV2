import assert from "node:assert/strict";
import { test, after } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, healthPool } from "../db";
import { cards, cardSets } from "../../shared/schema";
import { correctMasterpiecesBuybackCount, buybackCountRepair as config } from "../seeds/correctMasterpiecesBuybackCount";

after(async () => { await pool.end(); await healthPool.end(); });

test("count correction changes only the saved total and is idempotent", async () => {
  const rollback = new Error("test rollback");
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name=${config.marker}`);
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, config.slug));
    await tx.update(cardSets).set({ totalCards: 198 }).where(eq(cardSets.id, set.id));
    const before = await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id);
    assert.deepEqual(await correctMasterpiecesBuybackCount(tx), { applied: true, previousCount: 198, count: 99 });
    assert.deepEqual(await correctMasterpiecesBuybackCount(tx), { applied: false });
    const [updated] = await tx.select().from(cardSets).where(eq(cardSets.id, set.id));
    assert.equal(updated.totalCards, 99);
    assert.deepEqual(await tx.select().from(cards).where(eq(cards.setId, set.id)).orderBy(cards.id), before);
    throw rollback;
  }), error => error === rollback);
});
