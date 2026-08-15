import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * One-time idempotent fix: 2026 Topps Chrome Marvel Comics "Superfractor 1/N"
 * junk subsets.
 *
 * The spreadsheet import created 200 one-card subsets ("Superfractor 1/1" …
 * "Superfractor 1/200") that exactly duplicate the proper 200-card
 * "Superfractor" subset (verified in prod: all 200 match by card_number+name).
 * Per Joshua (Aug 2026): the Superfractor is a 1/1 parallel of every base
 * card and must be ONE set.
 *
 * This seed, per junk card:
 *  - finds its twin in the canonical Superfractor subset (card_number + name)
 *  - repoints every user-facing reference to the twin (collections with
 *    quantity merge + listings repointed to the surviving collection row,
 *    wishlists, binder cards, xp_events with farm-proof-index dedupe, scan
 *    matches, migration log rows)
 *  - deletes the junk card and, once empty and unreferenced, the junk subset
 * A junk card with no twin (should not exist) is moved into the canonical
 * subset instead of deleted, so nothing is ever lost.
 *
 * The seed data (toppsChrome2026.json) was fixed in the same change, so the
 * main seeder no longer recreates these subsets. Marker-gated, advisory-locked,
 * slug-matched — safe on every startup in dev and prod.
 */

const MARKER = 'superfractor_2026_junk_sets_fix_v1';
const CANONICAL_SLUG = '2026-topps-chrome-marvel-comics-superfractor';

export async function fixSuperfractor2026JunkSets(): Promise<void> {
  const done = await db.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
  if (((done as any).rows ?? []).length > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fix-superfractor-2026-junk-sets'))`);
    const again = await tx.execute(sql`SELECT 1 FROM startup_migrations WHERE name = ${MARKER}`);
    if (((again as any).rows ?? []).length > 0) return;

    const canonicalRow: any = await tx.execute(sql`SELECT id FROM card_sets WHERE slug = ${CANONICAL_SLUG}`);
    const canonicalId: number | undefined = canonicalRow.rows?.[0]?.id;
    if (!canonicalId) {
      // Set not seeded in this environment yet — mark done only when there is
      // also no junk to clean (otherwise leave the marker unset and retry on a
      // later boot, after the main seeder has run).
      const junkCheck: any = await tx.execute(sql`
        SELECT 1 FROM card_sets WHERE name ~ '^Superfractor 1/\\d+$'
          AND slug LIKE '2026-topps-chrome-marvel-comics-superfractor-%' LIMIT 1`);
      if ((junkCheck.rows ?? []).length === 0) {
        await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER}) ON CONFLICT (name) DO NOTHING`);
      }
      return;
    }

    // junk card -> canonical twin (matched by card_number + name)
    await tx.execute(sql`
      CREATE TEMP TABLE junk_pairs ON COMMIT DROP AS
      SELECT c.id AS junk_id, t.id AS twin_id, c.set_id AS junk_set_id
      FROM cards c
      JOIN card_sets cs ON cs.id = c.set_id
      LEFT JOIN cards t ON t.set_id = ${canonicalId}
        AND t.card_number = c.card_number AND t.name = c.name AND t.archived_at IS NULL
      WHERE cs.name ~ '^Superfractor 1/\\d+$'
        AND cs.slug LIKE '2026-topps-chrome-marvel-comics-superfractor-%'
        AND cs.id <> ${canonicalId}`);

    const counts: any = await tx.execute(sql`
      SELECT count(*)::int AS total, count(twin_id)::int AS with_twin FROM junk_pairs`);
    const { total, with_twin } = counts.rows?.[0] ?? { total: 0, with_twin: 0 };

    // --- Repoint user data from junk card to twin (twin_id IS NOT NULL) ---

    // Listings that reference the junk card directly
    await tx.execute(sql`
      UPDATE listings l SET card_id = jp.twin_id
      FROM junk_pairs jp WHERE l.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);

    // Collections: merge quantity into an existing twin row, repoint listings
    // off the doomed duplicate row first, then repoint/remove.
    await tx.execute(sql`
      UPDATE user_collections t SET quantity = t.quantity + d.quantity
      FROM user_collections d
      JOIN junk_pairs jp ON jp.junk_id = d.card_id AND jp.twin_id IS NOT NULL
      WHERE t.user_id = d.user_id AND t.card_id = jp.twin_id`);
    await tx.execute(sql`
      UPDATE listings l SET user_collection_id = t.id
      FROM user_collections d
      JOIN junk_pairs jp ON jp.junk_id = d.card_id AND jp.twin_id IS NOT NULL
      JOIN user_collections t ON t.user_id = d.user_id AND t.card_id = jp.twin_id
      WHERE l.user_collection_id = d.id`);
    await tx.execute(sql`
      UPDATE user_collections uc SET card_id = jp.twin_id
      FROM junk_pairs jp
      WHERE uc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM user_collections t WHERE t.user_id = uc.user_id AND t.card_id = jp.twin_id)`);
    await tx.execute(sql`
      DELETE FROM user_collections uc USING junk_pairs jp
      WHERE uc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);

    // Wishlists / binder cards: repoint unless the twin row already exists
    await tx.execute(sql`
      UPDATE user_wishlists uw SET card_id = jp.twin_id
      FROM junk_pairs jp
      WHERE uw.card_id = jp.junk_id AND jp.twin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM user_wishlists t WHERE t.user_id = uw.user_id AND t.card_id = jp.twin_id)`);
    await tx.execute(sql`
      DELETE FROM user_wishlists uw USING junk_pairs jp
      WHERE uw.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      UPDATE pc_binder_cards pbc SET card_id = jp.twin_id
      FROM junk_pairs jp
      WHERE pbc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pc_binder_cards t WHERE t.binder_id = pbc.binder_id AND t.card_id = jp.twin_id)`);
    await tx.execute(sql`
      DELETE FROM pc_binder_cards pbc USING junk_pairs jp
      WHERE pbc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);

    // XP ledger: farm-proof unique (user_id, event_type, card_id) — dedupe first
    await tx.execute(sql`
      UPDATE xp_events xe SET card_id = jp.twin_id
      FROM junk_pairs jp
      WHERE xe.card_id = jp.junk_id AND jp.twin_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM xp_events t
          WHERE t.user_id = xe.user_id AND t.event_type = xe.event_type AND t.card_id = jp.twin_id)`);
    await tx.execute(sql`
      DELETE FROM xp_events xe USING junk_pairs jp
      WHERE xe.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);

    // Remaining FK holders: scan matches + migration logs repoint, caches drop
    await tx.execute(sql`
      UPDATE scan_uploads su SET top_match_card_id = jp.twin_id
      FROM junk_pairs jp WHERE su.top_match_card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      UPDATE scan_feedback sf SET selected_card_id = jp.twin_id
      FROM junk_pairs jp WHERE sf.selected_card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      UPDATE migration_log_cards mlc SET card_id = jp.twin_id
      FROM junk_pairs jp WHERE mlc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      DELETE FROM card_price_cache cpc USING junk_pairs jp WHERE cpc.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      DELETE FROM pending_card_images pci USING junk_pairs jp WHERE pci.card_id = jp.junk_id AND jp.twin_id IS NOT NULL`);

    // Delete twinned junk cards; rescue twinless ones into the canonical set
    await tx.execute(sql`
      DELETE FROM cards c USING junk_pairs jp WHERE c.id = jp.junk_id AND jp.twin_id IS NOT NULL`);
    await tx.execute(sql`
      UPDATE cards c SET set_id = ${canonicalId}
      FROM junk_pairs jp WHERE c.id = jp.junk_id AND jp.twin_id IS NULL`);

    // Delete now-empty, unreferenced junk subsets
    await tx.execute(sql`
      DELETE FROM card_sets cs
      WHERE cs.id IN (SELECT DISTINCT junk_set_id FROM junk_pairs)
        AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM share_links sl WHERE sl.card_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM card_set_migrations m WHERE m.legacy_set_id = cs.id OR m.canonical_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM migration_logs ml WHERE ml.source_set_id = cs.id OR ml.destination_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM migration_log_cards mlc WHERE mlc.old_set_id = cs.id OR mlc.new_set_id = cs.id)`);

    // Also catch already-empty junk subsets that had no cards at all
    await tx.execute(sql`
      DELETE FROM card_sets cs
      WHERE cs.name ~ '^Superfractor 1/\\d+$'
        AND cs.slug LIKE '2026-topps-chrome-marvel-comics-superfractor-%'
        AND cs.id <> ${canonicalId}
        AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM share_links sl WHERE sl.card_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM card_set_migrations m WHERE m.legacy_set_id = cs.id OR m.canonical_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM migration_logs ml WHERE ml.source_set_id = cs.id OR ml.destination_set_id = cs.id)
        AND NOT EXISTS (SELECT 1 FROM migration_log_cards mlc WHERE mlc.old_set_id = cs.id OR mlc.new_set_id = cs.id)`);

    // Reconcile canonical totalCards (unarchived only)
    await tx.execute(sql`
      UPDATE card_sets SET total_cards =
        (SELECT count(*)::int FROM cards WHERE set_id = ${canonicalId} AND archived_at IS NULL)
      WHERE id = ${canonicalId}`);

    // Only mark done when NO junk subsets remain — if any were retained
    // (unexpected set-level references), leave the marker unset so the fix
    // retries on the next boot instead of silently giving up forever.
    const remaining: any = await tx.execute(sql`
      SELECT count(*)::int AS n FROM card_sets
      WHERE name ~ '^Superfractor 1/\\d+$'
        AND slug LIKE '2026-topps-chrome-marvel-comics-superfractor-%'
        AND id <> ${canonicalId}`);
    const leftover = remaining.rows?.[0]?.n ?? 0;
    if (leftover === 0) {
      await tx.execute(sql`INSERT INTO startup_migrations (name) VALUES (${MARKER}) ON CONFLICT (name) DO NOTHING`);
    } else {
      console.error(`[Superfractor 2026 Fix] ${leftover} junk subset(s) retained by unexpected references — marker NOT written, will retry next boot`);
    }
    console.log(`[Superfractor 2026 Fix] junk cards processed=${total} (twinned=${with_twin}, rescued=${total - with_twin})`);
  });
  console.log('[Superfractor 2026 Fix] ✅ Superfractor is one set');
}
