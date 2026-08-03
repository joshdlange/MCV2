// Idempotent seed: create the two PC Binder badges (safe to run in dev & prod).
// Usage: npx tsx scripts/seed-binder-badges.ts
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const BADGES = [
  {
    name: "Binder Builder",
    description: "Organizer at heart! Created your first Personal Collection binder.",
    iconUrl: "/uploads/badges/binder-builder.png",
    category: "Collection",
    rarity: "silver",
    points: 25,
    requirement: JSON.stringify({ type: "pc_binder_count", value: 1 }),
  },
  {
    name: "Binder Boss",
    description: "Master organizer! Created 5 Personal Collection binders.",
    iconUrl: "/uploads/badges/binder-boss.png",
    category: "Collection",
    rarity: "gold",
    points: 50,
    requirement: JSON.stringify({ type: "pc_binder_count", value: 5 }),
  },
];

async function main() {
  for (const b of BADGES) {
    const existing = await db.execute(sql`SELECT id FROM badges WHERE name = ${b.name}`);
    if (existing.rows.length) {
      console.log(`"${b.name}" already exists (id ${(existing.rows[0] as any).id}) — skipping`);
      continue;
    }
    const r = await db.execute(sql`
      INSERT INTO badges (name, description, icon_url, category, rarity, points, requirement, is_active)
      VALUES (${b.name}, ${b.description}, ${b.iconUrl}, ${b.category}, ${b.rarity}, ${b.points}, ${b.requirement}, true)
      RETURNING id
    `);
    console.log(`Created "${b.name}" (id ${(r.rows[0] as any).id})`);
  }
  process.exit(0);
}
main();
