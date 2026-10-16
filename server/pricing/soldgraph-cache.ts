import type { Pool } from "pg";
import { SoldgraphClient } from "./soldgraph-client";
import { analyzeSoldRows, buildSoldQueries } from "./soldgraph-matching";

export const soldgraphEnabled = () => process.env.PRICING_PROVIDER === "soldgraph";
export function publicPrice(result: any, refreshedAt: Date | null, expiresAt: Date | null) {
  const count = result?.usableCount ?? 0;
  return {
    provider: "soldgraph", avgPrice: result?.median ?? null, salesCount: count,
    matchedCount: result?.acceptedCount ?? 0, bestOfferCount: result?.bestOfferCount ?? 0,
    confidence: count >= 3 ? "normal" : count ? "limited" : "unavailable",
    low: result?.low ?? null, high: result?.high ?? null,
    earliestSoldDate: result?.earliestSoldDate ?? null, latestSoldDate: result?.latestSoldDate ?? null,
    lastFetched: refreshedAt, expiresAt, stale: !expiresAt || new Date(expiresAt).getTime() <= Date.now(),
  };
}

/** Separate shared cache. Old cache and scheduled active-pricing jobs are untouched. */
export class SoldgraphCache {
  private ready?: Promise<void>;
  constructor(private pool: Pool, private client = new SoldgraphClient()) {}
  private init() {
    return this.ready ??= (async () => {
      const db = await this.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(78435,0)");
        await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_price_cache (
          card_id integer PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          provider text NOT NULL DEFAULT 'soldgraph', query text NOT NULL,
          result jsonb, refreshed_at timestamptz, expires_at timestamptz,
          retry_after timestamptz, last_error text)`);
        await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_request_budget (
          id bigserial PRIMARY KEY, card_id integer NOT NULL, requested_at timestamptz NOT NULL DEFAULT now())`);
        await db.query("CREATE INDEX IF NOT EXISTS soldgraph_budget_time ON soldgraph_request_budget(requested_at)");
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; }
      finally { db.release(); }
    })().catch(e => { this.ready = undefined; throw e; });
  }
  async read(cardId: number) {
    await this.init();
    const { rows } = await this.pool.query("SELECT * FROM soldgraph_price_cache WHERE card_id=$1", [cardId]);
    const row = rows[0];
    return publicPrice(row?.result, row?.refreshed_at ?? null, row?.expires_at ?? null);
  }
  async refresh(cardId: number) {
    await this.init();
    const db = await this.pool.connect();
    let locked = false;
    try {
      locked = (await db.query("SELECT pg_try_advisory_lock(78436,$1) AS locked", [cardId])).rows[0].locked;
      if (!locked) return { ...await this.read(cardId), refreshing: true };
      const cached = (await db.query("SELECT * FROM soldgraph_price_cache WHERE card_id=$1", [cardId])).rows[0];
      if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) return await this.read(cardId);
      if (cached?.retry_after && new Date(cached.retry_after).getTime() > Date.now()) throw new Error("Pricing refresh temporarily unavailable; try later");
      const { rows } = await db.query(`SELECT c.id,c.name,c.card_number AS "cardNumber",s.year,
        m.name AS parent,s.name AS subset,c.variation,
        ARRAY(SELECT DISTINCT s2.name FROM cards c2 JOIN card_sets s2 ON s2.id=c2.set_id
          WHERE s2.main_set_id=s.main_set_id AND c2.name=c.name AND c2.card_number=c.card_number
          AND c2.id<>c.id AND c2.archived_at IS NULL) AS siblings
        FROM cards c JOIN card_sets s ON s.id=c.set_id JOIN main_sets m ON m.id=s.main_set_id
        WHERE c.id=$1 AND c.archived_at IS NULL`, [cardId]);
      if (!rows[0]) throw new Error("Card identity unavailable");
      const card = rows[0], query = buildSoldQueries(card)[0];
      // Reserve credits durably before outbound calls, serializing budget checks across instances.
      // Count failed/ambiguous calls conservatively; no automatic retry that can double-charge.
      await db.query("BEGIN");
      try {
        await db.query("SELECT pg_advisory_xact_lock(78437,0)");
        const usage = (await db.query(`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE requested_at>now()-interval '24 hours')::int AS daily
          FROM soldgraph_request_budget WHERE requested_at>now()-interval '30 days'`)).rows[0];
        const limit = (name: string, fallback: number) => {
          const n = Number(process.env[name] ?? fallback);
          if (!Number.isInteger(n) || n < 1) throw new Error("Invalid pricing budget configuration");
          return n;
        };
        if (usage.total >= limit("SOLDGRAPH_30_DAY_BUDGET", 80) ||
            usage.daily >= limit("SOLDGRAPH_DAILY_BUDGET", 20)) throw new Error("Pricing refresh budget reached");
        await db.query("INSERT INTO soldgraph_request_budget(card_id) VALUES($1)", [cardId]);
        // Crash-safe cooldown also prevents immediate reissues after an ambiguous timeout/restart.
        await db.query(`INSERT INTO soldgraph_price_cache(card_id,query,retry_after)
          VALUES($1,$2,now()+interval '15 minutes') ON CONFLICT(card_id)
          DO UPDATE SET retry_after=excluded.retry_after`, [cardId, query]);
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; }
      try {
        const page = await this.client.search(query);
        const result = analyzeSoldRows(card, page.data);
        await db.query(`UPDATE soldgraph_price_cache SET query=$2,result=$3::jsonb,
          refreshed_at=now(),expires_at=now()+interval '24 hours',retry_after=NULL,last_error=NULL
          WHERE card_id=$1`, [cardId, query, JSON.stringify(result)]);
      } catch {
        await db.query("UPDATE soldgraph_price_cache SET last_error='provider_failure' WHERE card_id=$1", [cardId]);
        throw new Error("Sold pricing provider unavailable; cached value preserved");
      }
      return await this.read(cardId);
    } finally {
      try {
        if (locked) await db.query("SELECT pg_advisory_unlock(78436,$1)", [cardId]);
        db.release();
      } catch (error) {
        db.release(true); // Never return a connection with a possible held session lock.
        throw error;
      }
    }
  }
}
