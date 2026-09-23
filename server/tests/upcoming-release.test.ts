import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centralReleaseDate, isDueForPublication, validateChecklist, catalogSlug } from '../../shared/upcomingRelease';
import { parseUpcomingChecklist } from '../../client/src/lib/upcomingChecklistCsv';
import { publicUpcomingSet, validateUpcomingAdminWrite } from '../../shared/upcomingAdmin';
import { initializeUpcomingLifecycle } from '../services/upcomingLifecycle';

test('initial staging/publication failures cannot disable scheduled retries or discovery', async () => {
  let retry: (() => Promise<void>) | undefined;
  const attempts: string[] = [];
  let initial = true;
  await initializeUpcomingLifecycle({
    stage: async () => { attempts.push('stage'); if (initial) throw new Error('staging unavailable'); },
    publish: async () => { attempts.push('publish'); if (initial) throw new Error('database unavailable'); },
    discover: async () => { attempts.push('discover'); },
    report: phase => { attempts.push(`failed:${phase}`); },
  }, run => { attempts.push('scheduled'); retry = run; });
  assert.deepEqual(attempts, ['scheduled', 'stage', 'failed:stage', 'publish', 'failed:publish', 'discover']);
  initial = false;
  await retry!();
  assert.deepEqual(attempts.slice(-3), ['stage', 'publish', 'discover']);
});

test('admin validation rejects bad scalars, blank/no-year names and invalid merged updates', () => {
  const valid = { setName: '2026 Topps Test', sourceUrl: 'https://example.com/release' };
  for (const patch of [
    { setName: '' }, { setName: '   ' }, { setName: 'No year' }, { setName: 2026 },
    { sourceUrl: {} }, { sourceUrl: [] }, { sourceUrl: 'javascript:alert(1)' },
    { isActive: 'false' }, { releaseDateEstimated: '2026-02-30' },
    { dateConfidence: 'confirmed', releaseDateEstimated: null },
  ]) assert.throws(() => validateUpcomingAdminWrite({ ...valid, ...patch }));
  const existing = validateUpcomingAdminWrite({ ...valid, dateConfidence: 'confirmed', releaseDateEstimated: '2026-10-14' });
  assert.throws(() => validateUpcomingAdminWrite({ releaseDateEstimated: null }, existing));
  const updated = validateUpcomingAdminWrite({ status: 'delayed' }, existing);
  assert.equal(updated.setName, valid.setName);
  assert.equal(updated.releaseDateEstimated?.toISOString(), '2026-10-14T05:00:00.000Z');
});

test('public upcoming serializer strips staged JSON, source and internal errors', () => {
  const staged = [{ name: 'secret staged card' }];
  const response = JSON.parse(JSON.stringify(publicUpcomingSet({
    id: 1, setName: '2026 Topps Test', stagedChecklist: staged,
    sourceUrl: 'internal://owner', releaseError: 'private diagnostic',
  })));
  assert.deepEqual(response, { id: 1, setName: '2026 Topps Test', checklistReady: true });
});

test('Central midnight is correct at release, winter, and DST transition boundaries', () => {
  assert.equal(centralReleaseDate('2026-10-14').toISOString(), '2026-10-14T05:00:00.000Z');
  assert.equal(centralReleaseDate('2026-01-14').toISOString(), '2026-01-14T06:00:00.000Z');
  assert.equal(centralReleaseDate('2026-03-08').toISOString(), '2026-03-08T06:00:00.000Z');
  assert.equal(centralReleaseDate('2026-11-01').toISOString(), '2026-11-01T05:00:00.000Z');
  for (const value of ['2026-02-30', 'tomorrow', '2026-10-14T00:00:00Z']) assert.throws(() => centralReleaseDate(value));
});

test('before, exact boundary, missed scheduler catchup and all publication guards', () => {
  const set = { status: 'upcoming', isActive: true, dateConfidence: 'confirmed',
    releaseDateEstimated: centralReleaseDate('2026-10-14'), stagedChecklist: [{}], publishedMainSetId: null };
  assert.equal(isDueForPublication(set, new Date('2026-10-14T04:59:59Z')), false);
  assert.equal(isDueForPublication(set, new Date('2026-10-14T05:00:00Z')), true);
  assert.equal(isDueForPublication(set, new Date('2026-10-16T05:00:00Z')), true);
  for (const patch of [{ status: 'delayed' }, { status: 'released' }, { dateConfidence: 'estimated' },
    { stagedChecklist: null }, { publishedMainSetId: 1 }, { isActive: false }, { releaseDateEstimated: null }]) {
    assert.equal(isDueForPublication({ ...set, ...patch }, new Date('2026-10-16')), false);
  }
});

test('Neon staged data exactly preserves uploaded spreadsheet and insert flags', () => {
  const source = parseUpcomingChecklist(readFileSync('attached_assets/2026_Topps_Neon_-_Sheet1_(1)_1790181982173.csv', 'utf8'));
  const bundled = JSON.parse(readFileSync('server/seeds/data/topps-marvel-neon-2026.json', 'utf8'));
  assert.deepEqual(source, bundled);
  assert.equal(source.length, 67);
  assert.equal(source.reduce((n, s) => n + s.cards.length, 0), 5690);
});

test('reject duplicate cards, conflicting subset slugs, malformed CSV', () => {
  const subset = { name: 'Base', isInsert: false, cards: [{ number: '1', name: 'Iron Man' }] };
  assert.throws(() => validateChecklist([{ ...subset, cards: [...subset.cards, ...subset.cards] }]));
  assert.throws(() => validateChecklist([subset, { ...subset, name: 'Base!' }]));
  assert.throws(() => parseUpcomingChecklist('Subset,Card Number,Card Name,Is Insert\nBase,1,Iron Man,maybe'));
});

test('real DB: atomic publication, concurrent idempotency, rollback after partial insert', { skip: !process.env.TEST_UPCOMING_DB }, async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Development test only');
  const { db, pool, healthPool } = await import('../db');
  const { upcomingSets, mainSets, cardSets, cards, upcomingSetCandidates, setIntelScanLogs } = await import('../../shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { publishDueUpcomingSets } = await import('../services/upcomingSetRelease');
  const suffix = Date.now();
  const name = `1999 Upcoming Test ${suffix}`;
  const failureName = `1999 Upcoming Failure ${suffix}`;
  const checklist = [{ name: 'Base', isInsert: false, cards: [{ number: '1', name: 'Iron Man' }] }];
  const due = new Date('1999-01-01T06:00:00Z');
  let upcomingIds: number[] = [];
  let blockerId: number | undefined;
  try {
    const { saveUpcomingSet } = await import('../services/upcomingAdmin');
    const adminInput = { setName: `1999 Admin Test ${suffix}`, sourceUrl: `https://example.com/admin-${suffix}` };
    const concurrent = await Promise.allSettled([saveUpcomingSet(adminInput), saveUpcomingSet(adminInput)]);
    const successful = concurrent.filter(r => r.status === 'fulfilled');
    assert.equal(successful.length, 1);
    for (const result of successful) {
      if (result.status === 'fulfilled' && result.value) upcomingIds.push(result.value.id);
    }
    await assert.rejects(saveUpcomingSet({ ...adminInput, setName: `1999 Other ${suffix}` }));
    await assert.rejects(saveUpcomingSet({ setName: ' ' }, upcomingIds[0]));
    const another = await saveUpcomingSet({ setName: `1999 Other ${suffix}`, sourceUrl: `https://example.com/other-${suffix}` });
    upcomingIds.push(another!.id);
    await assert.rejects(saveUpcomingSet({ setName: adminInput.setName }, another!.id));
    const { neonReconciliation } = await import('../seeds/stageToppsNeon2026');
    const equivalent = { stagedChecklist: checklist, publishedMainSetId: null, thumbnailUrl: 'https://example.com/admin-image',
      status: 'delayed', releaseDateEstimated: new Date('2026-11-01T05:00:00Z') };
    assert.deepEqual(neonReconciliation(equivalent, checklist), {});
    assert.deepEqual({ ...equivalent, ...neonReconciliation(equivalent, checklist) }, equivalent);
    assert.deepEqual(neonReconciliation({ ...equivalent, stagedChecklist: null }, checklist), { stagedChecklist: checklist });
    assert.throws(() => neonReconciliation({ ...equivalent, stagedChecklist: [] }, checklist));
    const entries = await db.insert(upcomingSets).values([name, failureName].map(setName => ({
      setName, sourceUrl: `internal://test/${setName}`, dateConfidence: 'confirmed',
      status: 'upcoming', isActive: true, releaseDateEstimated: due, stagedChecklist: checklist,
    }))).returning();
    const publicationIds = entries.map(e => e.id);
    upcomingIds.push(...publicationIds);
    const [blocker] = await db.insert(cardSets).values({
      name: 'Test blocker', slug: `${catalogSlug(failureName)}-base`, year: 1999,
    }).returning();
    blockerId = blocker.id;
    await publishDueUpcomingSets(new Date(due.getTime() - 1));
    assert.equal((await db.select().from(mainSets).where(eq(mainSets.slug, catalogSlug(name)))).length, 0);
    await Promise.all([publishDueUpcomingSets(due), publishDueUpcomingSets(due)]);
    const [published] = await db.select().from(upcomingSets).where(eq(upcomingSets.id, publicationIds[0]));
    assert.equal(published.status, 'released');
    assert.equal(published.isActive, false);
    assert.ok(published.publishedMainSetId);
    const matches = await db.select().from(mainSets).where(eq(mainSets.slug, catalogSlug(name)));
    assert.equal(matches.length, 1);
    const children = await db.select().from(cardSets).where(eq(cardSets.mainSetId, matches[0].id));
    assert.equal(children.length, 1);
    assert.equal((await db.select().from(cards).where(eq(cards.setId, children[0].id))).length, 1);
    assert.equal((await db.select().from(mainSets).where(eq(mainSets.slug, catalogSlug(failureName)))).length, 0);
    const [failed] = await db.select().from(upcomingSets).where(eq(upcomingSets.id, publicationIds[1]));
    assert.equal(failed.status, 'upcoming');
    assert.ok(failed.releaseError);
    const { runSetIntelScan, normalizeSetName } = await import('../services/setIntelligence');
    const discoveredName = `2027 Topps Marvel Test Discovery ${suffix} Trading Cards`;
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        if (String(url).includes('cardlines')) throw new Error('Test source unavailable');
        return new Response(`<rss><channel><item><title>${discoveredName}</title><link>https://example.com/test-${suffix}</link><description>Marvel trading card checklist announcement.</description></item></channel></rss>`);
      };
      const first = await runSetIntelScan({ dryRun: false, trigger: `test-${suffix}` });
      const second = await runSetIntelScan({ dryRun: false, trigger: `test-${suffix}` });
      assert.equal(first.candidatesCreated, 1);
      assert.equal(second.candidatesCreated, 0);
      assert.ok(first.sources.some(s => !s.ok && s.error));
      const [candidate] = await db.select().from(upcomingSetCandidates)
        .where(eq(upcomingSetCandidates.normalizedName, normalizeSetName(discoveredName)));
      assert.ok(candidate);
      assert.notEqual(candidate.status, 'approved');
      assert.equal(candidate.estimatedReleaseDate, null);
      assert.equal(candidate.approvedUpcomingSetId, null);
      assert.equal((await db.select().from(upcomingSets).where(eq(upcomingSets.setName, discoveredName))).length, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await db.delete(upcomingSetCandidates).where(eq(upcomingSetCandidates.normalizedName, normalizeSetName(discoveredName)));
      await db.delete(setIntelScanLogs).where(eq(setIntelScanLogs.trigger, `test-${suffix}`));
    }
  } finally {
    for (const id of upcomingIds) await db.delete(upcomingSets).where(eq(upcomingSets.id, id));
    for (const n of [name, failureName]) {
      const ms = await db.select().from(mainSets).where(eq(mainSets.slug, catalogSlug(n)));
      for (const m of ms) {
        const children = await db.select().from(cardSets).where(eq(cardSets.mainSetId, m.id));
        for (const child of children) await db.delete(cards).where(eq(cards.setId, child.id));
        await db.delete(cardSets).where(eq(cardSets.mainSetId, m.id));
        await db.delete(mainSets).where(eq(mainSets.id, m.id));
      }
    }
    if (blockerId) await db.delete(cardSets).where(eq(cardSets.id, blockerId));
    await pool.end(); await healthPool.end();
  }
});