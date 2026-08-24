import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import subsetData from './data/toppsMintMarvel2026.json';
import { appendParallelVariants } from './parallelSubsetVariants';
import { areExpectedChecklistsComplete } from './seedChecklistCompletion';

/**
 * One-time idempotent seed: 2026 Topps Mint Marvel.
 *
 * Creates (only if missing — safe to run on every startup, dev and prod):
 *  - The master set (matched by slug), with the hobby box image
 *  - 20 subsets (Base + 9 inserts + 10 requested Base parallels)
 *  - 1,730 cards total
 *
 * Data source: server/seeds/data/toppsMintMarvel2026.json, generated from the
 * user's spreadsheet (trimmed names/whitespace). Note: Base cards 76-125 are
 * flagged isInsert per the checklist (short prints), so isInsert is carried
 * per-card here rather than per-subset.
 */

const MAIN_SET_SLUG = '2026-topps-mint-marvel';
const MAIN_SET_NAME = '2026 Topps Mint Marvel';
const YEAR = 2026;
const SET_IMAGE_URL = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1785773876/set_images/tnrjklnmvezbhggumqhl.png';

type SubsetDef = { name: string; isInsert: boolean; cards: Array<{ num: string; name: string; isInsert: boolean }> };
export const TOPPS_MINT_PARALLEL_NAMES = [
  'Sky Blue Foil /100',
  'Green Mint Foil /75',
  'Gold Foil /50',
  'Orange Diamante Foil /25',
  'Orange Foil /25',
  'Black Foil /10',
  'Black & Yellow Electric Dots Foil /10 (SDCC Exclusive)',
  'Red Diamante Foil /5',
  'Red Foil /5',
  'Foilfractor 1/1',
] as const;
export const TOPPS_MINT_2026_SUBSETS: SubsetDef[] = appendParallelVariants(
  subsetData as SubsetDef[],
  'Base',
  TOPPS_MINT_PARALLEL_NAMES,
);
const SUBSETS = TOPPS_MINT_2026_SUBSETS;

// Same normalization used by the canonical taxonomy importer in routes.ts
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[&]/g, 'and')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function ensureSubset(tx: Tx, mainSetId: number, name: string, isInsertSubset: boolean): Promise<number> {
  const slug = `${MAIN_SET_SLUG}-${generateSlug(name)}`;
  const [existing] = await tx.select({
    id: cardSets.id,
    slug: cardSets.slug,
    year: cardSets.year,
    isActive: cardSets.isActive,
    isCanonical: cardSets.isCanonical,
    isInsertSubset: cardSets.isInsertSubset,
    archivedAt: cardSets.archivedAt,
  })
    .from(cardSets)
    .where(and(eq(cardSets.mainSetId, mainSetId), eq(cardSets.name, name)));
  if (existing) {
    if (
      existing.slug !== slug
      || existing.year !== YEAR
      || !existing.isActive
      || !existing.isCanonical
      || existing.isInsertSubset !== isInsertSubset
      || existing.archivedAt != null
    ) {
      throw new Error(`[Topps Mint Seed] Existing subset "${name}" has invalid canonical identity — aborting`);
    }
    return existing.id;
  }

  const [bySlug] = await tx.select({
    id: cardSets.id,
    mainSetId: cardSets.mainSetId,
    name: cardSets.name,
    year: cardSets.year,
    isActive: cardSets.isActive,
    isCanonical: cardSets.isCanonical,
    isInsertSubset: cardSets.isInsertSubset,
    archivedAt: cardSets.archivedAt,
  })
    .from(cardSets).where(eq(cardSets.slug, slug));
  if (bySlug) {
    if (
      bySlug.mainSetId !== mainSetId
      || bySlug.name !== name
      || bySlug.year !== YEAR
      || !bySlug.isActive
      || !bySlug.isCanonical
      || bySlug.isInsertSubset !== isInsertSubset
      || bySlug.archivedAt != null
    ) {
      throw new Error(`[Topps Mint Seed] Slug collision: "${slug}" belongs to main set ${bySlug.mainSetId} / "${bySlug.name}", expected ${mainSetId} / "${name}" — aborting`);
    }
    return bySlug.id;
  }

  const [created] = await tx.insert(cardSets).values({
    name,
    slug,
    year: YEAR,
    mainSetId,
    isActive: true,
    isCanonical: true,
    isInsertSubset,
    totalCards: 0,
  }).onConflictDoNothing({ target: cardSets.slug }).returning({ id: cardSets.id });
  if (!created) {
    const [row] = await tx.select({
      id: cardSets.id,
      mainSetId: cardSets.mainSetId,
      name: cardSets.name,
      year: cardSets.year,
      isActive: cardSets.isActive,
      isCanonical: cardSets.isCanonical,
      isInsertSubset: cardSets.isInsertSubset,
      archivedAt: cardSets.archivedAt,
    })
      .from(cardSets).where(eq(cardSets.slug, slug));
    if (
      !row
      || row.mainSetId !== mainSetId
      || row.name !== name
      || row.year !== YEAR
      || !row.isActive
      || !row.isCanonical
      || row.isInsertSubset !== isInsertSubset
      || row.archivedAt != null
    ) {
      throw new Error(`[Topps Mint Seed] Slug collision after insert: "${slug}" does not resolve to main set ${mainSetId} / "${name}"`);
    }
    return row.id;
  }
  return created.id;
}

export async function seedToppsMintMarvel2026(): Promise<void> {
  if (await areExpectedChecklistsComplete(
    MAIN_SET_SLUG,
    MAIN_SET_NAME,
    YEAR,
    SUBSETS,
    (name) => `${MAIN_SET_SLUG}-${generateSlug(name)}`,
  )) {
    return;
  }

  await db.transaction(async (tx) => {
    // Cross-instance single-flight guard (autoscale can boot several instances)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed-topps-mint-marvel-2026'))`);

    // 1. Master set
    let [mainSet] = await tx.select({
      id: mainSets.id,
      name: mainSets.name,
      thumbnailImageUrl: mainSets.thumbnailImageUrl,
      isActive: mainSets.isActive,
      isCanonical: mainSets.isCanonical,
      archivedAt: mainSets.archivedAt,
    })
      .from(mainSets)
      .where(eq(mainSets.slug, MAIN_SET_SLUG));

    if (!mainSet) {
      [mainSet] = await tx.insert(mainSets).values({
        name: MAIN_SET_NAME,
        slug: MAIN_SET_SLUG,
        isActive: true,
        isCanonical: true,
        thumbnailImageUrl: SET_IMAGE_URL,
      }).returning({
        id: mainSets.id,
        name: mainSets.name,
        thumbnailImageUrl: mainSets.thumbnailImageUrl,
        isActive: mainSets.isActive,
        isCanonical: mainSets.isCanonical,
        archivedAt: mainSets.archivedAt,
      });
      console.log('[Topps Mint Seed] Created master set');
    } else if (
      mainSet.name !== MAIN_SET_NAME
      || !mainSet.isActive
      || !mainSet.isCanonical
      || mainSet.archivedAt != null
    ) {
      throw new Error('[Topps Mint Seed] Existing master set has invalid canonical identity — aborting');
    } else if (!mainSet.thumbnailImageUrl) {
      await tx.update(mainSets).set({ thumbnailImageUrl: SET_IMAGE_URL }).where(eq(mainSets.id, mainSet.id));
    }

    // 2. Subsets + cards
    let createdSubsets = 0;
    let insertedCards = 0;
    for (const subset of SUBSETS) {
      const setId = await ensureSubset(tx, mainSet.id, subset.name, subset.isInsert);

      const nums = subset.cards.map(c => c.num);
      const existing = await tx.select({
        cardNumber: cards.cardNumber,
        name: cards.name,
        isInsert: cards.isInsert,
        rarity: cards.rarity,
      })
        .from(cards)
        .where(and(
          eq(cards.setId, setId),
          inArray(cards.cardNumber, nums),
          sql`${cards.archivedAt} IS NULL`,
        ));
      const have = new Set<string>();
      const expectedByNumber = new Map(subset.cards.map((card) => [card.num, card]));
      for (const card of existing) {
        const expected = expectedByNumber.get(card.cardNumber);
        const expectedIsInsert = expected?.isInsert ?? subset.isInsert;
        if (
          !expected
          || have.has(card.cardNumber)
          || card.name !== expected.name
          || card.isInsert !== expectedIsInsert
          || card.rarity !== (expectedIsInsert ? 'Insert' : 'Common')
        ) {
          throw new Error(`[Topps Mint Seed] Existing card ${subset.name} ${card.cardNumber} has invalid identity — aborting`);
        }
        have.add(card.cardNumber);
      }
      const missing = subset.cards.filter(c => !have.has(c.num));

      if (missing.length > 0) {
        for (let i = 0; i < missing.length; i += 1000) {
          const chunk = missing.slice(i, i + 1000);
          await tx.insert(cards).values(chunk.map(c => ({
            setId,
            cardNumber: c.num,
            name: c.name,
            isInsert: c.isInsert,
            rarity: c.isInsert ? 'Insert' : 'Common',
          })));
        }
        insertedCards += missing.length;
      }
      if (existing.length === 0 && missing.length === subset.cards.length) createdSubsets++;

      // Reconcile totalCards with the actual count (self-heals stale values)
      await tx.update(cardSets)
        .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId} AND ${cards.archivedAt} IS NULL)` })
        .where(eq(cardSets.id, setId));
    }

    console.log(`[Topps Mint Seed] Subsets ensured: ${SUBSETS.length} (${createdSubsets} newly populated), cards inserted: ${insertedCards}`);
  });

  console.log('[Topps Mint Seed] ✅ 2026 Topps Mint Marvel is in place');
}
