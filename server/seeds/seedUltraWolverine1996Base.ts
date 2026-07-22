import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import cardData from './data/ultraWolverine1996Base.json';

/**
 * One-time idempotent seed (July 2026): populate the empty base subset of the
 * "1996 Ultra X-Men Wolverine" collection with its 100-card base checklist
 * (from the user's CSV, names trimmed). Matched by subset name (same in dev
 * and prod); only missing card numbers are inserted, so reruns are no-ops.
 * Safe to remove after the prod run is confirmed.
 */

const BASE_SUBSET_NAME = '1996 Ultra X-Men Wolverine - 1996 Ultra X-Men Wolverine';

type CardDef = { num: string; name: string };
const CARDS = cardData as CardDef[];

export async function seedUltraWolverine1996Base(): Promise<{ inserted: number; setId?: number }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('seed-ultra-wolverine-1996-base'))`);

    const [subset] = await tx.select({ id: cardSets.id })
      .from(cardSets)
      .where(eq(cardSets.name, BASE_SUBSET_NAME));
    if (!subset) {
      console.warn('[Ultra Wolverine Seed] Base subset not found — skipping');
      return { inserted: 0 };
    }

    const existing = await tx.select({ cardNumber: cards.cardNumber })
      .from(cards)
      .where(and(eq(cards.setId, subset.id), inArray(cards.cardNumber, CARDS.map(c => c.num))));
    const have = new Set(existing.map(c => c.cardNumber));
    const missing = CARDS.filter(c => !have.has(c.num));

    if (missing.length > 0) {
      await tx.insert(cards).values(missing.map(c => ({
        setId: subset.id,
        cardNumber: c.num,
        name: c.name,
        isInsert: false,
        rarity: 'Common',
      })));
    }

    // Reconcile denormalized total
    await tx.update(cardSets)
      .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${subset.id})` })
      .where(eq(cardSets.id, subset.id));

    return { inserted: missing.length, setId: subset.id };
  });
}
