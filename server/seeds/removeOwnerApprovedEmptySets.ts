import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { mainSets, cardSets } from '../../shared/schema';
import removals from './data/owner-empty-set-removals.json';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function removeOwnerApprovedEmptySetsTx(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merge_duplicate_legacy_sets'))`);
  // Prevent new references between the emptiness check and deletion.
  await tx.execute(sql`LOCK TABLE main_sets, card_sets IN SHARE ROW EXCLUSIVE MODE`);
  let deletedMainSets = 0, deletedSubsets = 0, preservedHistorySubsets = 0;
  for (const entry of removals) {
    const [main] = await tx.select().from(mainSets).where(eq(mainSets.slug, entry.slug));
    if (!main) continue;
    const counts = await tx.execute(sql`SELECT
      (SELECT count(*) FROM cards c JOIN card_sets s ON s.id=c.set_id WHERE s.main_set_id=${main.id})::int cards,
      (SELECT count(*) FROM upcoming_sets WHERE published_main_set_id=${main.id})::int upcoming`);
    if (Number(counts.rows[0].cards) || Number(counts.rows[0].upcoming)) {
      throw new Error(`Owner cleanup refused: ${entry.review} is populated or linked to an upcoming release`);
    }
    const subsets = await tx.select().from(cardSets).where(eq(cardSets.mainSetId, main.id));
    for (const set of subsets) {
      const refs = await tx.execute(sql`SELECT (
        (SELECT count(*) FROM card_set_migrations WHERE legacy_set_id=${set.id} OR canonical_set_id=${set.id}) +
        (SELECT count(*) FROM migration_logs WHERE source_set_id=${set.id} OR destination_set_id=${set.id}) +
        (SELECT count(*) FROM migration_log_cards WHERE old_set_id=${set.id} OR new_set_id=${set.id}) +
        (SELECT count(*) FROM share_links WHERE card_set_id=${set.id})
      )::int n`);
      if (Number(refs.rows[0].n)) {
        await tx.update(cardSets).set({
          mainSetId: null, isActive: false, archivedAt: set.archivedAt ?? new Date(),
        }).where(eq(cardSets.id, set.id));
        preservedHistorySubsets++;
      } else {
        await tx.delete(cardSets).where(eq(cardSets.id, set.id));
        deletedSubsets++;
      }
    }
    // No cascading deletion: unknown FK dependencies abort and roll back.
    await tx.delete(mainSets).where(eq(mainSets.id, main.id));
    deletedMainSets++;
  }
  return { deletedMainSets, deletedSubsets, preservedHistorySubsets };
}

export const removeOwnerApprovedEmptySets = () => db.transaction(removeOwnerApprovedEmptySetsTx);
