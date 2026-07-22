// One-time cleanup (July 2026): 1991 Comic Images X-Men — duplicate AU set.
//
// A whole subset was imported twice: once as the canonical base subset
// ("1991 Comic Images X-Men - 1991 Comic Images X-Men", 90 cards) and once as a
// sibling set whose 90 cards all carry an "AU" suffix glued onto the name
// ("The X-Men AU", "PatchAU", ...). The earlier auDuplicateCleanup didn't catch
// these because it only pairs twins within the SAME set — these are cross-set.
//
// This cleanup finds the AU set by content, not by id or exact name (ids/names
// differ between dev and prod): a set under the "1991 Comic Images X-Men" family
// where EVERY card name ends in the AU suffix. It remaps any user references to
// the base twin (matched by card_number in the canonical base set), deletes the
// AU cards, and finally deletes the emptied set. Idempotent + advisory-locked.

import { sql } from "drizzle-orm";
import { db } from "../db";

const BASE_SET_NAME = "1991 Comic Images X-Men - 1991 Comic Images X-Men";

export interface XmenAuCleanupResult {
  ran: boolean;
  reason?: string;
  auSetId?: number;
  auSetName?: string;
  deletedCards: number;
  deletedSet: boolean;
  remapped: Record<string, number>;
  droppedDuplicateRefs: Record<string, number>;
}

export async function runXmenAuSetCleanup(): Promise<XmenAuCleanupResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('xmen-1991-au-set-cleanup'))`);

    const noop: XmenAuCleanupResult = {
      ran: false, deletedCards: 0, deletedSet: false, remapped: {}, droppedDuplicateRefs: {},
    };

    // Canonical base subset (same name in dev and prod).
    const baseRes = await tx.execute(sql`
      SELECT id FROM card_sets WHERE name = ${BASE_SET_NAME} ORDER BY id ASC LIMIT 1`);
    const baseSetId = (baseRes.rows[0] as any)?.id;
    if (!baseSetId) return { ...noop, reason: "base set not found" };

    // The duplicate AU set: in the same family, not the base set, non-empty, and
    // EVERY card name ends with the AU suffix.
    const auRes = await tx.execute(sql`
      SELECT cs.id, cs.name FROM card_sets cs
      WHERE cs.name LIKE '1991 Comic Images X-Men%'
        AND cs.id <> ${baseSetId}
        AND EXISTS (SELECT 1 FROM cards c WHERE c.set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_id = cs.id AND c.name !~ 'AU,?$')
      ORDER BY cs.id ASC LIMIT 1`);
    const auSet = auRes.rows[0] as any;
    if (!auSet) return { ...noop, reason: "no all-AU duplicate set found (already cleaned)" };

    // Pair every AU card with its base twin by card_number. Refuse to run if any
    // card lacks a twin — user references would have nowhere to go.
    await tx.execute(sql`
      CREATE TEMP TABLE xmen_au_pairs ON COMMIT DROP AS
      SELECT au.id AS au_id,
             (SELECT b.id FROM cards b
               WHERE b.set_id = ${baseSetId} AND b.card_number = au.card_number
               ORDER BY b.id ASC LIMIT 1) AS base_id
      FROM cards au WHERE au.set_id = ${auSet.id}`);
    const unmatched = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM xmen_au_pairs WHERE base_id IS NULL`);
    if (((unmatched.rows[0] as any)?.n ?? 1) > 0) {
      return { ...noop, auSetId: auSet.id, auSetName: auSet.name, reason: "some AU cards have no base twin — aborted" };
    }

    const remapped: Record<string, number> = {};
    const droppedDuplicateRefs: Record<string, number> = {};

    // Tables unique on (user_id, card_id): drop the AU row when the user already
    // has the base card, otherwise remap.
    for (const table of ["user_collections", "user_wishlists"]) {
      const t = sql.raw(table);
      const del = await tx.execute(sql`
        DELETE FROM ${t} r USING xmen_au_pairs p
        WHERE r.card_id = p.au_id
          AND EXISTS (SELECT 1 FROM ${t} x WHERE x.user_id = r.user_id AND x.card_id = p.base_id)`);
      droppedDuplicateRefs[table] = del.rowCount ?? 0;
      const upd = await tx.execute(sql`
        UPDATE ${t} r SET card_id = p.base_id FROM xmen_au_pairs p WHERE r.card_id = p.au_id`);
      remapped[table] = upd.rowCount ?? 0;
    }

    // pc_binder_cards: unique per (binder_id, card_id).
    const binderDel = await tx.execute(sql`
      DELETE FROM pc_binder_cards r USING xmen_au_pairs p
      WHERE r.card_id = p.au_id
        AND EXISTS (SELECT 1 FROM pc_binder_cards x WHERE x.binder_id = r.binder_id AND x.card_id = p.base_id)`);
    droppedDuplicateRefs["pc_binder_cards"] = binderDel.rowCount ?? 0;
    const binderUpd = await tx.execute(sql`
      UPDATE pc_binder_cards r SET card_id = p.base_id FROM xmen_au_pairs p WHERE r.card_id = p.au_id`);
    remapped["pc_binder_cards"] = binderUpd.rowCount ?? 0;

    // Plain remaps.
    for (const { table, column } of [
      { table: "listings", column: "card_id" },
      { table: "migration_log_cards", column: "card_id" },
      { table: "scan_uploads", column: "top_match_card_id" },
      { table: "scan_feedback", column: "selected_card_id" },
    ]) {
      const upd = await tx.execute(sql`
        UPDATE ${sql.raw(table)} r SET ${sql.raw(column)} = p.base_id
        FROM xmen_au_pairs p WHERE r.${sql.raw(column)} = p.au_id`);
      remapped[table] = upd.rowCount ?? 0;
    }

    // Rows that die with the card.
    const pendingDel = await tx.execute(sql`
      DELETE FROM pending_card_images r USING xmen_au_pairs p WHERE r.card_id = p.au_id`);
    droppedDuplicateRefs["pending_card_images"] = pendingDel.rowCount ?? 0;
    const cacheDel = await tx.execute(sql`
      DELETE FROM card_price_cache r USING xmen_au_pairs p WHERE r.card_id = p.au_id`);
    droppedDuplicateRefs["card_price_cache"] = cacheDel.rowCount ?? 0;

    const cardDel = await tx.execute(sql`
      DELETE FROM cards c USING xmen_au_pairs p WHERE c.id = p.au_id`);

    // Delete the emptied set itself so it disappears from set browsing.
    const setDel = await tx.execute(sql`
      DELETE FROM card_sets cs
      WHERE cs.id = ${auSet.id}
        AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_id = cs.id)`);

    return {
      ran: true,
      auSetId: auSet.id,
      auSetName: auSet.name,
      deletedCards: cardDel.rowCount ?? 0,
      deletedSet: (setDel.rowCount ?? 0) > 0,
      remapped,
      droppedDuplicateRefs,
    };
  });
}
