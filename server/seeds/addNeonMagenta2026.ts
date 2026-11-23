import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';

export const magentaImage = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795445477/image-admin/catalog-imports/2026-neon-magenta-carnage-97.png';
export const magentaSlug = '2026-topps-marvel-neon-magenta-costco-exclusive';
export async function addNeonMagenta2026(database: Pick<typeof db, 'transaction'> = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-catalog-publication'))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('repair_topps_neon_2026'))`);
    const marker = 'owner_neon_magenta_costco_2026';
    if ((await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`)).rows.length) return false;
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, '2026-topps-marvel-neon'));
    // The upcoming checklist may not have been published in this environment yet.
    if (!main) return false;
    const [base] = await tx.select().from(cardSets).where(eq(cardSets.slug, '2026-topps-marvel-neon-base'));
    if (!base || base.mainSetId !== main.id || base.year !== 2026 || base.archivedAt) throw new Error('Neon base identity mismatch');
    const source = await tx.select().from(cards).where(eq(cards.setId, base.id));
    if (source.length !== 200 || new Set(source.map(c => c.cardNumber)).size !== 200 ||
      source.some(c => c.archivedAt) || !Array.from({ length: 200 }, (_, i) => String(i + 1)).every(n => source.some(c => c.cardNumber === n)) ||
      source.find(c => c.cardNumber === '97')?.name.toLowerCase() !== 'carnage') throw new Error('Neon base checklist mismatch');
    const existing = await tx.select().from(cardSets).where(sql`${cardSets.slug}=${magentaSlug}
      OR (${cardSets.mainSetId}=${main.id} AND ${cardSets.name} ILIKE '%magenta%')`);
    if (existing.length) throw new Error('Magenta already exists; reconcile instead of duplicating');
    const [subset] = await tx.insert(cardSets).values({
      name: 'Magenta (Costco exclusive)', slug: magentaSlug, year: 2026,
      mainSetId: main.id, totalCards: 200, isActive: true, isCanonical: true,
      isInsertSubset: true, canonicalSource: 'owner_checklist', imageUrl: magentaImage,
    }).returning();
    await tx.insert(cards).values(source.map(c => ({
      setId: subset.id, cardNumber: c.cardNumber, name: c.name, rarity: 'Common', isInsert: true,
      frontImageUrl: c.cardNumber === '97' ? magentaImage : null,
    })));
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${marker})`);
    return true;
  });
}
