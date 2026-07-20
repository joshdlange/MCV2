import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import subsetData from './data/toppsFinestFF2026.json';

/**
 * One-time idempotent seed: 2026 Topps Finest Fantastic Four: 65th Anniversary.
 *
 * Creates (only if missing — safe to run on every startup, dev and prod):
 *  - The master set (matched by slug), with the hobby box image
 *  - 137 subsets (Base + 136 inserts/parallels)
 *  - 4,851 cards total
 *
 * Data source: server/seeds/data/toppsFinestFF2026.json, generated from the
 * user's spreadsheet with these cleanups: ignored the per-row year autofill
 * glitch in the "Main Set" column (2026→4876), trimmed names, uniform " - "
 * separators, and normalized casing (GOLD→Gold, Super Fractor→SuperFractor).
 */

const MAIN_SET_SLUG = '2026-topps-finest-fantastic-four-65th-anniversary';
const MAIN_SET_NAME = '2026 Topps Finest Fantastic Four: 65th Anniversary';
const YEAR = 2026;
const SET_IMAGE_URL = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1784576510/set_images/gesh2v2khpqvqm6gclxy.jpg';

type SubsetDef = { name: string; isInsert: boolean; cards: Array<{ num: string; name: string }> };
const SUBSETS = subsetData as SubsetDef[];
const TOTAL_CARDS = SUBSETS.reduce((a, s) => a + s.cards.length, 0);

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
  const [existing] = await tx.select({ id: cardSets.id })
    .from(cardSets)
    .where(and(eq(cardSets.mainSetId, mainSetId), eq(cardSets.name, name)));
  if (existing) return existing.id;

  const [bySlug] = await tx.select({ id: cardSets.id }).from(cardSets).where(eq(cardSets.slug, slug));
  if (bySlug) return bySlug.id;

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
    const [row] = await tx.select({ id: cardSets.id }).from(cardSets).where(eq(cardSets.slug, slug));
    return row.id;
  }
  return created.id;
}

export async function seedToppsFinestFF2026(): Promise<void> {
  // Cheap pre-check outside the transaction: if the set is fully seeded,
  // skip the reconciliation pass entirely on normal startups.
  const expectedSlugs = SUBSETS.map(s => `${MAIN_SET_SLUG}-${generateSlug(s.name)}`);
  const [check] = await db.select({
    subsetCount: sql<number>`count(distinct ${cardSets.id})::int`,
    cardCount: sql<number>`count(${cards.id})::int`,
  })
    .from(cardSets)
    .leftJoin(cards, eq(cards.setId, cardSets.id))
    .where(inArray(cardSets.slug, expectedSlugs));
  if (check && check.subsetCount === SUBSETS.length && check.cardCount >= TOTAL_CARDS) {
    return;
  }

  await db.transaction(async (tx) => {
    // Cross-instance single-flight guard (autoscale can boot several instances)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed-topps-finest-ff-2026'))`);

    // 1. Master set
    let [mainSet] = await tx.select({ id: mainSets.id, thumbnailImageUrl: mainSets.thumbnailImageUrl })
      .from(mainSets)
      .where(eq(mainSets.slug, MAIN_SET_SLUG));

    if (!mainSet) {
      [mainSet] = await tx.insert(mainSets).values({
        name: MAIN_SET_NAME,
        slug: MAIN_SET_SLUG,
        isActive: true,
        isCanonical: true,
        thumbnailImageUrl: SET_IMAGE_URL,
      }).returning({ id: mainSets.id, thumbnailImageUrl: mainSets.thumbnailImageUrl });
      console.log('[Topps Finest FF Seed] Created master set');
    } else if (!mainSet.thumbnailImageUrl) {
      await tx.update(mainSets).set({ thumbnailImageUrl: SET_IMAGE_URL }).where(eq(mainSets.id, mainSet.id));
    }

    // 2. Subsets + cards
    let createdSubsets = 0;
    let insertedCards = 0;
    for (const subset of SUBSETS) {
      const setId = await ensureSubset(tx, mainSet.id, subset.name, subset.isInsert);

      const nums = subset.cards.map(c => c.num);
      const existing = await tx.select({ cardNumber: cards.cardNumber })
        .from(cards)
        .where(and(eq(cards.setId, setId), inArray(cards.cardNumber, nums)));
      const have = new Set(existing.map(c => c.cardNumber));
      const missing = subset.cards.filter(c => !have.has(c.num));

      if (missing.length > 0) {
        // Chunked inserts to stay well under the Postgres parameter limit
        for (let i = 0; i < missing.length; i += 1000) {
          const chunk = missing.slice(i, i + 1000);
          await tx.insert(cards).values(chunk.map(c => ({
            setId,
            cardNumber: c.num,
            name: c.name,
            isInsert: subset.isInsert,
            rarity: subset.isInsert ? 'Insert' : 'Common',
          })));
        }
        insertedCards += missing.length;
      }
      if (existing.length === 0 && missing.length === subset.cards.length) createdSubsets++;

      // Reconcile totalCards with the actual count (self-heals stale values)
      await tx.update(cardSets)
        .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId})` })
        .where(eq(cardSets.id, setId));
    }

    console.log(`[Topps Finest FF Seed] Subsets ensured: ${SUBSETS.length} (${createdSubsets} newly populated), cards inserted: ${insertedCards}`);
  });

  console.log('[Topps Finest FF Seed] ✅ 2026 Topps Finest Fantastic Four: 65th Anniversary is in place');
}
