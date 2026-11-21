import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { db, pool, healthPool } from '../db';
import { upcomingSets } from '../../shared/schema';
import { isDueForPublication } from '../../shared/upcomingRelease';
import { updateOwnerUpcomingPreviews, upcomingPreviewUpdate as config } from '../seeds/updateOwnerUpcomingPreviews';

after(async () => { await pool.end(); await healthPool.end(); });

test('owner previews preserve other releases and never publish an absent checklist', async () => {
  const rollback = new Error('rollback');
  await assert.rejects(db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM startup_migrations WHERE name = ${config.marker}`);
    const before = await tx.select().from(upcomingSets).orderBy(upcomingSets.id);
    assert.equal(await updateOwnerUpcomingPreviews(tx), true);
    const after = await tx.select().from(upcomingSets).orderBy(upcomingSets.id);
    const rally = after.find(row => row.setName === config.rallyName)!;
    assert.equal(rally.thumbnailUrl, config.rallyImage);
    assert.equal(rally.releaseDateEstimated?.toISOString(), '2026-11-30T06:00:00.000Z');
    assert.equal(rally.stagedChecklist, null);
    assert.equal(rally.isActive, true);
    assert.equal(isDueForPublication(rally, new Date('2026-12-01')), false);
    for (const row of before.filter(row => row.setName !== config.rallyName)) {
      const updated = after.find(other => other.id === row.id)!;
      if (row.setName === config.studiosName) {
        assert.equal(updated.thumbnailUrl, config.studiosImage);
        assert.deepEqual({ ...updated, thumbnailUrl: row.thumbnailUrl, updatedAt: row.updatedAt }, row);
      } else assert.deepEqual(updated, row);
    }
    await tx.update(upcomingSets).set({ thumbnailUrl: 'manual-later-edit' }).where(eq(upcomingSets.id, rally.id));
    assert.equal(await updateOwnerUpcomingPreviews(tx), false);
    assert.equal((await tx.select().from(upcomingSets).where(eq(upcomingSets.id, rally.id)))[0].thumbnailUrl, 'manual-later-edit');
    throw rollback;
  }), error => error === rollback);
});
