import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';

const slug = '1993-marvel-comics-crossover-checklists';
const name = '1993 Marvel Comics Crossover Checklists';
const marker = 'import_crossover_checklists_1993';
const note = 'Promotional cards given out at comic shops, rather than a conventional packaged card set.';
const carnage = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795024543/image-admin/catalog-imports/1993-crossover-checklists/u71wgzeq2gcm6yv0wqzt.png';
const back = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795024546/image-admin/catalog-imports/1993-crossover-checklists/qu4ft0txyn4a7ixu1en4.png';
const blood = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1795024547/image-admin/catalog-imports/1993-crossover-checklists/hz61nbetypofpn2gginf.png';
export const crossover1993Checklist = [
  'Blood and Thunder', 'Bloodties', 'Magneto', 'Maximum Carnage', 'The Infinity Crusade',
].map((name, i) => ({ number: String(i + 1), name }));

/** Owner-supplied checklist and byte-uploaded images; never overwrite existing imagery. */
export async function importCrossoverChecklists1993(database: Pick<typeof db, 'transaction'> = db) {
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { imported: false };
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, slug));
    if (!main || main.name !== name || !main.isActive || main.archivedAt ||
        (main.thumbnailImageUrl && main.thumbnailImageUrl !== blood))
      throw new Error('Crossover Checklists main-set identity/image conflict');
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    const set = children[0];
    if (children.length !== 1 || !set.isActive || set.archivedAt || set.year !== 1993 ||
        set.isInsertSubset || !['Base', `${name} - ${name}`].includes(set.name) ||
        (set.imageUrl && set.imageUrl !== carnage))
      throw new Error('Crossover Checklists base identity/image conflict');
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const card of existing) {
      const expected = crossover1993Checklist.find(c => c.number === card.cardNumber);
      if (!expected || seen.has(card.cardNumber) || card.name !== expected.name || card.isInsert || card.archivedAt)
        throw new Error(`Crossover Checklists card conflict: ${card.cardNumber}`);
      seen.add(card.cardNumber);
    }
    const missing = crossover1993Checklist.filter(c => !seen.has(c.number));
    if (missing.length) await tx.insert(cards).values(missing.map(c => ({
      setId: set.id, cardNumber: c.number, name: c.name, rarity: 'Common', isInsert: false,
    })));
    for (const image of [
      { number: '1', front: blood, back: null, attachments: ['image_1795024498082.png'] },
      { number: '4', front: carnage, back, attachments: ['image_1795024394328.png', 'image_1795024425956.png'] },
    ]) {
      const [card] = await tx.select().from(cards).where(sql`${cards.setId}=${set.id} AND ${cards.cardNumber}=${image.number}`);
      if (!card || (card.frontImageUrl && card.frontImageUrl !== image.front) ||
          (image.back && card.backImageUrl && card.backImageUrl !== image.back))
        throw new Error(`Crossover Checklists image conflict: ${image.number}`);
      const frontMissing = !card.frontImageUrl;
      const backMissing = Boolean(image.back && !card.backImageUrl);
      if (!frontMissing && !backMissing) continue;
      const [updated] = await tx.update(cards).set({
        ...(frontMissing ? { frontImageUrl: image.front } : {}),
        ...(backMissing ? { backImageUrl: image.back } : {}),
      }).where(sql`${cards.id}=${card.id}
        AND ${cards.frontImageUrl} IS NOT DISTINCT FROM ${card.frontImageUrl}
        AND ${cards.backImageUrl} IS NOT DISTINCT FROM ${card.backImageUrl}`).returning();
      if (!updated) throw new Error('Crossover image changed during import');
      await tx.insert(adminAuditLogs).values({
        actionType: 'card_image_update', entityType: 'card', entityId: card.id, entityName: `${card.name} #${card.cardNumber}`,
        notes: JSON.stringify({ source: marker, attachments: image.attachments,
          sides: [...(frontMissing ? ['front'] : []), ...(backMissing ? ['back'] : [])],
          oldFrontImageUrl: card.frontImageUrl, newFrontImageUrl: updated.frontImageUrl,
          oldBackImageUrl: card.backImageUrl, newBackImageUrl: updated.backImageUrl }),
      });
    }
    await tx.update(mainSets).set({
      thumbnailImageUrl: blood, notes: main.notes?.includes(note) ? main.notes : [main.notes, note].filter(Boolean).join('\n'),
    }).where(eq(mainSets.id, main.id));
    await tx.update(cardSets).set({
      name: 'Base', imageUrl: carnage, totalCards: 5,
      description: set.description?.includes(note) ? set.description : [set.description, note].filter(Boolean).join('\n'),
    }).where(eq(cardSets.id, set.id));
    const final = await tx.select().from(cards).where(eq(cards.setId, set.id));
    if (final.length !== 5) throw new Error('Crossover Checklists final count mismatch');
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: 'main_set', entityId: main.id, entityName: name,
      notes: JSON.stringify({ source: 'Owner-supplied five-card checklist', inserted: missing.length }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { imported: true, inserted: missing.length, setId: set.id };
  });
}
