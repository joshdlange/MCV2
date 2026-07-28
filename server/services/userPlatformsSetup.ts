// Startup setup (July 2026): user_platforms table.
//
// db:push is unusable in this repo (interactive prompt aborts — see memory),
// so this table is created idempotently at startup, in dev and prod alike.
// Also backfills one-time from analytics_events (upgrade-modal events carry
// platform + user_id) so existing users get some initial platform data.
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureUserPlatformsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_platforms (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_platforms_user_platform_idx
    ON user_platforms (user_id, platform)
  `);

  // Backfill from analytics_events (idempotent — ON CONFLICT DO NOTHING).
  await db.execute(sql`
    INSERT INTO user_platforms (user_id, platform, first_seen_at, last_seen_at)
    SELECT ae.user_id, ae.platform, MIN(ae.created_at), MAX(ae.created_at)
    FROM analytics_events ae
    JOIN users u ON u.id = ae.user_id
    WHERE ae.user_id IS NOT NULL
      AND ae.platform IN ('web', 'ios', 'android')
    GROUP BY ae.user_id, ae.platform
    ON CONFLICT (user_id, platform) DO NOTHING
  `);
}
