/**
 * One-off remediation to retire the leftover duplicate Eternals base set
 * (card_sets 1617 "marvel 2023 eternals", inactive, under main set 388).
 *
 * Prerequisite: scripts/merge-eternals-redundant-parallels.ts already applied
 * (all 324 color/PP parallels merged; 1617 holds only bracket-free cards).
 *
 * Steps (idempotent, dry-run by default):
 *  1. "Gemma Chan As Sersi [Immortals And Mortals] #IM-11" carries card_number
 *     "11" — fix it to "IM-11" (applyCardNumberFixes), then merge it into its
 *     existing counterpart IM-11 in subset 5087 "Immortals and Mortals".
 *  2. Merge the ~100 base cards whose exact counterpart (same number + name)
 *     exists in base subset 5069 via mergeRedundantParallels (transfers
 *     references, soft-archives the stray, audit-logs each merge).
 *  3. Move the 15 base short-prints #101–115 (no counterpart in 5069 — its
 *     numbering stops at 100 while the Gold/Black parallels run to 115) into
 *     subset 5069 via moveParallelCards.
 *  4. "Hobby Box" (a sealed-product record, not a card) is genuinely unique —
 *     it stays in 1617, which remains inactive.
 *
 * Usage: npx tsx scripts/retire-eternals-base-set.ts [--confirm]
 */
import {
  applyCardNumberFixes,
  mergeRedundantParallels,
  moveParallelCards,
  normalizeCardName,
} from "../server/services/dataQualityAudit";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 337);
const CONFIRM = process.argv.includes("--confirm");
const MAIN_SET_ID = 388; // 2023 Upper Deck Marvel Eternals
const LEGACY_SET_ID = 1617; // "marvel 2023 eternals"
const BASE_SUBSET_ID = 5069; // "... - 2023 Upper Deck Marvel Eternals" (base)
const IMMORTALS_SUBSET_ID = 5087; // "... - Immortals and Mortals"

interface CardRow { id: number; card_number: string; name: string }

async function loadActiveLegacyCards(): Promise<CardRow[]> {
  return (
    await db.execute(sql`
      SELECT id, card_number, name FROM cards
      WHERE set_id = ${LEGACY_SET_ID} AND archived_at IS NULL
      ORDER BY id
    `)
  ).rows as unknown as CardRow[];
}

function logResult(label: string, res: { applied: number; preview: any[]; skipped: Array<{ cardId: number; reason: string }> }) {
  console.log(`${label}: ${CONFIRM ? `applied ${res.applied}` : `would apply ${res.preview.length}`}, skipped ${res.skipped.length}`);
  const reasons = new Map<string, number>();
  for (const s of res.skipped) reasons.set(s.reason.replace(/\d+/g, "N"), (reasons.get(s.reason.replace(/\d+/g, "N")) ?? 0) + 1);
  for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  skip x${n}: ${reason}`);
}

async function main() {
  console.log(`Mode: ${CONFIRM ? "CONFIRM (applying changes)" : "DRY RUN"}`);

  // ── Sanity checks ──
  const setRows = (
    await db.execute(sql`SELECT id, main_set_id, is_active FROM card_sets WHERE id IN (${LEGACY_SET_ID}, ${BASE_SUBSET_ID}, ${IMMORTALS_SUBSET_ID})`)
  ).rows as Array<{ id: number; main_set_id: number | null; is_active: boolean }>;
  for (const id of [LEGACY_SET_ID, BASE_SUBSET_ID, IMMORTALS_SUBSET_ID]) {
    const r = setRows.find((s) => s.id === id);
    if (!r) throw new Error(`card_sets ${id} not found`);
    if (r.main_set_id !== MAIN_SET_ID)
      throw new Error(`card_sets ${id} has main_set_id=${r.main_set_id}, expected ${MAIN_SET_ID} — run merge-eternals-redundant-parallels.ts first`);
  }

  let legacy = await loadActiveLegacyCards();

  // ── Step 0: leftover bracketed parallels the parallels script skipped ──
  // (their duplicate groups contained differently-named cards — Hobby Box /
  // Gemma Chan — so they never classified as OK_PARALLEL). Merge each into the
  // sibling subset whose trailing name matches the bracket variant.
  const siblings = (
    await db.execute(sql`SELECT id, name FROM card_sets WHERE main_set_id = ${MAIN_SET_ID} AND is_active = true AND id != ${LEGACY_SET_ID}`)
  ).rows as Array<{ id: number; name: string }>;
  const PP_SET_ID = 1623; // "marvel 2023 eternals Printing Plate" — activated by prerequisite script
  const subsetForVariant = (variant: string): number | null => {
    if (/^printing plate$/i.test(variant)) return PP_SET_ID;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const hit = siblings.find((s) => {
      const parts = s.name.split(" - ");
      return parts.length > 1 && norm(parts[parts.length - 1]) === norm(variant);
    });
    return hit?.id ?? null;
  };

  const bracketed = legacy.filter((c) => /\[[^\]]+\]\s*$/.test(c.name));
  const leftoverMerges: Array<{ dupCardId: number; targetSetId: number; expectedCurrentSetId: number }> = [];
  for (const c of bracketed) {
    const variant = c.name.match(/\[([^\]]+)\]\s*$/)![1].trim();
    const target = subsetForVariant(variant);
    if (target == null) throw new Error(`No sibling subset matches variant "${variant}" for card ${c.id} "${c.name}"`);
    leftoverMerges.push({ dupCardId: c.id, targetSetId: target, expectedCurrentSetId: LEGACY_SET_ID });
  }
  if (leftoverMerges.length > 0) {
    const res = await mergeRedundantParallels(ADMIN_USER_ID, leftoverMerges, CONFIRM);
    logResult(`Leftover bracketed-parallel merges (${leftoverMerges.length})`, res);
    if (CONFIRM && res.applied !== leftoverMerges.length) throw new Error("Not all leftover parallels merged — aborting");
    legacy = await loadActiveLegacyCards();
  }

  // ── Step 1: Gemma Chan IM-11 — renumber, then merge into subset 5087 ──
  const gemma = legacy.filter((c) => /#IM-11\s*$/i.test(c.name));
  if (gemma.length > 1) throw new Error(`Expected at most one IM-11 card in set ${LEGACY_SET_ID}, found ${gemma.length}`);
  if (gemma.length === 1) {
    const g = gemma[0];
    if (g.card_number.toUpperCase() !== "IM-11") {
      const fixRes = await applyCardNumberFixes(
        ADMIN_USER_ID,
        [{ cardId: g.id, expectedCurrentNumber: g.card_number, newCardNumber: "IM-11" }],
        CONFIRM
      );
      logResult(`IM-11 renumber ("${g.card_number}" -> "IM-11")`, fixRes);
      if (CONFIRM && fixRes.applied !== 1) throw new Error("IM-11 renumber did not apply — aborting");
    }
    const mergeRes = await mergeRedundantParallels(
      ADMIN_USER_ID,
      [{ dupCardId: g.id, targetSetId: IMMORTALS_SUBSET_ID, expectedCurrentSetId: LEGACY_SET_ID }],
      CONFIRM
    );
    logResult(`IM-11 merge into Immortals and Mortals (${IMMORTALS_SUBSET_ID})`, mergeRes);
    if (CONFIRM && mergeRes.applied !== 1) throw new Error("IM-11 merge did not apply — aborting");
  } else {
    console.log("IM-11 card already resolved — skipping step 1");
  }

  // ── Step 2: merge base cards that duplicate subset 5069 ──
  legacy = await loadActiveLegacyCards();
  const baseTargets = (
    await db.execute(sql`SELECT card_number, name FROM cards WHERE set_id = ${BASE_SUBSET_ID} AND archived_at IS NULL`)
  ).rows as unknown as CardRow[];
  const targetKeys = new Set(baseTargets.map((t) => `${t.card_number.trim().toUpperCase()}::${normalizeCardName(t.name)}`));
  const isHobbyBox = (c: CardRow) => /hobby box/i.test(c.name);

  const dupes = legacy.filter(
    (c) => !isHobbyBox(c) && !/[\[(]/.test(c.name) && targetKeys.has(`${c.card_number.trim().toUpperCase()}::${normalizeCardName(c.name)}`)
  );
  const mergeRes = await mergeRedundantParallels(
    ADMIN_USER_ID,
    dupes.map((c) => ({ dupCardId: c.id, targetSetId: BASE_SUBSET_ID, expectedCurrentSetId: LEGACY_SET_ID })),
    CONFIRM
  );
  logResult(`Base-card merges into subset ${BASE_SUBSET_ID}`, mergeRes);
  if (mergeRes.impact)
    console.log(`  Impact: ${mergeRes.impact.collectionRecords} collection rows (${mergeRes.impact.collectionUsers} users), ${mergeRes.impact.wishlistRecords} wishlist rows`);

  // ── Step 3: move unique short-prints #101–115 into subset 5069 ──
  const uniques = legacy.filter(
    (c) => !isHobbyBox(c) && !dupes.some((d) => d.id === c.id) && /^\d+$/.test(c.card_number.trim()) && Number(c.card_number) >= 101 && Number(c.card_number) <= 115
  );
  const moveRes = await moveParallelCards(
    ADMIN_USER_ID,
    uniques.map((c) => ({ cardId: c.id, targetSetId: BASE_SUBSET_ID, expectedCurrentSetId: LEGACY_SET_ID })),
    CONFIRM
  );
  logResult(`Short-print moves (#101–115) into subset ${BASE_SUBSET_ID}`, moveRes);

  // ── Step 4: report anything unaccounted for ──
  const after = await loadActiveLegacyCards();
  const leftovers = after.filter((c) => !isHobbyBox(c));
  console.log(`Remaining active cards in set ${LEGACY_SET_ID}: ${after.length} (${after.map((c) => `"${c.name}"`).slice(0, 5).join(", ")}${after.length > 5 ? ", …" : ""})`);

  if (CONFIRM) {
    if (leftovers.length > 0) {
      console.error(`Post-check FAILED — ${leftovers.length} unexpected cards remain:`);
      for (const c of leftovers.slice(0, 20)) console.error(`  ${c.id} #${c.card_number} ${c.name}`);
      process.exit(1);
    }
    // Keep total_cards in sync (merge/move helpers already do this, but be safe)
    for (const sid of [LEGACY_SET_ID, BASE_SUBSET_ID]) {
      await db.execute(sql`UPDATE card_sets SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = ${sid} AND archived_at IS NULL) WHERE id = ${sid}`);
    }
    const inactive = (await db.execute(sql`SELECT is_active FROM card_sets WHERE id = ${LEGACY_SET_ID}`)).rows[0] as any;
    console.log(`Post-check passed — set ${LEGACY_SET_ID} holds only the Hobby Box product record and stays inactive (is_active=${inactive.is_active}).`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
