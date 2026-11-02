import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import checklist from './data/topps-marvel-neon-2026.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const parentSlug = '2026-topps-marvel-neon';
const fail = (message: string): never => { throw new Error(`Neon checklist repair: ${message}`); };
const slugFor = (label: string) => `${parentSlug}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const upChecklist = checklist.filter(s => /^\d+ UP$/.test(s.name)).flatMap(s => s.cards);
const baseChecklist = checklist.find(s => s.name === 'BASE')!.cards;

/** Kept injectable so preservation and rollback are tested against real PostgreSQL. */
export async function repairNeonChecklist(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('upcoming-catalog-publication'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('repair_topps_neon_2026'))`);
  const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, parentSlug));
  if (!main) return { skipped: true, added: 0, moved: 0 };
  if (main.name !== '2026 Topps Marvel Neon' || main.archivedAt || !main.isActive) fail('parent identity conflict');
  if (upChecklist.length !== 10 || baseChecklist.length !== 200) fail('source counts changed');
  const sets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
  const base = sets.find(s => s.slug === slugFor('BASE'));
  const target = sets.find(s => s.slug === slugFor('1 UP'));
  if (!base || !target) fail('base or 1-Up subset missing');
  if (base!.name !== 'BASE' || !['1 UP', '1-Up'].includes(target!.name) ||
      base!.isInsertSubset || !target!.isInsertSubset) fail('source subset identity conflict');
  for (const set of [base!, target!]) {
    if (set.archivedAt || !set.isActive || set.year !== 2026) fail(`inactive source ${set.name}`);
  }
  const upSets = sets.filter(s => Array.from({ length: 10 }, (_, i) => slugFor(`${i + 1} UP`)).includes(s.slug));
  if (upSets.length !== 10) fail('expected all ten original UP subset identities');
  const upCards = await tx.select().from(cards).where(inArray(cards.setId, upSets.map(s => s.id)));
  const baseCards = await tx.select().from(cards).where(eq(cards.setId, base!.id));
  function validate(actual: typeof upCards, expected: typeof upChecklist, label: string, insert: boolean, complete = true) {
    const map = new Map(expected.map(c => [c.number, c.name]));
    const seen = new Set<string>();
    for (const card of actual) {
      if (seen.has(card.cardNumber) || map.get(card.cardNumber) !== card.name ||
          card.archivedAt || card.isInsert !== insert) fail(`unexpected card in ${label}: ${card.cardNumber}`);
      seen.add(card.cardNumber);
    }
    if (complete && seen.size !== map.size) fail(`incomplete ${label}`);
    return seen;
  }
  validate(upCards, upChecklist, '1-Up', true);
  validate(baseCards, baseChecklist, 'BASE', false);
  let moved = 0;
  // Move rows, not collectible identities: images, prices, ownership, wishlists,
  // binder references and XP remain attached to their original card IDs.
  const moveIds = upCards.filter(c => c.setId !== target!.id).map(c => c.id);
  if (moveIds.length) {
    await tx.update(cards).set({ setId: target!.id }).where(inArray(cards.id, moveIds));
    moved = moveIds.length;
  }
  await tx.update(cardSets).set({ name: '1-Up', totalCards: 10, isInsertSubset: true })
    .where(eq(cardSets.id, target!.id));
  const retired = upSets.filter(s => s.id !== target!.id);
  for (const set of retired) {
    if (set.name !== `${Number(set.slug.match(/-(\d+)-up$/)?.[1])} UP`) fail('unexpected retired subset identity');
    if (!set.archivedAt || set.isActive || set.totalCards !== 0) {
      await tx.update(cardSets).set({ totalCards: 0, isActive: false, archivedAt: set.archivedAt ?? new Date() })
        .where(eq(cardSets.id, set.id));
    }
  }
  let added = 0;
  const variants = [
    ...['Black', 'Orange', 'Red'].map(color => ({ name: `1-Up - ${color}`, expected: upChecklist, insert: true })),
    ...['Diamante Foil', 'Gold Diamante', 'Green Diamante', 'Orange Diamante', 'Purple Diamante']
      .map(name => ({ name, expected: baseChecklist, insert: false })),
  ];
  for (const variant of variants) {
    const slug = slugFor(variant.name);
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (set && (set.mainSetId !== main.id || set.name !== variant.name || set.year !== 2026 ||
        set.archivedAt || !set.isActive || set.isInsertSubset !== variant.insert)) fail(`identity conflict: ${variant.name}`);
    if (!set) {
      [set] = await tx.insert(cardSets).values({
        name: variant.name, slug, mainSetId: main.id, year: 2026,
        totalCards: variant.expected.length, isInsertSubset: variant.insert,
        isCanonical: true, canonicalSource: 'owner_checklist',
      }).returning();
    }
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = validate(existing, variant.expected, variant.name, variant.insert, false);
    const missing = variant.expected.filter(c => !seen.has(c.number));
    if (missing.length) {
      await tx.insert(cards).values(missing.map(c => ({
        setId: set.id, name: c.name, cardNumber: c.number, rarity: 'Common', isInsert: variant.insert,
      })));
      added += missing.length;
    }
    if (set.totalCards !== variant.expected.length) {
      await tx.update(cardSets).set({ totalCards: variant.expected.length }).where(eq(cardSets.id, set.id));
    }
  }
  return { skipped: false, added, moved };
}

export async function repairToppsNeon2026() {
  return db.transaction(repairNeonChecklist);
}
