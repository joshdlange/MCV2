import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from './data/toppsChromeSapphire2025.json';

// User-supplied 200-card checklist. Keep existing subset identities and images.
export const SAPPHIRE_2025_VARIANTS = [
  ['base', null], ['green-sapphire', 99], ['aqua-sapphire', 75],
  ['gold-sapphire', 50], ['orange-sapphire', 25], ['purple-sapphire', 15],
  ['black-sapphire', 10], ['red-sapphire', 5], ['padparadscha-sapphire', 1],
] as const;

export async function completeSapphire2025() {
  if (checklist.length !== 200 || checklist.some((c, i) => c.num !== String(i + 1))) {
    throw new Error('Invalid 2025 Sapphire checklist');
  }
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('complete-sapphire-2025'))`);
    const [parent] = await tx.select().from(mainSets)
      .where(eq(mainSets.slug, '2025-topps-chrome-sapphire-edition-marvel'));
    if (!parent || !parent.isActive || parent.archivedAt) throw new Error('2025 Sapphire parent missing or inactive');
    let inserted = 0;
    for (const [suffix] of SAPPHIRE_2025_VARIANTS) {
      const [subset] = await tx.select().from(cardSets).where(and(
        eq(cardSets.mainSetId, parent.id),
        eq(cardSets.slug, `2025-2025-topps-chrome-sapphire-edition-marvel-${suffix}`),
      ));
      if (!subset || !subset.isActive || subset.archivedAt) throw new Error(`Sapphire subset missing or inactive: ${suffix}`);
      const existing = await tx.select().from(cards).where(eq(cards.setId, subset.id));
      const numbers = new Set<string>();
      for (const card of existing) {
        const expected = checklist.find(c => c.num === card.cardNumber);
        if (!expected || numbers.has(card.cardNumber) || card.archivedAt
          || card.name.toLowerCase() !== expected.name.toLowerCase()) {
          throw new Error(`Sapphire identity conflict: ${suffix} #${card.cardNumber}`);
        }
        numbers.add(card.cardNumber);
      }
      const missing = checklist.filter(c => !numbers.has(c.num));
      if (missing.length) {
        await tx.insert(cards).values(missing.map(c => ({
          setId: subset.id, cardNumber: c.num, name: c.name,
          rarity: 'Common', isInsert: false,
        })));
        inserted += missing.length;
      }
      await tx.update(cardSets).set({ totalCards: 200 }).where(eq(cardSets.id, subset.id));
    }
    console.log(`[Sapphire 2025] Verified nine 200-card checklists; inserted ${inserted}`);
    return inserted;
  });
}
