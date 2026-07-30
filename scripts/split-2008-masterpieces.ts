/**
 * One-time fix: setId 2834 ("2008 UD Marvel Masterpieces Set 2" base) contains
 * TWO interleaved 90-card checklists — the true Set 2 base AND the Set 3 base
 * (verified against tradercracks.com Set 2 checklist and nslists.com Set 3
 * checklist, July 2026). Cards matching the Set 3 checklist move to setId 2842
 * ("Set 3" base subset, currently holding only NNO-numbered sketch entries, so
 * numbers 1-90 are free).
 *
 * Usage: tsx scripts/split-2008-masterpieces.ts [--confirm]
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 337);
const CONFIRM = process.argv.includes("--confirm");
const SET2_BASE = 2834;
const SET3_BASE = 2842;

// 2008 UD Marvel Masterpieces Set 3 base checklist (nslists.com/mrvmas09.htm)
const SET3: Record<number, string> = {
  1: "Ahab", 2: "Annihilus", 3: "Baron Zemo", 4: "Black Tom", 5: "Blastaar",
  6: "The Blob", 7: "Dark Phoenix", 8: "Death-Stalker", 9: "Dormammu & Umar", 10: "Dr. Doom",
  11: "Egghead", 12: "Elektra", 13: "Enchantress", 14: "Fin Fang Foom", 15: "Green Goblin",
  16: "Grey Gargoyle", 17: "Hobgoblin", 18: "Jack O'Lantern", 19: "Juggernaut", 20: "Kang",
  21: "The Kingpin", 22: "Klaw", 23: "Kraven The Hunter", 24: "Magneto", 25: "Master Mold",
  26: "Maximus", 27: "Mephisto", 28: "Mister Hyde", 29: "Mister Sinister", 30: "Nightmare",
  31: "Nimrod", 32: "Onslaught", 33: "Quagmire", 34: "Radioactive Man", 35: "Sabretooth",
  36: "Sentinels", 37: "Skrull", 38: "Spiral", 39: "Super-Skrull", 40: "Terrax The Tamer",
  41: "The Tinkerer", 42: "Titania", 43: "Typhoid Mary", 44: "Venom", 45: "The Wrecking Crew",
  46: "Adamantium Extraction", 47: "Archenemies", 48: "Bloody Battle", 49: "Caught!", 50: "Caught in a Whirlwind",
  51: "Combat for a Kingdom", 52: "Cosmic Chess Game", 53: "Death of Elektra", 54: "Defeated by The Kingpin", 55: "Destroy All Vampires!",
  56: "Fight for Freedom", 57: "For the Power Cosmic", 58: "Invasion of Avengers Mansion", 59: "Life, Liberty, and Justice", 60: "Magneto Strikes",
  61: "The Mandarin Strikes", 62: "Metal on Metal", 63: "Namor Takes His Bride", 64: "Rise of The Sinister Six", 65: "Sound and Fury",
  66: "Spider-Man vs. The Green Goblin", 67: "Stop the War", 68: "To Court Death", 69: "To Rule the Morlocks", 70: "To Save the Earth",
  71: "Ultimate Battle", 72: "Under Ultron's Control",
  73: "Doc Ock Captured", 74: "Doc Ock Mug Shot 1", 75: "Doc Ock Mug Shot 2",
  76: "Electro Captured", 77: "Electro Mug Shot 1", 78: "Electro Mug Shot 2",
  79: "Kraven Captured", 80: "Kraven Mug Shot 1", 81: "Kraven Mug Shot 2",
  82: "Mysterio Captured", 83: "Mysterio Mug Shot 1", 84: "Mysterio Mug Shot 2",
  85: "Sandman Captured", 86: "Sandman Mug Shot 1", 87: "Sandman Mug Shot 2",
  88: "Vulture Captured", 89: "Vulture Mug Shot 1", 90: "Vulture Mug Shot 2",
};

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");

async function main() {
  console.log(`Mode: ${CONFIRM ? "CONFIRM" : "DRY RUN"}`);
  const rows = (await db.execute(sql`
    SELECT id, card_number, name FROM cards
    WHERE set_id = ${SET2_BASE} AND archived_at IS NULL
  `)).rows as Array<{ id: number; card_number: string; name: string }>;

  const byNumber = new Map<number, typeof rows>();
  for (const r of rows) {
    const n = Number(r.card_number);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n)!.push(r);
  }

  const moves: Array<{ cardId: number; targetSetId: number; expectedCurrentSetId: number }> = [];
  const problems: string[] = [];
  for (let n = 1; n <= 90; n++) {
    const cardsAtN = byNumber.get(n) ?? [];
    const s3 = norm(SET3[n]);
    // "Life" was imported truncated from "Life, Liberty, and Justice"
    const matches = cardsAtN.filter((c) => norm(c.name) === s3 || (n === 59 && norm(c.name) === "life"));
    if (cardsAtN.length !== 2) problems.push(`#${n}: expected 2 cards, found ${cardsAtN.length}`);
    else if (matches.length !== 1) problems.push(`#${n}: ${matches.length} cards match Set 3 name "${SET3[n]}" (${cardsAtN.map((c) => c.name).join(" / ")})`);
    else {
      moves.push({ cardId: matches[0].id, targetSetId: SET3_BASE, expectedCurrentSetId: SET2_BASE });
      console.log(`#${n}: "${matches[0].name}" -> Set 3 | stays: "${cardsAtN.find((c) => c.id !== matches[0].id)!.name}"`);
    }
  }

  if (problems.length) {
    console.log("\nPROBLEMS (nothing applied):");
    problems.forEach((p) => console.log("  " + p));
    process.exit(1);
  }
  console.log(`\n${moves.length} cards to move ${SET2_BASE} -> ${SET3_BASE}`);
  if (moves.length !== 90) { console.log("Refusing: expected exactly 90 moves"); process.exit(1); }

  // Deliberate cross-master-set move (Set 2 and Set 3 are separate releases /
  // master sets), so moveParallelCards' guard doesn't apply — done manually
  // with the same protections: advisory lock, collision check, audit log, counts.
  if (!CONFIRM) { console.log("Dry run complete — rerun with --confirm to apply."); process.exit(0); }
  let applied = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('data_quality_parallel_moves'))`);
    // Collision check: numbers 1-90 must be free in target
    const clash = (await tx.execute(sql`
      SELECT card_number FROM cards WHERE set_id = ${SET3_BASE} AND archived_at IS NULL AND card_number ~ '^[0-9]+$' AND card_number::int BETWEEN 1 AND 90
    `)).rows;
    if (clash.length) throw new Error(`Target already has ${clash.length} active cards numbered 1-90 — aborting`);
    for (const m of moves) {
      const upd = await tx.execute(sql`
        UPDATE cards SET set_id = ${SET3_BASE}
        WHERE id = ${m.cardId} AND set_id = ${SET2_BASE} AND archived_at IS NULL
      `);
      if ((upd as any).rowCount !== 1) throw new Error(`Card ${m.cardId} changed during apply — aborting (transaction rolls back)`);
      await tx.execute(sql`
        INSERT INTO admin_audit_logs (admin_user_id, action_type, entity_type, entity_id, entity_name, notes)
        SELECT ${ADMIN_USER_ID}, 'data_quality_parallel_move', 'card', id, name,
          ${JSON.stringify({ old: { setId: SET2_BASE }, new: { setId: SET3_BASE }, reason: "2008 Masterpieces split: Set 3 base checklist cards mis-imported into Set 2 base (verified vs nslists.com/tradercracks.com)" })}
        FROM cards WHERE id = ${m.cardId}
      `);
      applied++;
    }
    for (const sid of [SET2_BASE, SET3_BASE]) {
      await tx.execute(sql`
        UPDATE card_sets SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = ${sid} AND archived_at IS NULL) WHERE id = ${sid}
      `);
    }
  });
  console.log(`Moved: ${applied}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
