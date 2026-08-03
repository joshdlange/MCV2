// One-time backfill: run retroactive badge checks for every user.
// Needed because newly wired badge checkers (Insert Hunter, Set Completer,
// Master Collector, Speed Collector, Curator, Historian) only trigger on
// future activity — existing users need one retroactive pass.
// Usage: npx tsx scripts/backfill-badges.ts
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { badgeService } from "../server/badge-service";

async function main() {
  const users = await db.execute(sql`SELECT id FROM users ORDER BY id`);
  let done = 0, failed = 0;
  for (const row of users.rows as any[]) {
    try {
      // Only the newly wired data-derived checkers — NOT the full retroactive
      // suite (which includes time-of-day-sensitive checks like Night Owl).
      const id = Number(row.id);
      await badgeService.checkInsertHunter(id);
      await badgeService.checkSetCompletionBadges(id);
      await badgeService.checkSpeedCollector(id);
      await badgeService.checkCurator(id);
      await badgeService.checkHistorian(id);
      await badgeService.checkBinderBadges(id);
      done++;
    } catch (e: any) {
      failed++;
      console.error(`user ${row.id} failed: ${e.message}`);
    }
    if (done % 100 === 0) console.log(`...${done}/${users.rows.length}`);
  }
  console.log(`Backfill complete: ${done} users processed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
