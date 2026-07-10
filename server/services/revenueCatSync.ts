import { CronJob } from 'cron';
import { storage } from '../storage';
import { sendEmail } from '../email';

// The entitlement identifier configured in RevenueCat for the Super Hero plan.
// This is intentionally the *entitlement*, not the product id, so new product
// versions (e.g. MCV_Apple_Superhero -> MCV_Apple_Superhero_v2) keep working.
export const RC_ENTITLEMENT = 'super_hero';

// The system account is not a paying customer and must never be treated as one.
export const SYSTEM_USER_FIREBASE_UID = 'SYSTEM_USER_MCV';

interface RcEntitlement {
  product_identifier?: string;
  purchase_date?: string;
  expires_date?: string | null;
}

interface RcVerifyResult {
  ok: boolean;              // true if the RC lookup itself succeeded (even if no entitlement)
  entitlement: RcEntitlement | null; // present only when an ACTIVE super_hero entitlement exists
  error?: string;          // set when the lookup failed
}

/**
 * Verify a user's Super Hero entitlement directly with RevenueCat's REST API.
 *
 * IMPORTANT: never send an X-Platform header from the server. RC v1 REST treats
 * that as a mobile-client signal and rejects secret keys with error 7243, which
 * silently breaks every server-side lookup. RC can also return HTTP 200/201 with
 * an error body ({ code, message }); we treat any such body as a failed lookup.
 */
export async function verifyRcEntitlement(firebaseUid: string): Promise<RcVerifyResult> {
  const rcSecretKey = process.env.REVENUECAT_SECRET_KEY;
  if (!rcSecretKey) return { ok: false, entitlement: null, error: 'REVENUECAT_SECRET_KEY not configured' };

  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(firebaseUid)}`,
      { headers: { Authorization: `Bearer ${rcSecretKey}`, 'Content-Type': 'application/json' } }
    );
    const body: any = await res.json().catch(() => null);

    // RC returns 200 (existing) or 201 (auto-created empty subscriber). Anything
    // else, a missing body, or a body carrying an error code is a failed lookup.
    if ((!res.ok && res.status !== 201) || !body || typeof body.code === 'number') {
      return { ok: false, entitlement: null, error: `HTTP ${res.status}${body?.code ? ` code ${body.code}` : ''}` };
    }

    const entitlement: RcEntitlement | undefined = body?.subscriber?.entitlements?.[RC_ENTITLEMENT];
    if (!entitlement) return { ok: true, entitlement: null };

    // expires_date is null for lifetime entitlements; otherwise must be in the future.
    const isActive = !entitlement.expires_date || new Date(entitlement.expires_date) > new Date();
    return { ok: true, entitlement: isActive ? entitlement : null };
  } catch (e: any) {
    return { ok: false, entitlement: null, error: e?.message || 'network error' };
  }
}

export interface ReconcileResult {
  scanned: number;
  affected: number;
  errors: number;
  autoFixed: boolean;
  users: Array<{
    userId: number;
    email: string | null;
    username: string | null;
    currentPlan: string | null;
    rcProduct?: string;
    purchaseDate?: string;
    expiresDate?: string | null;
    fixed: boolean;
  }>;
}

/**
 * Scan every non-SUPER_HERO account against RevenueCat and (optionally) upgrade
 * anyone who has an active super_hero entitlement but the wrong plan. This is the
 * safety net that guarantees an iOS payer is never left stuck on SIDE_KICK, even
 * if the client-side activate call or the webhook was missed.
 */
export async function reconcileRevenueCatSubscriptions(autoFix: boolean): Promise<ReconcileResult> {
  const allUsers = await storage.getAllUsers();
  const candidates = allUsers.filter(
    (u) => u.firebaseUid && u.firebaseUid !== SYSTEM_USER_FIREBASE_UID && u.plan !== 'SUPER_HERO'
  );

  const users: ReconcileResult['users'] = [];
  let errorCount = 0;

  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    await Promise.all(
      batch.map(async (u) => {
        const result = await verifyRcEntitlement(u.firebaseUid!);
        if (!result.ok) {
          errorCount++;
          console.warn(`[RC Reconcile] lookup failed for user ${u.id}: ${result.error}`);
          return;
        }
        if (!result.entitlement) return;

        const record = {
          userId: u.id,
          email: u.email,
          username: u.username,
          currentPlan: u.plan,
          rcProduct: result.entitlement.product_identifier,
          purchaseDate: result.entitlement.purchase_date,
          expiresDate: result.entitlement.expires_date,
          fixed: false,
        };
        users.push(record);

        if (autoFix) {
          await storage.updateUser(u.id, { plan: 'SUPER_HERO', subscriptionStatus: 'active' });
          record.fixed = true;
          console.log(`[RC Reconcile] Auto-upgraded user ${u.id} (${u.email}) to SUPER_HERO`);
        }
      })
    );
    if (i + 5 < candidates.length) await new Promise((r) => setTimeout(r, 200));
  }

  return { scanned: candidates.length, affected: users.length, errors: errorCount, autoFixed: autoFix, users };
}

let reconcileCronStarted = false;

/**
 * Daily safety net: automatically reconcile RevenueCat subscriptions so any iOS
 * payer who slipped through (missed webhook / failed client activate) is upgraded
 * within a day without any manual admin action.
 */
export function startRevenueCatReconcileCron(): void {
  if (reconcileCronStarted) return;
  reconcileCronStarted = true;

  const job = new CronJob(
    '0 7 * * *', // daily 7 AM CT
    async () => {
      try {
        if (!process.env.REVENUECAT_SECRET_KEY) return;
        const result = await reconcileRevenueCatSubscriptions(true);
        if (result.affected > 0) {
          console.log(`[RC Reconcile] Daily job upgraded ${result.affected} stuck user(s)`);
          try {
            await sendEmail(
              'josh@marvelcardvault.com',
              `🔧 Daily RC Reconcile Auto-Fixed ${result.affected} User(s)`,
              `<p>The daily RevenueCat reconciliation found and upgraded <strong>${result.affected}</strong> user(s) with an active iOS subscription but the wrong plan.</p>
               <table border="1" cellpadding="4"><tr><th>ID</th><th>Email</th><th>Product</th><th>Expires</th></tr>
               ${result.users.map((r) => `<tr><td>${r.userId}</td><td>${r.email}</td><td>${r.rcProduct}</td><td>${r.expiresDate}</td></tr>`).join('')}
               </table>`
            );
          } catch { /* non-fatal */ }
        }
        if (result.errors > 0) {
          console.warn(`[RC Reconcile] Daily job had ${result.errors} lookup errors`);
        }
      } catch (error) {
        console.error('[RC Reconcile] Daily cron error:', error);
      }
    },
    null,
    false,
    'America/Chicago'
  );
  job.start();
  console.log('[RevenueCat] Daily reconciliation cron started (7 AM CT)');
}
