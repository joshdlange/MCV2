import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';

const parentSlug = 'marvel-1992-comic-images-ghost-rider-ii';
const subsetSlug = `${parentSlug}-glow-in-the-dark`;
const marker = 'import_ghost_rider_ii_glow_1992';
export const ghostRiderGlowChecklist = [
  'Illuminating', 'Vigilantes', 'My Arsenal', 'Power Source', 'Wolverine',
  'The Flames', 'Punisher', 'Hot Air', 'Cable', 'Grin and Bear It',
].map((name, index) => ({ number: `G${index + 1}`, name }));

/** Add only the customer-reported subset; preserve all existing base cards and images. */
export async function importGhostRiderIIGlow1992(database: Pick<typeof db, 'transaction'> = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { imported: false };
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, parentSlug));
    if (!main || main.name.trim() !== 'Marvel 1992 Comic Images Ghost Rider II' ||
        !main.isActive || main.archivedAt) throw new Error('Ghost Rider II parent identity conflict');
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    if (children.some(s => /glow/i.test(s.name) && s.slug !== subsetSlug))
      throw new Error('Ghost Rider II already has an alternate glow subset; review required');
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, subsetSlug));
    if (set && (set.mainSetId !== main.id || set.name !== 'Glow In the Dark' ||
        set.year !== 1992 || !set.isInsertSubset || !set.isActive || set.archivedAt))
      throw new Error('Ghost Rider II glow subset identity conflict');
    if (!set) {
      [set] = await tx.insert(cardSets).values({
        mainSetId: main.id, name: 'Glow In the Dark', slug: subsetSlug, year: 1992,
        totalCards: 10, isInsertSubset: true, isActive: true, isCanonical: true,
        canonicalSource: 'owner_checklist',
      }).returning();
    }
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const card of existing) {
      const expected = ghostRiderGlowChecklist.find(c => c.number === card.cardNumber);
      if (!expected || card.name !== expected.name || seen.has(card.cardNumber) ||
          !card.isInsert || card.archivedAt) throw new Error(`Ghost Rider glow card conflict: ${card.cardNumber}`);
      seen.add(card.cardNumber);
    }
    const missing = ghostRiderGlowChecklist.filter(c => !seen.has(c.number));
    if (missing.length) await tx.insert(cards).values(missing.map(c => ({
      setId: set.id, cardNumber: c.number, name: c.name, isInsert: true, rarity: 'Insert',
    })));
    await tx.update(cardSets).set({ totalCards: 10 }).where(eq(cardSets.id, set.id));
    const final = await tx.select().from(cards).where(eq(cards.setId, set.id));
    if (final.length !== 10) throw new Error('Ghost Rider glow final count mismatch');
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: 'card_set', entityId: set.id, entityName: 'Glow In the Dark',
      notes: JSON.stringify({ source: 'Owner-supplied customer checklist', inserted: missing.length }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { imported: true, inserted: missing.length, setId: set.id };
  });
}
