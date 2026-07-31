/**
 * One-off remediation for the 7 "(unassigned)" Eternals parallel groups
 * (Gold/Blue/Silver/Purple/Green/Black/Printing Plate — 324 cards).
 *
 * Steps (all idempotent, dry-run by default):
 *  1. Assign main_set_id = 388 ("2023 Upper Deck Marvel Eternals") to the two
 *     orphan card_sets rows: 1617 "marvel 2023 eternals" and
 *     1623 "marvel 2023 eternals Printing Plate". Audit-logged.
 *  2. Activate set 1623 — it is the only Printing Plate subset under main set
 *     388, and the merge guard refuses inactive targets. Audit-logged.
 *  3. Re-run buildParallelSubsetReport: all 324 cards classify as
 *     already_in_target (exact counterparts exist in subsets 5085/5072/5094/
 *     5092/5086/5071 and 1623) and are merged via mergeRedundantParallels
 *     (transfers references, soft-archives the stray, audit-logs each merge).
 *
 * Usage: npx tsx scripts/merge-eternals-redundant-parallels.ts [--confirm]
 */
import { buildParallelSubsetReport, mergeRedundantParallels } from "../server/services/dataQualityAudit";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 337);
const CONFIRM = process.argv.includes("--confirm");
const MAIN_SET_ID = 388; // 2023 Upper Deck Marvel Eternals
const ETERNALS_SET_ID = 1617; // "marvel 2023 eternals" (orphan base subset)
const PP_TARGET_SET_ID = 1623; // "marvel 2023 eternals Printing Plate"

/** Idempotently assign main_set_id + activate the PP subset, with audit logs. */
async function ensureSubsetPrerequisites(): Promise<void> {
  const rows = (
    await db.execute(sql`SELECT id, name, main_set_id, is_active FROM card_sets WHERE id IN (${ETERNALS_SET_ID}, ${PP_TARGET_SET_ID})`)
  ).rows as Array<{ id: number; name: string; main_set_id: number | null; is_active: boolean }>;
  if (rows.length !== 2) throw new Error(`Expected card_sets ${ETERNALS_SET_ID} & ${PP_TARGET_SET_ID}, found ${rows.length}`);

  for (const r of rows) {
    if (r.main_set_id != null && r.main_set_id !== MAIN_SET_ID)
      throw new Error(`card_sets ${r.id} already has main_set_id=${r.main_set_id}, refusing to overwrite`);
    if (r.main_set_id == null) {
      console.log(`${CONFIRM ? "Assigning" : "Would assign"} main_set_id=${MAIN_SET_ID} to card_sets ${r.id} ("${r.name}")`);
      if (CONFIRM) {
        await db.execute(sql`UPDATE card_sets SET main_set_id = ${MAIN_SET_ID} WHERE id = ${r.id} AND main_set_id IS NULL`);
        await db.execute(sql`
          INSERT INTO admin_audit_logs (admin_user_id, action_type, entity_type, entity_id, entity_name, notes)
          VALUES (${ADMIN_USER_ID}, 'data_quality_main_set_assign', 'card_set', ${r.id}, ${r.name},
            ${JSON.stringify({ old: { mainSetId: null }, new: { mainSetId: MAIN_SET_ID }, reason: "Assign main set to unassigned Eternals subset (388 = 2023 Upper Deck Marvel Eternals)" })})
        `);
      }
    }
    if (r.id === PP_TARGET_SET_ID && !r.is_active) {
      console.log(`${CONFIRM ? "Activating" : "Would activate"} card_sets ${r.id} ("${r.name}") — only Printing Plate subset under main set ${MAIN_SET_ID}`);
      if (CONFIRM) {
        await db.execute(sql`UPDATE card_sets SET is_active = true WHERE id = ${r.id} AND is_active = false`);
        await db.execute(sql`
          INSERT INTO admin_audit_logs (admin_user_id, action_type, entity_type, entity_id, entity_name, notes)
          VALUES (${ADMIN_USER_ID}, 'data_quality_subset_activate', 'card_set', ${r.id}, ${r.name},
            ${JSON.stringify({ old: { isActive: false }, new: { isActive: true }, reason: "Only Printing Plate subset under main set 388; activated so redundant PP duplicates can merge into it" })})
        `);
      }
    }
  }
}

async function main() {
  console.log(`Mode: ${CONFIRM ? "CONFIRM (applying changes)" : "DRY RUN"}`);

  // ── Step 1+2: prerequisites (idempotent) ──
  await ensureSubsetPrerequisites();

  // ── Step 3: merge redundant copies ──
  const rows = await buildParallelSubsetReport();

  // Pre-check: no "(unassigned)" groups should remain for these subsets once
  // prerequisites are applied (dry-run mode may still show them).
  const unassigned = rows.filter((r) => r.mainSet === "(unassigned)" && r.currentSetId === ETERNALS_SET_ID);
  if (unassigned.length > 0)
    console.log(`Note: ${unassigned.length} groups still show "(unassigned)" — prerequisites not applied yet (dry run?)`);

  const redundant = rows.filter(
    (r) => r.currentSetId === ETERNALS_SET_ID && r.moveStatus === "already_in_target" && r.matchedSubsetId != null
  );
  const merges = redundant.flatMap((r) =>
    r.cardIds.map((cardId) => ({ dupCardId: cardId, targetSetId: r.matchedSubsetId!, expectedCurrentSetId: r.currentSetId }))
  );

  // Printing Plate groups have no name-matched subset in the report; their
  // counterparts live in set 1623 ("marvel 2023 eternals Printing Plate").
  const pp = rows.filter(
    (r) => r.currentSetId === ETERNALS_SET_ID && r.variant === "Printing Plate" && r.matchedSubsetId == null
  );
  const ppMerges = pp.flatMap((r) =>
    r.cardIds.map((cardId) => ({ dupCardId: cardId, targetSetId: PP_TARGET_SET_ID, expectedCurrentSetId: r.currentSetId }))
  );

  console.log(`Color-parallel merges: ${merges.length}; Printing Plate merges: ${ppMerges.length}`);

  let remaining = [...merges, ...ppMerges];
  let total = 0;
  for (let pass = 1; remaining.length > 0 && pass <= 50; pass++) {
    const res = await mergeRedundantParallels(ADMIN_USER_ID, remaining, CONFIRM);
    console.log(`Pass ${pass}: ${CONFIRM ? `merged ${res.applied}` : `would merge ${res.preview.length}`}, skipped ${res.skipped.length}`);
    if (res.impact)
      console.log(`  Impact: ${res.impact.collectionRecords} collection rows (${res.impact.collectionUsers} users), ${res.impact.wishlistRecords} wishlist rows`);
    const reasons = new Map<string, number>();
    for (const s of res.skipped) reasons.set(s.reason.replace(/\d+/g, "N"), (reasons.get(s.reason.replace(/\d+/g, "N")) ?? 0) + 1);
    for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  skip x${n}: ${reason}`);
    total += CONFIRM ? res.applied : res.preview.length;
    if (!CONFIRM) { remaining = []; break; }
    const retryIds = new Set(res.skipped.filter((s) => s.reason.includes("Another merge in this batch")).map((s) => s.cardId));
    remaining = remaining.filter((m) => retryIds.has(m.dupCardId));
  }
  console.log(`TOTAL ${CONFIRM ? "merged" : "would merge"}: ${total}`);

  // ── Post-check: after CONFIRM, no unassigned or eternals rows should remain ──
  if (CONFIRM) {
    const after = await buildParallelSubsetReport();
    const remUnassigned = after.filter((r) => r.mainSet === "(unassigned)").length;
    const remEternals = after.filter((r) => r.currentSetId === ETERNALS_SET_ID).length;
    console.log(`Post-check: unassigned rows remaining = ${remUnassigned}, eternals (set ${ETERNALS_SET_ID}) rows remaining = ${remEternals}`);
    if (remUnassigned > 0 || remEternals > 0) {
      console.error("Post-check FAILED — some groups remain unresolved.");
      process.exit(1);
    }
    console.log("Post-check passed — all unassigned Eternals parallel groups resolved.");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
