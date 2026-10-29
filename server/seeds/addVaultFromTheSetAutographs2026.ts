import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from './data/topps-vault-marvel-2026.json';

const parentSlug = '2026-topps-vault-marvel';
const slug = `${parentSlug}-from-the-set-autograph-relics`;
const name = 'FROM THE SET AUTOGRAPH RELICS';

/** Add-only correction supplied by the catalog owner; never clone images/prices. */
export async function addVaultFromTheSetAutographs2026() {
  const source = checklist.find(s => s.name === 'FROM THE SET');
  if (!source || source.cards.length !== 10 ||
      source.cards.some(c => !c.number.startsWith('FTS-'))) {
    throw new Error('Unexpected Vault From the Set source checklist');
  }
  const expected = new Map(source.cards.map(c => [c.number.replace(/^FTS-/, 'FTSA-'), c.name]));
  return db.transaction(async tx => {
    // Share the original import lock to avoid racing that importer.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('import_topps_vault_marvel_2026'))`);
    const [parent] = await tx.select().from(mainSets).where(eq(mainSets.slug, parentSlug));
    if (!parent || parent.name !== '2026 Topps Vault Marvel' || !parent.isActive || parent.archivedAt) {
      throw new Error('Vault autograph subset parent missing or conflicting');
    }
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (set && (set.mainSetId !== parent.id || set.name !== name || set.year !== 2026 ||
        !set.isActive || set.archivedAt || !set.isInsertSubset)) {
      throw new Error('Vault autograph subset identity conflict');
    }
    if (!set) {
      [set] = await tx.insert(cardSets).values({
        name, slug, year: 2026, mainSetId: parent.id, totalCards: expected.size,
        isInsertSubset: true, isCanonical: true, canonicalSource: 'owner_checklist',
        description: 'Autographed From the Set relic cards (FTSA). Separate from the non-autographed FTS checklist.',
      }).returning();
    }
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const card of existing) {
      if (seen.has(card.cardNumber) || expected.get(card.cardNumber) !== card.name ||
          card.archivedAt || !card.isInsert) {
        throw new Error(`Vault autograph card identity conflict: ${card.cardNumber}`);
      }
      seen.add(card.cardNumber);
    }
    const missing = [...expected].filter(([number]) => !seen.has(number));
    if (missing.length) {
      await tx.insert(cards).values(missing.map(([cardNumber, cardName]) => ({
        setId: set.id, cardNumber, name: cardName, rarity: 'Common', isInsert: true,
        description: 'From the Set Autograph Relic',
      })));
    }
    if (set.totalCards !== expected.size) {
      await tx.update(cardSets).set({ totalCards: expected.size }).where(eq(cardSets.id, set.id));
    }
    return { added: missing.length, total: expected.size };
  });
}
