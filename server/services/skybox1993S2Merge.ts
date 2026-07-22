// One-time fix (July 2026): 1993 SkyBox X-Men Series 2 base subset merge.
//
// The canonical "1993 SkyBox X-Men Series 2" family (slug 1993-skybox-x-men-series-2)
// has an EMPTY base subset ("Still Populating"), while a legacy duplicate family
// "Marvel 1993 X-Men Series 2" (slug marvel-1993-x-men-series-2) holds the real
// 100-card base checklist twice:
//   - subset slug 'marvel-1993-x-men-series-2' (100 cards, images, all user refs)
//   - subset slug 'marvel-1993-x-men-series-2--marvel-1993-x-men-series-2--base'
//     (identical checklist, zero user refs)
//
// Fix: MOVE the referenced subset's cards into the canonical empty base subset by
// repointing set_id — card ids don't change, so user_collections / binders /
// images / price cache all follow automatically. Then delete the redundant twin
// subset's cards (full FK chain), the two emptied subsets, and the duplicate
// main set. Idempotent + advisory-locked; aborts safely if anything looks off.

import { sql } from "drizzle-orm";
import { db } from "../db";

const KEEPER_MAIN_SLUG = "1993-skybox-x-men-series-2";
const KEEPER_BASE_SUBSET_SLUG = "1993-skybox-x-men-series-2-1993-skybox-x-men-series-2-base";
const DUPE_MAIN_SLUG = "marvel-1993-x-men-series-2";
const MOVE_SUBSET_SLUG = "marvel-1993-x-men-series-2";

export interface SkyboxMergeResult {
  ran: boolean;
  reason?: string;
  movedCards: number;
  deletedTwinCards: number;
  deletedSubsets: number;
  deletedMainSet: boolean;
  deletedRefs: Record<string, number>;
}

export async function runSkybox1993S2Merge(): Promise<SkyboxMergeResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('skybox-1993-s2-merge'))`);

    const noop: SkyboxMergeResult = {
      ran: false, movedCards: 0, deletedTwinCards: 0, deletedSubsets: 0,
      deletedMainSet: false, deletedRefs: {},
    };

    const dupeMainRes = await tx.execute(sql`
      SELECT id FROM main_sets WHERE slug = ${DUPE_MAIN_SLUG}`);
    const dupeMainId = (dupeMainRes.rows[0] as any)?.id;
    if (!dupeMainId) return { ...noop, reason: "duplicate main set already gone" };

    const keeperRes = await tx.execute(sql`
      SELECT cs.id FROM card_sets cs
      JOIN main_sets ms ON ms.id = cs.main_set_id
      WHERE ms.slug = ${KEEPER_MAIN_SLUG} AND cs.slug = ${KEEPER_BASE_SUBSET_SLUG}`);
    const keeperSetId = (keeperRes.rows[0] as any)?.id;
    if (!keeperSetId) return { ...noop, reason: "canonical base subset not found — aborted" };

    // Destination must still be empty (safety: never merge into a populated set).
    const destCount = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM cards WHERE set_id = ${keeperSetId}`);
    if (((destCount.rows[0] as any)?.n ?? 1) > 0) {
      return { ...noop, reason: "destination base subset is not empty — aborted" };
    }

    const moveRes = await tx.execute(sql`
      SELECT id FROM card_sets WHERE main_set_id = ${dupeMainId} AND slug = ${MOVE_SUBSET_SLUG}`);
    const moveSetId = (moveRes.rows[0] as any)?.id;
    if (!moveSetId) return { ...noop, reason: "source subset not found — aborted" };

    // 1. Move the real base cards (ids unchanged → all user refs/images follow).
    const moved = await tx.execute(sql`
      UPDATE cards SET set_id = ${keeperSetId} WHERE set_id = ${moveSetId}`);

    // 2. Delete every other card left in the duplicate family (the identical
    //    zero-ref twin subset), with the full dependent-row chain.
    await tx.execute(sql`
      CREATE TEMP TABLE skybox_merge_doomed_sets ON COMMIT DROP AS
      SELECT id FROM card_sets WHERE main_set_id = ${dupeMainId}`);
    await tx.execute(sql`
      CREATE TEMP TABLE skybox_merge_doomed_cards ON COMMIT DROP AS
      SELECT c.id FROM cards c JOIN skybox_merge_doomed_sets s ON s.id = c.set_id`);

    const deletedRefs: Record<string, number> = {};

    // Marketplace chain first (listings reference user_collections).
    await tx.execute(sql`
      CREATE TEMP TABLE skybox_merge_doomed_listings ON COMMIT DROP AS
      SELECT l.id FROM listings l
      WHERE l.card_id IN (SELECT id FROM skybox_merge_doomed_cards)
         OR l.user_collection_id IN (
              SELECT uc.id FROM user_collections uc
              WHERE uc.card_id IN (SELECT id FROM skybox_merge_doomed_cards))`);
    const ordersRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM orders o
      WHERE o.listing_id IN (SELECT id FROM skybox_merge_doomed_listings)`);
    if (((ordersRes.rows[0] as any)?.n ?? 0) > 0) {
      throw new Error("orders exist for doomed listings — aborting transaction for manual review");
    }
    const offersDel = await tx.execute(sql`
      DELETE FROM offers o WHERE o.listing_id IN (SELECT id FROM skybox_merge_doomed_listings)`);
    deletedRefs["offers"] = offersDel.rowCount ?? 0;
    const reportsUpd = await tx.execute(sql`
      UPDATE reports r SET listing_id = NULL
      WHERE r.listing_id IN (SELECT id FROM skybox_merge_doomed_listings)`);
    deletedRefs["reports (listing nulled)"] = reportsUpd.rowCount ?? 0;
    const listingsDel = await tx.execute(sql`
      DELETE FROM listings l WHERE l.id IN (SELECT id FROM skybox_merge_doomed_listings)`);
    deletedRefs["listings"] = listingsDel.rowCount ?? 0;

    for (const { table, column } of [
      { table: "user_collections", column: "card_id" },
      { table: "user_wishlists", column: "card_id" },
      { table: "pc_binder_cards", column: "card_id" },
      { table: "pending_card_images", column: "card_id" },
      { table: "card_price_cache", column: "card_id" },
    ]) {
      const del = await tx.execute(sql`
        DELETE FROM ${sql.raw(table)} r USING skybox_merge_doomed_cards d WHERE r.${sql.raw(column)} = d.id`);
      deletedRefs[table] = del.rowCount ?? 0;
    }

    for (const { table, column } of [
      { table: "scan_uploads", column: "top_match_card_id" },
      { table: "scan_feedback", column: "selected_card_id" },
    ]) {
      const upd = await tx.execute(sql`
        UPDATE ${sql.raw(table)} r SET ${sql.raw(column)} = NULL
        FROM skybox_merge_doomed_cards d WHERE r.${sql.raw(column)} = d.id`);
      deletedRefs[`${table} (nulled)`] = upd.rowCount ?? 0;
    }

    // Migration-console history tied to doomed cards or sets.
    const mlcDel = await tx.execute(sql`
      DELETE FROM migration_log_cards r
      WHERE r.card_id IN (SELECT id FROM skybox_merge_doomed_cards)
         OR r.old_set_id IN (SELECT id FROM skybox_merge_doomed_sets)
         OR r.new_set_id IN (SELECT id FROM skybox_merge_doomed_sets)
         OR r.migration_log_id IN (
              SELECT id FROM migration_logs ml
              WHERE ml.source_set_id IN (SELECT id FROM skybox_merge_doomed_sets)
                 OR ml.destination_set_id IN (SELECT id FROM skybox_merge_doomed_sets))`);
    deletedRefs["migration_log_cards"] = mlcDel.rowCount ?? 0;
    const mlDel = await tx.execute(sql`
      DELETE FROM migration_logs ml
      WHERE ml.source_set_id IN (SELECT id FROM skybox_merge_doomed_sets)
         OR ml.destination_set_id IN (SELECT id FROM skybox_merge_doomed_sets)`);
    deletedRefs["migration_logs"] = mlDel.rowCount ?? 0;

    const csmDel = await tx.execute(sql`
      DELETE FROM card_set_migrations r
      WHERE r.legacy_set_id IN (SELECT id FROM skybox_merge_doomed_sets)
         OR r.canonical_set_id IN (SELECT id FROM skybox_merge_doomed_sets)`);
    deletedRefs["card_set_migrations"] = csmDel.rowCount ?? 0;
    const slDel = await tx.execute(sql`
      DELETE FROM share_links r WHERE r.card_set_id IN (SELECT id FROM skybox_merge_doomed_sets)`);
    deletedRefs["share_links"] = slDel.rowCount ?? 0;

    const twinCardDel = await tx.execute(sql`
      DELETE FROM cards c USING skybox_merge_doomed_cards d WHERE c.id = d.id`);

    const setDel = await tx.execute(sql`
      DELETE FROM card_sets cs WHERE cs.id IN (SELECT id FROM skybox_merge_doomed_sets)`);
    const mainDel = await tx.execute(sql`
      DELETE FROM main_sets ms WHERE ms.id = ${dupeMainId}`);

    // 3. Reconcile the keeper subset's denormalized count.
    await tx.execute(sql`
      UPDATE card_sets SET total_cards = (SELECT COUNT(*)::int FROM cards WHERE set_id = ${keeperSetId})
      WHERE id = ${keeperSetId}`);

    return {
      ran: true,
      movedCards: moved.rowCount ?? 0,
      deletedTwinCards: twinCardDel.rowCount ?? 0,
      deletedSubsets: setDel.rowCount ?? 0,
      deletedMainSet: (mainDel.rowCount ?? 0) > 0,
      deletedRefs,
    };
  });
}
