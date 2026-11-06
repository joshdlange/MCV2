import assert from 'node:assert/strict';
import test from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { mainSets, cardSets, cardSetMigrations, cards } from '../../shared/schema';
import { removeOwnerApprovedEmptySetsTx } from '../seeds/removeOwnerApprovedEmptySets';
import removals from '../seeds/data/owner-empty-set-removals.json';

async function fixtures(tx: Parameters<typeof removeOwnerApprovedEmptySetsTx>[0]) {
  for (const entry of removals) {
    await tx.insert(mainSets).values({name:entry.set,slug:entry.slug,isActive:false}).onConflictDoNothing();
  }
  for (const slug of ['marvel-1994-fleer-amazing-spider-man','2024-topps-star-wars-masterwork']) {
    const [main]=await tx.select().from(mainSets).where(eq(mainSets.slug,slug));
    if (!(await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id))).length) {
      await tx.insert(cardSets).values({name:'Test fixture',slug:`test-empty-cleanup-${slug}`,year:2024,mainSetId:main.id});
    }
  }
}

test('empty-set cleanup preserves history, leaves cards alone, and is repeat safe', async () => {
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL!==process.env.NEON_DATABASE_URL);
  assert.notEqual(process.env.NODE_ENV,'production');
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx=>{
    await fixtures(tx);
    const [main]=await tx.select().from(mainSets).where(eq(mainSets.slug,'marvel-1994-fleer-amazing-spider-man'));
    const [set]=await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    const [history]=await tx.insert(cardSetMigrations).values({legacySetId:set.id,canonicalSetId:set.id,confidence:100,reason:'test only'}).returning();
    const snapshot=async()=>(await tx.execute(sql`SELECT
      (SELECT count(*) FROM cards)::int cards,
      (SELECT count(*) FROM user_collections)::int collections,
      (SELECT coalesce(sum(quantity),0) FROM user_collections)::text quantity,
      (SELECT count(*) FROM user_wishlists)::int wishlists`)).rows;
    const before=await snapshot();
    const result=await removeOwnerApprovedEmptySetsTx(tx);
    assert.equal(result.deletedMainSets,49);
    assert.ok(result.preservedHistorySubsets>=1);
    const [preserved]=await tx.select().from(cardSets).where(eq(cardSets.id,set.id));
    assert.equal(preserved.mainSetId,null);assert.equal(preserved.isActive,false);
    assert.ok(preserved.archivedAt);
    assert.equal((await tx.select().from(cardSetMigrations).where(eq(cardSetMigrations.id,history.id))).length,1);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual(await removeOwnerApprovedEmptySetsTx(tx),{deletedMainSets:0,deletedSubsets:0,preservedHistorySubsets:0});
    throw new Rollback();
  }),e=>e instanceof Rollback);
});

test('cleanup refuses a newly populated candidate and rolls back earlier removals', async()=>{
  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL!==process.env.NEON_DATABASE_URL);
  assert.notEqual(process.env.NODE_ENV,'production');
  class Rollback extends Error {}
  await assert.rejects(db.transaction(async tx=>{
    await fixtures(tx);
    const [main]=await tx.select().from(mainSets).where(eq(mainSets.slug,'2024-topps-star-wars-masterwork'));
    const [set]=await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
    await tx.insert(cards).values({setId:set.id,name:'Safety fixture',cardNumber:'TEST',rarity:'Common'});
    await assert.rejects(tx.transaction(inner=>removeOwnerApprovedEmptySetsTx(inner)),/populated/);
    assert.equal((await tx.select().from(mainSets).where(eq(mainSets.slug,'1928-ogdens-marvels-of-motion'))).length,1);
    throw new Rollback();
  }),e=>e instanceof Rollback);
});
test.after(()=>pool.end());
