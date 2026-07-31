/**
 * One-time migration: create new parallel subsets for the 58 variant groups
 * (5+ cards, non-unassigned) that had no matching subset in the parallel report.
 *
 * For each group:
 *   1. INSERT INTO card_sets (name, slug, year, main_set_id, is_active, is_insert_subset)
 *      … if the subset already exists (slug collision), reuse it.
 *   2. UPDATE cards SET set_id = <new_subset_id> WHERE id IN (<card_ids>)
 *   3. INSERT INTO admin_audit_logs for every card moved.
 *
 * Run: npx ts-node -e "require('./scripts/create-parallel-subsets')"
 * or:  npx tsx scripts/create-parallel-subsets.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ADMIN_USER_ID = 337;
const DRY_RUN = process.env.DRY_RUN !== "false"; // default dry-run; set DRY_RUN=false to apply

// Map from CSV main_set name → { mainSetId, year }
const MAIN_SET_MAP: Record<string, { mainSetId: number; year: number }> = {
  "2000 Topps X-Men The Movie":              { mainSetId: 486, year: 2000 },
  "2020 Upper Deck Marvel Ages":             { mainSetId: 346, year: 2020 },
  "2020-21 Upper Deck Marvel Annual":        { mainSetId: 351, year: 2020 },
  "2022 Fleer Ultra Marvel Avengers":        { mainSetId: 110, year: 2022 },
  "2023 Fleer Ultra Marvel Wolverine":       { mainSetId: 378, year: 2023 },
  "2023 Upper Deck Marvel Platinum ":        { mainSetId: 3,   year: 2023 },
  "2023 Upper Deck Marvel Platinum":         { mainSetId: 3,   year: 2023 }, // trimmed form in CSV
  "2023 Upper Deck Marvel Wandavision":      { mainSetId: 398, year: 2023 },
  "2024 Upper Deck Marvel Studios Series 1": { mainSetId: 419, year: 2024 },
  "2025 Kakawow Aura Marvel":                { mainSetId: 82,  year: 2025 },
  "2025 Topps Chrome Marvel":                { mainSetId: 121, year: 2025 },
  "Marvel 2025 Topps Chrome":               { mainSetId: 80,  year: 2025 },
  "marvel 2025 topps finest x men '97":     { mainSetId: 79,  year: 2025 },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Groups: [mainSet, variant, cardIds[]]
const GROUPS: Array<{ mainSet: string; variant: string; cardIds: number[] }> = [
  // Derived from parallel_subset_check_2026-07-30.csv (no_match rows, 5+ cards, non-unassigned)
  // ──────────────────────────────────────────────────────────────────────────────────────────
  // Populated by the seed script below at runtime from the CSV
];

import * as fs from "fs";
import * as path from "path";

function loadGroupsFromCsv(): typeof GROUPS {
  const csvPath = path.join(process.cwd(), "exports", "parallel_subset_check_2026-07-30.csv");
  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  const header = lines[0].split(",");
  const idx = (col: string) => header.indexOf(col);
  const iMS = idx("main_set"), iVariant = idx("variant"), iCardIds = idx("card_ids"),
        iCount = idx("card_count"), iStatus = idx("move_status");

  const groupMap = new Map<string, { mainSet: string; variant: string; cards: number; cardIds: number[] }>();

  for (let i = 1; i < lines.length; i++) {
    // Robust CSV parse for quoted fields
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 10) continue;
    const moveStatus = cols[iStatus]?.trim();
    if (moveStatus !== "none") continue;
    const mainSet = cols[iMS]?.trim();
    const variant = cols[iVariant]?.trim();
    const cardCount = parseInt(cols[iCount]?.trim() ?? "0", 10);
    const cardIdsStr = cols[iCardIds]?.trim() ?? "";
    if (!mainSet || mainSet === "(unassigned)") continue;
    if (!variant || !MAIN_SET_MAP[mainSet]) continue;
    const cardIds = cardIdsStr.split(/\s+/).map(Number).filter(Boolean);
    const key = `${mainSet}||${variant}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.cards += cardCount;
      existing.cardIds.push(...cardIds);
    } else {
      groupMap.set(key, { mainSet, variant, cards: cardCount, cardIds });
    }
  }

  return [...groupMap.values()]
    .filter((g) => g.cards >= 5)
    .sort((a, b) => b.cards - a.cards)
    .map(({ mainSet, variant, cardIds }) => ({ mainSet, variant, cardIds }));
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

async function main() {
  const groups = loadGroupsFromCsv();
  console.log(`\nLoaded ${groups.length} groups (${groups.reduce((s, g) => s + g.cardIds.length, 0)} cards) from CSV`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (set DRY_RUN=false to apply)" : "LIVE — writing to DB"}\n`);

  let createdSubsets = 0;
  let reusedSubsets = 0;
  let movedCards = 0;
  let skippedCards = 0;

  for (const group of groups) {
    const meta = MAIN_SET_MAP[group.mainSet]!;
    const subsetName = `${group.mainSet} - ${group.variant}`;
    const slug = slugify(subsetName);

    // ── 1. Find or create subset ──────────────────────────────────────────────
    const existing = await db.execute(sql`SELECT id, name FROM card_sets WHERE slug = ${slug} LIMIT 1`);
    let subsetId: number;
    let subsetAction: "created" | "reused";

    if (existing.rows.length > 0) {
      subsetId = (existing.rows[0] as any).id;
      subsetAction = "reused";
      reusedSubsets++;
    } else {
      if (!DRY_RUN) {
        const ins = await db.execute(sql`
          INSERT INTO card_sets (name, slug, year, main_set_id, is_active, is_canonical, is_insert_subset, total_cards)
          VALUES (${subsetName}, ${slug}, ${meta.year}, ${meta.mainSetId}, true, false, false, 0)
          RETURNING id
        `);
        subsetId = (ins.rows[0] as any).id;
      } else {
        subsetId = -1; // placeholder for dry run
      }
      subsetAction = "created";
      createdSubsets++;
    }

    // ── 2. Move cards ─────────────────────────────────────────────────────────
    const cardRows = (await db.execute(sql`
      SELECT id, name, card_number, set_id FROM cards
      WHERE id IN (${sql.join(group.cardIds.map((id) => sql`${id}`), sql`, `)})
        AND archived_at IS NULL
    `)).rows as any[];

    let moved = 0;
    let skipped = 0;
    for (const card of cardRows) {
      if (card.set_id === subsetId) { skipped++; continue; } // already there
      if (!DRY_RUN) {
        const upd = await db.execute(sql`
          UPDATE cards SET set_id = ${subsetId}
          WHERE id = ${card.id} AND set_id = ${card.set_id} AND archived_at IS NULL
        `);
        if ((upd as any).rowCount === 0) { skipped++; continue; }
        await db.execute(sql`
          INSERT INTO admin_audit_logs (admin_user_id, action_type, entity_type, entity_id, entity_name, notes)
          VALUES (
            ${ADMIN_USER_ID},
            'data_quality_parallel_move',
            'card',
            ${card.id},
            ${card.name},
            ${JSON.stringify({
              old: { setId: card.set_id },
              new: { setId: subsetId },
              cardNumber: card.card_number,
              reason: `Parallel subset creation: moved ${group.variant} variant into "${subsetName}"`,
            })}
          )
        `);
      }
      moved++;
    }
    const missing = group.cardIds.length - cardRows.length;
    skipped += missing;
    movedCards += moved;
    skippedCards += skipped;

    const statusEmoji = subsetAction === "created" ? "🆕" : "♻️";
    console.log(
      `${statusEmoji} [${subsetAction}] "${subsetName}" (id=${subsetId}) — ${moved} cards moved${skipped ? `, ${skipped} skipped` : ""}`
    );
  }

  console.log(`\n── Summary ──────────────────────────────────────────────────────────`);
  console.log(`  New subsets created : ${createdSubsets}`);
  console.log(`  Existing reused     : ${reusedSubsets}`);
  console.log(`  Cards moved         : ${movedCards}`);
  console.log(`  Cards skipped       : ${skippedCards}`);
  if (DRY_RUN) {
    console.log(`\n  ⚠️  DRY RUN — nothing was written. Rerun with DRY_RUN=false to apply.`);
  } else {
    console.log(`\n  ✅ Applied. Every moved card has an admin_audit_logs entry for rollback.`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
