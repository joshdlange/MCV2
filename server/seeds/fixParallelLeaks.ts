import { db } from '../db';
import { cardSets, cards } from '../../shared/schema';
import { eq, and, sql, isNull, like, inArray, not } from 'drizzle-orm';

/**
 * Idempotent fix: parallel cards that leaked into base/insert set checklists.
 *
 * Audit query that found these:
 *   SELECT cs.name, count(*) FROM cards c JOIN card_sets cs ON cs.id=c.set_id
 *   WHERE c.archived_at IS NULL AND c.name ~ '\[.+\]' GROUP BY 1 ORDER BY 2 DESC
 *
 * Products fixed:
 *  1. TCMS 2025 – Autographs, TVA Pruning → move to existing parallel sets
 *  2. TCMS 2025 – Sketch Artists, Daredevil Born Again → create missing sets + move
 *  3. TCMS 2025 – SELF strips (parallel set cards decorated with their own label)
 *  4. 2025 Topps Chrome Marvel inserts – move to existing sibling sets
 *  5. 2025 Topps Finest X-Men '97 new inserts – move to existing sibling sets
 *  6. 2025 Topps Finest X-Men '97 old base/inserts – create missing parallels + move
 *  7. Women of Marvel Battle Time – move to existing sibling sets
 *  8. Sapphire Selections – move to existing sibling sets
 *  9. Wandavision base – move to existing, archive ambiguous
 * 10. 2023 Eternals – create parallel sets + move
 * 11. 2024 UD Marvel Studios S1 – canvas (move), portraits Gold (move)
 * 12. Marvel 2025 Topps Chrome old base – create parallel sets + move
 * 13. Kakawow The Legend of Iron Man Gold – create refractor parallel sets + move
 * 14. 2025 Topps Chrome Marvel facsimile/writer autograph sets – create + move
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Repoint any collection/wishlist/binder entries from fromCardId → toCardId, then archive from.
 * Embeds `[canonical=N]` in the archive_reason so that retroactive binder repair passes
 * can resolve source→canonical without a database-wide name search.
 */
async function repointAndArchive(tx: Tx, fromCardId: number, toCardId: number, reason: string) {
  if (fromCardId !== toCardId) {
    // user_collections: merge quantities, then move non-duplicate rows, then drop stragglers
    await tx.execute(sql`
      UPDATE user_collections t SET quantity = t.quantity + d.quantity
      FROM user_collections d
      WHERE t.user_id = d.user_id AND t.card_id = ${toCardId} AND d.card_id = ${fromCardId}`);
    await tx.execute(sql`
      UPDATE user_collections uc SET card_id = ${toCardId}
      WHERE uc.card_id = ${fromCardId}
        AND NOT EXISTS (SELECT 1 FROM user_collections t WHERE t.user_id = uc.user_id AND t.card_id = ${toCardId})`);
    await tx.execute(sql`DELETE FROM user_collections WHERE card_id = ${fromCardId}`);
    // user_wishlists: same pattern
    await tx.execute(sql`
      UPDATE user_wishlists uw SET card_id = ${toCardId}
      WHERE uw.card_id = ${fromCardId}
        AND NOT EXISTS (SELECT 1 FROM user_wishlists t WHERE t.user_id = uw.user_id AND t.card_id = ${toCardId})`);
    await tx.execute(sql`DELETE FROM user_wishlists WHERE card_id = ${fromCardId}`);
    // pc_binder_cards: drop rows where binder already holds the canonical card, then repoint
    await tx.execute(sql`
      DELETE FROM pc_binder_cards
      WHERE card_id = ${fromCardId}
        AND binder_id IN (SELECT binder_id FROM pc_binder_cards WHERE card_id = ${toCardId})`);
    await tx.execute(sql`
      UPDATE pc_binder_cards SET card_id = ${toCardId} WHERE card_id = ${fromCardId}`);
  }
  // Embed canonical card ID in archive reason so future binder-repair passes
  // can deterministically reconstruct source→canonical without name searches.
  const fullReason = fromCardId !== toCardId ? `${reason} [canonical=${toCardId}]` : reason;
  await tx.update(cards)
    .set({ archivedAt: sql`now()`, archiveReason: fullReason })
    .where(eq(cards.id, fromCardId));
}

/** Resolve set ID by slug. Returns null if not found. */
async function resolveSet(tx: Tx, slug: string): Promise<number | null> {
  const rows = await tx.select({ id: cardSets.id }).from(cardSets).where(eq(cardSets.slug, slug));
  return rows[0]?.id ?? null;
}

/**
 * Ensure a card_set row exists (by slug). Creates it if missing.
 * Returns the set ID.
 */
async function ensureSet(
  tx: Tx,
  slug: string,
  name: string,
  year: number,
  mainSetId: number | null,
): Promise<number> {
  const existing = await resolveSet(tx, slug);
  if (existing) return existing;
  const [row] = await tx.insert(cardSets).values({
    name, slug, year, mainSetId, isActive: true, isCanonical: true, totalCards: 0,
  }).onConflictDoNothing({ target: cardSets.slug }).returning({ id: cardSets.id });
  if (row) return row.id;
  // Race: another instance created it
  const again = await resolveSet(tx, slug);
  if (again) return again;
  throw new Error(`Failed to create set: ${slug}`);
}

/** Strip one bracket label from a name. "Iron Man [Gold]" → "Iron Man". */
function stripLabel(name: string, label: string): string {
  return name.replace(new RegExp(`\\s*\\[${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*`, 'g'), ' ').trim();
}

/** Strip ALL bracket labels from a name. */
function stripAllLabels(name: string): string {
  return name.replace(/\s*\[.+?\]\s*/g, ' ').trim();
}

/**
 * Move stray cards (those with [label] in their name) from sourceSetId to targetSetId.
 * Matching is done by card_number (normal sets). When multiple strays share the same
 * card_number, match by cleaned name instead. When a clean card already occupies the
 * slot in the target set, repoint collections and archive the stray; otherwise move.
 */
async function moveStraysByNumber(
  tx: Tx,
  sourceSetId: number,
  targetSetId: number,
  label: string,
  reason: string,
): Promise<{ moved: number; merged: number }> {
  const strays = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
    .from(cards)
    .where(and(
      eq(cards.setId, sourceSetId),
      isNull(cards.archivedAt),
      like(cards.name, `%[${label}]%`),
    ));

  let moved = 0, merged = 0;
  for (const stray of strays) {
    const cleanName = stripLabel(stray.name, label);
    // Find the canonical in the target set: must match BOTH card_number AND stripped name.
    // Do NOT fall back to an arbitrary candidate — a name mismatch means a different card
    // occupies the slot and needs manual review, not an automated merge.
    const candidates = await tx.select({ id: cards.id, name: cards.name })
      .from(cards)
      .where(and(eq(cards.setId, targetSetId), eq(cards.cardNumber, stray.cardNumber), isNull(cards.archivedAt)));
    const match = candidates.find(c => c.name === cleanName);
    if (match) {
      // Exact card_number + name match → merge (repoint collections/binders, archive source).
      await repointAndArchive(tx, stray.id, match.id, reason);
      merged++;
    } else if (candidates.length === 0) {
      // Target slot is empty → move the stray card there directly.
      await tx.update(cards).set({ setId: targetSetId, name: cleanName }).where(eq(cards.id, stray.id));
      moved++;
    } else {
      // Target slot is occupied by a different card — skip; leave for manual review.
      console.warn(`[ParallelLeakFix] Slot occupied by different card: stray=${stray.id} "${cleanName}" #${stray.cardNumber} → target set ${targetSetId} (${candidates.length} occupant(s))`);
    }
  }
  return { moved, merged };
}

/**
 * Move stray cards matching [label] from sourceSetId to targetSetId, matching by
 * cleaned name (for sets where card_number is unreliable, e.g. autographs all #1).
 */
async function moveStraysByName(
  tx: Tx,
  sourceSetId: number,
  targetSetId: number,
  label: string,
  reason: string,
): Promise<{ moved: number; merged: number }> {
  const strays = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
    .from(cards)
    .where(and(
      eq(cards.setId, sourceSetId),
      isNull(cards.archivedAt),
      like(cards.name, `%[${label}]%`),
    ));

  const existing = await tx.select({ id: cards.id, name: cards.name })
    .from(cards)
    .where(and(eq(cards.setId, targetSetId), isNull(cards.archivedAt)));
  const byName = new Map(existing.map(c => [c.name, c.id]));

  let moved = 0, merged = 0;
  for (const stray of strays) {
    const cleanName = stripLabel(stray.name, label);
    const existingId = byName.get(cleanName);
    if (existingId) {
      await repointAndArchive(tx, stray.id, existingId, reason);
      merged++;
    } else {
      await tx.update(cards).set({ setId: targetSetId, name: cleanName }).where(eq(cards.id, stray.id));
      byName.set(cleanName, stray.id); // prevent double-move if duplicates
      moved++;
    }
  }
  return { moved, merged };
}

/**
 * Strip label decorations from cards already in the correct parallel set.
 * "Iron Man [Gold]" in the Gold Refractor set → "Iron Man".
 * Merges with existing clean-named card if present.
 */
async function selfStripLabels(
  tx: Tx,
  setId: number,
  label: string,
  reason: string,
): Promise<{ stripped: number; merged: number }> {
  const strays = await tx.select({ id: cards.id, cardNumber: cards.cardNumber, name: cards.name })
    .from(cards)
    .where(and(eq(cards.setId, setId), isNull(cards.archivedAt), like(cards.name, `%[${label}]%`)));

  const existing = await tx.select({ id: cards.id, name: cards.name })
    .from(cards)
    .where(and(eq(cards.setId, setId), isNull(cards.archivedAt), not(like(cards.name, `%[${label}]%`))));
  const byName = new Map(existing.map(c => [c.name, c.id]));

  let stripped = 0, merged = 0;
  for (const stray of strays) {
    const cleanName = stripLabel(stray.name, label);
    const existingId = byName.get(cleanName);
    if (existingId) {
      await repointAndArchive(tx, stray.id, existingId, reason);
      merged++;
    } else {
      await tx.update(cards).set({ name: cleanName }).where(eq(cards.id, stray.id));
      byName.set(cleanName, stray.id);
      stripped++;
    }
  }
  return { stripped, merged };
}

/** Archive strays with an ambiguous label (e.g. [Printing Plate] without a color). */
async function archiveStrays(
  tx: Tx,
  setId: number,
  label: string,
  reason: string,
): Promise<number> {
  const strays = await tx.select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.setId, setId), isNull(cards.archivedAt), like(cards.name, `%[${label}]%`)));
  for (const s of strays) await repointAndArchive(tx, s.id, s.id, reason);
  return strays.length;
}

/** Recalculate totalCards for a set. */
async function syncTotal(tx: Tx, setId: number) {
  await tx.update(cardSets)
    .set({ totalCards: sql`(SELECT count(*)::int FROM ${cards} WHERE ${cards.setId} = ${setId} AND ${cards.archivedAt} IS NULL)` })
    .where(eq(cardSets.id, setId));
}

const MARKER = 'parallel_leak_fix_v1';
const MARKER_V2 = 'parallel_leak_fix_v2';
const MARKER_V3 = 'parallel_leak_fix_v3';

/** v2 patch: SELF-strip missed parallel sets + X-Men '97 Remember It inserts. */
async function fixParallelLeaksV2(): Promise<void> {
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER_V2}`);
  if (((done as any).rows ?? []).length > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-parallel-leaks-v2'))`);
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER_V2}`);
    if (((again as any).rows ?? []).length > 0) return;

    // SELF strips missed in v1 (parallel sets whose cards still carry the label)
    const v2SelfSets: Array<[number, string]> = [
      [2493, 'Black Refractor'],    // air-marvel-black-refractor
      [2494, 'Red Wave Refractor'], // air-marvel-red-wave-refractor
      [6466, 'Black Refractor'],    // 50-years-of-nightcrawler-black-refractor
      [6462, 'Black Refractor'],    // 35-years-of-ghost-rider-black-refractor
      [6463, 'Red Wave Refractor'], // 35-years-of-ghost-rider-red-wave-refractor
      [6469, 'SuperFractor'],       // 50-years-of-nightcrawler-superfractor
      [6543, 'SuperFractor'],       // 2025-topps-chrome-marvel-superfractor
    ];
    let v2Stripped = 0, v2Merged = 0;
    for (const [setId, label] of v2SelfSets) {
      const r = await selfStripLabels(tx, setId, label, `Parallel leak fix v2: self-strip [${label}]`);
      v2Stripped += r.stripped; v2Merged += r.merged;
      if (r.stripped + r.merged) await syncTotal(tx, setId);
    }

    // X-Men '97 "Remember It" (7428) → existing sibling sets
    const rememberItMoves: Array<[string, string]> = [
      ['Laser Refractor', '2025-2025-topps-finest-x-men-97-remember-it-laser-refractor'],
      ['SuperFractor',    '2025-2025-topps-finest-x-men-97-remember-it-superfractor'],
      ['X-Fractor',       '2025-2025-topps-finest-x-men-97-remember-it-x-fractor'],
    ];
    let riMoved = 0, riMerged = 0;
    for (const [label, slug] of rememberItMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix v2] Remember It target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, 7428, tid, label,
        `Parallel leak fix v2: X-Men '97 Remember It [${label}] moved`);
      riMoved += r.moved; riMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (riMoved + riMerged) await syncTotal(tx, 7428);

    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER_V2}) ON CONFLICT (name) DO NOTHING`);
    console.log(`[ParallelLeakFix v2] self-strip: stripped=${v2Stripped} merged=${v2Merged}; Remember It: moved=${riMoved} merged=${riMerged}`);
  });
}

/**
 * v3 patch: retroactively fix stale pc_binder_cards rows left over from the v1
 * run, which merged cards before binder repointing was added to repointAndArchive.
 *
 * repointAndArchive now embeds `[canonical=N]` in every merge's archive_reason.
 * v3 uses that tag for a fully deterministic repoint — no name searches, no
 * cross-set guessing. v1 rows that pre-date the tag are retained for review
 * (not deleted) because we cannot safely determine their correct target.
 */
async function fixParallelLeaksV3(): Promise<void> {
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER_V3}`);
  if (((done as any).rows ?? []).length > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-parallel-leaks-v3'))`);
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER_V3}`);
    if (((again as any).rows ?? []).length > 0) return;

    // Find binder slots whose card was archived by any parallel-leak-fix pass.
    const staleResult = await tx.execute(sql`
      SELECT pbc.id, pbc.binder_id, pbc.card_id, c.archive_reason
      FROM pc_binder_cards pbc
      JOIN cards c ON c.id = pbc.card_id
      WHERE c.archived_at IS NOT NULL
        AND c.archive_reason LIKE 'Parallel leak fix%'`);
    const staleRows: Array<{ id: number; binder_id: number; card_id: number; archive_reason: string }> =
      (staleResult as any).rows ?? [];

    let repointed = 0, retained = 0;
    for (const row of staleRows) {
      // Extract the canonical card ID that repointAndArchive embedded in the reason.
      // Format: "... [canonical=N]" — present for every merge going forward.
      // Rows from v1 (before this tag was added) have no tag and are retained for
      // manual review; we must not guess or delete them.
      const tagMatch = row.archive_reason.match(/\[canonical=(\d+)\]/);
      if (!tagMatch) {
        retained++;
        continue;
      }
      const canonId = parseInt(tagMatch[1], 10);

      // Confirm the canonical card is still active (not itself subsequently archived).
      const canonCheck = await tx.execute(sql`
        SELECT 1 FROM cards WHERE id = ${canonId} AND archived_at IS NULL LIMIT 1`);
      if (((canonCheck as any).rows ?? []).length === 0) {
        retained++;
        continue;
      }

      // If binder already holds the canonical card, drop the now-duplicate stale row.
      const dupCheck = await tx.execute(sql`
        SELECT 1 FROM pc_binder_cards
        WHERE binder_id = ${row.binder_id} AND card_id = ${canonId}`);
      if (((dupCheck as any).rows ?? []).length > 0) {
        await tx.execute(sql`DELETE FROM pc_binder_cards WHERE id = ${row.id}`);
        // (counts as implicitly resolved; not added to repointed)
      } else {
        await tx.execute(sql`UPDATE pc_binder_cards SET card_id = ${canonId} WHERE id = ${row.id}`);
        repointed++;
      }
    }

    // Verification: count any entries that still point to archived leak-fix cards.
    const remaining = await tx.execute(sql`
      SELECT count(*) AS n
      FROM pc_binder_cards pbc
      JOIN cards c ON c.id = pbc.card_id
      WHERE c.archived_at IS NOT NULL
        AND c.archive_reason LIKE 'Parallel leak fix%'`);
    const remainCount = Number((remaining as any).rows?.[0]?.n ?? 0);

    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER_V3}) ON CONFLICT (name) DO NOTHING`);
    console.log(`[ParallelLeakFix v3] Binder cleanup: repointed=${repointed} retained-for-review=${retained} remaining=${remainCount}`);
  });
}

export async function fixParallelLeaks(): Promise<void> {
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
  if (((done as any).rows ?? []).length > 0) {
    // v1 already done; run v2 and v3 patches if not yet applied.
    await fixParallelLeaksV2();
    await fixParallelLeaksV3();
    return;
  }

  console.log('[ParallelLeakFix] Starting parallel-leak fix across all affected products…');

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-parallel-leaks-v1'))`);
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
    if (((again as any).rows ?? []).length > 0) return;

    // ─────────────────────────────────────────────────────────────────────
    // §1  TCMS 2025 – Autographs base → existing parallel sets (by NAME)
    //     All autograph cards share card_number "1"; match by cleaned name.
    // ─────────────────────────────────────────────────────────────────────
    const AUTOGRAPHS_BASE = 6583;
    const autoMoves: Array<[string, string]> = [
      ['Gold',        '2025-2025-topps-chrome-marvel-studios-autographs-gold-refractor'],
      ['Orange',      '2025-2025-topps-chrome-marvel-studios-autographs-orange-refractor'],
      ['Black',       '2025-2025-topps-chrome-marvel-studios-autographs-black-refractor'],
      ['Superfractor','2025-2025-topps-chrome-marvel-studios-autographs-superfractor'],
      ['Red',         '2025-2025-topps-chrome-marvel-studios-autographs-red-refractor'],
    ];
    let autoMoved = 0, autoMerged = 0;
    for (const [label, slug] of autoMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] Autograph target not found: ${slug}`); continue; }
      const r = await moveStraysByName(tx, AUTOGRAPHS_BASE, tid, label,
        `Parallel leak fix: TCMS 2025 autograph [${label}] moved to correct set`);
      autoMoved += r.moved; autoMerged += r.merged;
    }
    if (autoMoved + autoMerged) {
      await syncTotal(tx, AUTOGRAPHS_BASE);
      for (const [, slug] of autoMoves) { const id = await resolveSet(tx, slug); if (id) await syncTotal(tx, id); }
      console.log(`[ParallelLeakFix] TCMS autographs: moved=${autoMoved} merged=${autoMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §2  TCMS 2025 – TVA Pruning → existing shimmer-refractor sibling sets
    // ─────────────────────────────────────────────────────────────────────
    const TVA_BASE = 6664;
    const tvaMoves: Array<[string, string]> = [
      ['Black',       '2025-2025-topps-chrome-marvel-studios-tva-pruning-black-shimmer-refractor'],
      ['Red',         '2025-2025-topps-chrome-marvel-studios-tva-pruning-red-shimmer-refractor'],
      ['Gold',        '2025-2025-topps-chrome-marvel-studios-tva-pruning-gold-shimmer-refractor'],
      ['Orange',      '2025-2025-topps-chrome-marvel-studios-tva-pruning-orange-shimmer-refractor'],
      ['Superfractor','2025-2025-topps-chrome-marvel-studios-tva-pruning-superfractor'],
    ];
    let tvaMoved = 0, tvaMerged = 0;
    for (const [label, slug] of tvaMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] TVA target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, TVA_BASE, tid, label,
        `Parallel leak fix: TCMS 2025 TVA Pruning [${label}] moved`);
      tvaMoved += r.moved; tvaMerged += r.merged;
    }
    if (tvaMoved + tvaMerged) {
      await syncTotal(tx, TVA_BASE);
      for (const [, slug] of tvaMoves) { const id = await resolveSet(tx, slug); if (id) await syncTotal(tx, id); }
      console.log(`[ParallelLeakFix] TCMS TVA Pruning: moved=${tvaMoved} merged=${tvaMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §3  TCMS 2025 – Sketch Artists → create + move (3 parallel sets)
    // ─────────────────────────────────────────────────────────────────────
    const SKETCH_BASE = 6644;
    const TCMS_MAIN = 122;
    const sketchDefs: Array<[string, string, string]> = [
      ['Silver', '2025-2025-topps-chrome-marvel-studios-sketch-artists-silver',
        '2025 Topps Chrome Marvel Studios - Sketch Artists Silver'],
      ['Black',  '2025-2025-topps-chrome-marvel-studios-sketch-artists-black-refractor',
        '2025 Topps Chrome Marvel Studios - Sketch Artists Black Refractor'],
      ['Gold',   '2025-2025-topps-chrome-marvel-studios-sketch-artists-gold-refractor',
        '2025 Topps Chrome Marvel Studios - Sketch Artists Gold Refractor'],
    ];
    let sketchMoved = 0, sketchMerged = 0;
    for (const [label, slug, name] of sketchDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCMS_MAIN);
      const r = await moveStraysByNumber(tx, SKETCH_BASE, tid, label,
        `Parallel leak fix: TCMS 2025 Sketch Artists [${label}] moved to created set`);
      sketchMoved += r.moved; sketchMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (sketchMoved + sketchMerged) {
      await syncTotal(tx, SKETCH_BASE);
      console.log(`[ParallelLeakFix] TCMS Sketch Artists: moved=${sketchMoved} merged=${sketchMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §4  TCMS 2025 – Daredevil Born Again → create 2 parallel sets + move
    // ─────────────────────────────────────────────────────────────────────
    const DAREDEVIL_BASE = 6604;
    const ddDefs: Array<[string, string, string]> = [
      ['Black', '2025-2025-topps-chrome-marvel-studios-daredevil-born-again-black-refractor',
        '2025 Topps Chrome Marvel Studios - Daredevil Born Again Black Refractor'],
      ['Red',   '2025-2025-topps-chrome-marvel-studios-daredevil-born-again-red-refractor',
        '2025 Topps Chrome Marvel Studios - Daredevil Born Again Red Refractor'],
    ];
    let ddMoved = 0, ddMerged = 0;
    for (const [label, slug, name] of ddDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCMS_MAIN);
      const r = await moveStraysByNumber(tx, DAREDEVIL_BASE, tid, label,
        `Parallel leak fix: TCMS 2025 Daredevil BA [${label}] moved`);
      ddMoved += r.moved; ddMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (ddMoved + ddMerged) {
      await syncTotal(tx, DAREDEVIL_BASE);
      console.log(`[ParallelLeakFix] TCMS Daredevil BA: moved=${ddMoved} merged=${ddMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §5  TCMS 2025 – SELF strips: parallel sets carrying their own label
    // ─────────────────────────────────────────────────────────────────────
    const selfStrips: Array<[number, string]> = [
      [6586, 'Orange'],       // autographs-orange-refractor
      [6585, 'Gold'],         // autographs-gold-refractor
      [6587, 'Red'],          // autographs-red-refractor
      [6584, 'Black'],        // autographs-black-refractor
      [6588, 'Superfractor'], // autographs-superfractor
      [6580, 'Black'],        // agatha-all-along-tarot-cards-black-refractor
      [6578, 'Superfractor'], // agatha-all-along-autographs-superfractor
      [6581, 'Superfractor'], // agatha-all-along-tarot-cards-superfractor
      [6599, 'Gold'],         // captain-america-brave-new-world-gold-refractor
      [6600, 'Orange'],       // captain-america-brave-new-world-orange-refractor
    ];
    let selfStripped = 0, selfMerged = 0;
    for (const [setId, label] of selfStrips) {
      const r = await selfStripLabels(tx, setId, label,
        `Parallel leak fix: strip [${label}] from own parallel set`);
      selfStripped += r.stripped; selfMerged += r.merged;
      if (r.stripped + r.merged) await syncTotal(tx, setId);
    }
    if (selfStripped + selfMerged)
      console.log(`[ParallelLeakFix] TCMS SELF strips: stripped=${selfStripped} merged=${selfMerged}`);

    // ─────────────────────────────────────────────────────────────────────
    // §6  2025 Topps Chrome Marvel inserts → existing sibling sets (by #)
    // ─────────────────────────────────────────────────────────────────────
    // Each entry: [sourceSetId, label, targetSlug]
    const tcmInsertMoves: Array<[number, string, string]> = [
      // Marvel Anniversaries (2497)
      [2497, 'Black Refractor',    '2025-2025-topps-chrome-marvel-marvel-anniversaries-black'],
      [2497, 'Gold Wave Refractor','2025-2025-topps-chrome-marvel-marvel-anniversaries-gold-wave'],
      [2497, 'Orange Refractor',   '2025-2025-topps-chrome-marvel-marvel-anniversaries-orange'],
      [2497, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-marvel-anniversaries-red-wave'],
      [2497, 'SuperFractor',       '2025-2025-topps-chrome-marvel-marvel-anniversaries-superfractor'],
      // Galactic Legends (6498)
      [6498, 'Black Refractor',    '2025-2025-topps-chrome-marvel-galactic-legends-black'],
      [6498, 'Gold Wave Refractor','2025-2025-topps-chrome-marvel-galactic-legends-gold-wave'],
      [6498, 'Orange Lava Refractor','2025-2025-topps-chrome-marvel-galactic-legends-orange-lava'],
      [6498, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-galactic-legends-red-wave'],
      [6498, 'Refractor',          '2025-2025-topps-chrome-marvel-galactic-legends-refractor'],
      [6498, 'SuperFractor',       '2025-2025-topps-chrome-marvel-galactic-legends-superfractor'],
      // Marvel Icons (2530)
      [2530, 'Black Refractor',    '2025-2025-topps-chrome-marvel-marvel-icons-black'],
      [2530, 'Gold Wave Refractor','2025-2025-topps-chrome-marvel-marvel-icons-gold-wave'],
      [2530, 'Orange Refractor',   '2025-2025-topps-chrome-marvel-marvel-icons-orange'],
      [2530, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-marvel-icons-red-wave'],
      [2530, 'SuperFractor',       '2025-2025-topps-chrome-marvel-marvel-icons-superfractor'],
      // Marvel Icons parallel sets – SELF (Gold Wave / Red Wave sets contain [Gold] or [Red])
      [2532, 'Gold',               '2025-2025-topps-chrome-marvel-marvel-icons-gold-wave'], // self-strip via target==source trick → handled below in selfStrips2
      [2534, 'Red',                '2025-2025-topps-chrome-marvel-marvel-icons-red-wave'],
      // X-Men Giant Size 50th Anniversary (6561)
      [6561, 'Black Refractor',    '2025-2025-topps-chrome-marvel-x-men-giant-size-50th-anniversary-black'],
      [6561, 'Gold Wave Refractor','2025-2025-topps-chrome-marvel-x-men-giant-size-50th-anniversary-gold-wave'],
      [6561, 'Orange Refractor',   '2025-2025-topps-chrome-marvel-x-men-giant-size-50th-anniversary-orange'],
      [6561, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-x-men-giant-size-50th-anniversary-red-wave'],
      [6561, 'SuperFractor',       '2025-2025-topps-chrome-marvel-x-men-giant-size-50th-anniversary-superfractor'],
      // Future Stars (6492)
      [6492, 'Black Refractor',    '2025-2025-topps-chrome-marvel-future-stars-black'],
      [6492, 'Gold Wave Refractor','2025-2025-topps-chrome-marvel-future-stars-gold-wave'],
      [6492, 'Orange Refractor',   '2025-2025-topps-chrome-marvel-future-stars-orange'],
      [6492, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-future-stars-red-wave'],
      [6492, 'SuperFractor',       '2025-2025-topps-chrome-marvel-future-stars-superfractor'],
      // Marvel Reflections (2536)
      [2536, 'Shimmer Refractor',      '2025-2025-topps-chrome-marvel-marvel-reflections-shimmer'],
      [2536, 'Kaleidoscope Refractor', '2025-2025-topps-chrome-marvel-marvel-reflections-kaleidoscope'],
      [2536, 'RayWave Refractor',      '2025-2025-topps-chrome-marvel-marvel-reflections-raywave'],
      [2536, 'SuperFractor Scodix',    '2025-2025-topps-chrome-marvel-marvel-reflections-superfractor'],
      // Indestructible Black Lazer Refractor (6513) – SELF strip + SuperFractor move
      [6513, 'SuperFractor',           '2025-2025-topps-chrome-marvel-indestructible-superfractor'],
      // Indestructible Red Lazer Refractor (6514) – SELF strip below
      // Air Marvel Shadowbox (2495)
      [2495, 'SuperFractor',           '2025-2025-topps-chrome-marvel-air-marvel-superfractor'],
      [2495, 'Red Wave Refractor',     '2025-2025-topps-chrome-marvel-air-marvel-red-wave-refractor'],
      // Mask-Off Facsimile Autographs (6524)
      [6524, 'Black Refractor',        '2025-2025-topps-chrome-marvel-mask-off-facsimile-autographs-black-refractor'],
      [6524, 'Red Wave Refractor',     '2025-2025-topps-chrome-marvel-mask-off-facsimile-autographs-red-refractor'],
      [6524, 'SuperFractor',           '2025-2025-topps-chrome-marvel-mask-off-facsimile-autographs-superfractor'],
      // 35 Years of Ghost Rider Shadowbox (6464)
      [6464, 'SuperFractor',           '2025-2025-topps-chrome-marvel-35-years-of-ghost-rider-superfractor'],
      // The New Avengers 20th Anniversary (6544)
      [6544, 'Black',       '2025-2025-topps-chrome-marvel-the-new-avengers-20th-anniversary-black'],
      [6544, 'Orange',      '2025-2025-topps-chrome-marvel-the-new-avengers-20th-anniversary-orange'],
      [6544, 'SuperFractor','2025-2025-topps-chrome-marvel-the-new-avengers-20th-anniversary-superfractor'],
      // Topps Patrimony (6557)
      [6557, 'Black Refractor',    '2025-2025-topps-chrome-marvel-topps-patrimony-black-refractor'],
      [6557, 'Red Wave Refractor', '2025-2025-topps-chrome-marvel-topps-patrimony-red-refractor'],
      [6557, 'SuperFractor',       '2025-2025-topps-chrome-marvel-topps-patrimony-superfractor'],
      // Golden Anniversaries (6506)
      [6506, 'SuperFractor',       '2025-2025-topps-chrome-marvel-golden-anniversaries-superfractor'],
    ];
    let tcmMoved = 0, tcmMerged = 0;
    const tcmSourcesToSync = new Set<number>();
    for (const [srcId, label, slug] of tcmInsertMoves) {
      // SELF-strip case: target == source set
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] TCM insert target not found: ${slug}`); continue; }
      if (tid === srcId) {
        const r = await selfStripLabels(tx, srcId, label, `Parallel leak fix: self-strip [${label}]`);
        tcmMoved += r.stripped; tcmMerged += r.merged;
      } else {
        const r = await moveStraysByNumber(tx, srcId, tid, label,
          `Parallel leak fix: TCM insert [${label}] moved to correct set`);
        tcmMoved += r.moved; tcmMerged += r.merged;
        await syncTotal(tx, tid);
      }
      tcmSourcesToSync.add(srcId);
    }
    // SELF strip for remaining sets
    const tcmSelfSets: Array<[number, string]> = [
      [6513, 'Black Lazer Refractor'], // indestructible-black-lazer-refractor
      [6514, 'Red Lazer Refractor'],   // indestructible-red-lazer-refractor
      [6471, 'Mini-Diamonds Refractor'], // 60-years-of-shield-mini-diamonds-refractor
    ];
    for (const [setId, label] of tcmSelfSets) {
      const r = await selfStripLabels(tx, setId, label, `Parallel leak fix: self-strip [${label}]`);
      tcmMoved += r.stripped; tcmMerged += r.merged;
      tcmSourcesToSync.add(setId);
    }
    for (const id of Array.from(tcmSourcesToSync)) await syncTotal(tx, id);
    if (tcmMoved + tcmMerged)
      console.log(`[ParallelLeakFix] TCM inserts: moved=${tcmMoved} merged=${tcmMerged}`);

    // ─────────────────────────────────────────────────────────────────────
    // §7  TCM 2025 inserts – CREATE missing parallel sets then move
    // ─────────────────────────────────────────────────────────────────────
    const TCM_MAIN = 121;
    const tcmCreateMoves: Array<[number, string, string, string, number]> = [
      // [sourceSetId, label, newSlug, newName, year]
      [2495, 'Mini-Diamonds Refractor',
        '2025-2025-topps-chrome-marvel-air-marvel-mini-diamonds-refractor',
        '2025 Topps Chrome Marvel - Air Marvel Mini-Diamonds Refractor', 2025],
      [6469, 'Mini-Diamonds Refractor',
        '2025-2025-topps-chrome-marvel-50-years-of-nightcrawler-mini-diamonds-refractor',
        '2025 Topps Chrome Marvel - 50 Years of Nightcrawler Mini-Diamonds Refractor', 2025],
      [6506, 'Gold Wave Refractor',
        '2025-2025-topps-chrome-marvel-golden-anniversaries-gold-wave',
        '2025 Topps Chrome Marvel - Golden Anniversaries Gold Wave', 2025],
      [6524, 'Mini-Diamonds Refractor',
        '2025-2025-topps-chrome-marvel-mask-off-facsimile-autographs-mini-diamonds-refractor',
        '2025 Topps Chrome Marvel - Mask-Off Facsimile Autographs Mini-Diamonds Refractor', 2025],
      [6557, 'Mini-Diamonds Refractor',
        '2025-2025-topps-chrome-marvel-topps-patrimony-mini-diamonds-refractor',
        '2025 Topps Chrome Marvel - Topps Patrimony Mini-Diamonds Refractor', 2025],
    ];
    let tcmCreateMoved = 0, tcmCreateMerged = 0;
    for (const [srcId, label, slug, name, year] of tcmCreateMoves) {
      const tid = await ensureSet(tx, slug, name, year, TCM_MAIN);
      const r = await moveStraysByNumber(tx, srcId, tid, label,
        `Parallel leak fix: TCM insert [${label}] moved to newly created set`);
      tcmCreateMoved += r.moved; tcmCreateMerged += r.merged;
      await syncTotal(tx, tid);
      await syncTotal(tx, srcId);
    }
    // Marvel Reflections [Refractor] – archive (only 5 cards, no matching refractor set)
    const reflArchived = await archiveStrays(tx, 2536, 'Refractor',
      'Parallel leak fix: Marvel Reflections [Refractor] archived – ambiguous target');
    if (tcmCreateMoved + tcmCreateMerged + reflArchived)
      console.log(`[ParallelLeakFix] TCM inserts (created sets): moved=${tcmCreateMoved} merged=${tcmCreateMerged} archived=${reflArchived}`);

    // ─────────────────────────────────────────────────────────────────────
    // §8  2025 Topps Finest X-Men '97 NEW inserts → existing sibling sets
    // ─────────────────────────────────────────────────────────────────────
    const xmen97Moves: Array<[number, string, string]> = [
      // Greatest Hits (7407)
      [7407, 'Gold Refractor',   '2025-2025-topps-finest-x-men-97-greatest-hits-gold-refractor'],
      [7407, 'Laser Refractor',  '2025-2025-topps-finest-x-men-97-greatest-hits-laser-refractor'],
      [7407, 'Orange Refractor', '2025-2025-topps-finest-x-men-97-greatest-hits-orange-refractor'],
      [7407, 'Red Refractor',    '2025-2025-topps-finest-x-men-97-greatest-hits-red-refractor'],
      [7407, 'SuperFractor',     '2025-2025-topps-finest-x-men-97-greatest-hits-superfractor'],
      [7407, 'X-Fractor',        '2025-2025-topps-finest-x-men-97-greatest-hits-x-fractor'],
      // Previously on X-Men (7419)
      [7419, 'Gold Refractor',   '2025-2025-topps-finest-x-men-97-previously-on-x-men-gold-refractor'],
      [7419, 'Laser Refractor',  '2025-2025-topps-finest-x-men-97-previously-on-x-men-laser-refractor'],
      [7419, 'Orange Refractor', '2025-2025-topps-finest-x-men-97-previously-on-x-men-orange-refractor'],
      [7419, 'Red Refractor',    '2025-2025-topps-finest-x-men-97-previously-on-x-men-red-refractor'],
      [7419, 'SuperFractor',     '2025-2025-topps-finest-x-men-97-previously-on-x-men-superfractor'],
      [7419, 'X-Fractor',        '2025-2025-topps-finest-x-men-97-previously-on-x-men-x-fractor'],
      // Sentinels' Scan (7432)
      [7432, 'Gold Refractor',   '2025-2025-topps-finest-x-men-97-sentinels-scan-gold-refractor'],
      [7432, 'Orange Refractor', '2025-2025-topps-finest-x-men-97-sentinels-scan-orange-refractor'],
      [7432, 'Red Refractor',    '2025-2025-topps-finest-x-men-97-sentinels-scan-red-refractor'],
      [7432, 'SuperFractor',     '2025-2025-topps-finest-x-men-97-sentinels-scan-superfractor'],
      [7432, 'X-Fractor',        '2025-2025-topps-finest-x-men-97-sentinels-scan-x-fractor'],
      // Children of the Atom (7399)
      [7399, 'SuperFractor',     '2025-2025-topps-finest-x-men-97-children-of-the-atom-superfractor'],
      // Omega Level (7416)
      [7416, 'SuperFractor',     '2025-2025-topps-finest-x-men-97-omega-level-superfractor'],
    ];
    let xmen97Moved = 0, xmen97Merged = 0;
    const xmen97ToSync = new Set<number>();
    for (const [srcId, label, slug] of xmen97Moves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] X-Men '97 target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, srcId, tid, label,
        `Parallel leak fix: X-Men '97 insert [${label}] moved`);
      xmen97Moved += r.moved; xmen97Merged += r.merged;
      await syncTotal(tx, tid);
      xmen97ToSync.add(srcId);
    }
    for (const id of Array.from(xmen97ToSync)) await syncTotal(tx, id);
    if (xmen97Moved + xmen97Merged)
      console.log(`[ParallelLeakFix] X-Men '97 new inserts: moved=${xmen97Moved} merged=${xmen97Merged}`);

    // ─────────────────────────────────────────────────────────────────────
    // §9  OLD X-Men '97 base (main_set 79) – create missing parallel sets + move
    //     The old base is set 2120 and only has refractor/refractor-sp siblings.
    //     All other parallel labels need new sets under the same prefix.
    // ─────────────────────────────────────────────────────────────────────
    const OLD_XMEN97_BASE = 2120;
    const OLD_XMEN97_MAIN = 79;
    const XMEN97_SLUG_PFX = 'marvel-2025-topps-finest-x-men-97-';
    const XMEN97_NAME_PFX = 'marvel 2025 topps finest x men \'97 ';
    // label → [slug suffix, display name suffix]
    const oldXmenDefs: Array<[string, string, string]> = [
      ['Refractor',         'refractor',         'Refractor'],
      ['Laser Refractor',   'laser-refractor',   'Laser Refractor'],
      ['Gold Refractor',    'gold-refractor',    'Gold Refractor'],
      ['Orange Refractor',  'orange-refractor',  'Orange Refractor'],
      ['X-Fractor',         'x-fractor',         'X-Fractor'],
      ['Red Refractor',     'red-refractor',     'Red Refractor'],
      ['SuperFractor',      'superfractor',      'SuperFractor'],
      ['Laser Refractor SP','laser-refractor-sp','Laser Refractor SP'],
      ['Orange Refractor SP','orange-refractor-sp','Orange Refractor SP'],
      ['Refractor SP',      'refractor-sp',      'Refractor SP'],
      ['Gold Refractor SP', 'gold-refractor-sp', 'Gold Refractor SP'],
      ['X-Fractor SP',      'x-fractor-sp',      'X-Fractor SP'],
      ['Red Refractor SP',  'red-refractor-sp',  'Red Refractor SP'],
    ];
    let oldXmenMoved = 0, oldXmenMerged = 0;
    for (const [label, slugSuffix, nameSuffix] of oldXmenDefs) {
      const slug = `${XMEN97_SLUG_PFX}${slugSuffix}`;
      const name = `${XMEN97_NAME_PFX}${nameSuffix}`;
      const tid = await ensureSet(tx, slug, name, 2025, OLD_XMEN97_MAIN);
      const r = await moveStraysByNumber(tx, OLD_XMEN97_BASE, tid, label,
        `Parallel leak fix: old X-Men '97 base [${label}] moved`);
      oldXmenMoved += r.moved; oldXmenMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (oldXmenMoved + oldXmenMerged) {
      await syncTotal(tx, OLD_XMEN97_BASE);
      console.log(`[ParallelLeakFix] Old X-Men '97 base: moved=${oldXmenMoved} merged=${oldXmenMerged}`);
    }

    // Old X-Men '97 short-print (2239) and voice actor autograph (2241) inserts
    const oldXmenInsertDefs: Array<[number, string, string, string, string]> = [
      [2239, 'X-Fractor',   'marvel-2025-topps-finest-x-men-97-short-print-x-fractor',
        "marvel 2025 topps finest x men '97 Short Print X-Fractor", ''],
      [2239, 'Superfractor', 'marvel-2025-topps-finest-x-men-97-short-print-superfractor',
        "marvel 2025 topps finest x men '97 Short Print SuperFractor", ''],
      [2241, 'X-Fractor',   'marvel-2025-topps-finest-x-men-97-voice-actor-autograph-x-fractor',
        "marvel 2025 topps finest x men '97 Voice Actor Autograph Variation X-Fractor", ''],
      [2241, 'Gold Refractor',   'marvel-2025-topps-finest-x-men-97-voice-actor-autograph-gold-refractor',
        "marvel 2025 topps finest x men '97 Voice Actor Autograph Variation Gold Refractor", ''],
      [2241, 'Orange Refractor', 'marvel-2025-topps-finest-x-men-97-voice-actor-autograph-orange-refractor',
        "marvel 2025 topps finest x men '97 Voice Actor Autograph Variation Orange Refractor", ''],
      [2241, 'Red Refractor',    'marvel-2025-topps-finest-x-men-97-voice-actor-autograph-red-refractor',
        "marvel 2025 topps finest x men '97 Voice Actor Autograph Variation Red Refractor", ''],
    ];
    let oldXmenInsertMoved = 0, oldXmenInsertMerged = 0;
    for (const [srcId, label, slug, name] of oldXmenInsertDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, OLD_XMEN97_MAIN);
      const r = await moveStraysByNumber(tx, srcId, tid, label,
        `Parallel leak fix: old X-Men '97 insert [${label}] moved`);
      oldXmenInsertMoved += r.moved; oldXmenInsertMerged += r.merged;
      await syncTotal(tx, tid);
      await syncTotal(tx, srcId);
    }
    if (oldXmenInsertMoved + oldXmenInsertMerged)
      console.log(`[ParallelLeakFix] Old X-Men '97 inserts: moved=${oldXmenInsertMoved} merged=${oldXmenInsertMerged}`);

    // ─────────────────────────────────────────────────────────────────────
    // §10  Women of Marvel – Battle Time → existing sibling sets
    // ─────────────────────────────────────────────────────────────────────
    const WOM_BASE = 6256;
    const womMoves: Array<[string, string]> = [
      ['Foil Lt Fx Blue',   '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-blue'],
      ['Foil Lt Fx Copper', '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-copper'],
      ['Foil Lt Fx Gold',   '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-gold'],
      ['Foil Lt Fx Green',  '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-green'],
      ['Foil Lt Fx Purple', '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-purple'],
      ['Foil Lt Fx Red',    '2024-2024-upper-deck-women-of-marvel-battle-time-foil-lt-fx-red'],
    ];
    let womMoved = 0, womMerged = 0;
    for (const [label, slug] of womMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] WoM target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, WOM_BASE, tid, label,
        `Parallel leak fix: Women of Marvel Battle Time [${label}] moved`);
      womMoved += r.moved; womMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (womMoved + womMerged) {
      await syncTotal(tx, WOM_BASE);
      console.log(`[ParallelLeakFix] WoM Battle Time: moved=${womMoved} merged=${womMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11  Sapphire Selections → existing sibling sets
    // ─────────────────────────────────────────────────────────────────────
    const SAPPH_BASE = 6679;
    const sapphMoves: Array<[string, string]> = [
      ['Black',       '2025-2025-topps-chrome-sapphire-edition-marvel-sapphire-selections-black'],
      ['Red',         '2025-2025-topps-chrome-sapphire-edition-marvel-sapphire-selections-red'],
      ['Padparadscha','2025-2025-topps-chrome-sapphire-edition-marvel-sapphire-selections-padparadscha'],
    ];
    let sapphMoved = 0, sapphMerged = 0;
    for (const [label, slug] of sapphMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] Sapphire target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, SAPPH_BASE, tid, label,
        `Parallel leak fix: Sapphire Selections [${label}] moved`);
      sapphMoved += r.moved; sapphMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (sapphMoved + sapphMerged) {
      await syncTotal(tx, SAPPH_BASE);
      console.log(`[ParallelLeakFix] Sapphire Selections: moved=${sapphMoved} merged=${sapphMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §12  Wandavision base → existing sibling sets + archive ambiguous
    // ─────────────────────────────────────────────────────────────────────
    const WV_BASE = 5421;
    const wvMoves: Array<[string, string]> = [
      ['Green Vision',   '2023-2023-upper-deck-marvel-wandavision-green-vision'],
      ['Purple Spell',   '2023-2023-upper-deck-marvel-wandavision-purple-spell'],
      ['Scarlet Red',    '2023-2023-upper-deck-marvel-wandavision-scarlet-red'],
      ['Gold',           '2023-2023-upper-deck-marvel-wandavision-gold'],
      ['White Vision',   '2023-2023-upper-deck-marvel-wandavision-white-vision'],
      ['Mind Stone Yellow','2023-2023-upper-deck-marvel-wandavision-mind-stone-yellow'],
    ];
    let wvMoved = 0, wvMerged = 0;
    for (const [label, slug] of wvMoves) {
      const tid = await resolveSet(tx, slug);
      if (!tid) { console.warn(`[ParallelLeakFix] Wandavision target not found: ${slug}`); continue; }
      const r = await moveStraysByNumber(tx, WV_BASE, tid, label,
        `Parallel leak fix: Wandavision base [${label}] moved`);
      wvMoved += r.moved; wvMerged += r.merged;
      await syncTotal(tx, tid);
    }
    // Archive ambiguous [Printing Plate] and [Black] (no color-specific target)
    const wvArchived1 = await archiveStrays(tx, WV_BASE, 'Printing Plate',
      'Parallel leak fix: Wandavision [Printing Plate] archived – color unknown');
    const wvArchived2 = await archiveStrays(tx, WV_BASE, 'Black',
      'Parallel leak fix: Wandavision [Black] archived – no matching parallel set');
    if (wvMoved + wvMerged + wvArchived1 + wvArchived2) {
      await syncTotal(tx, WV_BASE);
      console.log(`[ParallelLeakFix] Wandavision: moved=${wvMoved} merged=${wvMerged} archived=${wvArchived1 + wvArchived2}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §13  2023 Eternals – create parallel sets + move (no main_set)
    // ─────────────────────────────────────────────────────────────────────
    const ETERNALS_BASE = 1617;
    const eternalsMainSet = null;
    const eternalsDefs: Array<[string, string, string]> = [
      ['Gold',   'marvel-2023-eternals-gold',   'marvel 2023 eternals Gold'],
      ['Blue',   'marvel-2023-eternals-blue',   'marvel 2023 eternals Blue'],
      ['Silver', 'marvel-2023-eternals-silver', 'marvel 2023 eternals Silver'],
      ['Purple', 'marvel-2023-eternals-purple', 'marvel 2023 eternals Purple'],
      ['Green',  'marvel-2023-eternals-green',  'marvel 2023 eternals Green'],
      ['Black',  'marvel-2023-eternals-black',  'marvel 2023 eternals Black'],
      ['Immortals And Mortals', 'marvel-2023-eternals-immortals-and-mortals',
        'marvel 2023 eternals Immortals And Mortals'],
    ];
    let etMoved = 0, etMerged = 0;
    for (const [label, slug, name] of eternalsDefs) {
      const tid = await ensureSet(tx, slug, name, 2023, eternalsMainSet);
      const r = await moveStraysByNumber(tx, ETERNALS_BASE, tid, label,
        `Parallel leak fix: 2023 Eternals [${label}] moved`);
      etMoved += r.moved; etMerged += r.merged;
      await syncTotal(tx, tid);
    }
    // Archive ambiguous [Printing Plate]
    const etArchived = await archiveStrays(tx, ETERNALS_BASE, 'Printing Plate',
      'Parallel leak fix: Eternals [Printing Plate] archived – color unknown');
    if (etMoved + etMerged + etArchived) {
      await syncTotal(tx, ETERNALS_BASE);
      console.log(`[ParallelLeakFix] 2023 Eternals: moved=${etMoved} merged=${etMerged} archived=${etArchived}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §14  2024 UD Marvel Studios S1 – Canvas [Black White] and Portraits [Gold]
    // ─────────────────────────────────────────────────────────────────────
    // Canvas: [Black White] → ud-canvas-black-and-white
    const CANVAS_ID = 6182;
    const CANVAS_BW_ID = await resolveSet(tx, '2024-2024-upper-deck-marvel-studios-series-1-ud-canvas-black-and-white');
    if (CANVAS_BW_ID) {
      const r = await moveStraysByNumber(tx, CANVAS_ID, CANVAS_BW_ID, 'Black White',
        'Parallel leak fix: UD Canvas [Black White] moved');
      if (r.moved + r.merged) {
        await syncTotal(tx, CANVAS_ID); await syncTotal(tx, CANVAS_BW_ID);
        console.log(`[ParallelLeakFix] UD Canvas Black White: moved=${r.moved} merged=${r.merged}`);
      }
    }
    // Also strip SELF in the BW set
    await selfStripLabels(tx, 6183, 'Black White', 'Parallel leak fix: UD Canvas BW self-strip');
    await syncTotal(tx, 6183);
    // Archive [Printing Plate] in canvas (color unknown)
    await archiveStrays(tx, CANVAS_ID, 'Printing Plate',
      'Parallel leak fix: UD Canvas [Printing Plate] archived – color unknown');

    // Portraits: [Gold] → ud-portraits-gold; [Bronze] → create; [Printing Plate] → archive
    const PORTRAITS_ID = 6184;
    const PORTRAITS_GOLD_ID = await resolveSet(tx, '2024-2024-upper-deck-marvel-studios-series-1-ud-portraits-gold');
    if (PORTRAITS_GOLD_ID) {
      const r = await moveStraysByNumber(tx, PORTRAITS_ID, PORTRAITS_GOLD_ID, 'Gold',
        'Parallel leak fix: UD Portraits [Gold] moved');
      if (r.moved + r.merged) { await syncTotal(tx, PORTRAITS_ID); await syncTotal(tx, PORTRAITS_GOLD_ID); }
    }
    const PORTRAITS_BRONZE_ID = await ensureSet(tx,
      '2024-2024-upper-deck-marvel-studios-series-1-ud-portraits-bronze',
      '2024 Upper Deck Marvel Studios Series 1 - UD Portraits Bronze', 2024,
      (await tx.select({ mainSetId: cardSets.mainSetId }).from(cardSets).where(eq(cardSets.id, PORTRAITS_ID)))[0]?.mainSetId ?? null,
    );
    const rPortBronze = await moveStraysByNumber(tx, PORTRAITS_ID, PORTRAITS_BRONZE_ID, 'Bronze',
      'Parallel leak fix: UD Portraits [Bronze] moved');
    if (rPortBronze.moved + rPortBronze.merged) { await syncTotal(tx, PORTRAITS_ID); await syncTotal(tx, PORTRAITS_BRONZE_ID); }
    await archiveStrays(tx, PORTRAITS_ID, 'Printing Plate',
      'Parallel leak fix: UD Portraits [Printing Plate] archived – color unknown');
    // Base set: [Outburst] → existing sets; [Printing Plate] + [Exclusive] → archive
    const UDM_BASE_ID = 6147;
    const udmBaseMoves: Array<[string, string]> = [
      ['Outburst',     '2024-2024-upper-deck-marvel-studios-series-1-outburst'],
      ['Outburst Red', '2024-2024-upper-deck-marvel-studios-series-1-outburst-red'],
      ['Outburst Gold','2024-2024-upper-deck-marvel-studios-series-1-outburst-gold'],
    ];
    for (const [label, slug] of udmBaseMoves) {
      const tid = await resolveSet(tx, slug);
      if (tid) {
        const r = await moveStraysByNumber(tx, UDM_BASE_ID, tid, label,
          `Parallel leak fix: UDM S1 base [${label}] moved`);
        if (r.moved + r.merged) await syncTotal(tx, tid);
      }
    }
    await archiveStrays(tx, UDM_BASE_ID, 'Printing Plate',
      'Parallel leak fix: UDM S1 [Printing Plate] archived – color unknown');
    await archiveStrays(tx, UDM_BASE_ID, 'Exclusive',
      'Parallel leak fix: UDM S1 [Exclusive] archived – no matching set');
    await syncTotal(tx, UDM_BASE_ID);
    // Self-strip remaining SELF sets
    await selfStripLabels(tx, 6149, 'Gold',   'Parallel leak fix: +Footage Gold self-strip');
    await selfStripLabels(tx, 6157, 'Blue',   'Parallel leak fix: Fluorescence Blue self-strip');
    await selfStripLabels(tx, 6155, 'Pink',   'Parallel leak fix: Dazzlers Pink self-strip');
    await selfStripLabels(tx, 6159, 'Green',  'Parallel leak fix: Fluorescence Green self-strip');
    await selfStripLabels(tx, 6154, 'Green',  'Parallel leak fix: Dazzlers Green self-strip');
    await selfStripLabels(tx, 6166, 'Orange', 'Parallel leak fix: HoloGrFx Orange self-strip');
    await selfStripLabels(tx, 6158, 'Gold',   'Parallel leak fix: Fluorescence Gold self-strip');
    await selfStripLabels(tx, 6162, 'High Gloss', 'Parallel leak fix: High Gloss self-strip');
    for (const id of [6149,6157,6155,6159,6154,6166,6158,6162]) await syncTotal(tx, id);
    // Marquees [Printing Plate] → archive
    await archiveStrays(tx, 6170, 'Printing Plate',
      'Parallel leak fix: UD Marquees [Printing Plate] archived – color unknown');
    await syncTotal(tx, 6170);
    console.log('[ParallelLeakFix] UD Marvel Studios S1: done');

    // ─────────────────────────────────────────────────────────────────────
    // §15  Marvel 2025 Topps Chrome old base (main_set 80) – create + move
    //      All card_numbers are "1" in this import; match by name.
    // ─────────────────────────────────────────────────────────────────────
    const TCM_OLD_BASE = 2206;
    const TCM_OLD_MAIN = 80;
    const tcmOldBaseDefs: Array<[string, string, string]> = [
      ['Web',                  'marvel-2025-topps-chrome-web',                  'Marvel 2025 Topps Chrome Web'],
      ['Blue Red Web',         'marvel-2025-topps-chrome-blue-red-web',         'Marvel 2025 Topps Chrome Blue Red Web'],
      ['SuperFractor',         'marvel-2025-topps-chrome-superfractor',         'Marvel 2025 Topps Chrome SuperFractor'],
      ['Black',                'marvel-2025-topps-chrome-black',                'Marvel 2025 Topps Chrome Black'],
      ['Human Torch',          'marvel-2025-topps-chrome-human-torch',          'Marvel 2025 Topps Chrome Human Torch'],
      ['Black Clawed',         'marvel-2025-topps-chrome-black-clawed',         'Marvel 2025 Topps Chrome Black Clawed'],
      ['Rose Gold Mini Diamonds','marvel-2025-topps-chrome-rose-gold-mini-diamonds','Marvel 2025 Topps Chrome Rose Gold Mini Diamonds'],
      ['Orange',               'marvel-2025-topps-chrome-orange',               'Marvel 2025 Topps Chrome Orange'],
      ['Red Clawed',           'marvel-2025-topps-chrome-red-clawed',           'Marvel 2025 Topps Chrome Red Clawed'],
      ['Clawed',               'marvel-2025-topps-chrome-clawed',               'Marvel 2025 Topps Chrome Clawed'],
      ['Gold Wave',            'marvel-2025-topps-chrome-gold-wave',            'Marvel 2025 Topps Chrome Gold Wave'],
      ['Red Wave',             'marvel-2025-topps-chrome-red-wave',             'Marvel 2025 Topps Chrome Red Wave'],
      ['Orange Lava',          'marvel-2025-topps-chrome-orange-lava',          'Marvel 2025 Topps Chrome Orange Lava'],
      ['Green Lazer',          'marvel-2025-topps-chrome-green-lazer',          'Marvel 2025 Topps Chrome Green Lazer'],
      ['Red Shimmer',          'marvel-2025-topps-chrome-red-shimmer',          'Marvel 2025 Topps Chrome Red Shimmer'],
      ['Purple Shimmer',       'marvel-2025-topps-chrome-purple-shimmer',       'Marvel 2025 Topps Chrome Purple Shimmer'],
      ['Blue Green Shimmer',   'marvel-2025-topps-chrome-blue-green-shimmer',   'Marvel 2025 Topps Chrome Blue & Green Shimmer'],
      ['Blue',                 'marvel-2025-topps-chrome-blue',                 'Marvel 2025 Topps Chrome Blue'],
      ['Refractor',            'marvel-2025-topps-chrome-refractor',            'Marvel 2025 Topps Chrome Refractor'],
      ['Yellow Lava',          'marvel-2025-topps-chrome-yellow-lava',          'Marvel 2025 Topps Chrome Yellow Lava'],
      ['SuperFractor Clawed',  'marvel-2025-topps-chrome-superfractor-clawed',  'Marvel 2025 Topps Chrome SuperFractor Clawed'],
      ['Red Gold Lazer',       'marvel-2025-topps-chrome-red-gold-lazer',       'Marvel 2025 Topps Chrome Red Gold Lazer'],
    ];
    let tcmOldMoved = 0, tcmOldMerged = 0;
    for (const [label, slug, name] of tcmOldBaseDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCM_OLD_MAIN);
      const r = await moveStraysByName(tx, TCM_OLD_BASE, tid, label,
        `Parallel leak fix: TCM old base [${label}] moved`);
      tcmOldMoved += r.moved; tcmOldMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (tcmOldMoved + tcmOldMerged) {
      await syncTotal(tx, TCM_OLD_BASE);
      console.log(`[ParallelLeakFix] TCM old base: moved=${tcmOldMoved} merged=${tcmOldMerged}`);
    }

    // Avengers Infinity Die-Cut (2217) – create + move (all card_number=? – use number)
    const TCM_DIECUT = 2217;
    const tcmDieCutDefs: Array<[string, string, string]> = [
      ['SuperFractor',          'marvel-2025-topps-chrome-avengers-infinity-die-cut-superfractor',
        'Marvel 2025 Topps Chrome Avengers Infinity Die-Cut SuperFractor'],
      ['Black Refractor',       'marvel-2025-topps-chrome-avengers-infinity-die-cut-black-refractor',
        'Marvel 2025 Topps Chrome Avengers Infinity Die-Cut Black Refractor'],
      ['Mini-Diamonds Refractor','marvel-2025-topps-chrome-avengers-infinity-die-cut-mini-diamonds-refractor',
        'Marvel 2025 Topps Chrome Avengers Infinity Die-Cut Mini-Diamonds Refractor'],
      ['Red Wave Refractor',    'marvel-2025-topps-chrome-avengers-infinity-die-cut-red-wave-refractor',
        'Marvel 2025 Topps Chrome Avengers Infinity Die-Cut Red Wave Refractor'],
    ];
    let dieMoved = 0, dieMerged = 0;
    for (const [label, slug, name] of tcmDieCutDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCM_OLD_MAIN);
      const r = await moveStraysByNumber(tx, TCM_DIECUT, tid, label,
        `Parallel leak fix: TCM die-cut [${label}] moved`);
      dieMoved += r.moved; dieMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (dieMoved + dieMerged) {
      await syncTotal(tx, TCM_DIECUT);
      console.log(`[ParallelLeakFix] TCM die-cut: moved=${dieMoved} merged=${dieMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §16  Kakawow – The Legend of Iron Man Gold → create refractor sets + move
    // ─────────────────────────────────────────────────────────────────────
    const KAKAWOW_GOLD = 6346;
    const KAKAWOW_MAIN = (await tx.select({ mainSetId: cardSets.mainSetId })
      .from(cardSets).where(eq(cardSets.id, KAKAWOW_GOLD)))[0]?.mainSetId ?? null;
    const kakaDefs: Array<[string, string, string]> = [
      ['Refractor',          '2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-refractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man Refractor'],
      ['Red Wave Refractor', '2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-red-wave-refractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man Red Wave Refractor'],
      ['SuperFractor',       '2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-superfractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man SuperFractor'],
      ['Black Refractor',    '2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-black-refractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man Black Refractor'],
      ['Gold Wave Refractor','2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-gold-wave-refractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man Gold Wave Refractor'],
      ['Orange Lava Refractor','2025-2025-kakawow-aura-marvel-the-legend-of-iron-man-orange-lava-refractor',
        '2025 Kakawow Aura Marvel - The Legend of Iron Man Orange Lava Refractor'],
    ];
    let kakaMoved = 0, kakaMerged = 0;
    for (const [label, slug, name] of kakaDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, KAKAWOW_MAIN);
      const r = await moveStraysByNumber(tx, KAKAWOW_GOLD, tid, label,
        `Parallel leak fix: Kakawow Iron Man Gold [${label}] moved`);
      kakaMoved += r.moved; kakaMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (kakaMoved + kakaMerged) {
      await syncTotal(tx, KAKAWOW_GOLD);
      console.log(`[ParallelLeakFix] Kakawow Iron Man Gold: moved=${kakaMoved} merged=${kakaMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §17  2025 TCM Marvel facsimile + writer autograph insert sets
    //      Labels like [Sapphire], [Black Sapphire], [Gold Wave Refractor], etc.
    //      All autograph cards share card_number "1" – use name matching.
    // ─────────────────────────────────────────────────────────────────────
    // Marvel Comics Facsimile Autographs (2512)
    const FAC_AUTO = 2512;
    const facAutoDefs: Array<[string, string, string]> = [
      ['Sapphire',           '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Sapphire'],
      ['Red Sapphire',       '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-red-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Red Sapphire'],
      ['Black Sapphire',     '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-black-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Black Sapphire'],
      ['Padparadscha Sapphire','2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-padparadscha-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Padparadscha Sapphire'],
      ['Black Refractor',    '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-black-refractor',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Black Refractor'],
      ['Gold Wave Refractor','2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-gold-wave-refractor',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Gold Wave Refractor'],
      ['Orange Refractor',   '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-orange-refractor',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Orange Refractor'],
      ['Red Wave Refractor', '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-red-wave-refractor',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs Red Wave Refractor'],
      ['SuperFractor',       '2025-2025-topps-chrome-marvel-marvel-comics-facsimile-autographs-superfractor',
        '2025 Topps Chrome Marvel - Marvel Comics Facsimile Autographs SuperFractor'],
    ];
    let facMoved = 0, facMerged = 0;
    for (const [label, slug, name] of facAutoDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCM_MAIN);
      const r = await moveStraysByName(tx, FAC_AUTO, tid, label,
        `Parallel leak fix: TCM Facsimile Autographs [${label}] moved`);
      facMoved += r.moved; facMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (facMoved + facMerged) {
      await syncTotal(tx, FAC_AUTO);
      console.log(`[ParallelLeakFix] TCM Facsimile Autographs: moved=${facMoved} merged=${facMerged}`);
    }

    // Marvel Comic Book Artist & Writer Autographs (2503)
    const WRITER_AUTO = 2503;
    const writerAutoDefs: Array<[string, string, string]> = [
      ['Sapphire',              '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Sapphire'],
      ['Red Sapphire',          '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-red-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Red Sapphire'],
      ['Black Sapphire',        '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-black-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Black Sapphire'],
      ['Padparadscha Sapphire', '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-padparadscha-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Padparadscha Sapphire'],
      ['Purple Sapphire',       '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-purple-sapphire',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Purple Sapphire'],
      ['Black Refractor',       '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-black-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Black Refractor'],
      ['Gold Wave Refractor',   '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-gold-wave-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Gold Wave Refractor'],
      ['Orange Refractor',      '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-orange-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Orange Refractor'],
      ['Red Wave Refractor',    '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-red-wave-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Red Wave Refractor'],
      ['Purple Shimmer Refractor','2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-purple-shimmer-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Purple Shimmer Refractor'],
      ['Iron Man Red Gold Lazer Refractor','2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-iron-man-red-gold-lazer-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Iron Man Red Gold Lazer Refractor'],
      ['Hulk Green Lazer Refractor','2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-hulk-green-lazer-refractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs Hulk Green Lazer Refractor'],
      ['SuperFractor',          '2025-2025-topps-chrome-marvel-marvel-comic-book-artist-writer-autographs-superfractor',
        '2025 Topps Chrome Marvel - Marvel Comic Book Artist & Writer Autographs SuperFractor'],
    ];
    let writerMoved = 0, writerMerged = 0;
    for (const [label, slug, name] of writerAutoDefs) {
      const tid = await ensureSet(tx, slug, name, 2025, TCM_MAIN);
      const r = await moveStraysByName(tx, WRITER_AUTO, tid, label,
        `Parallel leak fix: TCM Writer Autographs [${label}] moved`);
      writerMoved += r.moved; writerMerged += r.merged;
      await syncTotal(tx, tid);
    }
    if (writerMoved + writerMerged) {
      await syncTotal(tx, WRITER_AUTO);
      console.log(`[ParallelLeakFix] TCM Writer Autographs: moved=${writerMoved} merged=${writerMerged}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // §18  Printing Plates sets that are SELF (strip their own label)
    //      e.g. 2020-21 UD Annual Printing Plate Achievements Black [35 cards]
    // ─────────────────────────────────────────────────────────────────────
    await selfStripLabels(tx, 4151, 'Printing Plate',
      'Parallel leak fix: UD Annual Printing Plate Achievements Black self-strip');
    await syncTotal(tx, 4151);

    // ─────────────────────────────────────────────────────────────────────
    // Done
    // ─────────────────────────────────────────────────────────────────────
    await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER}) ON CONFLICT (name) DO NOTHING`);
  });

  // Always run v2 and v3 after v1 completes on a fresh deploy.
  // Both are marker-gated internally so they are safe to call unconditionally.
  await fixParallelLeaksV2();
  await fixParallelLeaksV3();

  console.log('[ParallelLeakFix] ✅ All parallel leaks fixed');
}
