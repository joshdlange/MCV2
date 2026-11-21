import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { upcomingSets } from '../../shared/schema';
import { centralReleaseDate } from '../../shared/upcomingRelease';

export const upcomingPreviewUpdate = {
  marker: 'owner_spider_rally_and_studios_previews_2026',
  rallyName: '2026 CardFun Marvel Spider Rally',
  studiosName: '2026 Topps Chrome Marvel Studios',
  rallyImage: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795293075/upcoming-set-thumbnails/2026-cardfun-marvel-spider-rally.png',
  studiosImage: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795293076/upcoming-set-thumbnails/2026-topps-chrome-marvel-studios.png',
};

export async function updateOwnerUpcomingPreviews(database: Pick<typeof db, 'transaction'> = db) {
  return database.transaction(async tx => {
    const config = upcomingPreviewUpdate;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-candidate-approval'))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${config.marker}))`);
    if ((await tx.execute(sql`SELECT name FROM startup_migrations WHERE name = ${config.marker}`)).rows.length) return false;
    const studios = await tx.select().from(upcomingSets)
      .where(sql`lower(trim(${upcomingSets.setName})) = lower(${config.studiosName})`).for('update');
    if (studios.length !== 1) throw new Error('Expected one Topps Chrome Marvel Studios announcement');
    const rally = await tx.select().from(upcomingSets)
      .where(sql`lower(trim(${upcomingSets.setName})) = lower(${config.rallyName})
        OR ${upcomingSets.sourceUrl} = 'internal://owner-confirmed/2026-cardfun-marvel-spider-rally'`).for('update');
    if (rally.length > 1 || (rally[0] && (rally[0].publishedMainSetId ||
      rally[0].setName.trim().toLowerCase() !== config.rallyName.toLowerCase()))) {
      throw new Error('Spider Rally announcement needs reconciliation');
    }
    const values = {
      setName: config.rallyName, manufacturer: 'CardFun',
      releaseDateEstimated: centralReleaseDate('2026-11-30'),
      dateConfidence: 'confirmed' as const, status: 'upcoming' as const,
      isActive: true, thumbnailUrl: config.rallyImage, updatedAt: new Date(),
    };
    if (rally[0]) {
      await tx.update(upcomingSets).set(values).where(eq(upcomingSets.id, rally[0].id));
    } else {
      await tx.insert(upcomingSets).values({
        ...values,
        sourceUrl: 'internal://owner-confirmed/2026-cardfun-marvel-spider-rally',
        keyHighlights: 'Checklist not yet available.',
      });
    }
    await tx.update(upcomingSets).set({ thumbnailUrl: config.studiosImage, updatedAt: new Date() })
      .where(eq(upcomingSets.id, studios[0].id));
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${config.marker})`);
    return true;
  });
}
