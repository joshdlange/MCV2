import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets } from '../../shared/schema';
import { applyCardMergePairs } from './mergeDuplicateLegacySets';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Card = typeof cards.$inferSelect;
const marker = 'owner_base_audit_corrections';
export const auditSlugs = {
  universe90: '1990-1990-impel-marvel-universe-base',
  universe92: '1992-1992-impel-marvel-universe-base',
  holograms92: '1992-1992-impel-marvel-universe-holograms',
  universe93: '1993-1993-skybox-marvel-universe-base',
  red93: '1993-1993-skybox-marvel-universe-red-foil-2099',
  holo93: '1993-1993-skybox-marvel-universe-3-d-hologram-card',
  flair95: '1995-1995-flair-marvel-annual-base',
  promos95: '1995-1995-flair-marvel-annual-promos',
  retro15: '2015-2015-fleer-retro-marvel-base',
  masterpieces18: '2018-2018-upper-deck-marvel-masterpieces-base',
  gold18: '2018-2018-upper-deck-marvel-masterpieces-gold-foil',
};
const fail = (message: string): never => { throw new Error(`Base audit repair: ${message}`); };

export async function repairOwnerBaseAuditTx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${marker}))`);
  await tx.execute(sql`LOCK TABLE cards,card_sets,user_collections,user_wishlists,pc_binder_cards,listings,xp_events IN SHARE ROW EXCLUSIVE MODE`);
  const touched = new Set<number>();
  const pairs: { dup: number; surv: number }[] = [];
  let added = 0, moved = 0, renumbered = 0;
  const resolve = async (slug: string) => {
    const [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (!set || !set.isActive || set.archivedAt || !set.mainSetId) fail(`missing/conflicting ${slug}`);
    touched.add(set.id);
    return set;
  };
  const rows = async (id: number) => (await tx.select().from(cards).where(eq(cards.setId, id))).filter(c => !c.archivedAt);
  const one = (list: Card[], number: string, name: string) => {
    const found = list.filter(c => c.cardNumber === number && c.name === name);
    if (found.length !== 1) fail(`expected one ${number} ${name}, got ${found.length}`);
    return found[0];
  };
  const sameParent = (a: typeof cardSets.$inferSelect, b: typeof cardSets.$inferSelect) => {
    if (a.mainSetId !== b.mainSetId || a.year !== b.year) fail('subset parent mismatch');
  };
  const base90 = await resolve(auditSlugs.universe90);
  for (const [oldNumber, number, oldName, name] of [
    ['39', '135', 'Tales of Suspense', 'Tales of Suspense #39'],
    ['4', '136', 'Avengers', 'Avengers #4'],
  ]) {
    const current = await rows(base90.id);
    const old = current.filter(c => c.cardNumber === oldNumber && c.name === oldName);
    if (old.length) {
      if (old.length !== 1 || current.some(c => c.cardNumber === number)) fail(`occupied 1990 slot ${number}`);
      await tx.update(cards).set({ cardNumber: number, name }).where(eq(cards.id, old[0].id));
      renumbered++;
    } else one(current, number, name);
  }

  const base92 = await resolve(auditSlugs.universe92), holo92 = await resolve(auditSlugs.holograms92);
  sameParent(base92, holo92);
  for (const [i, name] of ['Hulk', 'Thing', 'Wolverine', 'Venom', 'Ghost Rider'].entries()) {
    const number = `H-${i + 1}`;
    const target = one(await rows(holo92.id), number, name);
    const sources = (await rows(base92.id)).filter(c => c.cardNumber === number);
    for (const source of sources) {
      if (source.name !== name) fail(`unexpected 1992 ${number}`);
      pairs.push({ dup: source.id, surv: target.id });
    }
  }
  const base93 = await resolve(auditSlugs.universe93), red93 = await resolve(auditSlugs.red93);
  sameParent(base93, red93);
  const redNames = [
    ['Doom 2099', 'Doom 2099'], ['Vulture 2099', 'Vulture 2099'], ['Ravage 2099', 'Ravage 2099'],
    ['Fearmaster 2099', 'Fearmaster'], ['Spider-Man 2099', 'Spider-Man 2099'],
    ['Punisher 2099', 'Punisher 2099'], ['Specialist 2099', 'Specialist'],
    ['Dethstryk 2099', 'Dethstryk'], ['Tiger Wylde 2099', 'Tiger Wylde'],
  ];
  for (const [i, [sourceName, targetName]] of redNames.entries()) {
    const target = one(await rows(red93.id), String(i + 1), targetName);
    for (const source of (await rows(base93.id)).filter(c => c.cardNumber === String(i + 1) && c.name === sourceName)) {
      pairs.push({ dup: source.id, surv: target.id });
    }
  }
  // The owner requested notification rather than creation if no subset exists.
  const holo93 = await resolve(auditSlugs.holo93);
  sameParent(base93, holo93);
  const hologramSources = (await rows(base93.id)).filter(c => c.cardNumber === 'H-IV');
  for (const source of hologramSources) {
    if (source.name !== 'Spider-Man vs. Venom') fail('1993 hologram identity');
    const targets = await rows(holo93.id);
    if (targets.length) {
      const target = one(targets, 'H-IV', source.name);
      pairs.push({ dup: source.id, surv: target.id });
    } else {
      await tx.update(cards).set({ setId: holo93.id, isInsert: true }).where(eq(cards.id, source.id));
      moved++;
    }
  }
  one(await rows(holo93.id), 'H-IV', 'Spider-Man vs. Venom');

  const flair = await resolve(auditSlugs.flair95), promo = await resolve(auditSlugs.promos95);
  sameParent(flair, promo);
  const promoTarget = one(await rows(promo.id), 'NNO', "4-up Panel, Copyright '94");
  for (const source of (await rows(flair.id)).filter(c => c.cardNumber === '1' && c.name === '4 Card Uncut Card Promo Sheet')) {
    pairs.push({ dup: source.id, surv: promoTarget.id });
  }
  const sabretooth = one(await rows(flair.id), '10', 'Sabretooth');
  for (const source of (await rows(flair.id)).filter(c => c.cardNumber === '10' && c.name === 'Sabertooth')) {
    pairs.push({ dup: source.id, surv: sabretooth.id });
  }
  await applyCardMergePairs(tx, pairs, marker, { imageTransferMode: 'missing-only', preserveCollectionMetadata: true });

  const retro = await resolve(auditSlugs.retro15), mm = await resolve(auditSlugs.masterpieces18);
  for (const [setId, number, name] of [
    [retro.id, '25', 'Hulk'], [mm.id, '83', 'Phoenix'],
    [mm.id, '88', 'Captain America'], [mm.id, '89', 'Iron Man'],
  ] as const) {
    const occupants = (await rows(setId)).filter(c => c.cardNumber === number);
    if (occupants.length) one(occupants, number, name);
    else {
      await tx.insert(cards).values({ setId, cardNumber: number, name, rarity: 'Common', isInsert: false });
      added++;
    }
  }
  const gold = await resolve(auditSlugs.gold18);
  sameParent(mm, gold);
  const baseCards = await rows(mm.id), goldCards = await rows(gold.id);
  for (const card of baseCards) {
    const matches = goldCards.filter(c => c.cardNumber === card.cardNumber);
    if (matches.length > 1) fail('duplicate Gold Signature number');
    if (!matches.length) {
      await tx.insert(cards).values({ setId: gold.id, cardNumber: card.cardNumber, name: card.name, rarity: 'Common' });
      added++;
    } else if (matches[0].name !== card.name) {
      if (card.cardNumber !== '56' || card.name !== 'Kang the Conqueror' || matches[0].name !== 'Kang The Conquerer') {
        fail(`Gold Signature identity mismatch ${card.cardNumber}`);
      }
      await tx.update(cards).set({ name: card.name }).where(eq(cards.id, matches[0].id));
    }
  }
  await tx.update(cardSets).set({ name: 'Gold Signature' }).where(eq(cardSets.id, gold.id));

  // Explicit packaging labels only: "Box" is a Marvel character, not packaging.
  const packaging = await tx.execute(sql`SELECT c.id,s.id AS set_id,s.slug,s.year,s.main_set_id
    FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
    WHERE c.archived_at IS NULL AND s.archived_at IS NULL AND s.is_active AND m.archived_at IS NULL AND m.is_active
    AND (s.slug LIKE '%-base' OR lower(s.name)='base' OR s.slug='marvel-1996-fleer-amalgam')
    AND lower(trim(c.name)) IN ('hobby box','blaster box','hanger pack','hobby pack','sealed box','booster box','retail box')`);
  for (const row of packaging.rows) {
    const slug = `${row.slug}-sealed-products`;
    let [set] = await tx.select().from(cardSets).where(eq(cardSets.slug, slug));
    if (!set) [set] = await tx.insert(cardSets).values({
      slug, name: 'Sealed Products (Not Base Cards)', year: Number(row.year),
      mainSetId: Number(row.main_set_id), isInsertSubset: true,
      description: 'Legacy box and pack records retained outside the base checklist to preserve collector holdings.',
    }).returning();
    if (set.mainSetId !== Number(row.main_set_id) || !set.isActive || set.archivedAt) fail('sealed products subset conflict');
    await tx.update(cards).set({ setId: set.id }).where(eq(cards.id, Number(row.id)));
    touched.add(Number(row.set_id)); touched.add(set.id);
    moved++;
  }
  for (const id of touched) await tx.update(cardSets).set({ totalCards: (await rows(id)).length }).where(eq(cardSets.id, id));
  for (const [id, count] of [[base90.id,162],[base92.id,200],[base93.id,180],[flair.id,150],[retro.id,60],[mm.id,90],[gold.id,90]]) {
    const list = await rows(id);
    if (list.length !== count || Array.from({ length: count }, (_, i) => String(i + 1))
      .some(n => list.filter(c => c.cardNumber === n).length !== 1)) fail(`terminal sequence ${id}`);
  }
  return { added, merged: pairs.length, moved, renumbered };
}

export async function repairOwnerBaseAudit() {
  return db.transaction(repairOwnerBaseAuditTx);
}
