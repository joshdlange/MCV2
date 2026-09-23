import { db } from '../db';
import { upcomingSets } from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { validateChecklist, centralReleaseDate } from '../../shared/upcomingRelease';
import checklist from './data/topps-marvel-neon-2026.json';
import { isDeepStrictEqual } from 'node:util';

export function neonReconciliation(existing: { stagedChecklist: unknown; publishedMainSetId: number | null; thumbnailUrl: string | null }, data: unknown) {
  if (existing.publishedMainSetId) {
    if (!isDeepStrictEqual(existing.stagedChecklist, data)) throw new Error('Neon published checklist conflicts with supplied spreadsheet');
    return {};
  }
  if (existing.stagedChecklist != null && !isDeepStrictEqual(existing.stagedChecklist, data)) {
    throw new Error('Neon existing checklist conflicts with supplied spreadsheet');
  }
  return {
    ...(existing.stagedChecklist == null ? { stagedChecklist: data } : {}),
    ...(!existing.thumbnailUrl ? { thumbnailUrl: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1790183610/main-set-thumbnails/2026-topps-marvel-neon.png' } : {}),
  };
}

export async function stageToppsNeon2026() {
  const data = validateChecklist(checklist);
  if (data.length !== 67 || data.reduce((n, s) => n + s.cards.length, 0) !== 5690) throw new Error('Neon checklist count mismatch');
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-candidate-approval'))`);
    const marker = 'stage_topps_marvel_neon_2026';
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    if ((await tx.execute(sql`SELECT name FROM startup_migrations WHERE name = ${marker}`)).rows.length) return;
    const name = '2026 Topps Marvel Neon';
    const existing = await tx.select().from(upcomingSets).where(sql`
      lower(trim(${upcomingSets.setName})) = lower(${name})
      OR ${upcomingSets.sourceUrl} = 'internal://owner-confirmed/2026-topps-marvel-neon'
    `).for('update');
    if (existing.length > 1) throw new Error('Multiple Neon upcoming records require reconciliation');
    if (existing.length) {
      if (existing[0].setName.trim().toLowerCase() !== name.toLowerCase()) throw new Error('Neon source URL belongs to another product');
      const updates = neonReconciliation(existing[0], data);
      if (Object.keys(updates).length) await tx.update(upcomingSets).set(updates).where(eq(upcomingSets.id, existing[0].id));
    } else await tx.insert(upcomingSets).values({
      setName: name, manufacturer: 'Topps',
      sourceUrl: 'internal://owner-confirmed/2026-topps-marvel-neon',
      releaseDateEstimated: centralReleaseDate('2026-10-14'),
      dateConfidence: 'confirmed', status: 'upcoming', isActive: true,
      thumbnailUrl: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1790183610/main-set-thumbnails/2026-topps-marvel-neon.png',
      keyHighlights: '5,690 checklist entries across 67 subsets. Releases October 14, 2026.',
      stagedChecklist: data,
    });
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${marker})`);
  });
}