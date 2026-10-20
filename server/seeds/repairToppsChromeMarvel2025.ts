import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { cards, cardSets, mainSets } from '../../shared/schema';
import { applyCardMergePairs } from './mergeDuplicateLegacySets';
// Derived from 2025_Topps_Marvel_Chrome_-_Sheet1_1792514124641.csv.
import checklist from './data/toppsChromeMarvel2025.json';

export const CHROME_MARVEL_2025_MARKER = 'repair_topps_chrome_marvel_2025_v1';
export const CHROME_MARVEL_2025_PARENT = '2025-topps-chrome-marvel';
export const CHROME_MARVEL_2025_PREFIX = '2025-2025-topps-chrome-marvel-';
const SOURCE = 'user-supplied-2025-topps-chrome-marvel-checklist';
export const CHROME_MARVEL_2025_VARIANTS = [
  ['base', 'Base', null],
  ['refractor', 'Refractor', '1:2 Hobby; 2 per Value Blaster box'],
  ['yellow-lava', 'Yellow Lava Refractor', '2 per box (Value Blaster exclusive)'],
  ['spider-web', 'Spider Web Refractor', '/399'],
  ['blue', 'Blue Refractor', '/299'],
  ['blue-green-shimmer', 'Blue & Green Shimmer Refractor', '/199'],
  ['iron-man-red-gold-lazer', 'Iron Man Red & Gold Lazer Refractor', '/100'],
  ['hulk-green-lazer', 'Hulk Green Lazer Refractor', '/99'],
  ['purple-shimmer', 'Purple Shimmer Refractor', '/75'],
  ['blue-red-spider-web', 'Blue & Red Spider Web Refractor', '/62'],
  ['gold-wave', 'Gold Wave Refractor', '/50'],
  ['rose-gold-mini-diamonds', 'Rose Gold Mini-Diamonds Refractor', '/40'],
  ['human-torch-refractor-red-orange', 'Human Torch Refractor (Red & Orange)', '/39'],
  ['orange', 'Orange Refractor', '/25'],
  ['orange-lava', 'Orange Lava Refractor', '/25'],
  ['black', 'Black Refractor', '/10'],
  ['red-wave', 'Red Wave Refractor', '/5'],
  ['red-shimmer', 'Red Shimmer Refractor', '/5'],
  ['superfractor', 'Superfractor', '1/1'],
  ['clawed-chrome', 'Base Clawed Chrome Stainless Steel', '/20'],
  ['clawed-chrome-black-refractor', 'Clawed Chrome Black Refractor', '/10'],
  ['clawed-chrome-red-refractor', 'Clawed Chrome Red Refractor', '/5'],
  ['clawed-chrome-superfractor', 'Clawed Chrome Superfractor', '1/1'],
] as const;

export const CHROME_MARVEL_2025_KAKAWOW_TARGETS = {
  B: '2025-kakawow-aura-marvel',
  CB: '2025-2025-kakawow-aura-marvel-marvel-iconic-debut',
  EB: '2025-2025-kakawow-aura-marvel-marvel-80s-legends',
} as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Card = typeof cards.$inferSelect;
type Pair = { dup: number; surv: number };
const norm = (name: string) => name.trim().toLowerCase();
const fail = (message: string): never => { throw new Error(`[Chrome Marvel 2025] ${message}`); };
const expectedByNumber = new Map(checklist.map(c => [c.num, c.name]));

function isChecklistIdentity(card: Card): boolean {
  const expected = expectedByNumber.get(card.cardNumber);
  // Explicit, scoped correction of the old parallel import's plural typo.
  return expected !== undefined && (norm(card.name) === norm(expected)
    || (card.name.endsWith(' (1st Appearance)')
      && norm(card.name.slice(0, -' (1st Appearance)'.length)) === norm(expected))
    || (card.cardNumber === '74' && card.name === 'The Makers'));
}

function isKnownSuperfractorStray(card: Card): boolean {
  return card.cardNumber === '2099' && card.name === 'Spider-Man 2099 #MO-SM';
}

// Covers every current cards FK, plus the polymorphic feed reference.
// Historical migration logs and price caches are retained, not discarded.
const REFERENCES = [
  ['user_collections', 'card_id'], ['user_wishlists', 'card_id'],
  ['pc_binder_cards', 'card_id'], ['listings', 'card_id'],
  ['pending_card_images', 'card_id'], ['xp_events', 'card_id'],
  ['scan_uploads', 'top_match_card_id'], ['scan_feedback', 'selected_card_id'],
  ['feed_events', 'related_id'], ['migration_log_cards', 'card_id'],
  ['card_price_cache', 'card_id'],
] as const;

async function readReferences(tx: Tx, ids: number[]) {
  const result: Record<string, Record<string, unknown>[]> = {};
  if (!ids.length) return result;
  const query = sql.join(REFERENCES.map(([table, column]) => sql`
      SELECT ${table}::text AS table_name,
        COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) AS rows
      FROM ${sql.raw(table)} r
      WHERE ${sql.raw(column)} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      ${table === 'feed_events' ? sql`AND related_type = 'card'` : sql``}`), sql` UNION ALL `);
  const rows = await tx.execute(query);
  for (const row of rows.rows) {
    result[String(row.table_name)] = row.rows as Record<string, unknown>[];
  }
  return result;
}

// Normalize only the allowed folds: owned quantities sum; wishlist/binder/XP
// membership is a set. All other reference rows and their metadata must survive.
function referenceSignature(
  refs: Awaited<ReturnType<typeof readReferences>>, pairs: Pair[],
): string {
  const mapping = new Map(pairs.map(p => [p.dup, p.surv]));
  const signature: Record<string, unknown> = {};
  for (const [table, column] of REFERENCES) {
    const normalized = new Map<string, number>();
    const rows = (refs[table] ?? []).map(original => {
      const row = { ...original };
      const cardId = Number(row[column]);
      row[column] = mapping.get(cardId) ?? cardId;
      if (table === 'user_collections' || table === 'user_wishlists'
        || table === 'pc_binder_cards' || table === 'xp_events') {
        const owner = table === 'pc_binder_cards' ? row.binder_id : row.user_id;
        const key = JSON.stringify([owner, row[column], table === 'xp_events' ? row.event_type : null]);
        normalized.set(key, table === 'user_collections'
          ? (normalized.get(key) ?? 0) + Number(row.quantity) : 1);
        return null;
      }
      // A collection fold changes its FK, not the listing's identity/metadata.
      if (table === 'listings') delete row.user_collection_id;
      return JSON.stringify(row);
    }).filter((row): row is string => row !== null).sort();
    signature[table] = { rows, memberships: [...normalized].sort(([a], [b]) => a.localeCompare(b)) };
  }
  return JSON.stringify(signature);
}

function assertNoReferences(refs: Awaited<ReturnType<typeof readReferences>>, label: string) {
  for (const [table, rows] of Object.entries(refs)) {
    if (rows.length) fail(`${label} still has ${rows.length} ${table} reference(s)`);
  }
}

function kakawowPairs(
  sources: Card[], targets: Card[], subsets: Map<string, typeof cardSets.$inferSelect>,
): Pair[] {
  return sources.map(source => {
    const match = /^AM-(B|CB|EB)-(\d{2})$/.exec(source.cardNumber);
    if (!match) return fail(`Unrecognized Base extra ${source.id}: ${source.cardNumber} ${source.name}`);
    const group = match[1] as keyof typeof CHROME_MARVEL_2025_KAKAWOW_TARGETS;
    const subset = subsets.get(CHROME_MARVEL_2025_KAKAWOW_TARGETS[group]);
    if (!subset) return fail(`Missing approved Kakawow destination for ${source.cardNumber}`);
    const matches = targets.filter(target => target.setId === subset.id
      && target.cardNumber === source.cardNumber && (norm(target.name) === norm(source.name)
        || (source.cardNumber === 'AM-B-30' && source.name === 'Ms. America' && target.name === 'Ms.America')
        || (source.cardNumber === 'AM-EB-08' && source.name === 'The Ballad of Beta Ray Bill'
          && target.name === 'The Ballad of Beta-Ray Bill')));
    if (matches.length !== 1) {
      return fail(`Expected one exact Kakawow identity for ${source.cardNumber} ${source.name}; found ${matches.length}`);
    }
    return { dup: source.id, surv: matches[0].id };
  });
}

/**
 * Repairs populated catalogs, not just empty ones. No hard deletes of cards,
 * no slug guesses, no number-only matching, and no existing image replacement.
 * Caller-owned transactions are supported for forced-rollback integration tests.
 */
export async function repairToppsChromeMarvel2025(transaction?: Tx): Promise<number> {
  if (!transaction) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(tx => repairToppsChromeMarvel2025(tx));
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (attempt >= 3 || !['40P01', '40001'].includes(code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  const tx = transaction;
  if (checklist.length !== 200 || checklist.some((c, i) => c.num !== String(i + 1) || !c.name)) {
    return fail('Invalid supplied checklist');
  }
  let marker = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${CHROME_MARVEL_2025_MARKER}`);
  if (!marker.rows.length) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${CHROME_MARVEL_2025_MARKER}))`);
    // The steady-state path is read-only: no advisory/table locks or updates.
    marker = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${CHROME_MARVEL_2025_MARKER}`);
    if (!marker.rows.length) {
      await tx.execute(sql`
        LOCK TABLE user_collections, user_wishlists, pc_binder_cards, listings,
          pending_card_images, xp_events, scan_uploads, scan_feedback, feed_events,
          card_price_cache, migration_log_cards, cards, card_sets, main_sets
        IN SHARE ROW EXCLUSIVE MODE`);
    }
  }
  const done = marker.rows.length > 0;
  const [parent] = await tx.select().from(mainSets).where(eq(mainSets.slug, CHROME_MARVEL_2025_PARENT));
  if (!parent || !parent.isActive || parent.archivedAt) return fail('Active parent missing');
  const targetSlugs = CHROME_MARVEL_2025_VARIANTS.map(([suffix]) => CHROME_MARVEL_2025_PREFIX + suffix);
  const subsets = await tx.select().from(cardSets).where(inArray(cardSets.slug, targetSlugs));
  const subsetBySlug = new Map(subsets.map(s => [s.slug, s]));
  for (const slug of targetSlugs) {
    const subset = subsetBySlug.get(slug);
    if (!subset) {
      if (done) return fail(`Completed subset missing: ${slug}`);
      continue;
    }
    if (subset.mainSetId !== parent.id || !subset.isActive || subset.archivedAt) {
      return fail(`Inactive or incorrectly parented approved subset: ${slug}`);
    }
  }
  const original = await tx.select().from(cards).where(inArray(cards.setId, subsets.map(s => s.id)));
  const base = subsetBySlug.get(CHROME_MARVEL_2025_PREFIX + 'base');
  const superfractor = subsetBySlug.get(CHROME_MARVEL_2025_PREFIX + 'superfractor');
  const extras = original.filter(c => c.setId === base?.id && /^AM-/.test(c.cardNumber));
  const stray = original.filter(c => c.setId === superfractor?.id && isKnownSuperfractorStray(c));
  const allowedExtraIds = new Set([...extras, ...stray].map(c => c.id));
  // Preflight all retained identities (including archived slots) before writes.
  for (const subset of subsets) {
    const seen = new Set<string>();
    for (const card of original.filter(c => c.setId === subset.id && !allowedExtraIds.has(c.id))) {
      if (!isChecklistIdentity(card) || card.archivedAt || seen.has(card.cardNumber)) {
        return fail(`Identity conflict in ${subset.slug}: ${card.id} #${card.cardNumber} ${card.name}`);
      }
      seen.add(card.cardNumber);
    }
  }
  let pairs: Pair[] = [];
  if (extras.length) {
    const [kakawow] = await tx.select().from(mainSets).where(eq(mainSets.slug, '2025-kakawow-aura-marvel'));
    if (!kakawow || !kakawow.isActive || kakawow.archivedAt) return fail('Active Kakawow parent missing');
    const destinations = await tx.select().from(cardSets)
      .where(inArray(cardSets.slug, Object.values(CHROME_MARVEL_2025_KAKAWOW_TARGETS)));
    if (destinations.length !== 3 || destinations.some(s => s.mainSetId !== kakawow.id || !s.isActive || s.archivedAt)) {
      return fail('Approved active Kakawow destination subsets missing');
    }
    const targetCards = await tx.select().from(cards)
      .where(and(inArray(cards.setId, destinations.map(s => s.id)), sql`${cards.archivedAt} IS NULL`));
    pairs = kakawowPairs(extras, targetCards, new Map(destinations.map(s => [s.slug, s])));
  }
  // This malformed insert is NOT base #112. Never convert it by number/name.
   // Historical price data stays attached to the archived identity; it is not
   // an owned copy and must never be copied onto a different Base card.
   const strayReferences = await readReferences(tx, stray.map(c => c.id));
   delete strayReferences.card_price_cache;
   assertNoReferences(strayReferences, 'Malformed Mask-Off Superfractor insert');
  const affectedIds = [...new Set(pairs.flatMap(p => [p.dup, p.surv]))];
  const before = done ? {} : await readReferences(tx, affectedIds);
  if (done) {
    if ([...extras, ...stray].some(c => !c.archivedAt)) return fail('Completion marker exists but extra cards remain active');
    assertNoReferences(await readReferences(tx, extras.map(c => c.id)), 'Archived Kakawow extras');
  } else {
    // Create only explicitly requested missing subsets, after all existing
    // identities and relocation destinations have passed the read preflight.
    for (const [suffix, label, description] of CHROME_MARVEL_2025_VARIANTS) {
      const slug = CHROME_MARVEL_2025_PREFIX + suffix;
      if (subsetBySlug.has(slug)) continue;
      const [created] = await tx.insert(cardSets).values({
        slug, name: `2025 Topps Chrome Marvel - ${label}`, description, year: 2025,
        mainSetId: parent.id, isActive: true, isCanonical: true,
        canonicalSource: SOURCE, isInsertSubset: false, totalCards: 0,
      }).returning();
      subsets.push(created);
      subsetBySlug.set(slug, created);
    }
    // The shared merger intentionally clears price caches and does not repoint
    // historical migration rows. Preserve both here before invoking it.
    if (pairs.length) {
      const values = sql.join(pairs.map(p => sql`(${p.dup}::integer, ${p.surv}::integer)`), sql`, `);
      await tx.execute(sql`WITH pairs(dup, surv) AS (VALUES ${values})
        UPDATE migration_log_cards r SET card_id = p.surv FROM pairs p WHERE r.card_id = p.dup`);
      await tx.execute(sql`WITH pairs(dup, surv) AS (VALUES ${values})
        UPDATE card_price_cache r SET card_id = p.surv FROM pairs p WHERE r.card_id = p.dup`);
    }
    // Reuse the shared deletion-aware collection-fold ledger: accountDeletion
    // scrubs its ownerId snapshots. Do not introduce a new private audit action.
    await applyCardMergePairs(tx, pairs, '2025 Chrome Marvel repair: misfiled Kakawow Aura identity', {
      imageTransferMode: 'missing-only', preserveCollectionMetadata: true,
    });
    for (const card of stray.filter(c => !c.archivedAt)) {
      await tx.update(cards).set({
        archivedAt: sql`now()`,
        archiveReason: '2025 Chrome Marvel repair: unreferenced malformed Mask-Off insert, not a Base Superfractor identity',
      }).where(eq(cards.id, card.id));
    }
    if (referenceSignature(before, pairs) !== referenceSignature(await readReferences(tx, affectedIds), pairs)) {
      return fail('Reference conservation check failed');
    }
    assertNoReferences(await readReferences(tx, extras.map(c => c.id)), 'Repointed Kakawow extras');
  }
  if (affectedIds.length) {
    const invalidListings = await tx.execute(sql`
      SELECT l.id FROM listings l
      LEFT JOIN user_collections uc ON uc.id = l.user_collection_id
      WHERE l.card_id IN (${sql.join(affectedIds.map(id => sql`${id}`), sql`, `)})
        AND (uc.id IS NULL OR uc.card_id <> l.card_id OR uc.user_id <> l.seller_id)`);
    if (invalidListings.rows.length) return fail('Listing collection linkage conservation check failed');
  }
  let inserted = 0;
  for (const [suffix, label, description] of CHROME_MARVEL_2025_VARIANTS) {
    const subset = subsetBySlug.get(CHROME_MARVEL_2025_PREFIX + suffix)!;
    const retained = original.filter(c => c.setId === subset.id && !allowedExtraIds.has(c.id));
    const have = new Set(retained.map(c => c.cardNumber));
    const missing = checklist.filter(c => !have.has(c.num));
    if (done && missing.length) return fail(`Completed checklist drift in ${subset.slug}`);
    if (!done) {
      if (missing.length) {
        await tx.insert(cards).values(missing.map(c => ({
          setId: subset.id, cardNumber: c.num, name: c.name, rarity: 'Common', isInsert: false,
        })));
        inserted += missing.length;
      }
      for (const card of retained) {
        const name = expectedByNumber.get(card.cardNumber)!;
        if (card.name !== name || card.isInsert) {
          const annotation = card.name.endsWith(' (1st Appearance)') ? '1st Appearance' : null;
          await tx.update(cards).set({
            name, isInsert: false,
            ...(annotation && !card.description?.includes(annotation)
              ? { description: [card.description, annotation].filter(Boolean).join('; ') } : {}),
          }).where(eq(cards.id, card.id));
        }
      }
      await tx.update(cardSets).set({
        name: `2025 Topps Chrome Marvel - ${label}`, totalCards: 200,
        ...(suffix === 'base' ? {} : { description }),
        isCanonical: true, canonicalSource: SOURCE, isInsertSubset: false,
      }).where(eq(cardSets.id, subset.id));
    }
  }
  if (!done) {
    await tx.update(mainSets).set({ isCanonical: true, canonicalSource: SOURCE }).where(eq(mainSets.id, parent.id));
  }
  // Validate exact terminal identities and flags, even on marker/no-op runs.
  const terminal = await tx.select().from(cards)
    .where(and(inArray(cards.setId, subsets.map(s => s.id)), sql`${cards.archivedAt} IS NULL`));
  const terminalSets = await tx.select().from(cardSets).where(inArray(cardSets.id, subsets.map(s => s.id)));
  for (const [suffix, label, description] of CHROME_MARVEL_2025_VARIANTS) {
    const subset = terminalSets.find(s => s.slug === CHROME_MARVEL_2025_PREFIX + suffix)!;
    const rows = terminal.filter(c => c.setId === subset.id);
    if (rows.length !== 200 || new Set(rows.map(c => c.cardNumber)).size !== 200
      || rows.some(c => expectedByNumber.get(c.cardNumber) !== c.name || c.isInsert)
      || !subset.isCanonical || !subset.isActive || subset.archivedAt || subset.isInsertSubset
      || subset.totalCards !== 200 || subset.mainSetId !== parent.id
      || subset.name !== `2025 Topps Chrome Marvel - ${label}`
      || (suffix !== 'base' && subset.description !== description)
      || subset.canonicalSource !== SOURCE) {
      return fail(`Terminal checklist/metadata validation failed: ${suffix}`);
    }
  }
  const [terminalParent] = await tx.select().from(mainSets).where(eq(mainSets.id, parent.id));
  if (!terminalParent.isCanonical || terminalParent.canonicalSource !== SOURCE) return fail('Parent canonical flags missing');
  if (!done) {
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${CHROME_MARVEL_2025_MARKER})`);
  }
  return inserted;
}
