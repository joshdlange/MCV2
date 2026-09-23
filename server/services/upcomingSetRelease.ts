import { db } from '../db';
import { upcomingSets, mainSets, cardSets, cards } from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { catalogSlug, isDueForPublication, validateChecklist } from '../../shared/upcomingRelease';

/** Staged cards exist only in private JSON, never in searchable catalog tables. */
export async function publishDueUpcomingSets(now = new Date()) {
  const candidates = await db.select().from(upcomingSets).where(sql`
    ${upcomingSets.isActive} = true AND ${upcomingSets.status} = 'upcoming'
    AND ${upcomingSets.dateConfidence} = 'confirmed'
    AND ${upcomingSets.stagedChecklist} IS NOT NULL
    AND ${upcomingSets.publishedMainSetId} IS NULL
    AND ${upcomingSets.releaseDateEstimated} <= ${now}
  `);
  let published = 0;
  for (const candidate of candidates) {
    if (!isDueForPublication(candidate, now)) continue;
    try {
      const changed = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-catalog-publication'))`);
        const [set] = await tx.select().from(upcomingSets).where(eq(upcomingSets.id, candidate.id)).for('update');
        if (!set || !isDueForPublication(set, now)) return false;
        const checklist = validateChecklist(set.stagedChecklist);
        const slug = catalogSlug(set.setName);
        if (!slug) throw new Error('Main set has no valid slug');
        const year = Number(set.setName.match(/\b(19|20)\d{2}\b/)?.[0]);
        if (!year) throw new Error('Main set name must include its year');
        const existing = await tx.select().from(mainSets).where(eq(mainSets.slug, slug));
        if (existing.length) throw new Error('Catalog set already exists; resolve the duplicate before release');
        const [main] = await tx.insert(mainSets).values({
          name: set.setName, slug, thumbnailImageUrl: set.thumbnailUrl,
          isActive: true, isCanonical: true, canonicalSource: 'confirmed_upcoming',
          createdAt: now,
        }).returning();
        for (const subset of checklist) {
          const [child] = await tx.insert(cardSets).values({
            name: subset.name, slug: `${slug}-${catalogSlug(subset.name)}`, year,
            mainSetId: main.id, isActive: true, isCanonical: true,
            canonicalSource: 'confirmed_upcoming', isInsertSubset: subset.isInsert,
            totalCards: subset.cards.length,
          }).returning();
          for (let offset = 0; offset < subset.cards.length; offset += 500) {
            await tx.insert(cards).values(subset.cards.slice(offset, offset + 500).map(c => ({
              setId: child.id, name: c.name, cardNumber: c.number, isInsert: subset.isInsert, rarity: 'Common',
            })));
          }
        }
        await tx.update(upcomingSets).set({
          status: 'released', isActive: false, publishedMainSetId: main.id,
          releaseError: null, updatedAt: now,
        }).where(eq(upcomingSets.id, set.id));
        return true;
      });
      if (changed) published++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Catalog publication failed';
      console.error(`[Upcoming publication] Set ${candidate.id}:`, message);
      await db.update(upcomingSets).set({ releaseError: message.slice(0, 500) }).where(eq(upcomingSets.id, candidate.id));
    }
  }
  return published;
}

let inFlight: Promise<number> | undefined;
// Coalesce concurrent requests, but do not cache over the release boundary.
export function upcomingPublicCatchup() {
  if (!inFlight) inFlight = publishDueUpcomingSets().finally(() => { inFlight = undefined; });
  return inFlight;
}