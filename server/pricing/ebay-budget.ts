import { AsyncLocalStorage } from "node:async_hooks";
import { pool } from "../db";
import type { Pool } from "pg";
import { ebayOAuthService } from "../ebay-oauth";

export async function browseAllowance() {
  const token = await ebayOAuthService.getAccessToken();
  const response = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy",
    {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("Browse quota lookup unavailable");
  const body = await response.json();
  const rate = body.rateLimits?.flatMap((a:any)=>a.resources ?? [])
    .find((r:any)=>r.name==="buy.browse")?.rates?.find((r:any)=>r.timeWindow===86400);
  if (!Number.isSafeInteger(rate?.remaining) || !Number.isFinite(Date.parse(rate?.reset)))
    throw new Error("Browse quota response unsupported");
  return {remaining:rate.remaining,reset:rate.reset};
}

export const ebayRequestContext = new AsyncLocalStorage<{ cardId?: number; runId?: string; limit?: number; stop?: { exhausted: boolean } }>();
const initialized = new WeakMap<Pool, Promise<void>>();
export async function reserveBrowseRequest(target: Pool = pool, quota = browseAllowance) {
  if (!initialized.has(target)) initialized.set(target, (async()=>{
    const db=await target.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(78439,0)");
      await db.query(`CREATE TABLE IF NOT EXISTS ebay_browse_reservations (
        id bigserial PRIMARY KEY, requested_at timestamptz NOT NULL DEFAULT now(),card_id integer,run_id text)`);
      await db.query(`CREATE INDEX IF NOT EXISTS ebay_browse_time ON ebay_browse_reservations(requested_at)`);
      await db.query(`CREATE TABLE IF NOT EXISTS ebay_browse_allowance (
        id integer PRIMARY KEY, remaining integer, baseline bigint, reset_at timestamptz,captured_at timestamptz)`);
      await db.query("COMMIT");
    } catch(e){await db.query("ROLLBACK");throw e;} finally{db.release();}
  })().catch(e=>{initialized.delete(target);throw e;}));
  await initialized.get(target);
  const db = await target.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(78439,0)");
    let allowance=(await db.query("SELECT * FROM ebay_browse_allowance WHERE id=1")).rows[0];
    if (!allowance || new Date(allowance.reset_at).getTime()<=Date.now() ||
        new Date(allowance.captured_at).getTime()<Date.now()-15*60000) {
      const live=await quota(); // Fail closed if account-wide usage cannot be checked.
      const recent=(await db.query(`SELECT coalesce(max(id),0) AS baseline,
        count(*) FILTER(WHERE requested_at>now()-interval '5 minutes')::int AS pending
        FROM ebay_browse_reservations`)).rows[0];
      allowance={remaining:Math.max(0,live.remaining-recent.pending),baseline:recent.baseline};
      await db.query(`INSERT INTO ebay_browse_allowance VALUES(1,$1,$2,$3,now())
        ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining,baseline=excluded.baseline,
        reset_at=excluded.reset_at,captured_at=now()`,[allowance.remaining,allowance.baseline,live.reset]);
    }
    const spent=(await db.query("SELECT count(*)::int AS n FROM ebay_browse_reservations WHERE id>$1",[allowance.baseline])).rows[0].n;
    const ctx = ebayRequestContext.getStore();
    const daily = Number(process.env.EBAY_BROWSE_DAILY_BUDGET ?? 4000);
    if (!Number.isSafeInteger(daily) || daily < 1) throw new Error("Invalid Browse budget");
    const row = (await db.query(`SELECT
      count(*) FILTER(WHERE requested_at>now()-interval '24 hours')::int AS daily,
      count(*) FILTER(WHERE run_id=$1)::int AS run
      FROM ebay_browse_reservations`,[ctx?.runId ?? null])).rows[0];
    const reserve=Number(process.env.EBAY_BROWSE_SAFETY_RESERVE ?? 1000);
    if(!Number.isSafeInteger(reserve)||reserve<0) throw new Error("Invalid Browse safety reserve");
    if (row.daily>=daily || allowance.remaining-spent<=reserve || (ctx?.limit != null && row.run>=ctx.limit)) {
      if (ctx?.stop) ctx.stop.exhausted = true;
      throw new Error("Browse request budget exhausted");
    }
    await db.query("INSERT INTO ebay_browse_reservations(card_id,run_id) VALUES($1,$2)",
      [ctx?.cardId ?? null,ctx?.runId ?? null]);
    await db.query("COMMIT");
  } catch(e) {await db.query("ROLLBACK");throw e;}
  finally {db.release();}
}
