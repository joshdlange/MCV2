import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { vintageChecklists } from './data/ownerVintageChecklists';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const masterpieces94 = '1994-fleer-marvel-masterpieces-hildebrandt-brothers';
export const heroes1977Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793983201/owner-catalog/1977-marvel-super-heroes-main.png';
export const posters1966Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793983384/owner-catalog/1966-club-art-posters-spiderman.png';
export const secretWars1984Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793983648/owner-catalog/1984-leaf-secret-wars-main.png';
export const stickers1986Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793984149/owner-catalog/1986-official-marvel-universe-stickers-main.png';
export const universe1987Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793984445/owner-catalog/1987-marvel-universe-i-main.png';
export const colossal1987Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793984919/owner-catalog/1987-colossal-conflicts-main.png';
export const magicMomentsImage = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793985948/owner-catalog/1987-magic-moments-main.png';
export const wolverine1988Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793986722/owner-catalog/1988-marvel-universe-iii-wolverine-main.png';
export const crunch1993Image = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793987780/owner-catalog/1993-crunch-n-munch-main.png';
export async function completeVintageAndGold1994Tx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('complete_vintage_gold_1994'))`);
  const fail = (message: string): never => { throw new Error(`Vintage/Gold checklist: ${message}`); };
  const resolve = async (parent: string, slug: string, year: number) => {
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, parent));
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (!main || !set || !main.isActive || main.archivedAt || set.mainSetId !== main.id ||
        set.year !== year || !set.isActive || set.archivedAt) fail(`missing/conflicting ${slug}`);
    return set;
  };
  const rows = async (id: number) => (await tx.select().from(cards).where(eq(cards.setId, id))).filter(c => !c.archivedAt);
  let goldAdded = 0, vintageAdded = 0, namesAligned = 0, captionsAdded = 0;
  // Gold first; preserve every existing collectible ID, image, price and holding.
  const base = await resolve(masterpieces94, `1994-${masterpieces94}-base`, 1994);
  const gold = await resolve(masterpieces94, `1994-${masterpieces94}-gold-foil-signature`, 1994);
  const baseRows = await rows(base.id), goldRows = await rows(gold.id);
  if (baseRows.length !== 140 || Array.from({length:140},(_,i)=>String(i+1))
    .some(n => baseRows.filter(c => c.cardNumber === n).length !== 1)) fail('Base must contain exactly 1–140');
  const seen = new Set<string>();
  for (const card of goldRows) {
    const source = baseRows.find(c => c.cardNumber === card.cardNumber);
    if (!source || seen.has(card.cardNumber) || source.name.toLowerCase() !== card.name.toLowerCase()) fail(`Gold identity ${card.cardNumber}`);
    seen.add(card.cardNumber);
    if (source.name !== card.name) {
      await tx.update(cards).set({ name: source.name }).where(eq(cards.id, card.id));
      namesAligned++;
    }
  }
  for (const card of baseRows.filter(c => !seen.has(c.cardNumber))) {
    await tx.insert(cards).values({ setId: gold.id, cardNumber: card.cardNumber, name: card.name, rarity: 'Common', isInsert: card.isInsert });
    goldAdded++;
  }
  await tx.update(cardSets).set({ totalCards: 140 }).where(eq(cardSets.id, gold.id));
  for (const checklist of vintageChecklists) {
    const set = await resolve(checklist.parent, `${checklist.year}-${checklist.parent}-base`, checklist.year);
    const current = await rows(set.id);
    const numbers = new Set<string>();
    for (const card of current) {
      const expected = checklist.cards.find(c => c.cardNumber === card.cardNumber);
      if (!expected || card.name !== expected.name || card.isInsert || numbers.has(card.cardNumber)) fail(`vintage identity ${set.slug}/${card.cardNumber}`);
      numbers.add(card.cardNumber);
      if (expected.description && card.description !== expected.description) {
        if (card.description) fail(`existing caption conflict ${card.cardNumber}`);
        await tx.update(cards).set({ description: expected.description }).where(eq(cards.id, card.id));
        captionsAdded++;
      }
    }
    for (const card of checklist.cards.filter(c => !numbers.has(c.cardNumber))) {
      await tx.insert(cards).values({ ...card, setId: set.id, rarity: 'Common', isInsert: false });
      vintageAdded++;
    }
    await tx.update(cardSets).set({ name: 'Base', isInsertSubset: false, totalCards: checklist.cards.length }).where(eq(cardSets.id, set.id));
    if ((await rows(set.id)).length !== checklist.cards.length) fail('vintage terminal count');
  }
  if ((await rows(gold.id)).length !== 140) fail('Gold terminal count');
  // Owner-supplied main-set artwork only; retain later curated replacements.
  const [heroes1977] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1977-marvel-super-heroes'));
  if (!heroes1977.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: heroes1977Image }).where(eq(mainSets.id, heroes1977.id));
  }
  const posters = await resolve('1966-marvel-super-heroes-club-art-posters',
    '1966-1966-marvel-super-heroes-club-art-posters-base', 1966);
  const spiderman = (await rows(posters.id)).find(c => c.cardNumber === '4' && c.name === 'Spiderman');
  if (!spiderman) fail('missing 1966 Spiderman');
  // Initial owner artwork only: never overwrite a later image-admin replacement.
  if (!spiderman.frontImageUrl) {
    await tx.update(cards).set({ frontImageUrl: posters1966Image }).where(eq(cards.id, spiderman.id));
  }
  const [postersMain] = await tx.select().from(mainSets).where(eq(mainSets.id, posters.mainSetId!));
  if (!postersMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: posters1966Image }).where(eq(mainSets.id, postersMain.id));
  }
  const [secretWarsMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1984-leaf-marvel-super-heroes-secret-wars-stickers'));
  if (!secretWarsMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: secretWars1984Image }).where(eq(mainSets.id, secretWarsMain.id));
  }
  const [stickers1986Main] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1986-comic-images-official-marvel-universe-stickers'));
  if (!stickers1986Main.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: stickers1986Image }).where(eq(mainSets.id, stickers1986Main.id));
  }
  const [universe1987Main] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1987-comic-images-marvel-universe-i'));
  if (!universe1987Main.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: universe1987Image }).where(eq(mainSets.id, universe1987Main.id));
  }
  const [colossalMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1987-comic-images-marvel-universe-ii-colossal-conflicts'));
  if (!colossalMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: colossal1987Image }).where(eq(mainSets.id, colossalMain.id));
  }
  const [magicMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1987-comic-images-marvel-s-magic-moments-stickers'));
  if (!magicMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: magicMomentsImage }).where(eq(mainSets.id, magicMain.id));
  }
  const [wolverineMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1988-comic-images-marvel-universe-iii-wolverine'));
  if (!wolverineMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: wolverine1988Image }).where(eq(mainSets.id, wolverineMain.id));
  }
  const [crunchMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, '1993-crunch-n-munch-marvel-super-heroes'));
  if (!crunchMain.thumbnailImageUrl) {
    await tx.update(mainSets).set({ thumbnailImageUrl: crunch1993Image }).where(eq(mainSets.id, crunchMain.id));
  }
  return { goldAdded, vintageAdded, namesAligned, captionsAdded };
}

export async function completeVintageAndGold1994() {
  return db.transaction(completeVintageAndGold1994Tx);
}
