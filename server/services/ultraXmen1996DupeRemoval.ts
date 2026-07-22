// One-time removal (July 2026): two duplicate/incorrect "1996 Ultra X-Men"
// collections, per explicit user confirmation:
//   - main set slug 'marvel-1996-ultra-x-men' (2 subsets, 200 cards). Its
//     ~317 user_collections entries + 1 wishlist entry point at wrong cards
//     (wrong images/data) — the user chose to DELETE them, no remapping.
//   - main set slug 'marvel-1996-ultra-x-men-wolverine' (2 subsets, 200 cards,
//     zero user references) — duplicates the correct '1996-ultra-x-men-wolverine'
//     family being seeded separately (exact slug match; the keeper slug is a
//     different string).
// Deletes every dependent row (marketplace listings chain first, since listings
// reference user_collections), then cards, then subsets, then the main sets.
// Aborts safely if any orders exist for doomed listings (needs human review —
// marketplace is dormant so none are expected).
// Idempotent (no-op once the main sets are gone) + advisory-locked.

import { sql } from "drizzle-orm";
import { db } from "../db";

const MAIN_SET_SLUGS = ["marvel-1996-ultra-x-men", "marvel-1996-ultra-x-men-wolverine"];

export interface UltraDupeRemovalResult {
  ran: boolean;
  reason?: string;
  removedMainSets: Array<{ id: number; name: string }>;
  deletedSubsets: number;
  deletedCards: number;
  deletedRefs: Record<string, number>;
}

export async function runUltraXmen1996DupeRemoval(): Promise<UltraDupeRemovalResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ultra-xmen-1996-dupe-removal'))`);

    const noop: UltraDupeRemovalResult = {
      ran: false, removedMainSets: [], deletedSubsets: 0, deletedCards: 0, deletedRefs: {},
    };

    const mainRes = await tx.execute(sql`
      SELECT id, name FROM main_sets
      WHERE slug IN (${sql.join(MAIN_SET_SLUGS.map(s => sql`${s}`), sql`, `)})`);
    const mains = mainRes.rows as Array<{ id: number; name: string }>;
    if (mains.length === 0) return noop;
    const idList = sql.join(mains.map(m => sql`${m.id}`), sql`, `);

    // Materialize the doomed subset and card ids once.
    await tx.execute(sql`
      CREATE TEMP TABLE ultra_dupe_sets ON COMMIT DROP AS
      SELECT id FROM card_sets WHERE main_set_id IN (${idList})`);
    await tx.execute(sql`
      CREATE TEMP TABLE ultra_dupe_cards ON COMMIT DROP AS
      SELECT c.id FROM cards c JOIN ultra_dupe_sets s ON s.id = c.set_id`);

    const deletedRefs: Record<string, number> = {};

    // --- Marketplace chain first: listings reference user_collections, and
    // offers/orders/reports reference listings.
    await tx.execute(sql`
      CREATE TEMP TABLE ultra_dupe_listings ON COMMIT DROP AS
      SELECT l.id FROM listings l
      WHERE l.card_id IN (SELECT id FROM ultra_dupe_cards)
         OR l.user_collection_id IN (
              SELECT uc.id FROM user_collections uc
              WHERE uc.card_id IN (SELECT id FROM ultra_dupe_cards))`);

    // Orders are real transactions — refuse to touch them automatically.
    const ordersRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM orders o
      WHERE o.listing_id IN (SELECT id FROM ultra_dupe_listings)`);
    if (((ordersRes.rows[0] as any)?.n ?? 0) > 0) {
      return { ...noop, reason: "orders exist for doomed listings — aborted, needs manual review" };
    }

    const offersDel = await tx.execute(sql`
      DELETE FROM offers o WHERE o.listing_id IN (SELECT id FROM ultra_dupe_listings)`);
    deletedRefs["offers"] = offersDel.rowCount ?? 0;
    const reportsUpd = await tx.execute(sql`
      UPDATE reports r SET listing_id = NULL
      WHERE r.listing_id IN (SELECT id FROM ultra_dupe_listings)`);
    deletedRefs["reports (listing nulled)"] = reportsUpd.rowCount ?? 0;
    const listingsDel = await tx.execute(sql`
      DELETE FROM listings l WHERE l.id IN (SELECT id FROM ultra_dupe_listings)`);
    deletedRefs["listings"] = listingsDel.rowCount ?? 0;

    // --- User-facing references: deleted outright per user decision (wrong cards).
    for (const { table, column } of [
      { table: "user_collections", column: "card_id" },
      { table: "user_wishlists", column: "card_id" },
      { table: "pc_binder_cards", column: "card_id" },
      { table: "pending_card_images", column: "card_id" },
      { table: "card_price_cache", column: "card_id" },
    ]) {
      const del = await tx.execute(sql`
        DELETE FROM ${sql.raw(table)} r USING ultra_dupe_cards d WHERE r.${sql.raw(column)} = d.id`);
      deletedRefs[table] = del.rowCount ?? 0;
    }

    // Nullable scan references: null out instead of deleting the scan history.
    for (const { table, column } of [
      { table: "scan_uploads", column: "top_match_card_id" },
      { table: "scan_feedback", column: "selected_card_id" },
    ]) {
      const upd = await tx.execute(sql`
        UPDATE ${sql.raw(table)} r SET ${sql.raw(column)} = NULL
        FROM ultra_dupe_cards d WHERE r.${sql.raw(column)} = d.id`);
      deletedRefs[`${table} (nulled)`] = upd.rowCount ?? 0;
    }

    // --- Migration-console history tied to doomed cards or sets.
    // migration_log_cards rows referencing doomed cards/sets, plus all child rows
    // of any migration_logs entry that references a doomed set (children must go
    // before the parent log rows).
    const mlcDel = await tx.execute(sql`
      DELETE FROM migration_log_cards r
      WHERE r.card_id IN (SELECT id FROM ultra_dupe_cards)
         OR r.old_set_id IN (SELECT id FROM ultra_dupe_sets)
         OR r.new_set_id IN (SELECT id FROM ultra_dupe_sets)
         OR r.migration_log_id IN (
              SELECT id FROM migration_logs ml
              WHERE ml.source_set_id IN (SELECT id FROM ultra_dupe_sets)
                 OR ml.destination_set_id IN (SELECT id FROM ultra_dupe_sets))`);
    deletedRefs["migration_log_cards"] = mlcDel.rowCount ?? 0;
    const mlDel = await tx.execute(sql`
      DELETE FROM migration_logs ml
      WHERE ml.source_set_id IN (SELECT id FROM ultra_dupe_sets)
         OR ml.destination_set_id IN (SELECT id FROM ultra_dupe_sets)`);
    deletedRefs["migration_logs"] = mlDel.rowCount ?? 0;

    // --- Other card_sets references.
    const csmDel = await tx.execute(sql`
      DELETE FROM card_set_migrations r
      WHERE r.legacy_set_id IN (SELECT id FROM ultra_dupe_sets)
         OR r.canonical_set_id IN (SELECT id FROM ultra_dupe_sets)`);
    deletedRefs["card_set_migrations"] = csmDel.rowCount ?? 0;
    const slDel = await tx.execute(sql`
      DELETE FROM share_links r WHERE r.card_set_id IN (SELECT id FROM ultra_dupe_sets)`);
    deletedRefs["share_links"] = slDel.rowCount ?? 0;

    // --- Finally: cards, subsets, main sets.
    const cardDel = await tx.execute(sql`
      DELETE FROM cards c USING ultra_dupe_cards d WHERE c.id = d.id`);
    const setDel = await tx.execute(sql`
      DELETE FROM card_sets cs WHERE cs.id IN (SELECT id FROM ultra_dupe_sets)`);
    await tx.execute(sql`
      DELETE FROM main_sets ms WHERE ms.id IN (${idList})`);

    return {
      ran: true,
      removedMainSets: mains,
      deletedSubsets: setDel.rowCount ?? 0,
      deletedCards: cardDel.rowCount ?? 0,
      deletedRefs,
    };
  });
}
