import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';
import checklist from './data/fox-kids-1995.json';

const slug = '1995-fleer-ultra-fox-kids-network';
const name = '1995 Fleer Ultra Fox Kids Network';
const marker = 'import_fox_kids_1995';
const box = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1792445487/image-admin/catalog-imports/1995-fox-kids/mrmjmvrmqnnmtnucktfv.png';
const wolverine = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1792445490/image-admin/catalog-imports/1995-fox-kids/o3wn1aut6yrdbv6gb7kx.png';
const subsets = [
  { name: 'Base', suffix: 'base', count: 150, isInsert: false },
  { name: 'Power Popup', suffix: 'power-popup', count: 24, isInsert: true },
  { name: 'Suspended Animation Cels', suffix: 'suspended-animation-cels', count: 10, isInsert: true },
];

/** Add only the supplied checklist; conflicting catalog identities/images abort atomically. */
export async function importFoxKids1995(database: Pick<typeof db, 'transaction'> = db) {
  if (checklist.length !== 184) throw new Error('Fox Kids checklist size mismatch');
  for (const subset of subsets) {
    const rows = checklist.filter(c => c.subset === subset.name);
    if (rows.length !== subset.count || rows.some((c, i) =>
      c.number !== String(i + 1) || !c.name || c.isInsert !== subset.isInsert))
      throw new Error(`Fox Kids checklist mismatch: ${subset.name}`);
  }
  if (checklist.find(c => c.subset === 'Base' && c.number === '91')?.name !== 'Wolverine')
    throw new Error('Fox Kids Wolverine identity mismatch');
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { imported: false };
    const matches = await tx.select().from(mainSets)
      .where(sql`${mainSets.slug}=${slug} OR lower(${mainSets.name})=lower(${name})`);
    if (matches.length > 1) throw new Error('Fox Kids duplicate main sets');
    let main = matches[0];
    if (!main) [main] = await tx.insert(mainSets).values({ name, slug }).returning();
    if (main.slug !== slug || main.name !== name || !main.isActive || main.archivedAt ||
      (main.thumbnailImageUrl && main.thumbnailImageUrl !== box))
      throw new Error('Fox Kids main-set identity/image conflict');
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    if (children.some(s => !subsets.some(expected => expected.name === s.name)))
      throw new Error('Fox Kids unexpected subset');
    let inserted = 0;
    for (const subset of subsets) {
      const matches = children.filter(s => s.name === subset.name);
      if (matches.length > 1) throw new Error(`Fox Kids duplicate subset: ${subset.name}`);
      let set = matches[0];
      if (!set) [set] = await tx.insert(cardSets).values({
        name: subset.name, slug: `${slug}-${subset.suffix}`, year: 1995,
        mainSetId: main.id, isInsertSubset: subset.isInsert, totalCards: subset.count,
      }).returning();
      if (set.slug !== `${slug}-${subset.suffix}` || set.year !== 1995 ||
        !set.isActive || set.archivedAt || set.isInsertSubset !== subset.isInsert ||
        (subset.name === 'Base' && set.imageUrl && set.imageUrl !== wolverine))
        throw new Error(`Fox Kids subset identity/image conflict: ${subset.name}`);
      const expected = checklist.filter(c => c.subset === subset.name);
      const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
      const seen = new Set<string>();
      for (const card of existing) {
        const row = expected.find(c => c.number === card.cardNumber);
        if (!row || seen.has(card.cardNumber) || card.name !== row.name ||
          card.isInsert !== row.isInsert || card.archivedAt)
          throw new Error(`Fox Kids card conflict: ${subset.name} #${card.cardNumber}`);
        seen.add(card.cardNumber);
      }
      const missing = expected.filter(c => !seen.has(c.number));
      if (missing.length) await tx.insert(cards).values(missing.map(c => ({
        setId: set.id, cardNumber: c.number, name: c.name, isInsert: c.isInsert, rarity: 'Common',
      })));
      inserted += missing.length;
      if (subset.name === 'Base') {
        const [card] = await tx.select().from(cards)
          .where(sql`${cards.setId}=${set.id} AND ${cards.cardNumber}='91'`);
        if (!card || (card.frontImageUrl && card.frontImageUrl !== wolverine))
          throw new Error('Fox Kids Wolverine image conflict');
        if (!card.frontImageUrl) {
          const updated = await tx.update(cards).set({ frontImageUrl: wolverine })
            .where(sql`${cards.id}=${card.id} AND ${cards.frontImageUrl} IS NULL`).returning();
          if (updated.length !== 1) throw new Error('Fox Kids image changed during import');
          await tx.insert(adminAuditLogs).values({
            actionType: 'card_image_update', entityType: 'card', entityId: card.id,
            entityName: 'Wolverine #91',
            notes: JSON.stringify({ source: marker, attachment: 'image_1792445405888.png',
              sides: ['front'], oldFrontImageUrl: null, newFrontImageUrl: wolverine }),
          });
        }
      }
      await tx.update(cardSets).set({
        totalCards: subset.count, ...(subset.name === 'Base' ? { imageUrl: wolverine } : {}),
      }).where(eq(cardSets.id, set.id));
      const final = await tx.select().from(cards).where(eq(cards.setId, set.id));
      if (final.length !== expected.length || final.some(c => c.archivedAt ||
        !expected.some(e => e.number === c.cardNumber && e.name === c.name && e.isInsert === c.isInsert)))
        throw new Error(`Fox Kids final validation failed: ${subset.name}`);
    }
    await tx.update(mainSets).set({ thumbnailImageUrl: box }).where(eq(mainSets.id, main.id));
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: 'main_set', entityId: main.id, entityName: name,
      notes: JSON.stringify({
        source: '1995_Fleer_Ultra_Fox_Kids_Network_-_Sheet2_1792445418158.csv',
        subsets: 3, cards: 184, inserted,
      }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { imported: true, inserted, mainSetId: main.id };
  });
}
