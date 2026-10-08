import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizeTrustedAvatarUrl } from "../../shared/trustedAvatarUrl";

// Messaging permits any other user unless either party has blocked the other.
// Profile/collection visibility is not a separate DM permission.
export async function searchMessageUsers(viewerId: number, query: string) {
  const term = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT u.id, u.username, u.display_name AS "displayName",
        u.photo_url AS "photoURL", u.collector_avatar_key AS "collectorAvatarKey",
        (EXISTS (SELECT 1 FROM follows f WHERE f.follower_user_id = ${viewerId} AND f.following_user_id = u.id)
         AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_user_id = u.id AND f.following_user_id = ${viewerId})) AS "isFriend"
      FROM users u
      WHERE u.id <> ${viewerId}
        AND NOT EXISTS (SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_user_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_user_id = ${viewerId}))
    )
    SELECT * FROM candidates
    WHERE ${query.trim() === ""} AND "isFriend"
       OR ${query.trim() !== ""} AND (username ILIKE ${term} OR "displayName" ILIKE ${term})
    ORDER BY "isFriend" DESC, lower(username), id
    LIMIT 30
  `);
  return result.rows.map((row: any) => ({
    ...row, photoURL: normalizeTrustedAvatarUrl(row.photoURL),
  }));
}
