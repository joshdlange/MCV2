import type { Pool } from "pg";
import { SoldgraphClient, SoldgraphError } from "./soldgraph-client";
import { analyzeSoldRows, buildSoldQueries } from "./soldgraph-matching";

export const soldgraphEnabled = () => process.env.PRICING_PROVIDER === "soldgraph";
export function publicPrice(result: any, refreshedAt: Date | null, expiresAt: Date | null) {
  const count = result?.usableCount ?? 0;
  return {
    provider: "soldgraph", avgPrice: result?.median ?? null, salesCount: count,
    source: count >= 3 ? "SOLDGRAPH_SOLD_COMPS" : count ? "SOLDGRAPH_LIMITED_DATA" : "SOLDGRAPH_NO_COMPS",
    matchedCount: result?.acceptedCount ?? 0, bestOfferCount: result?.bestOfferCount ?? 0,
    confidence: count >= 3 ? "normal" : count ? "limited" : "unavailable",
    low: result?.low ?? null, high: result?.high ?? null,
    earliestSoldDate: result?.earliestSoldDate ?? null, latestSoldDate: result?.latestSoldDate ?? null,
    lastFetched: refreshedAt, expiresAt, stale: !expiresAt || new Date(expiresAt).getTime() <= Date.now(),
  };
}

export function migrationPrice(sold: ReturnType<typeof publicPrice>, legacy: any) {
  const days = Number(process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS ?? 14);
  if (!Number.isFinite(days) || days < 1) throw new Error("Invalid SoldGraph display age");
  const preferred = !!sold.lastFetched && Date.now()-new Date(sold.lastFetched).getTime() <= days*86400000;
  if (preferred && sold.avgPrice != null && sold.avgPrice > 0 && sold.salesCount > 0) return sold;
  const price = Number(legacy?.avg_price);
  if (Number.isFinite(price) && price > 0) return {
    ...sold, provider: "legacy", source: "LEGACY_ACTIVE_ESTIMATE",
    soldgraphSource: "SOLDGRAPH_NO_COMPS", soldgraphAttempted: !!sold.lastFetched,
    avgPrice: price, salesCount: legacy.sales_count ?? 0, confidence: "estimate",
    lastFetched: legacy.last_fetched, low: null, high: null,
    earliestSoldDate: null, latestSoldDate: null,
  };
  return { ...sold, avgPrice: null, salesCount: 0, confidence: "unavailable",
    source: "SOLDGRAPH_NO_COMPS", historicalSource: sold.source };
}

/** Separate shared cache. Old cache and scheduled active-pricing jobs are untouched. */
export class SoldgraphCache {
  private ready?: Promise<void>;
  constructor(private pool: Pool, private client = new SoldgraphClient()) {}
  async init() {
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
        await db.query(`CREATE TABLE IF NOT EXISTS market_refresh_usage (
          user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          consumed integer NOT NULL DEFAULT 0 CHECK(consumed>=0))`);
        await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_price_demand (
          card_id integer PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          requested_at timestamptz NOT NULL DEFAULT now())`);
        await db.query(`CREATE TABLE IF NOT EXISTS soldgraph_quota_snapshot (
          id integer PRIMARY KEY CHECK(id=1), remaining integer NOT NULL,
          reserve integer NOT NULL, baseline bigint NOT NULL, captured_at timestamptz NOT NULL DEFAULT now())`);
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; }
      finally { db.release(); }
    })().catch(e => { this.ready = undefined; throw e; });
  }
  async read(cardId: number, connection: Pick<Pool,"query"> = this.pool) {
    await this.init();
    const { rows } = await connection.query("SELECT * FROM soldgraph_price_cache WHERE card_id=$1", [cardId]);
    const row = rows[0];
    const sold = publicPrice(row?.result, row?.refreshed_at ?? null, row?.expires_at ?? null);
    const legacy = await connection.query(`SELECT avg_price,sales_count,last_fetched FROM card_price_cache
      WHERE card_id=$1 ORDER BY last_fetched DESC,id DESC LIMIT 1`, [cardId]);
    return migrationPrice(sold, legacy.rows[0]);
  }
  async recordDemand(cardId: number) {
    await this.init();
    await this.pool.query(`INSERT INTO soldgraph_price_demand(card_id)
      SELECT id FROM cards WHERE id=$1 ON CONFLICT(card_id) DO UPDATE SET requested_at=now()`, [cardId]);
  }
  /** Shared by Check Value and targeted diagnostics. Never discards either cache. */
  async refreshWithFallback(cardId: number, userId?: number) {
    try {
      return await this.refresh(cardId, userId);
    } catch {
      return { ...await this.read(cardId), refreshStatus: "unavailable",
        message: "Refresh unavailable; best eligible cached price retained." };
    }
  }
  async refresh(cardId: number, userId?: number) {
    await this.init();
    const db = await this.pool.connect();
    let locked = false;
    let chargedUser: number | undefined;
    try {
      locked = (await db.query("SELECT pg_try_advisory_lock(78436,$1) AS locked", [cardId])).rows[0].locked;
      if (!locked) return { ...await this.read(cardId,db), refreshing: true };
      const cached = (await db.query("SELECT * FROM soldgraph_price_cache WHERE card_id=$1", [cardId])).rows[0];
      if (cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now()) return await this.read(cardId,db);
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
        let quota = (await db.query(`SELECT q.*,
          (SELECT count(*)::int FROM soldgraph_request_budget WHERE id>q.baseline) AS spent
          FROM soldgraph_quota_snapshot q WHERE id=1`)).rows[0];
        if (!quota || new Date(quota.captured_at).getTime() < Date.now() - 5 * 60_000) {
          // Account-wide quota is required, not just this database's local budget.
          // Capture the baseline before the lookup and conservatively retain recent
          // reservations that the upstream usage endpoint may not yet include.
          const recent = (await db.query(`SELECT coalesce(max(id),0) AS baseline,
            count(*) FILTER(WHERE requested_at>now()-interval '5 minutes')::int AS pending
            FROM soldgraph_request_budget`)).rows[0];
          const live: any = await this.client.usage();
          const reserve = Number(process.env.SOLDGRAPH_SAFETY_RESERVE ?? quota?.reserve ?? 100);
          if (!live || !["one_time", "rolling_30_days"].includes(live.window) ||
              ![live.remaining, live.limit, live.used].every(n => Number.isSafeInteger(n) && n >= 0) ||
              !Number.isSafeInteger(reserve) || reserve < 0) {
            throw new Error("Pricing account quota unavailable");
          }
          quota = { remaining: Math.max(0, live.remaining - recent.pending), reserve, spent: 0 };
          await db.query(`INSERT INTO soldgraph_quota_snapshot(id,remaining,reserve,baseline,captured_at)
            VALUES(1,$1,$2,$3,now()) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining,
            reserve=excluded.reserve,baseline=excluded.baseline,captured_at=now()`,
            [quota.remaining, reserve, recent.baseline]);
        }
        if (quota && quota.remaining - quota.spent <= quota.reserve) throw new Error("SoldGraph safety reserve reached");
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
        if (userId != null) {
          const user = (await db.query("SELECT plan,is_admin FROM users WHERE id=$1 FOR UPDATE",[userId])).rows[0];
          if (!user) throw new Error("Account unavailable");
          if (user.plan !== "SUPER_HERO" && !user.is_admin) {
            await db.query("INSERT INTO market_refresh_usage(user_id) VALUES($1) ON CONFLICT DO NOTHING",[userId]);
            const reserved = await db.query(`UPDATE market_refresh_usage SET consumed=consumed+1
              WHERE user_id=$1 AND consumed<20 RETURNING user_id`,[userId]);
            if (!reserved.rowCount) {
              await db.query("ROLLBACK");
              return {...await this.read(cardId,db),upgradeRequired:true};
            }
            chargedUser=userId;
          }
        }
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
      } catch (error) {
        // Definite pre-credit rejection/failed job: refund. Ambiguous transport outcomes
        // retain the reservation conservatively because a provider job may still run.
        if (chargedUser != null && error instanceof SoldgraphError &&
            ["invalid_key","missing_key","invalid_query","quota_or_rate_limit","job_failed","http_400","http_422"].includes(error.code)) {
          await db.query("UPDATE market_refresh_usage SET consumed=greatest(0,consumed-1) WHERE user_id=$1",[chargedUser]);
        }
        await db.query("UPDATE soldgraph_price_cache SET last_error='provider_failure' WHERE card_id=$1", [cardId]);
        throw new Error("Sold pricing provider unavailable; cached value preserved");
      }
      return await this.read(cardId,db);
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
