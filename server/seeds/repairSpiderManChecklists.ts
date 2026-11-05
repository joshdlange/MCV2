import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import topps from './data/topps-spider-man-2002-base.json';
import ultra from './data/ultra-spider-man-1995-base.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const marker = 'repair_spider_man_owner_checklists';
export const spiderManTargets = [
  { parent: '2002-topps-spider-man', slug: '2002-topps-spider-man-2002-topps-spider-man-base',
    year: 2002, label: 'Base', checklist: topps },
  { parent: '1995-fleer-ultra-spider-man', slug: 'marvel-1995-ultra-spider-man',
    year: 1995, label: 'Base', checklist: ultra },
  { parent: '1995-fleer-ultra-spider-man', slug: '1995-fleer-ultra-spider-man-gold-foil-signature-series',
    year: 1995, label: 'Gold Foil Signature Series', checklist: ultra },
];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Only known spelling/truncation and checklist section labels are aliases.
// Different names at the same number are NOT evidence of the same card.
function identityName(name: string, label: string) {
  if (label === 'Gold Foil Signature Series') name = name.replace(/\s*(LGC|MS|VF)$/, '');
  if (name === 'Demobgoblin') name = 'Demogoblin';
  if (name === 'Return of the Spider') name = 'Return of the Spider-Clone';
  return norm(name);
}

export async function repairSpiderManChecklist(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
  await tx.execute(sql`LOCK TABLE cards, card_sets IN SHARE ROW EXCLUSIVE MODE`);
  let added = 0;
  let reviewed = 0;
  for (const target of spiderManTargets) {
    const [parent] = await tx.select().from(mainSets).where(eq(mainSets.slug, target.parent));
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, target.slug));
    if (!parent || !parent.isActive || parent.archivedAt || !set || set.mainSetId !== parent.id ||
        set.year !== target.year || !set.isActive || set.archivedAt) {
      throw new Error(`Spider-Man checklist: missing/conflicting ${target.slug}`);
    }
    const expected = target.checklist;
    if (expected.length !== (target.year === 2002 ? 80 : 150) ||
        expected.some((e, i) => e.number !== String(i + 1))) throw new Error('Invalid supplied checklist');
    const existing = (await tx.select().from(cards).where(eq(cards.setId, set.id)))
      .filter(c => !c.archivedAt).sort((a, b) => a.id - b.id);
    const seen = new Set<string>();
    const questionable: number[] = [];
    for (const card of existing) {
      const entry = expected.find(e => e.number === card.cardNumber &&
        norm(e.name) === identityName(card.name, target.label));
      // Preserve even duplicate identities for review rather than merge ownership.
      if (!entry || seen.has(entry.number)) {
        questionable.push(card.id);
        continue;
      }
      seen.add(entry.number);
      if (card.name !== entry.name) await tx.update(cards).set({ name: entry.name }).where(eq(cards.id, card.id));
    }
    const reviewSlug = `${target.slug}-checklist-review`;
    let [review] = await tx.select().from(cardSets).where(eq(cardSets.slug, reviewSlug));
    if (review && (review.mainSetId !== parent.id || review.year !== target.year ||
        !review.isActive || review.archivedAt)) throw new Error(`Conflicting review subset ${reviewSlug}`);
    if (questionable.length) {
      if (!review) [review] = await tx.insert(cardSets).values({
        slug: reviewSlug, mainSetId: parent.id, year: target.year,
        name: `${target.label} — Checklist Review`,
        description: 'Unverified legacy entries retained for review. Not part of the official checklist. Original card identities, images and collector records are preserved.',
        isInsertSubset: true, isCanonical: false, totalCards: 0,
      }).returning();
      await tx.execute(sql`UPDATE cards SET set_id=${review.id}
        WHERE id IN (${sql.join(questionable.map(id => sql`${id}`), sql`,`)})`);
      reviewed += questionable.length;
    }
    if (review) {
      const count = await tx.execute(sql`SELECT count(*)::int AS n FROM cards WHERE set_id=${review.id} AND archived_at IS NULL`);
      await tx.update(cardSets).set({ totalCards: Number(count.rows[0].n) }).where(eq(cardSets.id, review.id));
    }
    const missing = expected.filter(e => !seen.has(e.number));
    if (missing.length) await tx.insert(cards).values(missing.map(e => ({
      setId: set.id, cardNumber: e.number, name: e.name, rarity: 'Common', isInsert: false,
    })));
    added += missing.length;
    await tx.update(cardSets).set({
      totalCards: expected.length, isCanonical: true, canonicalSource: 'owner_checklist',
    }).where(eq(cardSets.id, set.id));
    const final = (await tx.select().from(cards).where(eq(cards.setId, set.id))).filter(c => !c.archivedAt);
    if (final.length !== expected.length || expected.some(e =>
      final.filter(c => c.cardNumber === e.number && c.name === e.name).length !== 1)) {
      throw new Error(`Spider-Man terminal checklist mismatch: ${target.slug}`);
    }
  }
  return { added, reviewed };
}

export async function repairSpiderManChecklists() {
  return db.transaction(repairSpiderManChecklist);
}
