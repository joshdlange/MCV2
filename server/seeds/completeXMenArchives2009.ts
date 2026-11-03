import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import supplied from './data/x-men-archives-2009.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Entry = { number: string; name: string; description: string };
const slug = '2009-rittenhouse-x-men-archives';
const name = '2009 Rittenhouse X-Men Archives';
const definitions: { source?: keyof typeof supplied; suffix: string; label: string; count: number }[] = [
  { source: 'Base', suffix: 'base', label: 'Base', count: 72 },
  { source: 'Nemesis Cards', suffix: 'nemesis', label: 'Nemesis Cards', count: 9 },
  { source: 'Ready-for-Action Cover Gallery', suffix: 'ready-for-action', label: 'Ready-for-Action Cover Gallery', count: 9 },
  { source: 'Legendary Heroes', suffix: 'legendary-heroes', label: 'Legendary Heroes', count: 10 },
  { source: 'Colored Sketch Cards', suffix: 'sketches', label: 'Colored Sketch Cards', count: 86 },
  { source: 'Case Topper X-Men Team Card', suffix: 'case-toppers', label: 'Case Topper X-Men Team Card', count: 3 },
  { source: 'PROMO CARDS', suffix: 'promos', label: 'Promos', count: 5 },
  { suffix: 'multiple-case-purchase-incentive-sketches', label: 'Multiple-Case Purchase Incentive Sketches', count: 1 },
];
const caseNames = ['Juggernaut / Rogue / Psylocke', 'Beast / Cable / Wolverine', 'Storm / Phoenix / Nightcrawler / Colossus'];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const fail = (s: string): never => { throw new Error(`X-Men Archives import: ${s}`); };

/** Add missing cards to existing subsets; never replace collector identities/images. */
export async function completeArchivesChecklist(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('complete_x_men_archives_2009'))`);
  const parents = await tx.select().from(mainSets).where(sql`${mainSets.slug}=${slug} OR lower(${mainSets.name})=lower(${name})`);
  if (parents.length > 1) fail('duplicate main sets');
  let main = parents[0];
  if (!main) [main] = await tx.insert(mainSets).values({
    name, slug, isCanonical: true, canonicalSource: 'owner_checklist',
  }).returning();
  if (main.slug !== slug || main.name !== name || main.archivedAt || !main.isActive) fail('main-set identity conflict');
  const children = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
  const setSlug = (suffix: string) => suffix === 'base' ? `${slug}-${slug}-base` : `2009-${slug}-${suffix}`;
  if (children.some(s => !definitions.some(d => setSlug(d.suffix) === s.slug))) fail('unexpected subset');
  let added = 0;
  for (const def of definitions) {
    const expected: Entry[] = def.source ? supplied[def.source].map(c => ({ ...c })) : [
      { number: 'NNO', name: 'Renae DeLiz', description: 'Multiple-case purchase incentive sketch.' },
    ];
    if (def.suffix === 'legendary-heroes') expected.push({
      number: 'LH10', name: 'Shadowcat', description: 'Short print.',
    });
    if (def.suffix === 'case-toppers') expected.forEach((c, i) => { c.name = caseNames[i]; });
    if (def.suffix === 'promos') expected.find(c => c.number === 'P1')!.name = 'X-Men';
    // Sketch codes repeat in the supplied sheet. Artist + code identifies each
    // checklist entry; these are not invented serial numbers for physical sketches.
    const key = (c: Entry) => `${c.number}|${norm(c.name)}`;
    if (expected.length !== def.count || new Set(expected.map(key)).size !== def.count) fail(`invalid supplied ${def.label}`);
    let set = children.find(s => s.slug === setSlug(def.suffix));
    if (!set) [set] = await tx.insert(cardSets).values({
      name: def.label, slug: setSlug(def.suffix), year: 2009, mainSetId: main.id,
      isInsertSubset: def.suffix !== 'base', totalCards: def.count,
      isCanonical: true, canonicalSource: 'owner_checklist',
    }).returning();
    if (set.year !== 2009 || set.archivedAt || !set.isActive) fail(`subset conflict ${def.label}`);
    const existing = await tx.select().from(cards).where(eq(cards.setId, set.id));
    const seen = new Set<string>();
    for (const card of existing) {
      let match = expected.find(e => e.number === card.cardNumber && norm(e.name) === norm(card.name));
      if (!match && def.suffix === 'sketches' && card.cardNumber === 'NNO' && card.name === 'Kristin AllenSKH') {
        match = expected.find(e => e.name === 'Kristin Allen');
      }
      const aliases: Record<string, string> = {
        'nemesis|N1|Mr. Sinister': 'Mister Sinister',
        'legendary-heroes|LH7|Professor X': 'Professor Charles Xavier',
        'legendary-heroes|LH10|ShadowcatSP': 'Shadowcat',
        'multiple-case-purchase-incentive-sketches|NNO|Renae DeLizSKH': 'Renae DeLiz',
        'promos|CP2|Philly Non-Sports Show': 'Philly Non-Sport Show',
      };
      const alias = aliases[`${def.suffix}|${card.cardNumber}|${card.name}`];
      if (!match && alias) match = expected.find(e => e.number === card.cardNumber && e.name === alias);
      if (!match || card.archivedAt || seen.has(key(match))) fail(`card conflict ${def.label}: ${card.cardNumber} ${card.name}`);
      seen.add(key(match));
      const description = match.description && !card.description?.includes(match.description)
        ? [card.description, match.description].filter(Boolean).join('\n') : card.description;
      if (card.name !== match.name || card.cardNumber !== match.number || description !== card.description ||
          card.isInsert !== (def.suffix !== 'base')) {
        await tx.update(cards).set({
          name: match.name, cardNumber: match.number, description, isInsert: def.suffix !== 'base',
        }).where(eq(cards.id, card.id));
      }
    }
    const missing = expected.filter(e => !seen.has(key(e)));
    if (missing.length) await tx.insert(cards).values(missing.map(e => ({
      setId: set!.id, cardNumber: e.number, name: e.name, description: e.description || null,
      rarity: 'Common', isInsert: def.suffix !== 'base',
    })));
    added += missing.length;
    if (set.name !== def.label || set.totalCards !== def.count || !set.isCanonical || set.isInsertSubset !== (def.suffix !== 'base')) {
      await tx.update(cardSets).set({
        name: def.label, totalCards: def.count, isCanonical: true,
        canonicalSource: 'owner_checklist', isInsertSubset: def.suffix !== 'base',
      }).where(eq(cardSets.id, set.id));
    }
  }
  return { added, total: 195, subsets: 8 };
}

export async function completeXMenArchives2009() {
  return db.transaction(completeArchivesChecklist);
}
