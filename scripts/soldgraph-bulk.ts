/**
 * Server-shell operator command only; no public/admin HTTP endpoint.
 * Default is dry-run. Execution requires BOTH --execute and --confirm-search-spend.
 */
import pg from "pg";
import { SoldgraphBulk } from "../server/pricing/soldgraph-bulk";

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--execute","--confirm-search-spend","--dry-run","--max-cards","--reserve","--resume"]);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error("Invalid option");
    if (["--max-cards","--reserve","--resume"].includes(args[i])) {
      if (!args[++i] || args[i].startsWith("--")) throw new Error("Missing option value");
    }
  }
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name)+1] : undefined;
  const execute = args.includes("--execute");
  if (execute && (!args.includes("--confirm-search-spend") || args.includes("--dry-run"))) throw new Error("Explicit spend confirmation required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  try {
    await new SoldgraphBulk(pool).run({ execute,
      maxCards: Number(option("--max-cards") ?? 100), reserve: Number(option("--reserve") ?? 100),
      resume: option("--resume") }, value => console.log(JSON.stringify(value)));
  } finally { await pool.end(); }
}
main().catch(() => {
  // Do not print arbitrary upstream/database errors, which could contain credentials.
  console.error("Bulk refresh stopped. Verify options, database access, usage response, and operator-job status.");
  process.exitCode = 1;
});
