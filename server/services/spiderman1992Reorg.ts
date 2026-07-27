// One-time fix (July 2026): 1992 Comic Images Spider-Man reorg.
//
// Current (wrong) state — verified identical in dev and prod:
//   30th Anniversary main set (slug 1992-comic-images-spider-man-ii-30th-anniversary-1962-1992):
//     - "base" subset: 102 cards = the 90 McFarlane Era base cards (1-90) +
//       P-1..P-6 (McFarlane prisms) + P7..P12 (real 30th Anniversary prisms)
//     - "Prisms" subset: an EXACT duplicate of the same 102 cards
//   McFarlane Era main set (slug 1992-comic-images-spider-man-the-mcfarlane-era):
//     - "base" subset: EMPTY ("coming soon")
//     - "Prisms" subset: P-1..P-6 (correct)
//
// Fix (idempotent, advisory-locked, single transaction):
//   1. Merge the duplicate 30thA "Prisms" cards into their "base" twins
//      (repoint user refs by card_number, then delete the dupes).
//   2. Move base cards 1-90 from the 30thA base subset into the empty
//      McFarlane base subset (card ids unchanged → all user refs follow).
//   3. Merge the 30thA base subset's P-1..P-6 into the McFarlane Prisms
//      subset's existing P-1..P-6 (repoint refs, delete dupes).
//   4. Move P7..P12 into the 30thA Prisms subset (they are 30thA inserts).
//   5. Seed the real 90-card 30th Anniversary base checklist (from the
//      user-provided spreadsheet) into the now-empty 30thA base subset.
//   6. Reconcile denormalized total_cards on all four subsets.
//
// Safe to remove after the prod run is confirmed
// (admin_audit_logs action_type 'spiderman_1992_reorg').

import { sql } from "drizzle-orm";
import { db } from "../db";

const ANNIV_MAIN_SLUG = "1992-comic-images-spider-man-ii-30th-anniversary-1962-1992";
const MCF_MAIN_SLUG = "1992-comic-images-spider-man-the-mcfarlane-era";

// Real 1992 Comic Images Spider-Man II: 30th Anniversary base checklist (1-90).
const ANNIV_BASE: [string, string][] = [
  ["1", "September, 1962"], ["2", "6 Years Old"], ["3", "The Exhibition"],
  ["4", "Human Spider"], ["5", "Reflexes"], ["6", "Wall Climber"],
  ["7", "Spider-Sense"], ["8", "Web-Shooters"], ["9", "Web Fluid"],
  ["10", "Equipment"], ["11", "Wrestling"], ["12", "Irony"],
  ["13", "A Hero Is Born"], ["14", "Amazing Spider-Man"], ["15", "The Chameleon"],
  ["16", "J. J. Jameson"], ["17", "Bad Press"], ["18", "John Jameson"],
  ["19", "Fantastic Four"], ["20", "Shutter-Bug"], ["21", "Duel to the Death"],
  ["22", "The Vulture"], ["23", "The Tinkerer"], ["24", "Doctor Octopus"],
  ["25", "First Defeat"], ["26", "Sandman"], ["27", "Doctor Doom"],
  ["28", "The Lizard"], ["29", "Four Eyes"], ["30", "Electro"],
  ["31", "Betty Brant"], ["32", "The Enforcers"], ["33", "Mysterio"],
  ["34", "Green Goblin"], ["35", "Break-Up"], ["36", "Big Shoes"],
  ["37", "The Hulk"], ["38", "Kraven"], ["39", "The Ringmaster"],
  ["40", "Daredevil"], ["41", "Sinister Six"], ["42", "The Scorpion"],
  ["43", "Spider-Slayer"], ["44", "Molten Man"], ["45", "The Rhino"],
  ["46", "The Test"], ["47", "The X-Men"], ["48", "The Shocker"],
  ["49", "Captain Stacy"], ["50", "The Prowler"], ["51", "Drug Abuse"],
  ["52", "Morbius"], ["53", "Man-Wolf"], ["54", "Gwen Stacy"],
  ["55", "Gwen's Death"], ["56", "Green Goblin's Death"], ["57", "The Jackal"],
  ["58", "The Punisher"], ["59", "Vigilante"], ["60", "Seeing Green"],
  ["61", "Black Cat"], ["62", "The Burglar"], ["63", "Hydro-Man"],
  ["64", "Hobgoblin"], ["65", "Kingpin"], ["66", "Secret Wars"],
  ["67", "The Suit"], ["68", "Bad Luck"], ["69", "The Rose"],
  ["70", "The Symbiote"], ["71", "The Avengers"], ["72", "Venom"],
  ["73", "Unmasked"], ["74", "Marriage"], ["75", "Buried Alive"],
  ["76", "Vermin"], ["77", "Universal Powers"], ["78", "Captured"],
  ["79", "Issue #300"], ["80", "Silver Sable"], ["81", "Arrogance"],
  ["82", "Spider-Man #1"], ["83", "Heroes"], ["84", "Spawn"],
  ["85", "New Rose"], ["86", "New Warriors"], ["87", "Soul of the Hunter"],
  ["88", "Parents"], ["89", "Spider-Man 2099"], ["90", "Checklist CL"],
];

export interface Spiderman1992ReorgResult {
  ran: boolean;
  reason?: string;
  mergedDupePrismSubsetCards: number;
  movedBaseCards: number;
  mergedMcfPrisms: number;
  movedAnnivPrisms: number;
  seededAnnivBase: number;
  repointedRefs: Record<string, number>;
}

// Repoint every user-facing reference from each doomed card to its surviving
// twin (matched by card_number), deleting rows that would violate unique
// constraints, then delete the doomed cards. Pairs come from temp table
// `sm92_pairs(doomed_id, survivor_id)` which the caller must populate.
async function mergeDoomedIntoSurvivors(tx: any, repointedRefs: Record<string, number>) {
  // user_collections: unique (user_id, card_id) — drop doomed row if the user
  // already has the survivor, otherwise repoint.
  const ucDel = await tx.execute(sql`
    DELETE FROM user_collections uc USING sm92_pairs p
    WHERE uc.card_id = p.doomed_id
      AND EXISTS (SELECT 1 FROM user_collections uc2
                  WHERE uc2.user_id = uc.user_id AND uc2.card_id = p.survivor_id)`);
  repointedRefs["user_collections (dup dropped)"] =
    (repointedRefs["user_collections (dup dropped)"] ?? 0) + (ucDel.rowCount ?? 0);
  const ucUpd = await tx.execute(sql`
    UPDATE user_collections uc SET card_id = p.survivor_id
    FROM sm92_pairs p WHERE uc.card_id = p.doomed_id`);
  repointedRefs["user_collections"] =
    (repointedRefs["user_collections"] ?? 0) + (ucUpd.rowCount ?? 0);

  const wlDel = await tx.execute(sql`
    DELETE FROM user_wishlists w USING sm92_pairs p
    WHERE w.card_id = p.doomed_id
      AND EXISTS (SELECT 1 FROM user_wishlists w2
                  WHERE w2.user_id = w.user_id AND w2.card_id = p.survivor_id)`);
  repointedRefs["user_wishlists (dup dropped)"] =
    (repointedRefs["user_wishlists (dup dropped)"] ?? 0) + (wlDel.rowCount ?? 0);
  const wlUpd = await tx.execute(sql`
    UPDATE user_wishlists w SET card_id = p.survivor_id
    FROM sm92_pairs p WHERE w.card_id = p.doomed_id`);
  repointedRefs["user_wishlists"] =
    (repointedRefs["user_wishlists"] ?? 0) + (wlUpd.rowCount ?? 0);

  const pbUpd = await tx.execute(sql`
    UPDATE pc_binder_cards b SET card_id = p.survivor_id
    FROM sm92_pairs p WHERE b.card_id = p.doomed_id`);
  repointedRefs["pc_binder_cards"] =
    (repointedRefs["pc_binder_cards"] ?? 0) + (pbUpd.rowCount ?? 0);

  const piUpd = await tx.execute(sql`
    UPDATE pending_card_images i SET card_id = p.survivor_id
    FROM sm92_pairs p WHERE i.card_id = p.doomed_id`);
  repointedRefs["pending_card_images"] =
    (repointedRefs["pending_card_images"] ?? 0) + (piUpd.rowCount ?? 0);

  // Price cache rows for doomed cards are just dropped (regenerated nightly).
  const pcDel = await tx.execute(sql`
    DELETE FROM card_price_cache c USING sm92_pairs p WHERE c.card_id = p.doomed_id`);
  repointedRefs["card_price_cache (dropped)"] =
    (repointedRefs["card_price_cache (dropped)"] ?? 0) + (pcDel.rowCount ?? 0);

  for (const { table, column } of [
    { table: "scan_uploads", column: "top_match_card_id" },
    { table: "scan_feedback", column: "selected_card_id" },
  ]) {
    const upd = await tx.execute(sql`
      UPDATE ${sql.raw(table)} r SET ${sql.raw(column)} = p.survivor_id
      FROM sm92_pairs p WHERE r.${sql.raw(column)} = p.doomed_id`);
    repointedRefs[table] = (repointedRefs[table] ?? 0) + (upd.rowCount ?? 0);
  }

  // Migration-console history rows tied to doomed cards.
  const mlcDel = await tx.execute(sql`
    DELETE FROM migration_log_cards r USING sm92_pairs p WHERE r.card_id = p.doomed_id`);
  repointedRefs["migration_log_cards (dropped)"] =
    (repointedRefs["migration_log_cards (dropped)"] ?? 0) + (mlcDel.rowCount ?? 0);

  // Marketplace listings referencing doomed cards (feature is dormant, but be safe).
  const ordersRes = await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN sm92_pairs p ON p.doomed_id = l.card_id`);
  if (((ordersRes.rows[0] as any)?.n ?? 0) > 0) {
    throw new Error("orders exist for listings on doomed cards — aborting for manual review");
  }
  const lUpd = await tx.execute(sql`
    UPDATE listings l SET card_id = p.survivor_id
    FROM sm92_pairs p WHERE l.card_id = p.doomed_id`);
  repointedRefs["listings"] = (repointedRefs["listings"] ?? 0) + (lUpd.rowCount ?? 0);

  const cardDel = await tx.execute(sql`
    DELETE FROM cards c USING sm92_pairs p WHERE c.id = p.doomed_id`);
  return cardDel.rowCount ?? 0;
}

export async function runSpiderman1992Reorg(): Promise<Spiderman1992ReorgResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('spiderman-1992-reorg'))`);

    const noop: Spiderman1992ReorgResult = {
      ran: false, mergedDupePrismSubsetCards: 0, movedBaseCards: 0,
      mergedMcfPrisms: 0, movedAnnivPrisms: 0, seededAnnivBase: 0, repointedRefs: {},
    };

    // Resolve the four subsets by main-set slug + subset shape.
    const setsRes = await tx.execute(sql`
      SELECT cs.id, ms.slug AS main_slug, cs.slug
      FROM card_sets cs JOIN main_sets ms ON ms.id = cs.main_set_id
      WHERE ms.slug IN (${ANNIV_MAIN_SLUG}, ${MCF_MAIN_SLUG})`);
    const rows = setsRes.rows as any[];
    const pick = (mainSlug: string, prism: boolean) =>
      rows.find(r => r.main_slug === mainSlug && (r.slug.endsWith("-prisms") === prism))?.id;
    const annivBaseId = pick(ANNIV_MAIN_SLUG, false);
    const annivPrismId = pick(ANNIV_MAIN_SLUG, true);
    const mcfBaseId = pick(MCF_MAIN_SLUG, false);
    const mcfPrismId = pick(MCF_MAIN_SLUG, true);
    if (!annivBaseId || !annivPrismId || !mcfBaseId || !mcfPrismId) {
      return { ...noop, reason: "one or more subsets not found — aborted" };
    }

    // Idempotency guard: only run if the McFarlane base subset is still empty
    // AND the 30thA base subset still holds the mis-filed cards.
    const guard = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM cards WHERE set_id = ${mcfBaseId}) AS mcf_base_n,
        (SELECT COUNT(*)::int FROM cards WHERE set_id = ${annivBaseId}
          AND card_number ~ '^[0-9]+$' AND name = 'The Beginning') AS misfiled_marker`);
    const g = guard.rows[0] as any;
    if ((g?.mcf_base_n ?? 1) > 0) return { ...noop, reason: "McFarlane base already populated — already ran" };
    if ((g?.misfiled_marker ?? 0) === 0) return { ...noop, reason: "mis-filed McFarlane cards not found in 30thA base — aborted" };

    const repointedRefs: Record<string, number> = {};

    // ── 1. Merge the duplicate 30thA "Prisms" subset (102 identical cards)
    //       into the 30thA base subset twins, matched by card_number.
    await tx.execute(sql`
      CREATE TEMP TABLE sm92_pairs ON COMMIT DROP AS
      SELECT d.id AS doomed_id, s.id AS survivor_id
      FROM cards d JOIN cards s ON s.card_number = d.card_number
      WHERE d.set_id = ${annivPrismId} AND s.set_id = ${annivBaseId}`);
    // Any prism-subset card without a twin would be orphaned — abort if so.
    const orphanRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM cards d
      WHERE d.set_id = ${annivPrismId}
        AND NOT EXISTS (SELECT 1 FROM sm92_pairs p WHERE p.doomed_id = d.id)`);
    if (((orphanRes.rows[0] as any)?.n ?? 0) > 0) {
      throw new Error("30thA Prisms subset has cards without a base-subset twin — aborting");
    }
    const merged1 = await mergeDoomedIntoSurvivors(tx, repointedRefs);
    await tx.execute(sql`DROP TABLE sm92_pairs`);

    // ── 2. Move the 90 McFarlane base cards (numeric card numbers) into the
    //       empty McFarlane base subset. Card ids unchanged → refs follow.
    const movedBase = await tx.execute(sql`
      UPDATE cards SET set_id = ${mcfBaseId}, is_insert = false
      WHERE set_id = ${annivBaseId} AND card_number ~ '^[0-9]+$'`);

    // ── 3. Merge the 30thA base subset's P-1..P-6 into the McFarlane Prisms
    //       subset's existing P-1..P-6.
    await tx.execute(sql`
      CREATE TEMP TABLE sm92_pairs ON COMMIT DROP AS
      SELECT d.id AS doomed_id, s.id AS survivor_id
      FROM cards d JOIN cards s ON s.card_number = d.card_number
      WHERE d.set_id = ${annivBaseId} AND d.card_number LIKE 'P-%'
        AND s.set_id = ${mcfPrismId}`);
    const merged3 = await mergeDoomedIntoSurvivors(tx, repointedRefs);
    await tx.execute(sql`DROP TABLE sm92_pairs`);

    // ── 4. Move the real 30thA prisms (P7..P12) into the 30thA Prisms subset.
    const movedPrisms = await tx.execute(sql`
      UPDATE cards SET set_id = ${annivPrismId}, is_insert = true
      WHERE set_id = ${annivBaseId} AND card_number ~ '^P[0-9]+$'`);

    // Safety: the 30thA base subset must now be empty before seeding.
    const leftover = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM cards WHERE set_id = ${annivBaseId}`);
    if (((leftover.rows[0] as any)?.n ?? 1) > 0) {
      throw new Error("30thA base subset not empty after moves — aborting");
    }

    // ── 5. Seed the real 30th Anniversary base checklist (1-90).
    let seeded = 0;
    for (const [num, name] of ANNIV_BASE) {
      await tx.execute(sql`
        INSERT INTO cards (set_id, card_number, name, is_insert, rarity)
        VALUES (${annivBaseId}, ${num}, ${name}, false, 'Common')`);
      seeded++;
    }

    // ── 6. Reconcile denormalized counts.
    for (const id of [annivBaseId, annivPrismId, mcfBaseId, mcfPrismId]) {
      await tx.execute(sql`
        UPDATE card_sets SET total_cards = (SELECT COUNT(*)::int FROM cards WHERE set_id = ${id})
        WHERE id = ${id}`);
    }

    return {
      ran: true,
      mergedDupePrismSubsetCards: merged1,
      movedBaseCards: movedBase.rowCount ?? 0,
      mergedMcfPrisms: merged3,
      movedAnnivPrisms: movedPrisms.rowCount ?? 0,
      seededAnnivBase: seeded,
      repointedRefs,
    };
  });
}
