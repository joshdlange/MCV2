/**
 * Development-only operator entry point. Not imported by the application.
 * NODE_ENV=development npx tsx scripts/soldgraph-pilot.ts <card-id> [--fallbacks]
 * NODE_ENV=development npx tsx scripts/soldgraph-pilot.ts --usage
 */
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { SoldgraphClient, SoldgraphError } from "../server/pricing/soldgraph-client";
import { assertDevelopment, SoldgraphPilot } from "../server/pricing/soldgraph-dev";

async function main() {
  assertDevelopment();
  if (process.argv.includes("--usage")) {
    console.log(JSON.stringify(await new SoldgraphClient().usage(), null, 2));
    return;
  }
  const ids = process.argv.slice(2).filter(a => !a.startsWith("--")).map(Number);
  if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || ids.length > 6) throw new Error("Supply 1–6 valid card IDs");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pilot = new SoldgraphPilot();
  try {
    for (const id of ids) {
      const { rows } = await pool.query(`
        SELECT c.id,c.name,c.card_number AS "cardNumber",s.year,m.name AS parent,
          s.name AS subset,c.variation,
          ARRAY(SELECT DISTINCT s2.name FROM cards c2 JOIN card_sets s2 ON s2.id=c2.set_id
            WHERE s2.main_set_id=s.main_set_id AND c2.card_number=c.card_number
            AND c2.name=c.name AND c2.id<>c.id AND c2.archived_at IS NULL) AS siblings
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
        WHERE c.id=$1 AND c.archived_at IS NULL`, [id]);
      if (!rows[0]) throw new Error(`Card ${id} not found`);
      const report = await pilot.evaluate(rows[0], process.argv.includes("--fallbacks") ? 3 : 1);
      await mkdir(".local/soldgraph-qa", { recursive: true });
      await writeFile(`.local/soldgraph-qa/${id}.json`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    }
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error(error instanceof SoldgraphError ? error.message : "Soldgraph pilot failed; check local configuration, card metadata, and cache permissions.");
  process.exitCode = 1;
});
