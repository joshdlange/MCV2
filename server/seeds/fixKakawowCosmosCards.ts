import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';

/**
 * One-time idempotent data fix (July 2026): 9 cards (CM-I-100..CM-I-108) were
 * accidentally added via the admin modal to the wrong base sets:
 *   - CM-I-101..108 went into "2025 Kakawow Aura Marvel" (base)
 *   - CM-I-100 (Misty Knight) went into "2025 Kakawow Phantom Marvel Rivals" (base)
 * One card (Marrow) also had its name and card number swapped.
 *
 * This fix, run at startup under an advisory lock (safe on every boot, dev+prod):
 *   1. Repairs the swapped Marrow card (card_number 'Marrow' / name 'CM-I-103')
 *   2. Moves the misplaced CM-I-* cards into the Cosmos base set (preserving
 *      card IDs, so images and any collection entries follow)
 *   3. Clones CM-I-100..108 into the Cosmos Silver set if missing (name/number
 *      only, no image — matching the existing Silver convention)
 *   4. Recounts total_cards on all touched sets
 */

const COSMOS_BASE_SLUG = '2025-2025-kakawow-cosmos-marvel-base';
const COSMOS_SILVER_SLUG = '2025-2025-kakawow-cosmos-marvel-silver';
const AURA_BASE_SLUG = '2025-kakawow-aura-marvel';
const PHANTOM_BASE_SLUG = '2025-2025-kakawow-phantom-marvel-rivals-base';

const MISPLACED_NUMBERS = [
  'CM-I-100', 'CM-I-101', 'CM-I-102', 'CM-I-103', 'CM-I-104',
  'CM-I-105', 'CM-I-106', 'CM-I-107', 'CM-I-108',
];

export async function fixKakawowCosmosCards(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-kakawow-cosmos-cards'))`);

    const sets = await tx.select({ id: cardSets.id, slug: cardSets.slug })
      .from(cardSets)
      .where(inArray(cardSets.slug, [COSMOS_BASE_SLUG, COSMOS_SILVER_SLUG, AURA_BASE_SLUG, PHANTOM_BASE_SLUG]));
    const bySlug = new Map(sets.map(s => [s.slug, s.id]));
    const cosmosBaseId = bySlug.get(COSMOS_BASE_SLUG);
    const cosmosSilverId = bySlug.get(COSMOS_SILVER_SLUG);
    const auraBaseId = bySlug.get(AURA_BASE_SLUG);
    const phantomBaseId = bySlug.get(PHANTOM_BASE_SLUG);

    if (!cosmosBaseId || !cosmosSilverId) {
      console.log('[Kakawow Fix] Cosmos sets not found in this database — skipping');
      return;
    }

    const wrongSetIds = [auraBaseId, phantomBaseId].filter((id): id is number => !!id);

    // 1. Repair the swapped Marrow card wherever it lives
    const repaired = await tx.update(cards)
      .set({ cardNumber: 'CM-I-103', name: 'Marrow' })
      .where(and(eq(cards.cardNumber, 'Marrow'), eq(cards.name, 'CM-I-103')))
      .returning({ id: cards.id });
    if (repaired.length > 0) {
      console.log(`[Kakawow Fix] Repaired swapped Marrow card (id ${repaired[0].id})`);
    }

    // 2. Move misplaced CM-I-* cards from Aura/Phantom base into Cosmos base.
    //    Those sets use AM-*/PMR-* numbering, so any CM-I-* card there is misplaced.
    if (wrongSetIds.length > 0) {
      const misplaced = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, setId: cards.setId })
        .from(cards)
        .where(and(inArray(cards.setId, wrongSetIds), inArray(cards.cardNumber, MISPLACED_NUMBERS)));

      const existingInBase = await tx.select({ cardNumber: cards.cardNumber })
        .from(cards)
        .where(and(eq(cards.setId, cosmosBaseId), inArray(cards.cardNumber, MISPLACED_NUMBERS)));
      const alreadyThere = new Set(existingInBase.map(c => c.cardNumber));

      for (const card of misplaced) {
        if (alreadyThere.has(card.cardNumber)) {
          // Duplicate of a card already in Cosmos base — delete it, but only
          // if absolutely nothing references it (collections, wishlists,
          // binders, listings, XP). Cache-style rows are cleaned first.
          const [refs] = await tx.execute<{ total: string }>(sql`
            SELECT (SELECT count(*) FROM user_collections WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM user_wishlists WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM pc_binder_cards WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM listings WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM xp_events WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM migration_log_cards WHERE card_id = ${card.id})
                 + (SELECT count(*) FROM card_image_backup WHERE card_id = ${card.id}) AS total
          `).then(r => (r as any).rows ?? r);
          if (Number(refs.total) > 0) {
            console.warn(`[Kakawow Fix] ${card.cardNumber} duplicate (card ${card.id}) is referenced by user data — leaving it untouched`);
            continue;
          }
          await tx.execute(sql`DELETE FROM card_price_cache WHERE card_id = ${card.id}`);
          await tx.execute(sql`DELETE FROM pending_card_images WHERE card_id = ${card.id}`);
          await tx.delete(cards).where(eq(cards.id, card.id));
          console.log(`[Kakawow Fix] Deleted duplicate ${card.cardNumber} (card ${card.id}) from set ${card.setId} — already in Cosmos base`);
          continue;
        }
        await tx.update(cards).set({ setId: cosmosBaseId }).where(eq(cards.id, card.id));
        alreadyThere.add(card.cardNumber);
        console.log(`[Kakawow Fix] Moved ${card.cardNumber} (card ${card.id}) from set ${card.setId} to Cosmos base`);
      }
    }

    // 3. Clone CM-I-100..108 into Cosmos Silver (name/number only, Silver has no images)
    const baseCards = await tx.select({ cardNumber: cards.cardNumber, name: cards.name, rarity: cards.rarity })
      .from(cards)
      .where(and(eq(cards.setId, cosmosBaseId), inArray(cards.cardNumber, MISPLACED_NUMBERS)));

    const existingSilver = await tx.select({ cardNumber: cards.cardNumber })
      .from(cards)
      .where(and(eq(cards.setId, cosmosSilverId), inArray(cards.cardNumber, MISPLACED_NUMBERS)));
    const silverHas = new Set(existingSilver.map(c => c.cardNumber));

    const toClone = baseCards.filter(c => !silverHas.has(c.cardNumber));
    if (toClone.length > 0) {
      await tx.insert(cards).values(toClone.map(c => ({
        setId: cosmosSilverId,
        cardNumber: c.cardNumber,
        name: c.name,
        rarity: c.rarity || 'Common',
        isInsert: false,
      })));
      console.log(`[Kakawow Fix] Cloned ${toClone.length} cards into Cosmos Silver: ${toClone.map(c => c.cardNumber).join(', ')}`);
    }

    // 4. Reconcile total_cards on every touched set
    for (const setId of [cosmosBaseId, cosmosSilverId, ...wrongSetIds]) {
      await tx.update(cardSets)
        .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId})` })
        .where(eq(cardSets.id, setId));
    }
  });

  console.log('[Kakawow Fix] ✅ Kakawow Cosmos card fix complete');
}
