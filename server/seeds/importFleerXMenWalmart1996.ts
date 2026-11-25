import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';
import checklist from './data/fleer-x-men-walmart-1996.json';

export const fleerXMenWalmart1996 = {
  name: '1996 Fleer X-Men (Walmart Exclusive)',
  slug: '1996-fleer-x-men-walmart-exclusive',
  baseSlug: '1996-fleer-x-men-walmart-exclusive-base',
  marker: 'import_fleer_x_men_walmart_1996',
  thumbnail: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795628673/image-admin/catalog-imports/1996-fleer-x-men-walmart-thumbnail.png',
  archangel: 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795628674/image-admin/catalog-imports/1996-fleer-x-men-walmart-archangel-1.png',
};

/** Add-only owner checklist import; once complete, later admin edits are preserved. */
export async function importFleerXMenWalmart1996(database: Pick<typeof db, 'transaction'> = db) {
  const config = fleerXMenWalmart1996;
  if (checklist.length !== 100 || checklist.some((c, i) => c.number !== String(i + 1)) ||
      checklist[0].name !== 'Archangel') throw new Error('Fleer X-Men Walmart checklist mismatch');
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${config.marker}))`);
    if ((await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${config.marker}`)).rows.length)
      return { imported: false };

    let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, config.slug));
    if (main && (main.name !== config.name || !main.isActive || main.archivedAt ||
        (main.thumbnailImageUrl && main.thumbnailImageUrl !== config.thumbnail)))
      throw new Error('Fleer X-Men Walmart master identity/image conflict');
    if (!main) [main] = await tx.insert(mainSets).values({
      name: config.name, slug: config.slug, thumbnailImageUrl: config.thumbnail,
      isActive: true, isCanonical: true, canonicalSource: 'owner_checklist',
    }).returning();

    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    let base = children.find(s => s.slug === config.baseSlug);
    if (children.length > (base ? 1 : 0) || (base && (base.name !== 'Base' || base.year !== 1996 ||
        !base.isActive || base.archivedAt || base.isInsertSubset ||
        (base.imageUrl && base.imageUrl !== config.archangel))))
      throw new Error('Fleer X-Men Walmart subset identity/image conflict');
    if (!base) [base] = await tx.insert(cardSets).values({
      name: 'Base', slug: config.baseSlug, year: 1996, mainSetId: main.id,
      imageUrl: config.archangel, totalCards: 100, isActive: true,
      isCanonical: true, isInsertSubset: false, canonicalSource: 'owner_checklist',
    }).returning();

    const existing = await tx.select().from(cards).where(eq(cards.setId, base.id));
    const seen = new Set<string>();
    for (const card of existing) {
      const expected = checklist.find(c => c.number === card.cardNumber);
      if (!expected || seen.has(card.cardNumber) || card.name !== expected.name || card.isInsert || card.archivedAt)
        throw new Error(`Fleer X-Men Walmart card identity conflict: ${card.cardNumber}`);
      seen.add(card.cardNumber);
    }
    const missing = checklist.filter(c => !seen.has(c.number));
    if (missing.length) await tx.insert(cards).values(missing.map(c => ({
      setId: base.id, cardNumber: c.number, name: c.name, description: c.description,
      rarity: 'Common', isInsert: false,
      frontImageUrl: c.number === '1' ? config.archangel : null,
    })));

    const [archangel] = await tx.select().from(cards).where(sql`${cards.setId}=${base.id} AND ${cards.cardNumber}='1'`);
    if (!archangel || (archangel.frontImageUrl && archangel.frontImageUrl !== config.archangel))
      throw new Error('Fleer X-Men Walmart Archangel image conflict');
    if (!archangel.frontImageUrl) await tx.update(cards).set({ frontImageUrl: config.archangel })
      .where(eq(cards.id, archangel.id));
    await tx.update(cardSets).set({ totalCards: 100, imageUrl: config.archangel }).where(eq(cardSets.id, base.id));

    const final = await tx.select().from(cards).where(eq(cards.setId, base.id));
    if (final.length !== 100 || final.some(c => c.isInsert || c.archivedAt) ||
        final.filter(c => c.frontImageUrl).length !== 1)
      throw new Error('Fleer X-Men Walmart final validation failed');
    await tx.insert(adminAuditLogs).values([
      { actionType: 'card_image_update', entityType: 'card', entityId: archangel.id, entityName: 'Archangel #1',
        notes: JSON.stringify({ source: config.marker, attachment: 'image_1795628624918.png', sides: ['front'],
          oldFrontImageUrl: null, newFrontImageUrl: config.archangel }) },
      { actionType: config.marker, entityType: 'main_set', entityId: main.id, entityName: config.name,
        notes: JSON.stringify({ source: 'Owner-supplied 100-card base checklist', inserted: missing.length,
          thumbnailAttachment: 'image_1795628562228.png' }) },
    ]);
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${config.marker})`);
    return { imported: true, inserted: missing.length, mainSetId: main.id, setId: base.id };
  });
}
