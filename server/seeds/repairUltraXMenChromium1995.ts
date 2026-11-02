import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { applyCardMergePairs } from './mergeDuplicateLegacySets';
import base from './data/ultra-x-men-chromium-1995-base.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Card = typeof cards.$inferSelect;
type Entry = { number: string; name: string; artist: string | null; type?: string };
type Kind = 'base' | 'gold' | 'alternate' | 'lethal';
const parentSlug = '1995-ultra-x-men-chromium';
const marker = 'repair_ultra_x_men_chromium_1995';
const alternateNames = ['Beast', 'Alter Beast', 'Bishop', 'Bishop', 'Cable', 'X-Man',
  'Cyclops', 'Cyclops', 'Forge', 'Forge', 'Jean Grey', 'Jean Grey', 'Mr. Sinister',
  'Sinister', 'Omega Red', 'Rossovich', 'Storm', 'Storm', 'Wolverine', 'Weapon X'];
const alternate: Entry[] = alternateNames.map((name, i) => ({
  number: String(i + 1), name,
  artist: [0, 1, 2, 3, 8, 9, 14, 15, 16, 17].includes(i) ? 'Andy Kubert' : 'Adam Kubert',
}));
const lethal: Entry[] = ['Archangel', 'Bishop', 'Cable', 'Domino', 'Gambit', 'Omega Red',
  'Psylocke', 'Random', 'Wolverine'].map((name, i) => ({
  number: String(i + 1), name, artist: [1, 3, 6, 7].includes(i) ? 'Adam Kubert' : 'Andy Kubert',
}));
export const chromiumChecklists: Record<Kind, Entry[]> = { base, gold: base, alternate, lethal };
export const chromiumSubsets: Record<Kind, { slug: string; name: string }> = {
  base: { slug: `${parentSlug}-1995-ultra-x-men-chromium-base`, name: 'Base' },
  gold: { slug: `1995-${parentSlug}-gold-signature`, name: 'Gold Signature' },
  alternate: { slug: `1995-${parentSlug}-alternate-x`, name: 'Alternate X Embossed' },
  lethal: { slug: `1995-${parentSlug}-lethal-weapons`, name: 'Lethal Weapons' },
};
const fail = (message: string): never => { throw new Error(`1995 Chromium repair: ${message}`); };
const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace('sabertooth', 'sabretooth');
function matches(card: Card, entry: Entry, kind: Kind) {
  if (card.cardNumber !== entry.number) return false;
  if (norm(card.name) === norm(entry.name)) return true;
  if ((kind === 'base' || kind === 'gold') && entry.name.includes(' as ')) {
    return norm(card.name) === norm(entry.name.split(' as ')[0]);
  }
  return kind === 'lethal' && card.cardNumber === '8' && card.name === 'Random - Leathal Weapons';
}

export async function repairChromiumChecklist(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
  const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, parentSlug));
  if (!main) return { skipped: true, merged: 0, added: 0 };
  if (main.name !== '1995 Ultra X-Men Chromium' || !main.isActive || main.archivedAt) fail('parent conflict');
  // Other application instances may still be writing collector references.
  await tx.execute(sql`LOCK TABLE cards, card_sets, user_collections, user_wishlists,
    pc_binder_cards, listings, xp_events IN SHARE ROW EXCLUSIVE MODE`);
  const sets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
  const activeSets = sets.filter(s => s.isActive && !s.archivedAt);
  const promo = activeSets.find(s => s.slug === `1995-${parentSlug}-promos`);
  if (activeSets.length !== 5 || !promo) fail('unexpected subset layout');
  const targets = new Map<Kind, typeof cardSets.$inferSelect>();
  for (const kind of Object.keys(chromiumSubsets) as Kind[]) {
    const set = activeSets.find(s => s.slug === chromiumSubsets[kind].slug);
    if (!set || set.year !== 1995) fail(`missing ${kind}`);
    targets.set(kind, set!);
  }
  const all = await tx.select().from(cards).where(inArray(cards.setId, activeSets.map(s => s.id)));
  const active = all.filter(c => !c.archivedAt);
  if (active.filter(c => c.setId === promo!.id).length !== 1) fail('promo count conflict');
  const before = await tx.execute(sql`SELECT uc.user_id, sum(uc.quantity)::text AS quantity
    FROM user_collections uc JOIN cards c ON c.id=uc.card_id
    WHERE c.set_id IN (${sql.join(activeSets.map(s => sql`${s.id}`), sql`,`)})
    GROUP BY uc.user_id ORDER BY uc.user_id`);
  const groups = new Map<string, Card[]>();
  for (const card of active.filter(c => c.setId !== promo!.id)) {
    const own = [...targets].find(([, set]) => set.id === card.setId)![0];
    let kind: Kind | undefined = chromiumChecklists[own].some(e => matches(card, e, own)) ? own : undefined;
    // Gold is a distinct physical parallel, never silently reinterpret as base.
    if (!kind && own !== 'gold') {
      const candidates = (['base', 'alternate', 'lethal'] as Kind[])
        .filter(k => chromiumChecklists[k].some(e => matches(card, e, k)));
      if (candidates.length === 1) kind = candidates[0];
      else if (candidates.length > 1 && card.frontImageUrl) {
        // Archangel #1 exists in Base and Lethal Weapons. The misplaced
        // Alternate X copy shares the exact Base image, not the holo image.
        const imageMatches = candidates.filter(k => active.some(c =>
          c.setId === targets.get(k)!.id && c.cardNumber === card.cardNumber &&
          c.frontImageUrl === card.frontImageUrl &&
          chromiumChecklists[k].some(e => matches(c, e, k))));
        if (imageMatches.length === 1) kind = imageMatches[0];
      }
    }
    if (!kind) fail(`unmatched/ambiguous card ${card.id}: ${card.cardNumber} ${card.name}`);
    const key = `${kind}:${card.cardNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  let added = 0;
  const pairs: { dup: number; surv: number }[] = [];
  for (const [kind, set] of targets) {
    for (const entry of chromiumChecklists[kind]) {
      const candidates = groups.get(`${kind}:${entry.number}`) ?? [];
      candidates.sort((a, b) => Number(b.setId === set.id) - Number(a.setId === set.id)
        || Number(b.name === entry.name) - Number(a.name === entry.name) || a.id - b.id);
      let survivor = candidates[0];
      if (!survivor) {
        [survivor] = await tx.insert(cards).values({
          setId: set.id, name: entry.name, cardNumber: entry.number,
          rarity: 'Common', isInsert: kind === 'alternate' || kind === 'lethal',
        }).returning();
        added++;
      }
      const details = [
        entry.artist ? `Artist: ${entry.artist}.` : '',
        entry.type ? `Type: ${entry.type}.` : '',
        kind === 'lethal' ? 'Holo-Flash; 1:6 packs; All-Chromium set only.' : '',
      ].filter(Boolean);
      let description = survivor.description ?? '';
      for (const detail of details) if (!description.includes(detail)) description += `${description ? '\n' : ''}${detail}`;
      const isInsert = kind === 'alternate' || kind === 'lethal';
      if (survivor.setId !== set.id || survivor.name !== entry.name ||
          survivor.isInsert !== isInsert || (survivor.description ?? '') !== description) {
        await tx.update(cards).set({ setId: set.id, name: entry.name, isInsert, description })
          .where(eq(cards.id, survivor.id));
      }
      pairs.push(...candidates.filter(c => c.id !== survivor.id).map(c => ({ dup: c.id, surv: survivor.id })));
    }
    if (set.name !== chromiumSubsets[kind].name || set.totalCards !== chromiumChecklists[kind].length ||
        set.isInsertSubset !== (kind === 'alternate' || kind === 'lethal')) {
      await tx.update(cardSets).set({
        name: chromiumSubsets[kind].name, totalCards: chromiumChecklists[kind].length,
        isInsertSubset: kind === 'alternate' || kind === 'lethal',
      }).where(eq(cardSets.id, set.id));
    }
  }
  await applyCardMergePairs(tx, pairs, marker, {
    imageTransferMode: 'missing-only', preserveCollectionMetadata: true,
  });
  const after = await tx.execute(sql`SELECT uc.user_id, sum(uc.quantity)::text AS quantity
    FROM user_collections uc JOIN cards c ON c.id=uc.card_id
    WHERE c.set_id IN (${sql.join(activeSets.map(s => sql`${s.id}`), sql`,`)})
    GROUP BY uc.user_id ORDER BY uc.user_id`);
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) fail('collector quantities changed');
  const final = await tx.select().from(cards).where(inArray(cards.setId, [...targets.values()].map(s => s.id)));
  for (const [kind, set] of targets) {
    const rows = final.filter(c => c.setId === set.id && !c.archivedAt);
    if (rows.length !== chromiumChecklists[kind].length ||
        chromiumChecklists[kind].some(e => rows.filter(c => c.cardNumber === e.number && c.name === e.name).length !== 1)) {
      fail(`terminal checklist mismatch: ${kind}`);
    }
  }
  return { skipped: false, merged: pairs.length, added };
}

export async function repairUltraXMenChromium1995() {
  return db.transaction(repairChromiumChecklist);
}
