import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import mexico from './data/ovaltine-mexico-1983.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const ovaltineSlug = '1983-ovaltine-marvel-super-heroes-stickers';
export const ovaltineImage = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1793983073/owner-catalog/1983-ovaltine-usa-wolverine.png';
export const ovaltineLists = [
  { country: 'Mexico', cards: mexico },
  { country: 'USA', cards: ['Captain America','Invisible Girl','Power Man','Silver Surfer','Spider-Man',
    'Storm','The Hulk','The Thing','Thor','Wolverine'].map((name,i)=>({cardNumber:String(i+1),name})) },
];

export async function completeOvaltine1983Tx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('complete_ovaltine_1983'))`);
  const fail = (message: string): never => { throw new Error(`Ovaltine 1983: ${message}`); };
  let [main] = await tx.select().from(mainSets).where(eq(mainSets.slug,ovaltineSlug));
  if (!main) [main] = await tx.insert(mainSets).values({
    slug:ovaltineSlug, name:'1983 Ovaltine Marvel Super Heroes Stickers',
    thumbnailImageUrl:ovaltineImage, isCanonical:true, canonicalSource:'owner_checklist',
  }).returning();
  if (!main.isActive || main.archivedAt || main.name !== '1983 Ovaltine Marvel Super Heroes Stickers') fail('combined parent conflict');
  // Missing-only on repeat: later curated image replacements must survive startup.
  if (!main.thumbnailImageUrl) await tx.update(mainSets).set({thumbnailImageUrl:ovaltineImage}).where(eq(mainSets.id,main.id));
  let added = 0, reparented = 0;
  for (const list of ovaltineLists) {
    const legacySlug = `${ovaltineSlug}-${list.country.toLowerCase()}`;
    const [legacy] = await tx.select().from(mainSets).where(eq(mainSets.slug,legacySlug));
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug,`1983-${legacySlug}-base`));
    if (!legacy || !set || set.year !== 1983 || !set.isActive || set.archivedAt ||
        ![legacy.id, main.id].includes(set.mainSetId!)) fail(`missing/conflicting ${list.country}`);
    const siblings = await tx.select().from(cardSets).where(eq(cardSets.mainSetId,legacy.id));
    if (siblings.some(s=>s.id!==set.id)) fail(`unexpected legacy subsets ${list.country}`);
    const existing = (await tx.select().from(cards).where(eq(cards.setId,set.id))).filter(c=>!c.archivedAt);
    const seen = new Set<string>();
    for (const c of existing) {
      if (seen.has(c.cardNumber) || !list.cards.some(e=>e.cardNumber===c.cardNumber && e.name===c.name) || c.isInsert) fail(`card conflict ${list.country}/${c.cardNumber}`);
      seen.add(c.cardNumber);
    }
    for (const c of list.cards.filter(c=>!seen.has(c.cardNumber))) {
      await tx.insert(cards).values({
        ...c, setId:set.id, rarity:'Common', isInsert:false,
        // Initial artwork for the newly created identity, not an image replacement.
        frontImageUrl:list.country==='USA' && c.cardNumber==='10' ? ovaltineImage : null,
      });
      added++;
    }
    if (set.mainSetId !== main.id) reparented++;
    await tx.update(cardSets).set({
      mainSetId:main.id,name:list.country,totalCards:list.cards.length,isInsertSubset:false,
      ...(list.country==='USA' && !set.imageUrl ? {imageUrl:ovaltineImage} : {}),
    }).where(eq(cardSets.id,set.id));
    if (legacy.isActive || !legacy.archivedAt) await tx.update(mainSets).set({
      isActive:false,archivedAt:legacy.archivedAt ?? new Date(),
    }).where(eq(mainSets.id,legacy.id));
  }
  const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId,main.id));
  if (children.length!==2 || !children.some(s=>s.name==='Mexico') || !children.some(s=>s.name==='USA')) fail('combined subset shape');
  return {added,reparented};
}
export async function completeOvaltine1983() {
  return db.transaction(completeOvaltine1983Tx);
}
