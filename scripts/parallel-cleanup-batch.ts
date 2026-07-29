/**
 * One-time batch: clean up parallel duplicate cards.
 *  1. Merge redundant copies (already_in_target) — transfer collections, archive stray.
 *  2. Move clean parallels (ready) into their matching subsets.
 * target_occupied / no-match groups are left for manual review.
 *
 * Usage: tsx scripts/parallel-cleanup-batch.ts [--confirm]
 */
import { buildParallelSubsetReport, mergeRedundantParallels, moveParallelCards } from "../server/services/dataQualityAudit";

const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 337); // Joshua in dev; override via env in other environments
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  console.log(`Mode: ${CONFIRM ? "CONFIRM (applying changes)" : "DRY RUN"}`);
  const rows = await buildParallelSubsetReport();

  // ---- 1. Redundant copies -> merge ----
  const redundant = rows.filter((r) => r.moveStatus === "already_in_target" && r.matchedSubsetId != null);
  const merges = redundant.flatMap((r) =>
    r.cardIds.map((cardId) => ({ dupCardId: cardId, targetSetId: r.matchedSubsetId!, expectedCurrentSetId: r.currentSetId }))
  );
  console.log(`\nRedundant copies: ${redundant.length} groups, ${merges.length} cards to merge`);

  // Groups can hold several copies pointing at the same survivor; the batch
  // guard only allows one per survivor per pass, so loop until stable.
  let totalMerged = 0;
  let remaining = merges;
  for (let pass = 1; remaining.length > 0 && pass <= 50; pass++) {
    const res = await mergeRedundantParallels(ADMIN_USER_ID, remaining, CONFIRM);
    console.log(`  Pass ${pass}: ${CONFIRM ? `merged ${res.applied}` : `would merge ${res.preview.length}`}, skipped ${res.skipped.length}`);
    if (res.impact) console.log(`  Impact: ${res.impact.collectionRecords} collection rows (${res.impact.collectionUsers} users), ${res.impact.wishlistRecords} wishlist rows`);
    const skipReasons = new Map<string, number>();
    for (const s of res.skipped) {
      const key = s.reason.replace(/\d+/g, "N");
      skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1);
    }
    for (const [reason, n] of [...skipReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    skip x${n}: ${reason}`);
    totalMerged += CONFIRM ? res.applied : res.preview.length;
    if (!CONFIRM) { remaining = []; break; } // dry run: one pass is enough to see the picture
    // Retry only the batch-guard skips (another merge claimed the survivor this pass)
    const retryIds = new Set(res.skipped.filter((s) => s.reason.includes("Another merge in this batch")).map((s) => s.cardId));
    remaining = remaining.filter((m) => retryIds.has(m.dupCardId));
  }
  console.log(`  TOTAL ${CONFIRM ? "merged" : "would merge"}: ${totalMerged}`);

  // ---- 2. Ready groups -> move ----
  const ready = rows.filter((r) => r.moveStatus === "ready" && r.matchedSubsetId != null);
  const moves = ready.flatMap((r) =>
    r.cardIds.map((cardId) => ({ cardId, targetSetId: r.matchedSubsetId!, expectedCurrentSetId: r.currentSetId }))
  );
  console.log(`\nReady moves: ${ready.length} groups, ${moves.length} cards to move`);
  // Route caps at 3000 but we call the service directly; chunk anyway for sane transactions
  let totalMoved = 0;
  let totalMoveSkipped = 0;
  const moveSkipReasons = new Map<string, number>();
  for (let i = 0; i < moves.length; i += 500) {
    const chunk = moves.slice(i, i + 500);
    const res = await moveParallelCards(ADMIN_USER_ID, chunk, CONFIRM);
    totalMoved += CONFIRM ? res.applied : res.preview.length;
    totalMoveSkipped += res.skipped.length;
    for (const s of res.skipped) {
      const key = s.reason.replace(/\d+/g, "N");
      moveSkipReasons.set(key, (moveSkipReasons.get(key) ?? 0) + 1);
    }
  }
  console.log(`  TOTAL ${CONFIRM ? "moved" : "would move"}: ${totalMoved}, skipped ${totalMoveSkipped}`);
  for (const [reason, n] of [...moveSkipReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    skip x${n}: ${reason}`);

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
