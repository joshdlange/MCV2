/**
 * Push notification service (FCM via firebase-admin).
 *
 * Additive module — no existing code touched. Uses the Firebase Admin app
 * that routes.ts already initializes from FIREBASE_SERVICE_ACCOUNT_KEY.
 *
 * Tables (push_tokens, push_logs) are created lazily on first use because
 * db:push is unavailable in this repo (startup-DDL convention).
 *
 * IMPORTANT: sends are admin-triggered manual sends only. No crons, no
 * automatic triggers. Push failures never throw — they log and count.
 */
import admin from "firebase-admin";
import { sql } from "drizzle-orm";
import { db } from "./db";

const FCM_BATCH_SIZE = 500; // FCM multicast hard limit

/**
 * routes.ts initializes the default Firebase Admin app at boot; this guard
 * only exists so the service also works standalone (scripts, tests) and is
 * never sensitive to module load order. Same secret, same pattern.
 */
function ensureFirebaseApp(): void {
  if (admin.apps.length) return;
  // FIREBASE_SERVICE_ACCOUNT_KEY is the secret this app has always used
  // (routes.ts boots with it); _JSON accepted as an alias for compatibility.
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountKey) throw new Error("Missing required secret: FIREBASE_SERVICE_ACCOUNT_KEY");
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountKey) as admin.ServiceAccount),
  });
}

let tablesReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS push_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL,
          platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user_id, token)
        )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS push_logs (
          id SERIAL PRIMARY KEY,
          sent_by_admin_id INTEGER REFERENCES users(id),
          target TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          sent_count INTEGER DEFAULT 0,
          failed_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        )`);
      console.log("[Push] push_tokens / push_logs tables ready");
    })().catch((e) => {
      tablesReady = null; // allow retry on next call
      throw e;
    });
  }
  return tablesReady;
}

export type PushPlatform = "ios" | "android" | "web";
export type PushSegment = "all" | "superhero" | "sidekick";

// A real user has a handful of devices; anything beyond this is abuse or
// token churn. Oldest-updated rows are evicted so the newest devices win.
const MAX_TOKENS_PER_USER = 20;

export async function registerToken(userId: number, token: string, platform: PushPlatform): Promise<void> {
  await ensureTables();
  await db.execute(sql`
    INSERT INTO push_tokens (user_id, token, platform)
    VALUES (${userId}, ${token}, ${platform})
    ON CONFLICT (user_id, token)
    DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()
  `);
  // Cap tokens per user (resource-exhaustion guard on the public write path)
  await db.execute(sql`
    DELETE FROM push_tokens
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM push_tokens
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${MAX_TOKENS_PER_USER}
      )
  `);
}

/** Send one FCM message to a batch of tokens; prunes tokens FCM says are dead. */
async function sendToTokens(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    ensureFirebaseApp();
  } catch (e) {
    console.error("[Push] Firebase Admin unavailable:", e);
    return { sent: 0, failed: tokens.length };
  }
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
    try {
      const resp = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data,
      });
      sent += resp.successCount;
      failed += resp.failureCount;
      // Prune tokens that FCM reports as permanently invalid so future
      // segment sends don't keep failing on dead devices.
      const dead: string[] = [];
      resp.responses.forEach((r, idx) => {
        const code = (r.error as any)?.code as string | undefined;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
          dead.push(batch[idx]);
        }
      });
      if (dead.length > 0) {
        try {
          await db.execute(sql`DELETE FROM push_tokens WHERE token IN (${sql.join(dead.map((t) => sql`${t}`), sql`, `)})`);
          console.log(`[Push] pruned ${dead.length} dead token(s)`);
        } catch (e) {
          console.error("[Push] token prune failed (non-fatal):", e);
        }
      }
    } catch (e) {
      console.error(`[Push] batch send failed (${batch.length} tokens):`, e);
      failed += batch.length;
    }
  }
  return { sent, failed };
}

function sanitizeData(data: Record<string, unknown> = {}): Record<string, string> {
  // FCM data payload values must be strings.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = String(v);
  return out;
}

export async function sendPushToUser(
  userId: number,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number }> {
  try {
    await ensureTables();
    // Respect the user's push preference — skip silently when opted out.
    const rows: any = await db.execute(sql`
      SELECT pt.token
      FROM push_tokens pt
      JOIN users u ON u.id = pt.user_id
      WHERE pt.user_id = ${userId} AND u.push_enabled = true
    `);
    const tokens: string[] = (rows.rows ?? []).map((r: any) => r.token);
    if (tokens.length === 0) return { sent: 0, failed: 0 };
    return await sendToTokens(tokens, title, body, sanitizeData(data));
  } catch (e) {
    console.error(`[Push] sendPushToUser(${userId}) failed:`, e);
    return { sent: 0, failed: 0 };
  }
}

export async function sendPushToSegment(
  segment: PushSegment,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<{ sent: number; failed: number; totalUsers: number }> {
  try {
    await ensureTables();
    // Subscription tier lives in users.plan: 'SUPER_HERO' (paid) / 'SIDE_KICK' (free)
    const planFilter =
      segment === "superhero" ? sql` AND u.plan = 'SUPER_HERO'` :
      segment === "sidekick" ? sql` AND u.plan = 'SIDE_KICK'` :
      sql``;
    const rows: any = await db.execute(sql`
      SELECT pt.token, pt.user_id
      FROM push_tokens pt
      JOIN users u ON u.id = pt.user_id
      WHERE u.push_enabled = true ${planFilter}
    `);
    const list = rows.rows ?? [];
    const tokens: string[] = list.map((r: any) => r.token);
    const totalUsers = new Set(list.map((r: any) => r.user_id)).size;
    if (tokens.length === 0) return { sent: 0, failed: 0, totalUsers: 0 };
    const result = await sendToTokens(tokens, title, body, sanitizeData(data));
    return { ...result, totalUsers };
  } catch (e) {
    console.error(`[Push] sendPushToSegment(${segment}) failed:`, e);
    return { sent: 0, failed: 0, totalUsers: 0 };
  }
}

// --- New-message push (Tier 1 transactional) ---------------------------------
// Fired when a direct message is sent. Bundling + throttle keep a rapid burst
// of messages from turning into a push per message: at most one push per
// recipient+sender pair every 2 minutes, and the body collapses to
// "N new messages" when more than one is unread.
const lastMessagePushAt = new Map<string, number>();
const MESSAGE_PUSH_COOLDOWN_MS = 2 * 60 * 1000;

// Privacy: the push body is always generic ("New message" / "N new messages"),
// never the message content — push bodies show on lock screens and transit
// Apple/Google servers. The actual message is only fetched in-app after auth.
export async function notifyNewMessage(
  recipientId: number,
  senderId: number,
  senderName: string,
): Promise<void> {
  try {
    const key = `${recipientId}:${senderId}`;
    const now = Date.now();
    if (now - (lastMessagePushAt.get(key) ?? 0) < MESSAGE_PUSH_COOLDOWN_MS) return;
    lastMessagePushAt.set(key, now);
    // Bounded memory: drop stale entries once the map grows.
    if (lastMessagePushAt.size > 5000) {
      for (const [k, t] of lastMessagePushAt) {
        if (now - t > MESSAGE_PUSH_COOLDOWN_MS) lastMessagePushAt.delete(k);
      }
    }

    // Bundle: count unread messages from this sender (includes the one just sent).
    const rows: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM messages
      WHERE recipient_id = ${recipientId} AND sender_id = ${senderId} AND is_read = false
    `);
    const n: number = (rows.rows ?? [])[0]?.n ?? 1;
    const body = n > 1 ? `${n} new messages` : "New message";

    await sendPushToUser(recipientId, senderName, body, {
      type: "message",
      url: `/social?tab=messages&user=${senderId}`,
    });
  } catch (e) {
    // Never let a push failure affect message delivery.
    console.error(`[Push] notifyNewMessage(${recipientId}) failed:`, e);
  }
}

export async function logPushSend(entry: {
  sentByAdminId: number;
  target: string;
  title: string;
  body: string;
  sentCount: number;
  failedCount: number;
}): Promise<void> {
  try {
    await ensureTables();
    await db.execute(sql`
      INSERT INTO push_logs (sent_by_admin_id, target, title, body, sent_count, failed_count)
      VALUES (${entry.sentByAdminId}, ${entry.target}, ${entry.title}, ${entry.body}, ${entry.sentCount}, ${entry.failedCount})
    `);
  } catch (e) {
    console.error("[Push] failed to write push_logs entry:", e);
  }
}

export async function getPushLogs(limit = 50): Promise<any[]> {
  await ensureTables();
  const rows: any = await db.execute(sql`
    SELECT pl.id, pl.target, pl.title, pl.body, pl.sent_count, pl.failed_count, pl.created_at,
           u.username AS sent_by_username, u.display_name AS sent_by_display_name
    FROM push_logs pl
    LEFT JOIN users u ON u.id = pl.sent_by_admin_id
    ORDER BY pl.created_at DESC, pl.id DESC
    LIMIT ${limit}
  `);
  return rows.rows ?? [];
}

export async function getPushStats(): Promise<{
  totalTokens: number;
  iosTokens: number;
  androidTokens: number;
  webTokens: number;
  usersWithTokens: number;
}> {
  await ensureTables();
  const rows: any = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE platform = 'ios')::int AS ios,
      COUNT(*) FILTER (WHERE platform = 'android')::int AS android,
      COUNT(*) FILTER (WHERE platform = 'web')::int AS web,
      COUNT(DISTINCT user_id)::int AS users
    FROM push_tokens
  `);
  const r = (rows.rows ?? [])[0] ?? {};
  return {
    totalTokens: r.total ?? 0,
    iosTokens: r.ios ?? 0,
    androidTokens: r.android ?? 0,
    webTokens: r.web ?? 0,
    usersWithTokens: r.users ?? 0,
  };
}
