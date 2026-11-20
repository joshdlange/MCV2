import { sql } from "drizzle-orm";
import { db } from "../db";

export function countRecordedImages(notes: unknown[]): { images: number; unknownUpdates: number } {
  let images = 0;
  let unknownUpdates = 0;
  for (const note of notes) {
    try {
      const sides = JSON.parse(String(note)).sides;
      if (!Array.isArray(sides) || !sides.length ||
          sides.some(side => side !== "front" && side !== "back")) {
        unknownUpdates++;
      } else {
        images += new Set(sides).size;
      }
    } catch {
      unknownUpdates++;
    }
  }
  return { images, unknownUpdates };
}

/** Audit timestamps are UTC without timezone. Calendar boundaries are Central time. */
export async function getImageAdminActivity(userId: number, interval: "day" | "week") {
  const step = interval === "day" ? "1 day" : "1 week";
  const lookback = interval === "day" ? "29 days" : "11 weeks";
  const result = await db.execute(sql`
    WITH bounds AS (
      SELECT date_trunc(${interval}, now() AT TIME ZONE 'America/Chicago') AS current_period
    ), periods AS (
      SELECT generate_series(current_period - ${lookback}::interval,
        current_period, ${step}::interval) AS period FROM bounds
    ), events AS (
      SELECT date_trunc(${interval},
        created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') AS period,
        entity_id, notes
      FROM admin_audit_logs
      WHERE admin_user_id = ${userId}
        AND action_type = 'card_image_update' AND entity_type = 'card'
        AND created_at >= ((SELECT min(period) FROM periods)
          AT TIME ZONE 'America/Chicago' AT TIME ZONE 'UTC')
        AND created_at <= (now() AT TIME ZONE 'UTC')
    )
    SELECT to_char(p.period, 'YYYY-MM-DD') AS period,
      count(e.period)::integer AS updates,
      count(DISTINCT e.entity_id)::integer AS cards,
      array_agg(e.notes) FILTER (WHERE e.period IS NOT NULL) AS notes
    FROM periods p LEFT JOIN events e ON e.period = p.period
    GROUP BY p.period ORDER BY p.period
  `);
  const first = await db.execute(sql`
    SELECT min(created_at) AT TIME ZONE 'UTC' AS first_recorded_at
    FROM admin_audit_logs WHERE admin_user_id = ${userId}
      AND action_type = 'card_image_update' AND entity_type = 'card'
  `);
  return {
    interval,
    timeZone: "America/Chicago",
    firstRecordedAt: first.rows[0]?.first_recorded_at ?? null,
    periods: result.rows.map((row: any) => ({
      period: row.period, updates: row.updates, cards: row.cards,
      ...countRecordedImages(row.notes ?? []),
    })),
  };
}
