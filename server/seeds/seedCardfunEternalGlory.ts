import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';

/**
 * One-time idempotent seed: 2026 CardFun Marvel Rivals - Eternal Glory.
 *
 * Creates (only if missing — safe to run on every startup, dev and prod):
 *  - The master set (matched by slug; also trims a stray trailing space in its name)
 *  - The "Base" subset with 40 cards (MRA01–MRA40)
 *  - 20 empty variant/insert subsets that display "Coming Soon" until populated
 *
 * Card numbers for the variant subsets are not yet known; they stay empty on
 * purpose. Populate them later via the admin card import tools.
 */

const MAIN_SET_SLUG = '2026-cardfun-marvel-rivals-eternal-glory';
const MAIN_SET_NAME = '2026 CardFun Marvel Rivals - Eternal Glory';
const YEAR = 2026;

const BASE_CARDS: Array<{ num: string; name: string }> = [
  { num: 'MRA01', name: 'Spider-Man' },
  { num: 'MRA02', name: 'Captain America' },
  { num: 'MRA03', name: 'Iron Man' },
  { num: 'MRA04', name: 'Thor' },
  { num: 'MRA05', name: 'Hulk' },
  { num: 'MRA06', name: 'Black Panther' },
  { num: 'MRA07', name: 'Black Widow' },
  { num: 'MRA08', name: 'Hawkeye' },
  { num: 'MRA09', name: 'Doctor Strange' },
  { num: 'MRA10', name: 'Scarlet Witch' },
  { num: 'MRA11', name: 'Namor' },
  { num: 'MRA12', name: 'Cloak & Dagger' },
  { num: 'MRA13', name: 'Storm' },
  { num: 'MRA14', name: 'Moon Knight' },
  { num: 'MRA15', name: 'Winter Soldier' },
  { num: 'MRA16', name: 'Squirrel Girl' },
  { num: 'MRA17', name: 'Rocket Raccoon' },
  { num: 'MRA18', name: 'Groot' },
  { num: 'MRA19', name: 'Star-Lord' },
  { num: 'MRA20', name: 'Mantis' },
  { num: 'MRA21', name: 'Venom' },
  { num: 'MRA22', name: 'Magik' },
  { num: 'MRA23', name: 'Peni Parker' },
  { num: 'MRA24', name: 'The Punisher' },
  { num: 'MRA25', name: 'Luna Snow' },
  { num: 'MRA26', name: 'Adam Warlock' },
  { num: 'MRA27', name: 'Magneto' },
  { num: 'MRA28', name: 'Loki' },
  { num: 'MRA29', name: 'Hela' },
  { num: 'MRA30', name: 'Iron Fist' },
  { num: 'MRA31', name: 'Jeff the Land Shark' },
  { num: 'MRA32', name: 'Psylocke' },
  { num: 'MRA33', name: 'Wolverine' },
  { num: 'MRA34', name: 'Mister Fantastic' },
  { num: 'MRA35', name: 'Invisible Woman' },
  { num: 'MRA36', name: 'Human Torch' },
  { num: 'MRA37', name: 'The Thing' },
  { num: 'MRA38', name: 'Emma Frost' },
  { num: 'MRA39', name: 'Ultron' },
  { num: 'MRA40', name: 'Jean Grey' },
];

// Variant/insert subsets that stay empty ("Coming Soon") until card numbers are known.
const COMING_SOON_SUBSETS = [
  'Orange',
  'Golden',
  'Red',
  'Black',
  'Hero Debut Series',
  'Team up Series',
  'Art Gallery Series',
  'Refraction Series',
  'Hero Positioning Series',
  'X Evolution Series',
  'Summer Carnival Series',
  'Nirvana Rebirth Series',
  'Ink Painting Series',
  'Retro Art Series',
  'Flowing Lights',
  'Trophy Theme',
  'Snake Pattern',
  'Glory MVP',
  'Hero Signature Series',
  'Team up Signatures',
];

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

  // Slug is globally unique — fall back to slug match in case the name was edited
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
    // Extremely unlikely inside the advisory lock, but resolve by slug if a
    // conflicting row appeared between our check and insert.
    const [row] = await tx.select({ id: cardSets.id }).from(cardSets).where(eq(cardSets.slug, slug));
    return row.id;
  }
  console.log(`[CardFun Seed] Created subset: ${name}`);
  return created.id;
}

export async function seedCardfunEternalGlory(): Promise<void> {
  await db.transaction(async (tx) => {
    // Cross-instance single-flight guard: only one server instance seeds at a
    // time (autoscale deployments can boot several at once). The lock is tied
    // to this transaction and releases automatically on commit/rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed-cardfun-eternal-glory'))`);

    // 1. Master set (create if missing; trim stray trailing whitespace in the name)
    let [mainSet] = await tx.select({ id: mainSets.id, name: mainSets.name })
      .from(mainSets)
      .where(eq(mainSets.slug, MAIN_SET_SLUG));

    if (!mainSet) {
      [mainSet] = await tx.insert(mainSets).values({
        name: MAIN_SET_NAME,
        slug: MAIN_SET_SLUG,
        isActive: true,
        isCanonical: true,
      }).returning({ id: mainSets.id, name: mainSets.name });
      console.log('[CardFun Seed] Created master set');
    } else if (mainSet.name !== mainSet.name.trim()) {
      await tx.update(mainSets).set({ name: mainSet.name.trim() }).where(eq(mainSets.id, mainSet.id));
      console.log('[CardFun Seed] Trimmed whitespace from master set name');
    }

    // 2. Base subset + 40 cards
    const baseSetId = await ensureSubset(tx, mainSet.id, 'Base', false);

    const existing = await tx.select({ cardNumber: cards.cardNumber })
      .from(cards)
      .where(and(eq(cards.setId, baseSetId), inArray(cards.cardNumber, BASE_CARDS.map(c => c.num))));
    const have = new Set(existing.map(c => c.cardNumber));
    const missing = BASE_CARDS.filter(c => !have.has(c.num));

    if (missing.length > 0) {
      await tx.insert(cards).values(missing.map(c => ({
        setId: baseSetId,
        cardNumber: c.num,
        name: c.name,
        isInsert: false,
        rarity: 'Common',
      })));
      console.log(`[CardFun Seed] Inserted ${missing.length} base cards`);
    }

    // Always reconcile totalCards with the actual count (self-heals stale values)
    await tx.update(cardSets)
      .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${baseSetId})` })
      .where(eq(cardSets.id, baseSetId));

    // 3. Empty "Coming Soon" variant subsets
    for (const name of COMING_SOON_SUBSETS) {
      await ensureSubset(tx, mainSet.id, name, true);
    }
  });

  console.log('[CardFun Seed] ✅ 2026 CardFun Marvel Rivals - Eternal Glory is in place');
}
