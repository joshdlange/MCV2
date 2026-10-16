import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { SoldgraphClient } from "./soldgraph-client";
import { SoldgraphCache } from "./soldgraph-cache";

export function parseUsage(value: any) {
  if (!value || typeof value.plan !== "string" ||
      !["one_time", "rolling_30_days"].includes(value.window) ||
      ![value.limit, value.used, value.remaining].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw new Error("Unsupported SoldGraph usage response; refusing to spend");
  }
  return { plan: value.plan, limit: value.limit, used: value.used, remaining: value.remaining, window: value.window };
}
export function safeSearchCount(remaining: number, reserve: number, maxCards: number, eligible: number, localRoom: number) {
  return Math.max(0, Math.min(remaining - reserve, maxCards, eligible, localRoom));
}
export class SoldgraphBulk {
  constructor(private pool: Pool, private cache = new SoldgraphCache(pool),
    private provider = new SoldgraphClient()) {}

  private async init() {
    await this.cache.init();
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(78435,0)");
      await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_bulk_jobs (
        id uuid PRIMARY KEY, reserve integer NOT NULL, max_cards integer NOT NULL,
        status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now())`);
      await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_bulk_items (
        job_id uuid NOT NULL REFERENCES soldgraph_bulk_jobs(id), card_id integer NOT NULL,
        position integer NOT NULL, status text NOT NULL DEFAULT 'pending',
        PRIMARY KEY(job_id,card_id))`);
      await db.query("COMMIT");
    } catch (e) { await db.query("ROLLBACK"); throw e; }
    finally { db.release(); }
  }
  async candidates(maxCards: number) {
    await this.init();
    return (await this.pool.query(`WITH owned AS (
        SELECT DISTINCT card_id FROM user_collections WHERE quantity>0
      ), binders AS (SELECT DISTINCT card_id FROM pc_binder_cards),
      legacy AS (SELECT card_id,min(last_fetched) AS last_fetched FROM card_price_cache GROUP BY card_id),
      eligible AS (
        SELECT c.id, CASE WHEN d.card_id IS NOT NULL THEN 1 WHEN o.card_id IS NOT NULL THEN 2
          WHEN b.card_id IS NOT NULL THEN 4 WHEN l.card_id IS NOT NULL THEN 5
          WHEN c.created_at>now()-interval '7 days' THEN 6 ELSE 7 END AS priority,
          d.requested_at,l.last_fetched,c.created_at
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
        LEFT JOIN soldgraph_price_cache p ON p.card_id=c.id
        LEFT JOIN soldgraph_price_demand d ON d.card_id=c.id
        LEFT JOIN owned o ON o.card_id=c.id LEFT JOIN binders b ON b.card_id=c.id
        LEFT JOIN legacy l ON l.card_id=c.id
        WHERE c.archived_at IS NULL AND trim(c.name)<>'' AND trim(c.card_number)<>''
          AND trim(m.name)<>'' AND s.year IS NOT NULL
          AND (p.expires_at IS NULL OR p.expires_at<=now())
          AND (p.retry_after IS NULL OR p.retry_after<=now())
      ) SELECT *,count(*) OVER()::int AS eligible_count FROM eligible
      ORDER BY priority,requested_at DESC NULLS LAST,last_fetched ASC NULLS LAST,created_at DESC,id
      LIMIT $1`, [maxCards])).rows;
  }
  async localRoom() {
    const row = (await this.pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE requested_at>now()-interval '24 hours')::int AS daily
      FROM soldgraph_request_budget WHERE requested_at>now()-interval '30 days'`)).rows[0];
    const daily = Number(process.env.SOLDGRAPH_DAILY_BUDGET ?? 20);
    const monthly = Number(process.env.SOLDGRAPH_30_DAY_BUDGET ?? 80);
    if (![daily,monthly].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("Invalid local budget");
    return Math.max(0, Math.min(daily-row.daily, monthly-row.total));
  }
  /** Operator-only library: not registered as an HTTP route or imported by application startup. */
  async run(options: { execute?: boolean; maxCards?: number; reserve?: number; resume?: string },
    report: (value: object) => void = console.log) {
    const maxCards = options.maxCards ?? 100, reserve = options.reserve ?? 100;
    if (!Number.isSafeInteger(maxCards) || maxCards < 1 || maxCards > 500 ||
        !Number.isSafeInteger(reserve) || reserve < 0) throw new Error("Invalid max cards (1–500) or reserve");
    if (options.resume && !/^[0-9a-f-]{36}$/i.test(options.resume)) throw new Error("Invalid job ID");
    await this.init();
    const lock = await this.pool.connect();
    let locked = false;
    try {
      locked = (await lock.query("SELECT pg_try_advisory_lock(78438,0) AS locked")).rows[0].locked;
      if (!locked) throw new Error("Another bulk operator job is running");
      // Baseline BEFORE usage is deliberately conservative for in-flight app refreshes.
      const baseline = (await lock.query("SELECT coalesce(max(id),0) AS id FROM soldgraph_request_budget")).rows[0].id;
      const usage = parseUsage(await this.provider.usage()); // exactly once at invocation start
      let candidates = await this.candidates(maxCards);
      let job: any;
      if (options.resume) {
        job = (await lock.query("SELECT * FROM soldgraph_bulk_jobs WHERE id=$1", [options.resume])).rows[0];
        if (!job) throw new Error("Unknown bulk job");
        candidates = (await lock.query(`SELECT card_id AS id,count(*) OVER()::int AS eligible_count
          FROM soldgraph_bulk_items WHERE job_id=$1 AND status='pending' ORDER BY position`, [job.id])).rows;
      }
      const effectiveReserve = job?.reserve ?? reserve;
      const room = await this.localRoom();
      const planned = safeSearchCount(usage.remaining, effectiveReserve, maxCards,
        candidates.length, room);
      const summary = { dryRun: !options.execute, usage, reserve: effectiveReserve,
        eligibleCards: candidates[0]?.eligible_count ?? 0, maxCards,
        estimatedSearches: planned, localBudgetRoom: room, usageCalls: 1,
        prioritySampleCounts: candidates.reduce((a: any, c: any) => {
          a[c.priority ?? "resume"] = (a[c.priority ?? "resume"] ?? 0) + 1; return a;
        }, {}) };
      report(summary); // Always show estimated cost BEFORE any search.
      if (!options.execute) return summary;
      // Shared quota guard is also checked by ordinary app refreshes under the budget lock.
      await lock.query("BEGIN");
      try {
        await lock.query("SELECT pg_advisory_xact_lock(78437,0)");
        await lock.query(`INSERT INTO soldgraph_quota_snapshot(id,remaining,reserve,baseline)
          VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining,
          reserve=excluded.reserve,baseline=excluded.baseline,captured_at=now()`,
        [usage.remaining,effectiveReserve,baseline]);
        await lock.query("COMMIT");
      } catch (e) { await lock.query("ROLLBACK"); throw e; }
      if (!job) {
        job = { id: randomUUID() };
        await lock.query("BEGIN");
        try {
          await lock.query("INSERT INTO soldgraph_bulk_jobs(id,reserve,max_cards) VALUES($1,$2,$3)",
            [job.id,effectiveReserve,maxCards]);
          for (const [i,c] of candidates.entries()) {
            await lock.query("INSERT INTO soldgraph_bulk_items(job_id,card_id,position) VALUES($1,$2,$3)",
              [job.id,c.id,i]);
          }
          await lock.query("COMMIT");
        } catch (e) { await lock.query("ROLLBACK"); throw e; }
      }
      // An interrupted in-flight request may have been billed. Never automatically reissue it.
      await lock.query("UPDATE soldgraph_bulk_items SET status='uncertain' WHERE job_id=$1 AND status='running'", [job.id]);
      await lock.query("UPDATE soldgraph_bulk_jobs SET status='running' WHERE id=$1", [job.id]);
      report({ jobId: job.id, estimatedSearches: planned });
      let processed = 0;
      for (const c of candidates.slice(0, planned)) {
        await lock.query("UPDATE soldgraph_bulk_items SET status='running' WHERE job_id=$1 AND card_id=$2", [job.id,c.id]);
        try {
          const price = await this.cache.refresh(c.id);
          const status = "refreshing" in price && price.refreshing ? "pending" : "done";
          await lock.query("UPDATE soldgraph_bulk_items SET status=$3 WHERE job_id=$1 AND card_id=$2", [job.id,c.id,status]);
          processed++;
        } catch (e) {
          const quotaStop = e instanceof Error && /budget reached|safety reserve|temporarily unavailable/.test(e.message);
          await lock.query("UPDATE soldgraph_bulk_items SET status=$3 WHERE job_id=$1 AND card_id=$2",
            [job.id,c.id,quotaStop ? "pending" : "failed"]);
          break; // fail closed: don't burn the rest of the allowance on provider failures
        }
        await new Promise(resolve => setTimeout(resolve, 1500)); // modest operator rate, no cron
      }
      const counts = (await lock.query(`SELECT status,count(*)::int AS count FROM soldgraph_bulk_items
        WHERE job_id=$1 GROUP BY status`, [job.id])).rows;
      const incomplete = counts.some(c => c.status !== "done");
      await lock.query("UPDATE soldgraph_bulk_jobs SET status=$2 WHERE id=$1", [job.id,incomplete ? "paused" : "complete"]);
      const result = { ...summary, jobId: job.id, processed, counts };
      report(result);
      return result;
    } finally {
      try {
        if (locked) await lock.query("SELECT pg_advisory_unlock(78438,0)");
        lock.release();
      } catch (e) { lock.release(true); throw e; }
    }
  }
}
