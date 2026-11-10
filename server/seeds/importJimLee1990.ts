import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards, adminAuditLogs } from '../../shared/schema';

const slug = '1990-comic-images-marvel-comics-jim-lee';
const name = '1990 Comic Images Marvel Comics Jim Lee';
const marker = 'import_jim_lee_1990';
const pack = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1794341446/image-admin/catalog-imports/1990-jim-lee/qqn0guod3vjrcsv9vj9p.png';
const front = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1794341448/image-admin/catalog-imports/1990-jim-lee/f0se1wsxrx7aux0jcpnl.png';

// Owner-supplied spelling, punctuation and numbering are preserved. CL is a checklist designation.
export const jimLee1990Checklist = [
  'Surprise!', 'Beast', 'Two against...', 'Dreamqueen', 'Puck',
  'Blast Off!', 'Purple Man', 'Sub-Mariner', 'Double Take!', 'To the death!',
  'African Saga', 'Gator fight', 'Survival', 'Shot!', 'Black Widow',
  'Bushwaker', 'Stay back!', 'Teamwork', 'J. J. Jameson', 'Vacation',
  'Jet ski', 'Aloha!', 'Armory', 'Mandarin', 'Here I am!',
  'Lady Mandarin', 'Meditation', 'Banshee', 'Jean Grey', 'Animal Rage',
  "It's my turn!", 'Night stalker', 'Youth', 'Logan & Reed', 'Hulk',
  'Blackheart', 'Ghost Rider', 'Harriers', 'Trio', 'Quasar',
  'Wild Child', 'Caught', 'Vindicator', 'Fight back!', 'Checklist',
].map((name, i) => ({ number: String(i + 1), name, description: i === 44 ? 'CL' : null }));

/** Add-only catalog import, serialized and audited; completion preserves subsequent admin edits. */
export async function importJimLee1990(database: Pick<typeof db, 'transaction'> = db) {
  if (jimLee1990Checklist.length !== 45) throw new Error('Jim Lee checklist length mismatch');
  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
    const done = await tx.execute(sql`SELECT name FROM startup_migrations WHERE name=${marker}`);
    if (done.rows.length) return { imported: false };
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, slug));
    if (!main || main.name !== name || !main.isActive || main.archivedAt ||
        (main.thumbnailImageUrl && main.thumbnailImageUrl !== pack))
      throw new Error('Jim Lee main-set identity/image conflict');
    const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    const set = children[0];
    if (children.length !== 1 || !set.isActive || set.archivedAt || set.year !== 1990 ||
        set.isInsertSubset || !['Base', `${name} - ${name}`].includes(set.name) ||
        (set.imageUrl && set.imageUrl !== front))
      throw new Error('Jim Lee base subset identity/image conflict');
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const c of existing) {
      const expected = jimLee1990Checklist.find(r => r.number === c.cardNumber);
      if (!expected || seen.has(c.cardNumber) || c.name !== expected.name || c.isInsert || c.archivedAt)
        throw new Error(`Jim Lee card identity conflict: ${c.cardNumber}`);
      seen.add(c.cardNumber);
    }
    const missing = jimLee1990Checklist.filter(c => !seen.has(c.number));
    if (missing.length) await tx.insert(cards).values(missing.map(c => ({
      setId: set.id, cardNumber: c.number, name: c.name, description: c.description,
      rarity: 'Common', isInsert: false,
    })));
    const [first] = await tx.select().from(cards).where(sql`${cards.setId}=${set.id} AND ${cards.cardNumber}='1'`);
    if (!first || (first.frontImageUrl && first.frontImageUrl !== front))
      throw new Error('Jim Lee Surprise image conflict');
    if (!first.frontImageUrl) {
      const updated = await tx.update(cards).set({ frontImageUrl: front })
        .where(sql`${cards.id}=${first.id} AND ${cards.frontImageUrl} IS NULL`).returning();
      if (updated.length !== 1) throw new Error('Jim Lee image changed during import');
      await tx.insert(adminAuditLogs).values({
        actionType: 'card_image_update', entityType: 'card', entityId: first.id, entityName: 'Surprise! #1',
        notes: JSON.stringify({ source: marker, attachment: 'image_1794341398728.png',
          sides: ['front'], oldFrontImageUrl: null, newFrontImageUrl: front }),
      });
    }
    await tx.update(mainSets).set({ thumbnailImageUrl: pack }).where(eq(mainSets.id, main.id));
    await tx.update(cardSets).set({ name: 'Base', imageUrl: front, totalCards: 45 })
      .where(eq(cardSets.id, set.id));
    const final = await tx.select().from(cards).where(eq(cards.setId, set.id));
    if (final.length !== 45 || final.some(c => c.isInsert || c.archivedAt))
      throw new Error('Jim Lee final checklist validation failed');
    await tx.insert(adminAuditLogs).values({
      actionType: marker, entityType: 'main_set', entityId: main.id, entityName: name,
      notes: JSON.stringify({ source: 'Owner-supplied 45-card checklist', inserted: missing.length,
        thumbnailAttachment: 'image_1794341209580.png' }),
    });
    await tx.execute(sql`INSERT INTO startup_migrations(name) VALUES(${marker})`);
    return { imported: true, inserted: missing.length, mainSetId: main.id, setId: set.id };
  });
}
