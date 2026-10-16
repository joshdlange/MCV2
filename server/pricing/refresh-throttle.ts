import { createHash } from "node:crypto";
import { pool } from "../db";

/** Shared fixed-window abuse guard, separate from subscription entitlements. */
export async function allowPriceRefresh(userId:number,ip:string) {
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(78440,0)");
    await db.query(`CREATE TABLE IF NOT EXISTS market_refresh_throttle (
      key text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),hits integer NOT NULL)`);
    const keys=[`user:${userId}`,`ip:${createHash("sha256").update(ip).digest("hex")}`];
    let allowed=true;
    for(const [i,key] of keys.entries()) {
      const row=(await db.query(`INSERT INTO market_refresh_throttle(key,hits) VALUES($1,1)
        ON CONFLICT(key) DO UPDATE SET
        hits=CASE WHEN market_refresh_throttle.started_at<now()-interval '1 minute' THEN 1 ELSE market_refresh_throttle.hits+1 END,
        started_at=CASE WHEN market_refresh_throttle.started_at<now()-interval '1 minute' THEN now() ELSE market_refresh_throttle.started_at END
        RETURNING hits`,[key])).rows[0];
      if(row.hits>(i===0?30:120)) allowed=false;
    }
    await db.query("DELETE FROM market_refresh_throttle WHERE started_at<now()-interval '1 day'");
    await db.query("COMMIT");
    return allowed;
  } catch(e){await db.query("ROLLBACK");throw e;} finally{db.release();}
}
