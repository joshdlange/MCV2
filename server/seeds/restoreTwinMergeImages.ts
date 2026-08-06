import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * One-time idempotent repair: restore curated card images that the Aug 4 2026
 * legacy duplicate-set merge left on the archived side of a merge pair.
 *
 * Background: the merge folded twin cards into a survivor and only carried a
 * dup's image over when the survivor had NONE. When both twins had an image,
 * the survivor kept its own — even when the curated image (user upload, Drive
 * import, admin upload) lived on the twin that got archived. Result: binder /
 * set views reverted to old images.
 *
 * The exact merge pairs are recoverable from the archive notes: every merged
 * dup was archived with reason "... (merged into card <survivorId>)".
 *
 * Decision rules (front and back independently):
 *  1. An approved user upload for the survivor always wins (the merge already
 *     remapped pending_card_images rows onto survivors).
 *  2. Otherwise the archived dup's image wins when it matches a CURATED path
 *     pattern (direct card upload, user upload, Drive set import) and the
 *     survivor's current image does not. Non-curated vs non-curated, curated
 *     vs curated, and legacy local "/uploads/" paths are left untouched —
 *     too ambiguous to auto-repair.
 *
 * Idempotency / safety:
 *  - Runs under an advisory lock.
 *  - Every applied change is recorded in merge_image_repairs; a card+side
 *    already in the ledger is never touched again, so later manual edits are
 *    never clobbered by a re-run.
 *  - Only survivors whose current image is still non-curated are repaired, so
 *    anything an admin has since fixed by hand is skipped automatically.
 */

const LOG = '[Merge Image Repair]';

// SQL boolean: does a URL look like a curated (hand-picked) image?
const CURATED = (col: string) => `(
  ${col} LIKE '%/marvel-cards/card\\_%' OR
  ${col} LIKE '%/user_uploads/%' OR
  ${col} LIKE '%/mcv/sets/%'
)`;

export async function restoreTwinMergeImages(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('restore_twin_merge_images'))`);

    await tx.execute(sql`CREATE TABLE IF NOT EXISTS merge_image_repairs (
      card_id integer NOT NULL,
      side text NOT NULL,
      old_url text,
      new_url text NOT NULL,
      rule text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (card_id, side)
    )`);

    for (const side of ['front', 'back'] as const) {
      const col = `${side}_image_url`;

      // Rule 1: latest approved user upload for the survivor always wins.
      const r1: any = await tx.execute(sql.raw(`
        WITH approved AS (
          SELECT DISTINCT ON (p.card_id) p.card_id, p.${col} AS new_url
          FROM pending_card_images p
          WHERE p.status = 'approved' AND p.${col} IS NOT NULL
            AND EXISTS (SELECT 1 FROM cards d
                        WHERE d.archive_reason LIKE 'Legacy duplicate set merged%'
                          AND (regexp_match(d.archive_reason, 'merged into card (\\d+)'))[1]::int = p.card_id)
          ORDER BY p.card_id, p.reviewed_at DESC NULLS LAST, p.id DESC
        ),
        cand AS (
          SELECT a.card_id, s.${col} AS old_url, a.new_url
          FROM approved a
          JOIN cards s ON s.id = a.card_id
          WHERE s.${col} IS DISTINCT FROM a.new_url
            AND (s.${col} IS NULL OR NOT ${CURATED(`s.${col}`)})
            AND NOT EXISTS (SELECT 1 FROM merge_image_repairs r
                            WHERE r.card_id = a.card_id AND r.side = '${side}')
        ),
        ins AS (
          INSERT INTO merge_image_repairs (card_id, side, old_url, new_url, rule)
          SELECT card_id, '${side}', old_url, new_url, 'approved_upload_wins' FROM cand
          ON CONFLICT DO NOTHING
          RETURNING card_id, new_url
        )
        UPDATE cards c SET ${col} = ins.new_url
        FROM ins WHERE c.id = ins.card_id
      `));
      console.log(`${LOG} ${side}: applied ${r1.rowCount ?? 0} approved upload(s) to merge survivors`);

      // Rule 2: curated image on the archived dup, non-curated on the survivor.
      const r2: any = await tx.execute(sql.raw(`
        WITH pairs AS (
          SELECT d.id AS dup_id,
                 (regexp_match(d.archive_reason, 'merged into card (\\d+)'))[1]::int AS surv_id,
                 d.${col} AS dup_url
          FROM cards d
          WHERE d.archive_reason LIKE 'Legacy duplicate set merged%'
            AND d.archived_at IS NOT NULL
        ),
        cand AS (
          SELECT p.surv_id, s.${col} AS old_url,
                 -- if several dups map to one survivor, pick one deterministically
                 (array_agg(p.dup_url ORDER BY p.dup_id DESC))[1] AS new_url
          FROM pairs p
          JOIN cards s ON s.id = p.surv_id
          WHERE p.dup_url IS NOT NULL
            AND ${CURATED('p.dup_url')}
            AND (s.${col} IS NULL OR NOT ${CURATED(`s.${col}`)})
            AND s.${col} IS DISTINCT FROM p.dup_url
            AND NOT EXISTS (SELECT 1 FROM merge_image_repairs r
                            WHERE r.card_id = p.surv_id AND r.side = '${side}')
          GROUP BY p.surv_id, s.${col}
        ),
        ins AS (
          INSERT INTO merge_image_repairs (card_id, side, old_url, new_url, rule)
          SELECT surv_id, '${side}', old_url, new_url, 'curated_dup_over_noncurated_surv' FROM cand
          ON CONFLICT DO NOTHING
          RETURNING card_id, new_url
        )
        UPDATE cards c SET ${col} = ins.new_url
        FROM ins WHERE c.id = ins.card_id
      `));
      console.log(`${LOG} ${side}: restored ${r2.rowCount ?? 0} curated image(s) from archived merge twins`);
    }
  });

  console.log(`${LOG} Complete`);
}
