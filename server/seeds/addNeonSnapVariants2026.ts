import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from './data/topps-marvel-neon-2026.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const parentSlug = '2026-topps-marvel-neon';
export const snapVariantNames = ['Snap Gold', 'Snap Orange', 'Snap Black', 'Snap Red'];
const expected = checklist.find(s => s.name === 'MARVEL SNAP')!.cards;
const fail = (message: string): never => { throw new Error(`Neon Snap variants: ${message}`); };

export async function addNeonSnapVariantsTx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-catalog-publication'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('repair_topps_neon_2026'))`);
  const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, parentSlug));
  if (!main) return { skipped: true, added: 0 };
  if (main.name !== '2026 Topps Marvel Neon' || main.archivedAt || !main.isActive) fail('parent identity conflict');
  if (expected.length !== 20 || new Set(expected.map(c => c.number)).size !== 20) fail('invalid source checklist');
  const validate = (rows: typeof cards.$inferSelect[], complete: boolean) => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.archivedAt || !row.isInsert || seen.has(row.cardNumber) ||
          !expected.some(c => c.number === row.cardNumber && c.name === row.name)) fail(`unexpected card ${row.cardNumber}`);
      seen.add(row.cardNumber);
    }
    if (complete && seen.size !== 20) fail('incomplete Marvel Snap checklist');
    return seen;
  };
  const [source] = await tx.select().from(cardSets).where(eq(cardSets.slug, `${parentSlug}-marvel-snap`));
  if (!source || source.mainSetId !== main.id || source.name.toUpperCase() !== 'MARVEL SNAP' ||
      source.year !== 2026 || !source.isActive || source.archivedAt || !source.isInsertSubset) fail('source identity conflict');
  validate(await tx.select().from(cards).where(eq(cards.setId, source.id)), true);
  let added = 0;
  for (const name of snapVariantNames) {
    const slug = `${parentSlug}-${name.toLowerCase().replace(/ /g, '-')}`;
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (set && (set.mainSetId !== main.id || set.name !== name || set.year !== 2026 ||
        !set.isActive || set.archivedAt || !set.isInsertSubset)) fail(`subset identity conflict: ${name}`);
    if (!set) {
      [set] = await tx.insert(cardSets).values({
        name, slug, mainSetId: main.id, year: 2026, totalCards: 20,
        isInsertSubset: true, isCanonical: true, canonicalSource: 'owner_checklist',
      }).returning();
    }
    const seen = validate(await tx.select().from(cards).where(eq(cards.setId, set.id)), false);
    const missing = expected.filter(c => !seen.has(c.number));
    if (missing.length) {
      // Parallel identities only: never copy base artwork, prices or ownership.
      await tx.insert(cards).values(missing.map(c => ({
        setId: set.id, name: c.name, cardNumber: c.number, rarity: 'Common', isInsert: true,
      })));
      added += missing.length;
    }
    if (set.totalCards !== 20) await tx.update(cardSets).set({ totalCards: 20 }).where(eq(cardSets.id, set.id));
    validate(await tx.select().from(cards).where(eq(cards.setId, set.id)), true);
  }
  return { skipped: false, added };
}

export async function addNeonSnapVariants2026() {
  return db.transaction(addNeonSnapVariantsTx);
}
