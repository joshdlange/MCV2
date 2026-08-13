import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Idempotent startup fix: user_collections / user_wishlists / pc_binder_cards
 * rows still pointing at ARCHIVED cards whose archive_reason embeds the
 * canonical card id ("merged into card N" / "Merged into card N" /
 * "[canonical=N]"). These rows were created either before repointing was
 * added to the legacy set-merge passes, or by collectors adding archived
 * cards afterwards (the add path is now guarded in storage.addToCollection).
 *
 * Prod audit (Aug 2026): 39 user_collections rows, 0 wishlist, 0 binder,
 * 0 listings attached. All canonical targets exist and are unarchived.
 *
 * Everything is set-based SQL resolved AT RUNTIME from archive_reason, so it
 * works in both dev and prod despite differing card ids. Repoint pattern:
 * merge quantities into existing canonical rows, repoint the rest, delete
 * stragglers (listings are repointed to the surviving collection row first).
 */
export async function fixArchivedCollectionRows(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-archived-collection-rows'))`);

    // Build the archived → canonical pairs from archive_reason, restricted to
    // archived cards actually referenced by user data. Canonical must exist
    // and be unarchived; anything else is left alone (logged below).
    await tx.execute(sql`
      CREATE TEMP TABLE repoint_pairs ON COMMIT DROP AS
      SELECT c.id AS from_id,
             (regexp_match(c.archive_reason, '(?:[Mm]erged into card |\\[canonical=)(\\d+)'))[1]::int AS to_id
      FROM cards c
      WHERE c.archived_at IS NOT NULL
        AND c.archive_reason ~ '(?:[Mm]erged into card |\\[canonical=)\\d+'
        AND EXISTS (
          SELECT 1 FROM user_collections uc WHERE uc.card_id = c.id
          UNION ALL SELECT 1 FROM user_wishlists uw WHERE uw.card_id = c.id
          UNION ALL SELECT 1 FROM pc_binder_cards b WHERE b.card_id = c.id
        )`);
    await tx.execute(sql`
      DELETE FROM repoint_pairs p
      WHERE p.to_id IS NULL
         OR p.to_id = p.from_id
         OR NOT EXISTS (SELECT 1 FROM cards t WHERE t.id = p.to_id AND t.archived_at IS NULL)`);

    const pairCountRes: any = await tx.execute(sql`SELECT count(*)::int AS n FROM repoint_pairs`);
    const pairCount = pairCountRes.rows?.[0]?.n ?? 0;
    if (pairCount === 0) {
      console.log('[FixArchivedCollectionRows] Nothing to repoint.');
      return;
    }

    // --- user_collections: merge quantities into existing canonical rows ---
    await tx.execute(sql`
      UPDATE user_collections t
      SET quantity = t.quantity + d.quantity
      FROM user_collections d
      JOIN repoint_pairs p ON p.from_id = d.card_id
      WHERE t.user_id = d.user_id AND t.card_id = p.to_id`);
    // Repoint listings from soon-to-be-deleted duplicate rows to the survivor
    // (listings.user_collection_id is a NOT NULL FK).
    await tx.execute(sql`
      UPDATE listings l
      SET user_collection_id = t.id
      FROM user_collections d
      JOIN repoint_pairs p ON p.from_id = d.card_id
      JOIN user_collections t ON t.user_id = d.user_id AND t.card_id = p.to_id
      WHERE l.user_collection_id = d.id`);
    // Move rows where the user does not already own the canonical
    await tx.execute(sql`
      UPDATE user_collections uc
      SET card_id = p.to_id
      FROM repoint_pairs p
      WHERE uc.card_id = p.from_id
        AND NOT EXISTS (SELECT 1 FROM user_collections t WHERE t.user_id = uc.user_id AND t.card_id = p.to_id)`);
    // Drop stragglers (their quantities were merged above)
    await tx.execute(sql`
      DELETE FROM user_collections uc USING repoint_pairs p WHERE uc.card_id = p.from_id`);

    // --- user_wishlists: repoint unless canonical already wished ---
    await tx.execute(sql`
      UPDATE user_wishlists uw
      SET card_id = p.to_id
      FROM repoint_pairs p
      WHERE uw.card_id = p.from_id
        AND NOT EXISTS (SELECT 1 FROM user_wishlists t WHERE t.user_id = uw.user_id AND t.card_id = p.to_id)`);
    await tx.execute(sql`
      DELETE FROM user_wishlists uw USING repoint_pairs p WHERE uw.card_id = p.from_id`);

    // --- pc_binder_cards: drop rows whose binder already holds the canonical, then repoint ---
    await tx.execute(sql`
      DELETE FROM pc_binder_cards b
      USING repoint_pairs p
      WHERE b.card_id = p.from_id
        AND EXISTS (SELECT 1 FROM pc_binder_cards t WHERE t.binder_id = b.binder_id AND t.card_id = p.to_id)`);
    await tx.execute(sql`
      UPDATE pc_binder_cards b
      SET card_id = p.to_id
      FROM repoint_pairs p
      WHERE b.card_id = p.from_id`);

    console.log(`[FixArchivedCollectionRows] Repointed user data for ${pairCount} archived card(s) to their canonical rows.`);
  });

  // Visibility: any remaining user data on archived cards (unparseable or
  // dead canonical targets) — needs manual review, never auto-fixed.
  const leftover: any = await db.execute(sql`
    SELECT count(*)::int AS n FROM user_collections uc
    JOIN cards c ON c.id = uc.card_id WHERE c.archived_at IS NOT NULL`);
  const n = leftover.rows?.[0]?.n ?? 0;
  if (n > 0) {
    console.warn(`[FixArchivedCollectionRows] ${n} user_collections row(s) still point at archived cards (no resolvable canonical) — manual review needed.`);
  }
}
