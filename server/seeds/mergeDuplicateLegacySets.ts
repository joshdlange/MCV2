import { db } from '../db';
import { mainSets, cardSets, cards } from '../../shared/schema';
import { eq, and, inArray, sql, isNull } from 'drizzle-orm';
// Reference transfer is done set-based below (a batched version of
// dataQualityAudit's transferReferencesAndArchive) so ~1,100 card merges
// commit in seconds instead of minutes of per-card round trips.

/**
 * One-time idempotent remediation: merge legacy duplicate sets into their
 * canonical counterparts, then retire the legacy sets.
 *
 * Everything is resolved by SLUG (never by numeric id) and cards are matched
 * by card number + normalized name at runtime, so the same code is safe to
 * run against dev and prod even if row ids differ.
 *
 * Covered duplicates (legacy -> canonical):
 *  - "Marvel 1992 Masterpieces" main set (old base subset + its Feb-2026
 *    "-base" duplicate) -> "1992 SkyBox Marvel Masterpieces" (base + Battle
 *    Spectra; "Johnny Blaze" maps to "Blaze").
 *  - "Marvel 1993 Masterpieces" main set -> "1993 SkyBox Marvel Masterpieces"
 *    (spacing/typo names like "CaptainAmerica" map via squashed-name match).
 *  - Orphan subset "1994 Fleer Marvel Masterpieces Hildebrandt Brothers" ->
 *    main set of the same name ("N of 10" holofoils -> Gold Holofoils).
 *  - Orphan subset "1995 Fleer Marvel Masterpieces" -> main set of the same
 *    name ("N of 22" -> Canvas, "N/8" -> Holoflash).
 *  - 2023 UD Marvel Platinum: attach the orphan base subset to its main set
 *    (renamed "... - Base") and merge the Feb-2026 duplicate subset into it.
 *    (Survivor card #149 is renamed to "Thunderbolts" to match every
 *    parallel checklist in the product.)
 *  - Deactivate the empty orphan subset "2020 Upper Deck Marvel Avengers
 *    Endgame & Captain Marvel".
 *
 * Safety rules:
 *  - A legacy card with ANY user references (collection/wishlist/binder/etc.)
 *    that cannot be matched to a canonical card aborts the whole transaction.
 *  - Unmatched cards with zero references are soft-archived.
 *  - Legacy cards are soft-archived (never deleted); legacy subsets/main sets
 *    are deactivated + archived, not deleted.
 *  - Runs under an advisory lock; already-retired sources make it a no-op.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CardRow = typeof cards.$inferSelect;

const LOG = '[Legacy Set Merge]';

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Applied only as a fallback when the exact normalized name does not match.
const NAME_ALIASES: Record<string, string> = {
  johnnyblaze: 'blaze',                       // 1992 #2 official checklist name
  sabretooth: 'sabertooth',                   // 1994 PowerBlast PB8 spelling
  spidermansymbiotesuit: 'spidermansymbiote', // Platinum #83 duplicate naming
};

interface NumberRule {
  re: RegExp;               // matched against the trimmed legacy card number
  targetSubsetSlug: string; // subset the rewritten number lives in
}

interface MergeGroup {
  label: string;
  sourceSubsetSlugs: string[];      // legacy subsets to drain & retire
  targetMainSlug?: string;          // match into all active subsets of this main set
  targetSubsetSlugs?: string[];     // ...or into this explicit subset list
  retireMainSlug?: string;          // legacy main set to deactivate afterwards
  numberRules?: NumberRule[];
  numberOnlyFallback?: boolean;     // allow unique-number match when names differ
}

const GROUPS: MergeGroup[] = [
  {
    label: '1992 Masterpieces',
    sourceSubsetSlugs: [
      '1992-skybox-marvel-masterpieces',
      'marvel-1992-masterpieces--marvel-1992-masterpieces--base',
    ],
    targetMainSlug: '1992-skybox-marvel-masterpieces',
    retireMainSlug: 'marvel-1992-masterpieces',
  },
  {
    label: '1993 Masterpieces',
    sourceSubsetSlugs: [
      '1993-skybox-marvel-masterpieces',
      'marvel-1993-masterpieces-marvel-1993-masterpieces-base',
    ],
    targetMainSlug: '1993-skybox-marvel-masterpieces',
    retireMainSlug: 'marvel-1993-masterpieces',
  },
  {
    label: '1994 Hildebrandt',
    sourceSubsetSlugs: ['1994-fleer-marvel-masterpieces-hildebrandt-brothers'],
    targetMainSlug: '1994-fleer-marvel-masterpieces-hildebrandt-brothers',
    numberRules: [
      {
        re: /^(\d+) of 10$/i,
        targetSubsetSlug: '1994-1994-fleer-marvel-masterpieces-hildebrandt-brothers-gold-holofoils',
      },
    ],
  },
  {
    label: '1995 Fleer Masterpieces',
    sourceSubsetSlugs: ['1995-fleer-marvel-masterpieces'],
    targetMainSlug: '1995-fleer-marvel-masterpieces',
    numberRules: [
      { re: /^(\d+) of 22$/i, targetSubsetSlug: '1995-1995-fleer-marvel-masterpieces-canvas' },
      { re: /^(\d+)\/8$/, targetSubsetSlug: '1995-1995-fleer-marvel-masterpieces-holoflash' },
    ],
  },
  {
    label: '2023 UD Platinum base',
    sourceSubsetSlugs: ['2023-upper-deck-marvel-platinum--2023-upper-deck-marvel-platinum--base'],
    targetSubsetSlugs: ['2023-2023-upper-deck-marvel-platinum-base'],
    numberOnlyFallback: true,
  },
];

const PLATINUM_MAIN_SLUG = '2023-upper-deck-marvel-platinum';
const PLATINUM_BASE_SLUG = '2023-2023-upper-deck-marvel-platinum-base';
const EMPTY_ORPHAN_SLUG = '2020-upper-deck-marvel-avengers-endgame-captain-marvel';

async function refCount(tx: Tx, cardId: number): Promise<number> {
  const r: any = await tx.execute(sql`
    SELECT (SELECT count(*) FROM user_collections WHERE card_id = ${cardId})
         + (SELECT count(*) FROM user_wishlists WHERE card_id = ${cardId})
         + (SELECT count(*) FROM pc_binder_cards WHERE card_id = ${cardId})
         + (SELECT count(*) FROM listings WHERE card_id = ${cardId})
         + (SELECT count(*) FROM xp_events WHERE card_id = ${cardId})
         + (SELECT count(*) FROM pending_card_images WHERE card_id = ${cardId})
         + (SELECT count(*) FROM scan_uploads WHERE top_match_card_id = ${cardId})
         + (SELECT count(*) FROM scan_feedback WHERE selected_card_id = ${cardId}) AS n`);
  return Number(r.rows?.[0]?.n ?? 0);
}

function pickUnique(cands: CardRow[]): CardRow | null {
  return cands.length === 1 ? cands[0] : null;
}

/**
 * Choose a survivor when several target subsets share the same checklist
 * (e.g. Base + Jusko Signed Parallel): prefer the "- Base" subset, then any
 * subset that isn't a parallel/promo/autograph-style insert.
 */
function pickPreferred(cands: CardRow[], subsetById: Map<number, typeof cardSets.$inferSelect>): CardRow | null {
  if (cands.length === 1) return cands[0];
  if (cands.length === 0) return null;
  const inBase = cands.filter((c) => /\s-\s*base\s*$/i.test(subsetById.get(c.setId)?.name ?? ''));
  if (inBase.length === 1) return inBase[0];
  const nonParallel = cands.filter(
    (c) => !/parallel|promo|autograph|signed|sketch|foil|holo/i.test(subsetById.get(c.setId)?.name ?? ''),
  );
  if (nonParallel.length === 1) return nonParallel[0];
  return null;
}

/**
 * Set-based equivalent of dataQualityAudit's transferReferencesAndArchive for
 * a batch of (dup -> survivor) pairs already loaded into the merge_pairs temp
 * table. Handles multiple dups mapping to one survivor, and users who own
 * several dups of the same survivor, without violating unique constraints.
 */
async function applyPairBatch(tx: Tx, archiveReason: string): Promise<void> {
  // --- user_collections (unique user_id+card_id; quantities merge) ---
  await tx.execute(sql`
    UPDATE user_collections uc SET quantity = uc.quantity + agg.q
    FROM (SELECT d.user_id, p.surv_id, sum(d.quantity) q
          FROM user_collections d JOIN merge_pairs p ON d.card_id = p.dup_id
          WHERE EXISTS (SELECT 1 FROM user_collections s WHERE s.user_id = d.user_id AND s.card_id = p.surv_id)
          GROUP BY 1, 2) agg
    WHERE uc.user_id = agg.user_id AND uc.card_id = agg.surv_id`);
  // listings.user_collection_id is a required FK — repoint any listing that
  // references a dup collection row onto the surviving collection row BEFORE
  // that dup row is deleted.
  await tx.execute(sql`
    UPDATE listings l SET user_collection_id = s.id
    FROM user_collections d
    JOIN merge_pairs p ON d.card_id = p.dup_id
    JOIN user_collections s ON s.user_id = d.user_id AND s.card_id = p.surv_id
    WHERE l.user_collection_id = d.id`);
  await tx.execute(sql`
    DELETE FROM user_collections d USING merge_pairs p
    WHERE d.card_id = p.dup_id
      AND EXISTS (SELECT 1 FROM user_collections s WHERE s.user_id = d.user_id AND s.card_id = p.surv_id)`);
  // Fold multiple remaining dup rows per (user, survivor) into one keeper row
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, d.user_id, d.quantity, p.surv_id,
             row_number() OVER (PARTITION BY d.user_id, p.surv_id ORDER BY d.id) rn
      FROM user_collections d JOIN merge_pairs p ON d.card_id = p.dup_id)
    UPDATE user_collections k SET quantity = k.quantity + x.extra
    FROM ranked r1
    JOIN (SELECT user_id, surv_id, sum(quantity) extra FROM ranked WHERE rn > 1 GROUP BY 1, 2) x
      ON x.user_id = r1.user_id AND x.surv_id = r1.surv_id AND r1.rn = 1
    WHERE k.id = r1.id`);
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, d.user_id, p.surv_id,
             row_number() OVER (PARTITION BY d.user_id, p.surv_id ORDER BY d.id) rn,
             first_value(d.id) OVER (PARTITION BY d.user_id, p.surv_id ORDER BY d.id) keeper_id
      FROM user_collections d JOIN merge_pairs p ON d.card_id = p.dup_id)
    UPDATE listings l SET user_collection_id = r.keeper_id
    FROM ranked r WHERE r.rn > 1 AND l.user_collection_id = r.id`);
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, row_number() OVER (PARTITION BY d.user_id, p.surv_id ORDER BY d.id) rn
      FROM user_collections d JOIN merge_pairs p ON d.card_id = p.dup_id)
    DELETE FROM user_collections k USING ranked r WHERE k.id = r.id AND r.rn > 1`);
  await tx.execute(sql`
    UPDATE user_collections d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);

  // --- user_wishlists (unique user_id+card_id; dups dropped) ---
  await tx.execute(sql`
    DELETE FROM user_wishlists d USING merge_pairs p
    WHERE d.card_id = p.dup_id
      AND EXISTS (SELECT 1 FROM user_wishlists s WHERE s.user_id = d.user_id AND s.card_id = p.surv_id)`);
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, row_number() OVER (PARTITION BY d.user_id, p.surv_id ORDER BY d.id) rn
      FROM user_wishlists d JOIN merge_pairs p ON d.card_id = p.dup_id)
    DELETE FROM user_wishlists k USING ranked r WHERE k.id = r.id AND r.rn > 1`);
  await tx.execute(sql`
    UPDATE user_wishlists d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);

  // --- pc_binder_cards (unique binder_id+card_id; dups dropped) ---
  await tx.execute(sql`
    DELETE FROM pc_binder_cards d USING merge_pairs p
    WHERE d.card_id = p.dup_id
      AND EXISTS (SELECT 1 FROM pc_binder_cards s WHERE s.binder_id = d.binder_id AND s.card_id = p.surv_id)`);
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, row_number() OVER (PARTITION BY d.binder_id, p.surv_id ORDER BY d.id) rn
      FROM pc_binder_cards d JOIN merge_pairs p ON d.card_id = p.dup_id)
    DELETE FROM pc_binder_cards k USING ranked r WHERE k.id = r.id AND r.rn > 1`);
  await tx.execute(sql`
    UPDATE pc_binder_cards d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);

  // --- other references: straight repoint / cleanup ---
  await tx.execute(sql`UPDATE pending_card_images d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);
  await tx.execute(sql`UPDATE listings d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);
  // xp_events has a unique (user_id, event_type, card_id) anti-farming index:
  // drop dup-side events that would collide, then repoint the rest.
  await tx.execute(sql`
    DELETE FROM xp_events d USING merge_pairs p
    WHERE d.card_id = p.dup_id
      AND EXISTS (SELECT 1 FROM xp_events s
                  WHERE s.user_id = d.user_id AND s.event_type = d.event_type AND s.card_id = p.surv_id)`);
  await tx.execute(sql`
    WITH ranked AS (
      SELECT d.id, row_number() OVER (PARTITION BY d.user_id, d.event_type, p.surv_id ORDER BY d.id) rn
      FROM xp_events d JOIN merge_pairs p ON d.card_id = p.dup_id)
    DELETE FROM xp_events k USING ranked r WHERE k.id = r.id AND r.rn > 1`);
  await tx.execute(sql`UPDATE xp_events d SET card_id = p.surv_id FROM merge_pairs p WHERE d.card_id = p.dup_id`);
  await tx.execute(sql`UPDATE scan_uploads d SET top_match_card_id = p.surv_id FROM merge_pairs p WHERE d.top_match_card_id = p.dup_id`);
  await tx.execute(sql`UPDATE scan_feedback d SET selected_card_id = p.surv_id FROM merge_pairs p WHERE d.selected_card_id = p.dup_id`);
  await tx.execute(sql`DELETE FROM card_price_cache d USING merge_pairs p WHERE d.card_id = p.dup_id`);

  // Carry over images when the survivor is missing them
  await tx.execute(sql`
    UPDATE cards s SET front_image_url = d.front_image_url
    FROM merge_pairs p JOIN cards d ON d.id = p.dup_id
    WHERE s.id = p.surv_id AND s.front_image_url IS NULL AND d.front_image_url IS NOT NULL`);
  await tx.execute(sql`
    UPDATE cards s SET back_image_url = d.back_image_url
    FROM merge_pairs p JOIN cards d ON d.id = p.dup_id
    WHERE s.id = p.surv_id AND s.back_image_url IS NULL AND d.back_image_url IS NOT NULL`);

  // Soft-archive the duplicates (never hard-delete)
  await tx.execute(sql`
    UPDATE cards c SET archived_at = now(),
      archive_reason = ${archiveReason} || ' (merged into card ' || p.surv_id || ')'
    FROM merge_pairs p WHERE c.id = p.dup_id`);
}

async function mergeGroup(tx: Tx, group: MergeGroup): Promise<void> {
  const sources = await tx.select().from(cardSets).where(
    and(inArray(cardSets.slug, group.sourceSubsetSlugs), eq(cardSets.isActive, true)),
  );
  if (sources.length === 0) {
    console.log(`${LOG} ${group.label}: sources already retired — skipping`);
    return;
  }

  // Resolve target subsets
  let targetSubsets: (typeof cardSets.$inferSelect)[] = [];
  if (group.targetMainSlug) {
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, group.targetMainSlug));
    if (!main) throw new Error(`${group.label}: target main set slug "${group.targetMainSlug}" not found`);
    const sourceIds = new Set(sources.map((s) => s.id));
    targetSubsets = (await tx.select().from(cardSets)
      .where(and(eq(cardSets.mainSetId, main.id), eq(cardSets.isActive, true))))
      .filter((s) => !sourceIds.has(s.id));
  }
  if (group.targetSubsetSlugs?.length) {
    const extra = await tx.select().from(cardSets).where(
      and(inArray(cardSets.slug, group.targetSubsetSlugs), eq(cardSets.isActive, true)),
    );
    if (extra.length !== group.targetSubsetSlugs.length) {
      throw new Error(`${group.label}: some explicit target subsets missing/inactive`);
    }
    targetSubsets = targetSubsets.concat(extra);
  }
  if (targetSubsets.length === 0) throw new Error(`${group.label}: no target subsets resolved`);

  const targetIds = targetSubsets.map((s) => s.id);
  const subsetById = new Map(targetSubsets.map((s) => [s.id, s]));
  const subsetIdBySlug = new Map(targetSubsets.map((s) => [s.slug, s.id]));
  const targetCards = await tx.select().from(cards)
    .where(and(inArray(cards.setId, targetIds), isNull(cards.archivedAt)));

  // Index: num -> cards, and (num|normName) -> cards
  const byNum = new Map<string, CardRow[]>();
  const byNumName = new Map<string, CardRow[]>();

  let moved = 0, archivedUnref = 0;
  const pairs: Array<{ dup: number; surv: number }> = [];

  // The canonical subsets themselves occasionally contain identical twin
  // rows (same subset + number + normalized name). Fold twins into one
  // survivor (prefer the one with an image, then lowest id) so matching is
  // unambiguous and the canonical set comes out clean.
  const twinGroups = new Map<string, CardRow[]>();
  for (const c of targetCards) {
    const k = `${c.setId}|${(c.cardNumber ?? '').trim()}|${normName(c.name)}|${normName(c.variation ?? '')}`;
    (twinGroups.get(k) ?? twinGroups.set(k, []).get(k)!).push(c);
  }
  const dedupedTargets: CardRow[] = [];
  for (const grp of twinGroups.values()) {
    grp.sort((a, b) => (b.frontImageUrl ? 1 : 0) - (a.frontImageUrl ? 1 : 0) || a.id - b.id);
    dedupedTargets.push(grp[0]);
    for (const twin of grp.slice(1)) {
      pairs.push({ dup: twin.id, surv: grp[0].id });
      moved++;
    }
  }

  for (const c of dedupedTargets) {
    const num = (c.cardNumber ?? '').trim();
    (byNum.get(num) ?? byNum.set(num, []).get(num)!).push(c);
    const k = `${num}|${normName(c.name)}`;
    (byNumName.get(k) ?? byNumName.set(k, []).get(k)!).push(c);
  }
  for (const src of sources) {
    const srcCards = await tx.select().from(cards)
      .where(and(eq(cards.setId, src.id), isNull(cards.archivedAt)));
    for (const card of srcCards) {
      const num = (card.cardNumber ?? '').trim();
      const nm = normName(card.name);

      // Tier 1: exact number + normalized name
      let survivor = pickPreferred(byNumName.get(`${num}|${nm}`) ?? [], subsetById);
      // Tier 2: aliased name
      if (!survivor && NAME_ALIASES[nm]) {
        survivor = pickPreferred(byNumName.get(`${num}|${NAME_ALIASES[nm]}`) ?? [], subsetById);
      }
      // Tier 3: number rewrite rules into a specific subset
      if (!survivor && group.numberRules) {
        for (const rule of group.numberRules) {
          const m = num.match(rule.re);
          if (!m) continue;
          const subsetId = subsetIdBySlug.get(rule.targetSubsetSlug);
          if (!subsetId) throw new Error(`${group.label}: rule subset ${rule.targetSubsetSlug} not in targets`);
          const inSubset = (byNum.get(m[1]) ?? []).filter((c) => c.setId === subsetId);
          survivor = pickUnique(inSubset.filter((c) => {
            const tn = normName(c.name);
            return tn === nm || tn === NAME_ALIASES[nm];
          })) ?? pickUnique(inSubset);
          if (survivor) break;
        }
      }
      // Tier 4: unique number-only match (Platinum, where names drifted)
      if (!survivor && group.numberOnlyFallback) {
        survivor = pickPreferred(byNum.get(num) ?? [], subsetById);
      }

      if (!survivor) {
        const refs = await refCount(tx, card.id);
        if (refs > 0) {
          throw new Error(
            `${group.label}: card "${card.cardNumber} ${card.name}" (id ${card.id}) has ${refs} user reference(s) but no canonical match — aborting merge`,
          );
        }
        await tx.update(cards)
          .set({ archivedAt: new Date(), archiveReason: `Legacy duplicate set retired (${group.label}); no canonical match; unreferenced` })
          .where(eq(cards.id, card.id));
        archivedUnref++;
        continue;
      }

      pairs.push({ dup: card.id, surv: survivor.id });
      moved++;
    }
  }

  // Apply all repointing for the group in one set-based batch
  await tx.execute(sql`CREATE TEMP TABLE IF NOT EXISTS merge_pairs (dup_id integer PRIMARY KEY, surv_id integer NOT NULL) ON COMMIT DROP`);
  await tx.execute(sql`TRUNCATE merge_pairs`);
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500);
    await tx.execute(sql`
      INSERT INTO merge_pairs (dup_id, surv_id)
      VALUES ${sql.join(chunk.map((p) => sql`(${p.dup}, ${p.surv})`), sql`, `)}`);
  }
  if (pairs.length > 0) {
    await applyPairBatch(tx, `Legacy duplicate set merged (${group.label})`);
  }

  for (const src of sources) {
    await tx.update(cardSets)
      .set({ isActive: false, archivedAt: new Date() })
      .where(eq(cardSets.id, src.id));
  }

  // Retire the legacy main set once its subsets are drained
  if (group.retireMainSlug) {
    const [legacyMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, group.retireMainSlug));
    if (legacyMain && legacyMain.isActive) {
      const leftover: any = await tx.execute(sql`
        SELECT count(*) AS n FROM cards c
        JOIN card_sets cs ON cs.id = c.set_id
        WHERE cs.main_set_id = ${legacyMain.id} AND cs.is_active = true AND c.archived_at IS NULL`);
      if (Number(leftover.rows?.[0]?.n ?? 0) > 0) {
        throw new Error(`${group.label}: legacy main set still has active cards — refusing to retire`);
      }
      await tx.update(mainSets)
        .set({ isActive: false, archivedAt: new Date() })
        .where(eq(mainSets.id, legacyMain.id));
    }
  }

  // Refresh cached counts on target subsets
  for (const t of targetSubsets) {
    await tx.execute(sql`
      UPDATE card_sets SET total_cards =
        (SELECT count(*) FROM cards WHERE set_id = ${t.id} AND archived_at IS NULL)
      WHERE id = ${t.id}`);
  }

  console.log(`${LOG} ${group.label}: repointed ${moved} card(s), archived ${archivedUnref} unreferenced unmatched card(s)`);
}

export async function mergeDuplicateLegacySets(): Promise<void> {
  // Cheap idempotency probe before taking the lock
  const allSourceSlugs = GROUPS.flatMap((g) => g.sourceSubsetSlugs);
  const active = await db.select({ id: cardSets.id }).from(cardSets)
    .where(and(inArray(cardSets.slug, allSourceSlugs), eq(cardSets.isActive, true)));
  const [orphan] = await db.select().from(cardSets)
    .where(and(eq(cardSets.slug, EMPTY_ORPHAN_SLUG), eq(cardSets.isActive, true)));
  const [platBase] = await db.select().from(cardSets).where(eq(cardSets.slug, PLATINUM_BASE_SLUG));
  const needsPlatinumAttach = platBase && platBase.mainSetId == null;
  if (active.length === 0 && !orphan && !needsPlatinumAttach) {
    console.log(`${LOG} Nothing to do — all legacy duplicate sets already retired`);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);

    // Pre-step: attach the orphan Platinum base subset to its main set and
    // align card #149 with the checklist used by every parallel subset.
    if (needsPlatinumAttach) {
      const [platMain] = await tx.select().from(mainSets).where(eq(mainSets.slug, PLATINUM_MAIN_SLUG));
      if (!platMain) throw new Error('Platinum main set not found by slug');
      await tx.update(cardSets)
        .set({ mainSetId: platMain.id, name: '2023 Upper Deck Marvel Platinum - Base' })
        .where(eq(cardSets.id, platBase!.id));
      await tx.execute(sql`
        UPDATE cards SET name = 'Thunderbolts'
        WHERE set_id = ${platBase!.id} AND trim(card_number) = '149'
          AND name = 'Firestar' AND archived_at IS NULL`);
      console.log(`${LOG} Attached Platinum base subset to its main set`);
    }

    for (const group of GROUPS) {
      await mergeGroup(tx, group);
    }

    // Deactivate the empty orphan subset (only if it truly has no active cards)
    if (orphan) {
      const n: any = await tx.execute(sql`
        SELECT count(*) AS n FROM cards WHERE set_id = ${orphan.id} AND archived_at IS NULL`);
      if (Number(n.rows?.[0]?.n ?? 0) === 0) {
        await tx.update(cardSets)
          .set({ isActive: false, archivedAt: new Date() })
          .where(eq(cardSets.id, orphan.id));
        console.log(`${LOG} Deactivated empty orphan subset "${orphan.name}"`);
      }
    }
  });

  console.log(`${LOG} Complete`);
}
