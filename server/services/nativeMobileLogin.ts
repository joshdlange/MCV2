import { sql } from "drizzle-orm";
import { db } from "../db";

export type NativeMobilePlatform = "android" | "ios";

export interface NativeMobileLoginResult {
  recorded: boolean;
  loginNumber: number;
  platform: NativeMobilePlatform;
}

/**
 * Records one native app launch exactly once, even if /api/auth/sync is
 * retried after the server has already handled the request.
 */
export async function recordNativeMobileLogin(
  userId: number,
  sessionId: string,
  platform: NativeMobilePlatform,
): Promise<NativeMobileLoginResult> {
  return db.transaction(async (tx) => {
    // Serialize launches per user so concurrent cold-start syncs cannot claim
    // the same ordinal.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917204, ${userId})`);

    const existing: any = await tx.execute(sql`
      SELECT e.login_number
      FROM native_mobile_login_events e
      WHERE e.user_id = ${userId} AND e.session_id = ${sessionId}
      LIMIT 1
    `);
    const existingRow = (existing.rows ?? existing)[0];
    if (existingRow) {
      return {
        recorded: false,
        loginNumber: Number(existingRow.login_number),
        platform,
      };
    }

    const userResult: any = await tx.execute(sql`
      SELECT native_mobile_logins
      FROM users
      WHERE id = ${userId}
      FOR UPDATE
    `);
    const user = (userResult.rows ?? userResult)[0];
    if (!user) {
      throw new Error(`Cannot record native login for missing user ${userId}`);
    }

    const loginNumber = Number(user.native_mobile_logins ?? 0) + 1;
    await tx.execute(sql`
      INSERT INTO native_mobile_login_events (user_id, session_id, platform, login_number)
      VALUES (${userId}, ${sessionId}, ${platform}, ${loginNumber})
    `);
    await tx.execute(sql`
      UPDATE users
      SET native_mobile_logins = ${loginNumber}
      WHERE id = ${userId}
    `);

    return {
      recorded: true,
      loginNumber,
      platform,
    };
  });
}