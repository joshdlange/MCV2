import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets } from '../../shared/schema';

export const legendsThumbnail = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793991785/owner-catalog/legends-of-marvel-2011-2013-thumbnail.png';

export async function seedLegendsThumbnails() {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('legends_owner_thumbnails'))`);
    let updated = 0;
    for (const year of [2011, 2012, 2013]) {
      const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, `${year}-rittenhouse-legends-of-marvel`));
      if (!main || !main.isActive || main.archivedAt) throw new Error(`Missing active Legends ${year} main set`);
      // Fill the new sets; never undo a later admin thumbnail replacement.
      if (!main.thumbnailImageUrl) {
        await tx.update(mainSets).set({ thumbnailImageUrl: legendsThumbnail }).where(eq(mainSets.id, main.id));
        updated++;
      }
    }
    return { updated };
  });
}
