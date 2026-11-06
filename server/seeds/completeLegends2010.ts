import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const legends2010Slug = '2010-rittenhouse-legends-of-marvel';
// Preserve the two supplied columns without inventing front/back or correction semantics.
export const legends2010Lists = [
  { name: 'Black Widow', key: 'black-widow', credits: [
    ['Greg Land, Matt Ryan', 'Greg Land, Matt Ryan'],
    ['J. G. Jones', 'J. G. Jones'],
    ['Adi Granov', 'Joe Bennett, Sandu Florea'],
    ['Tom Raney', 'Miguel Angel Sepulveda'],
    ['Bill Sienkiewicz', 'Sean Phillips, Bill Sienkiewicz'],
    ['Adi Granov', 'Adi Granov'],
    ['Greg Land, Matt Ryan', 'Greg Land, Matt Ryan'],
    ['Adi Granov', 'Daniel Acuña'],
    ['Greg Land, Matt Ryan', 'Greg Land, Matt Ryan'],
  ] },
  { name: 'Captain America', key: 'captain-america', credits: [
    ['Mitchell Breitweiser', 'Steve Epting'],
    ['Bryan Hitch, Butch Guice', 'Bryan Hitch, Butch Guice'],
    ['Bart Sears, Rob Hunter', 'Bart Sears, Rob Hunter'],
    ['Steve Epting', 'Joe Jusko'],
    ['Jim Lee, Scott Williams', 'Tom Derenick'],
    ['Steve Epting', 'Jackson Guice'],
    ['unknown', 'Clayton Henry'],
    ['Steve Epting', 'Steve Epting, Butch Guice'],
    ['Steve Epting', 'Butch Guice'],
  ] },
  { name: 'Iron Man', key: 'iron-man', credits: [
    ['Adi Granov', 'Adi Granov'],
    ['Adi Granov', 'Adi Granov'],
    ['Salvador Larroca', 'Gerald Parel'],
    ['Salvador Larroca', 'Salvador Larroca'],
    ['Adi Granov', 'Adi Granov'],
    ['Adi Granov', 'Adi Granov'],
    ['Adi Granov', 'Adi Granov'],
    ['Adi Granov', 'Adi Granov'],
    ['Adi Granov', 'Adi Granov'],
  ] },
].map(list => ({
  ...list, cards: list.credits.map((credit, i) => ({
    cardNumber: `L${i + 1}`, name: list.name, description: `Artists: ${credit.join(' | ')}`,
  })),
}));

export async function completeLegends2010Tx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('complete_legends_2010'))`);
  const fail = (message: string): never => { throw new Error(`Legends 2010: ${message}`); };
  let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, legends2010Slug));
  if (!main) [main] = await tx.insert(mainSets).values({
    slug: legends2010Slug, name: '2010 Rittenhouse Legends of Marvel',
    isCanonical: true, canonicalSource: 'owner_checklist',
  }).returning();
  if (!main.isActive || main.archivedAt || main.name !== '2010 Rittenhouse Legends of Marvel') fail('combined parent conflict');
  let added = 0, reparented = 0, notesAdded = 0;
  for (const list of legends2010Lists) {
    const legacySlug = `${legends2010Slug}-${list.key}`;
    const [legacy] = await tx.select().from(mainSets).where(eq(mainSets.slug, legacySlug));
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, `2010-${legacySlug}-base`));
    if (!legacy || !set || set.year !== 2010 || !set.isActive || set.archivedAt ||
        ![legacy.id, main.id].includes(set.mainSetId!)) fail(`missing/conflicting ${list.name}`);
    const siblings = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, legacy.id));
    if (siblings.some(s => s.id !== set.id)) fail(`unexpected legacy subsets ${list.name}`);
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const card of existing) {
      const expected = list.cards.find(c => c.cardNumber === card.cardNumber);
      if (!expected || card.archivedAt || card.name !== expected.name || card.isInsert || seen.has(card.cardNumber)) fail(`identity conflict ${list.name}/${card.cardNumber}`);
      seen.add(card.cardNumber);
      if (card.description !== expected.description) {
        if (card.description) fail(`notes conflict ${list.name}/${card.cardNumber}`);
        await tx.update(cards).set({ description: expected.description }).where(eq(cards.id, card.id));
        notesAdded++;
      }
    }
    const missing = list.cards.filter(c => !seen.has(c.cardNumber));
    if (missing.length) {
      await tx.insert(cards).values(missing.map(c => ({ ...c, setId: set.id, rarity: 'Common', isInsert: false })));
      added += missing.length;
    }
    if (set.mainSetId !== main.id) reparented++;
    await tx.update(cardSets).set({
      mainSetId: main.id, name: list.name, totalCards: 9, isInsertSubset: false,
    }).where(eq(cardSets.id, set.id));
    if (legacy.isActive || !legacy.archivedAt) await tx.update(mainSets).set({
      isActive: false, archivedAt: legacy.archivedAt ?? new Date(),
    }).where(eq(mainSets.id, legacy.id));
    const finalRows = await tx.select().from(cards).where(eq(cards.setId, set.id));
    if (finalRows.length !== 9) fail(`terminal count ${list.name}`);
  }
  // Other legitimate subsets, if later added, are not removed or rejected.
  return { added, reparented, notesAdded };
}

export async function completeLegends2010() {
  return db.transaction(completeLegends2010Tx);
}
