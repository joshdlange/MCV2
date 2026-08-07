import { CronJob } from 'cron';
import Stripe from 'stripe';
import { storage } from '../storage';
import { sendEmail } from '../email';

/**
 * Daily Stripe reconciliation — the Stripe counterpart of the RevenueCat
 * reconcile cron. Guards against the failure mode where a checkout completes
 * payment but the subscription never gets linked to a user account (missed /
 * misrouted webhook — this happened to a cluster of subscribers in July 2026).
 *
 * For every ACTIVE Stripe subscription:
 *  - already linked to a user (users.stripe_subscription_id) → OK
 *  - unlinked, but exactly one account matches the Stripe customer email and
 *    that account has no other Stripe subscription → auto-link + upgrade
 *  - otherwise → include in an alert email to the admin (never guess)
 */

export interface StripeReconcileResult {
  activeSubs: number;
  linked: number;
  autoLinked: Array<{ subId: string; userId: number; email: string }>;
  unlinked: Array<{ subId: string; customerId: string; email: string | null; name: string | null; created: string }>;
  errors: number;
}

export async function reconcileStripeSubscriptions(autoFix: boolean): Promise<StripeReconcileResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured');
  const stripe = new Stripe(secretKey);

  const allUsers = await storage.getAllUsers();
  const bySubId = new Map(allUsers.filter(u => u.stripeSubscriptionId).map(u => [u.stripeSubscriptionId!, u]));
  const byEmail = new Map<string, typeof allUsers>();
  for (const u of allUsers) {
    if (!u.email) continue;
    const key = u.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(u);
  }

  const result: StripeReconcileResult = { activeSubs: 0, linked: 0, autoLinked: [], unlinked: [], errors: 0 };

  for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] })) {
    result.activeSubs++;
    if (bySubId.has(sub.id)) { result.linked++; continue; }

    const customer = sub.customer as Stripe.Customer;
    const custEmail = (typeof customer === 'object' && !customer.deleted ? customer.email : null) || null;
    const custName = (typeof customer === 'object' && !customer.deleted ? customer.name : null) || null;
    const metaUserId = parseInt(sub.metadata?.userId || '0');

    // Candidate user: subscription metadata first, then unique email match.
    let candidate = metaUserId ? allUsers.find(u => u.id === metaUserId) : undefined;
    if (!candidate && custEmail) {
      const matches = byEmail.get(custEmail.toLowerCase()) || [];
      if (matches.length === 1) candidate = matches[0];
    }

    // Only auto-link when the candidate has no other Stripe subscription —
    // a user who already has one would indicate a DUPLICATE sub, which needs
    // a human decision (cancel/refund), not silent linking.
    if (candidate && !candidate.stripeSubscriptionId && autoFix) {
      try {
        await storage.updateUser(candidate.id, {
          plan: 'SUPER_HERO',
          subscriptionStatus: 'active',
          stripeCustomerId: typeof customer === 'object' ? customer.id : (sub.customer as string),
          stripeSubscriptionId: sub.id,
        });
        result.autoLinked.push({ subId: sub.id, userId: candidate.id, email: candidate.email || '' });
        console.log(`[Stripe Reconcile] Auto-linked sub ${sub.id} to user ${candidate.id} (${candidate.email})`);
        continue;
      } catch (e) {
        result.errors++;
        console.error(`[Stripe Reconcile] Failed to link sub ${sub.id} to user ${candidate.id}:`, e);
      }
    }

    result.unlinked.push({
      subId: sub.id,
      customerId: typeof customer === 'object' ? customer.id : (sub.customer as string),
      email: custEmail,
      name: custName,
      created: new Date(sub.created * 1000).toISOString().slice(0, 10),
    });
  }

  return result;
}

async function sendReconcileAlert(result: StripeReconcileResult): Promise<void> {
  if (!result.autoLinked.length && !result.unlinked.length) return;
  const autoRows = result.autoLinked
    .map(r => `<tr><td>${r.subId}</td><td>${r.userId}</td><td>${r.email}</td></tr>`).join('');
  const unlinkedRows = result.unlinked
    .map(r => `<tr><td>${r.subId}</td><td>${r.customerId}</td><td>${r.email || '?'}</td><td>${r.name || '?'}</td><td>${r.created}</td></tr>`).join('');
  await sendEmail(
    'josh@marvelcardvault.com',
    `🔧 Stripe Reconcile: ${result.autoLinked.length} auto-linked, ${result.unlinked.length} need review`,
    `<p>Daily Stripe reconciliation scanned <strong>${result.activeSubs}</strong> active subscription(s).</p>
     ${autoRows ? `<h3>Auto-linked (payer was stuck on free)</h3><table border="1" cellpadding="4"><tr><th>Subscription</th><th>User ID</th><th>Email</th></tr>${autoRows}</table>` : ''}
     ${unlinkedRows ? `<h3>Unlinked — need manual review (possible duplicate or unknown payer)</h3><table border="1" cellpadding="4"><tr><th>Subscription</th><th>Customer</th><th>Email</th><th>Name</th><th>Created</th></tr>${unlinkedRows}</table>` : ''}`
  );
}

let cronStarted = false;

export function startStripeReconcileCron(): void {
  if (cronStarted) return;
  cronStarted = true;

  const job = new CronJob(
    '30 7 * * *', // daily 7:30 AM CT (after the 7 AM RevenueCat reconcile)
    async () => {
      try {
        if (!process.env.STRIPE_SECRET_KEY) return;
        const result = await reconcileStripeSubscriptions(true);
        if (result.autoLinked.length || result.unlinked.length) {
          console.log(`[Stripe Reconcile] auto-linked ${result.autoLinked.length}, unlinked needing review ${result.unlinked.length}`);
          try { await sendReconcileAlert(result); } catch { /* non-fatal */ }
        }
      } catch (error) {
        console.error('[Stripe Reconcile] Daily cron error:', error);
      }
    },
    null,
    false,
    'America/Chicago'
  );
  job.start();
  console.log('[Stripe] Daily subscription reconciliation cron started (7:30 AM CT)');
}
