// AU Duplicate Card Cleanup (July 2026)
//
// Some autograph subsets were imported twice: once with clean names ("Wolverine")
// and once with an "AU" suffix glued onto the name ("WolverineAU," or "Wolverine AU").
// A card counts as an AU duplicate ONLY when a base twin exists in the SAME set with
// the SAME card_number and the SAME name minus the AU suffix. Lone AU-named cards
// (legit autograph entries with no twin) are never touched.
//
// preview: read-only report of every duplicate pair + reference counts.
// cleanup: transactional — remaps user_collections / user_wishlists / pc_binder_cards /
// listings / migration_log_cards / scan_uploads / scan_feedback / pending_card_images
// from the AU card to its base twin (skipping remaps that would violate unique
// user+card indexes), deletes AU price-cache rows, then deletes the AU cards.
// Guarded by a pg advisory lock so concurrent/autoscale runs can't double-fire.

import { sql } from "drizzle-orm";
import { db } from "../db";

// Matches "NameAU," / "NameAU" / "Name AU" at end of name (case-sensitive AU).
const AU_SUFFIX_REGEX = "AU,?$";
const AU_STRIP_REGEX = "\\s*AU,?$";

// CTE producing (au_id, base_id) pairs. Deterministic base pick (lowest id) in the
// unlikely case a set has multiple base twins for the same number+name.
const DUP_PAIRS_CTE = sql.raw(`
  dup_pairs AS (
    SELECT au.id AS au_id,
           (SELECT b.id FROM cards b
             WHERE b.set_id = au.set_id
               AND b.id <> au.id
               AND b.card_number = au.card_number
               AND lower(b.name) = lower(trim(regexp_replace(au.name, '${AU_STRIP_REGEX}', '')))
             ORDER BY b.id ASC LIMIT 1) AS base_id
    FROM cards au
    WHERE au.name ~ '${AU_SUFFIX_REGEX}'
  ),
  pairs AS (
    SELECT au_id, base_id FROM dup_pairs WHERE base_id IS NOT NULL
  )
`);

export interface AuCleanupPreview {
  duplicateCount: number;
  setBreakdown: Array<{ setId: number; setName: string; duplicates: number }>;
  references: Record<string, number>;
  sample: Array<{ auCardId: number; baseCardId: number; cardNumber: string; auName: string; baseName: string; setName: string }>;
}

const REF_TABLES: Array<{ table: string; column: string }> = [
  { table: "user_collections", column: "card_id" },
  { table: "user_wishlists", column: "card_id" },
  { table: "pc_binder_cards", column: "card_id" },
  { table: "listings", column: "card_id" },
  { table: "migration_log_cards", column: "card_id" },
  { table: "pending_card_images", column: "card_id" },
  { table: "card_price_cache", column: "card_id" },
  { table: "scan_uploads", column: "top_match_card_id" },
  { table: "scan_feedback", column: "selected_card_id" },
];

export async function previewAuDuplicateCleanup(): Promise<AuCleanupPreview> {
  const countRes = await db.execute(sql`WITH ${DUP_PAIRS_CTE} SELECT COUNT(*)::int AS n FROM pairs`);
  const duplicateCount = (countRes.rows[0] as any)?.n ?? 0;

  const setsRes = await db.execute(sql`
    WITH ${DUP_PAIRS_CTE}
    SELECT cs.id AS set_id, cs.name AS set_name, COUNT(*)::int AS duplicates
    FROM pairs p JOIN cards c ON c.id = p.au_id JOIN card_sets cs ON cs.id = c.set_id
    GROUP BY cs.id, cs.name ORDER BY duplicates DESC`);

  const references: Record<string, number> = {};
  for (const { table, column } of REF_TABLES) {
    const r = await db.execute(sql`
      WITH ${DUP_PAIRS_CTE}
      SELECT COUNT(*)::int AS n FROM ${sql.raw(table)} t JOIN pairs p ON p.au_id = t.${sql.raw(column)}`);
    references[table] = (r.rows[0] as any)?.n ?? 0;
  }

  const sampleRes = await db.execute(sql`
    WITH ${DUP_PAIRS_CTE}
    SELECT p.au_id, p.base_id, au.card_number, au.name AS au_name, b.name AS base_name, cs.name AS set_name
    FROM pairs p
    JOIN cards au ON au.id = p.au_id
    JOIN cards b ON b.id = p.base_id
    JOIN card_sets cs ON cs.id = au.set_id
    ORDER BY cs.name, au.card_number LIMIT 25`);

  return {
    duplicateCount,
    setBreakdown: setsRes.rows.map((r: any) => ({ setId: r.set_id, setName: r.set_name, duplicates: r.duplicates })),
    references,
    sample: sampleRes.rows.map((r: any) => ({
      auCardId: r.au_id, baseCardId: r.base_id, cardNumber: r.card_number,
      auName: r.au_name, baseName: r.base_name, setName: r.set_name,
    })),
  };
}

export interface AuCleanupResult {
  deletedCards: number;
  remapped: Record<string, number>;
  droppedDuplicateRefs: Record<string, number>;
  deletedPriceCacheRows: number;
}

export async function runAuDuplicateCleanup(): Promise<AuCleanupResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('au-duplicate-cleanup'))`);

    // Materialize pairs once so every step operates on the identical card list.
    await tx.execute(sql`
      CREATE TEMP TABLE au_cleanup_pairs ON COMMIT DROP AS
      WITH ${DUP_PAIRS_CTE} SELECT au_id, base_id FROM pairs`);

    const remapped: Record<string, number> = {};
    const droppedDuplicateRefs: Record<string, number> = {};

    // Tables with a unique (user_id, card_id) index: delete the AU row when the
    // user already has the base card, otherwise remap to the base card.
    for (const table of ["user_collections", "user_wishlists"]) {
      const t = sql.raw(table);
      const del = await tx.execute(sql`
        DELETE FROM ${t} r USING au_cleanup_pairs p
        WHERE r.card_id = p.au_id
          AND EXISTS (SELECT 1 FROM ${t} x WHERE x.user_id = r.user_id AND x.card_id = p.base_id)`);
      droppedDuplicateRefs[table] = del.rowCount ?? 0;
      const upd = await tx.execute(sql`
        UPDATE ${t} r SET card_id = p.base_id FROM au_cleanup_pairs p WHERE r.card_id = p.au_id`);
      remapped[table] = upd.rowCount ?? 0;
    }

    // pc_binder_cards: unique per (binder_id, card_id) — same drop-then-remap approach.
    const binderDel = await tx.execute(sql`
      DELETE FROM pc_binder_cards r USING au_cleanup_pairs p
      WHERE r.card_id = p.au_id
        AND EXISTS (SELECT 1 FROM pc_binder_cards x WHERE x.binder_id = r.binder_id AND x.card_id = p.base_id)`);
    droppedDuplicateRefs["pc_binder_cards"] = binderDel.rowCount ?? 0;
    const binderUpd = await tx.execute(sql`
      UPDATE pc_binder_cards r SET card_id = p.base_id FROM au_cleanup_pairs p WHERE r.card_id = p.au_id`);
    remapped["pc_binder_cards"] = binderUpd.rowCount ?? 0;

    // Plain remaps (no unique constraint on card_id side).
    for (const { table, column } of [
      { table: "listings", column: "card_id" },
      { table: "migration_log_cards", column: "card_id" },
      { table: "scan_uploads", column: "top_match_card_id" },
      { table: "scan_feedback", column: "selected_card_id" },
    ]) {
      const upd = await tx.execute(sql`
        UPDATE ${sql.raw(table)} r SET ${sql.raw(column)} = p.base_id
        FROM au_cleanup_pairs p WHERE r.${sql.raw(column)} = p.au_id`);
      remapped[table] = upd.rowCount ?? 0;
    }

    // Pending image submissions for the doomed duplicates are meaningless — drop them.
    const pendingDel = await tx.execute(sql`
      DELETE FROM pending_card_images r USING au_cleanup_pairs p WHERE r.card_id = p.au_id`);
    droppedDuplicateRefs["pending_card_images"] = pendingDel.rowCount ?? 0;

    // Price cache rows die with the card.
    const cacheDel = await tx.execute(sql`
      DELETE FROM card_price_cache r USING au_cleanup_pairs p WHERE r.card_id = p.au_id`);

    const cardDel = await tx.execute(sql`
      DELETE FROM cards c USING au_cleanup_pairs p WHERE c.id = p.au_id`);

    return {
      deletedCards: cardDel.rowCount ?? 0,
      remapped,
      droppedDuplicateRefs,
      deletedPriceCacheRows: cacheDel.rowCount ?? 0,
    };
  });
}
