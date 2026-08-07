/**
 * Lifecycle Email System v1 — Marvel Card Vault
 * ---------------------------------------------
 * Journey-based lifecycle emails driven by user behavior, per
 * .agents/skills/mcv-lifecycle-marketing/SKILL.md.
 *
 * ACTIVE now:
 *   - lifecycle-welcome            (sent at onboarding completion, new signups only)
 *   - lifecycle-first-card-nudge   (hourly cron; 24h after signup, zero cards)
 *
 * DRAFT (templates + eligibility counts only, active:false — flip one at a
 * time AFTER admin preview/test, never all at once):
 *   - the 10 journey emails defined in LIFECYCLE_EMAILS below.
 *
 * Hard rules enforced here:
 *   - GLOBAL FREQUENCY CAP: no user receives more than ONE lifecycle/marketing
 *     email every LIFECYCLE_CAP_DAYS (14) days. Transactional email (password
 *     reset, billing, image approval/rejection, trades, badges) never routes
 *     through this module and is exempt. The welcome email is intentionally
 *     EXEMPT from the cap (it is the account-creation email; otherwise the
 *     24h nudge could never send) but IS logged and can never send twice.
 *   - NO RETROACTIVE SENDS: welcome + nudge only apply to users created on or
 *     after LIFECYCLE_LAUNCH_DATE. Existing users are never backfilled.
 *   - Idempotency: every send is logged to email_logs with a distinct
 *     job_name; every job dedupes off email_logs before sending.
 *   - marketingOptIn gates every lifecycle send except the welcome email.
 */

import { CronJob } from 'cron';
import { db } from '../db';
import { users, userCollections, userWishlists, pcBinders, pcBinderShareLinks, emailLogs, cards } from '../../shared/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { sendResendEmail } from '../services/emailService';

// Users created before this date never receive the welcome/nudge sequence.
// Set to the date this system shipped — do not move it backwards.
export const LIFECYCLE_LAUNCH_DATE = new Date('2026-08-08T00:00:00Z');

export const LIFECYCLE_CAP_DAYS = 14;
const NUDGE_BATCH_LIMIT = 50; // per hourly run — well under Resend limits

const APP_URL = 'https://www.marvelcardvault.com';
const BRAND_RED = '#EF4444';
const DARK_BG = '#0F172A';
const CARD_BG = '#1E293B';
const TEXT_PRIMARY = '#F1F5F9';
const TEXT_SECONDARY = '#94A3B8';
const LOGO_URL = 'https://res.cloudinary.com/dgu7hjfvn/image/upload/v1765655501/marvel-card-vault/email-logo.png';

// ---------------------------------------------------------------------------
// Shared lifecycle template (dark theme + unsubscribe + non-affiliation footer)
// ---------------------------------------------------------------------------

function lifecycleTemplate(opts: {
  preheader: string;
  heading: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
}): { html: string; text: string } {
  const paragraphsHtml = opts.paragraphs
    .map(p => `<p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">${p}</p>`)
    .join('\n');
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${opts.heading}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:${DARK_BG};color:${TEXT_PRIMARY};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${DARK_BG};">
    <tr><td style="padding:40px 20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:${CARD_BG};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:40px 40px 20px;text-align:center;background:linear-gradient(135deg,${DARK_BG} 0%,${CARD_BG} 100%);">
          <img src="${LOGO_URL}" alt="Marvel Card Vault" style="width:150px;height:auto;display:block;margin:0 auto;">
        </td></tr>
        <tr><td style="padding:20px 40px 40px;">
          <h1 style="margin:0 0 20px;font-size:28px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.2;">${opts.heading}</h1>
          ${paragraphsHtml}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="text-align:center;padding:20px 0;">
            <a href="${opts.ctaUrl}" style="display:inline-block;padding:16px 32px;background-color:${BRAND_RED};color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">${opts.ctaLabel}</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:30px 40px;background-color:${DARK_BG};border-top:1px solid #334155;text-align:center;">
          <p style="margin:0 0 10px;font-size:14px;color:${TEXT_SECONDARY};"><strong style="color:${BRAND_RED};">Marvel Card Vault</strong></p>
          <p style="margin:0 0 10px;font-size:12px;color:${TEXT_SECONDARY};">Marvel Card Vault is not affiliated with Marvel, Disney, Upper Deck, Topps, or any card manufacturer.</p>
          <p style="margin:0;font-size:12px;color:${TEXT_SECONDARY};">
            <a href="${APP_URL}" style="color:${BRAND_RED};text-decoration:none;">Visit Website</a> |
            <a href="${APP_URL}/settings" style="color:${BRAND_RED};text-decoration:none;">Email Preferences</a> |
            <a href="{{UNSUBSCRIBE_URL}}" style="color:${BRAND_RED};text-decoration:underline;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const text = [
    opts.heading,
    '',
    ...opts.paragraphs.map(p => p.replace(/<[^>]+>/g, '')),
    '',
    `${opts.ctaLabel}: ${opts.ctaUrl}`,
    '',
    'Marvel Card Vault is not affiliated with Marvel, Disney, Upper Deck, Topps, or any card manufacturer.',
    'Unsubscribe: {{UNSUBSCRIBE_URL}}',
  ].join('\n');

  return { html, text };
}

// ---------------------------------------------------------------------------
// Registry — every lifecycle email, active or draft
// ---------------------------------------------------------------------------

export interface LifecycleEmailDef {
  key: string;
  jobName: string;            // email_logs.job_name — dedupe + cap key. MUST start with 'lifecycle-'
  stage: string;              // lifecycle stage from the skill
  active: boolean;            // false = draft: previewable + countable, never auto-sent
  exemptFromCap?: boolean;    // welcome only
  subject: string;
  preheader: string;
  ctaLabel: string;
  ctaUrl: string;
  render: (u: { displayName?: string | null }) => { html: string; text: string };
  /** Estimated currently-eligible users (opted-in, before the 14-day cap). */
  eligibleCount: () => Promise<number>;
  eligibilityNote: string;
}

const optedIn = () => and(eq(users.marketingOptIn, true), ne(users.email, ''));

async function countUsers(where: ReturnType<typeof sql> | any): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` }).from(users).where(where);
  return Number(row[0]?.count || 0);
}

const ZERO_CARDS = sql`NOT EXISTS (SELECT 1 FROM user_collections uc WHERE uc.user_id = ${users.id})`;
const HAS_CARDS = sql`EXISTS (SELECT 1 FROM user_collections uc WHERE uc.user_id = ${users.id})`;

export const LIFECYCLE_EMAILS: LifecycleEmailDef[] = [
  {
    key: 'welcome',
    jobName: 'lifecycle-welcome',
    stage: 'Activation',
    active: true,
    exemptFromCap: true,
    subject: 'Welcome to Marvel Card Vault',
    preheader: 'Your vault is ready. Start building your collection and earning XP.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      preheader: 'Your vault is ready. Start building your collection and earning XP.',
      heading: 'Welcome to Marvel Card Vault',
      paragraphs: [
        'Hey collector,',
        'Welcome to Marvel Card Vault. Your vault is ready, and the best place to start is simple: add your first card.',
        'Once your collection starts taking shape, you can track your cards, build custom PC Binders, earn Collector XP, and share your favorite binders with other collectors.',
        'Start with one card today and build from there.',
      ],
      ctaLabel: 'Add Your First Card',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => 0, // event-triggered at signup, never batch-sent
    eligibilityNote: 'Event-triggered at onboarding completion for users created after launch date. Never batch-sent.',
  },
  {
    key: 'first-card-nudge',
    jobName: 'lifecycle-first-card-nudge',
    stage: 'Activation',
    active: true,
    subject: 'Your vault is waiting',
    preheader: 'Add your first card and start earning Collector XP.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      preheader: 'Add your first card and start earning Collector XP.',
      heading: 'Your vault is waiting',
      paragraphs: [
        'Hey collector,',
        'Your Marvel Card Vault is set up, but it looks like your collection is still empty.',
        'Add your first card to start building your vault, unlock progress, and begin earning Collector XP.',
        'It only takes a minute to get started.',
      ],
      ctaLabel: 'Add Your First Card',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      sql`${users.createdAt} >= ${LIFECYCLE_LAUNCH_DATE}`,
      sql`${users.createdAt} <= now() - interval '24 hours'`,
      ZERO_CARDS,
      notAlreadySent('lifecycle-first-card-nudge'),
    )),
    eligibilityNote: 'Signed up 24h+ ago (after launch date only), zero cards, opted in, not already nudged.',
  },

  // ------------------------- DRAFTS (disabled) -----------------------------
  {
    key: 'empty-vault',
    jobName: 'lifecycle-empty-vault',
    stage: 'Activation',
    active: false,
    subject: "Still empty? Let's fix that",
    preheader: 'Add one card and bring your vault to life.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      preheader: 'Add one card and bring your vault to life.',
      heading: "Still empty? Let's fix that",
      paragraphs: [
        'Hey collector,',
        'Your vault is still waiting on its first card. One card is all it takes to bring it to life.',
        'Add the card closest to you right now and your collection is officially started.',
      ],
      ctaLabel: 'Add Your First Card',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      ZERO_CARDS,
      sql`EXISTS (SELECT 1 FROM email_logs el WHERE el.job_name = 'lifecycle-first-card-nudge' AND lower(trim(el.email)) = lower(trim(${users.email})) AND el.sent_at <= now() - interval '7 days')`,
      sql`(${users.lastLogin} IS NULL OR ${users.lastLogin} <= now() - interval '7 days')`,
      notAlreadySent('lifecycle-empty-vault'),
    )),
    eligibilityNote: 'Zero cards, got the first-card nudge 7+ days ago with no response, inactive 7+ days.',
  },
  {
    key: 'collection-momentum',
    jobName: 'lifecycle-collection-momentum',
    stage: 'Engagement',
    active: false,
    subject: 'Your collection is off to a good start',
    preheader: 'Add a few more cards and keep your vault moving.',
    ctaLabel: 'Add More Cards',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      preheader: 'Add a few more cards and keep your vault moving.',
      heading: 'Your collection is off to a good start',
      paragraphs: [
        'Hey collector,',
        'Your vault has its first cards in it, and that is the hardest part done.',
        'Keep the momentum going: add a few more cards and watch your collection value, XP, and progress grow.',
      ],
      ctaLabel: 'Add More Cards',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      sql`(SELECT count(*) FROM user_collections uc WHERE uc.user_id = ${users.id}) BETWEEN 1 AND 9`,
      sql`NOT EXISTS (SELECT 1 FROM user_collections uc WHERE uc.user_id = ${users.id} AND uc.acquired_date > now() - interval '7 days')`,
      notAlreadySent('lifecycle-collection-momentum'),
    )),
    eligibilityNote: '1-9 cards, no card added in 7+ days.',
  },
  {
    key: 'pc-binder-prompt',
    jobName: 'lifecycle-pc-binder-prompt',
    stage: 'Engagement',
    active: false,
    subject: 'Build a binder around your favorites',
    preheader: 'Create a custom PC Binder for a character, artist, set, or chase list.',
    ctaLabel: 'Create a PC Binder',
    ctaUrl: `${APP_URL}/pc-binders`,
    render: () => lifecycleTemplate({
      preheader: 'Create a custom PC Binder for a character, artist, set, or chase list.',
      heading: 'Build a binder around your favorites',
      paragraphs: [
        'Hey collector,',
        'You have cards in your vault, which means you have favorites. PC Binders let you build custom binders around a character, an artist, a set, or a chase list.',
        'Your Super Hero plan includes them. Create your first one today.',
      ],
      ctaLabel: 'Create a PC Binder',
      ctaUrl: `${APP_URL}/pc-binders`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      eq(users.plan, 'SUPER_HERO'),
      HAS_CARDS,
      sql`NOT EXISTS (SELECT 1 FROM pc_binders pb WHERE pb.user_id = ${users.id})`,
      notAlreadySent('lifecycle-pc-binder-prompt'),
    )),
    eligibilityNote: 'Super Hero plan, has cards, has never created a PC Binder.',
  },
  {
    key: 'pc-binder-upgrade',
    jobName: 'lifecycle-pc-binder-upgrade',
    stage: 'Upgrade',
    active: false,
    subject: 'PC Binders are waiting',
    preheader: 'Upgrade to Super Hero to build custom binders around the cards you care about most.',
    ctaLabel: 'Unlock PC Binders',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      preheader: 'Upgrade to Super Hero to build custom binders around the cards you care about most.',
      heading: 'PC Binders are waiting',
      paragraphs: [
        'Hey collector,',
        'PC Binders let you build custom binders around the cards you care about most: a character, an artist, a chase list.',
        'They are a Super Hero feature. Upgrade and start building yours today.',
      ],
      ctaLabel: 'Unlock PC Binders',
      ctaUrl: `${APP_URL}/subscribe`,
    }),
    // NOTE: "clicked PC Binders" click-tracking does not exist yet; current
    // approximation is non-Super-Hero users with cards. Tighten before enabling.
    eligibleCount: async () => countUsers(and(
      optedIn(),
      ne(users.plan, 'SUPER_HERO'),
      HAS_CARDS,
      notAlreadySent('lifecycle-pc-binder-upgrade'),
    )),
    eligibilityNote: 'Free/Side Kick with cards (APPROXIMATION — add PC Binder click tracking before enabling).',
  },
  {
    key: 'missing-image',
    jobName: 'lifecycle-missing-image',
    stage: 'Contribution',
    active: false,
    subject: 'Help complete the vault',
    preheader: 'Some of your cards are missing images. Upload one and earn XP after approval.',
    ctaLabel: 'Upload an Image',
    ctaUrl: `${APP_URL}/my-collection`,
    render: () => lifecycleTemplate({
      preheader: 'Some of your cards are missing images. Upload one and earn XP after approval.',
      heading: 'Help complete the vault',
      paragraphs: [
        'Hey collector,',
        'Some of the cards in your collection are missing images in the vault.',
        'If you have the card in hand, snap a photo and upload it. Every approved image earns you Collector XP and helps every collector who owns that card.',
      ],
      ctaLabel: 'Upload an Image',
      ctaUrl: `${APP_URL}/my-collection`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      sql`EXISTS (SELECT 1 FROM user_collections uc JOIN cards c ON c.id = uc.card_id WHERE uc.user_id = ${users.id} AND c.front_image_url IS NULL)`,
      notAlreadySent('lifecycle-missing-image'),
    )),
    eligibilityNote: 'Owns at least one card whose vault image is missing.',
  },
  {
    key: 'share-binder',
    jobName: 'lifecycle-share-binder',
    stage: 'Referral/sharing',
    active: false,
    subject: 'Show off your vault',
    preheader: 'Share a binder with other collectors and earn XP.',
    ctaLabel: 'Share Your Binder',
    ctaUrl: `${APP_URL}/pc-binders`,
    render: () => lifecycleTemplate({
      preheader: 'Share a binder with other collectors and earn XP.',
      heading: 'Show off your vault',
      paragraphs: [
        'Hey collector,',
        'You have put real work into your binders. Other collectors would love to see them.',
        'Share a binder link and earn XP when you do.',
      ],
      ctaLabel: 'Share Your Binder',
      ctaUrl: `${APP_URL}/pc-binders`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      sql`EXISTS (SELECT 1 FROM pc_binders pb WHERE pb.user_id = ${users.id})`,
      sql`NOT EXISTS (SELECT 1 FROM pc_binder_share_links psl JOIN pc_binders pb2 ON pb2.id = psl.binder_id WHERE pb2.user_id = ${users.id})`,
      notAlreadySent('lifecycle-share-binder'),
    )),
    eligibilityNote: 'Has a PC Binder, has never shared one.',
  },
  {
    key: 'wishlist-nudge',
    jobName: 'lifecycle-wishlist-nudge',
    stage: 'Engagement',
    active: false,
    subject: 'What are you chasing next?',
    preheader: 'Add cards to your wishlist so your next target is easy to track.',
    ctaLabel: 'Build Your Chase List',
    ctaUrl: `${APP_URL}/wishlist`,
    render: () => lifecycleTemplate({
      preheader: 'Add cards to your wishlist so your next target is easy to track.',
      heading: 'What are you chasing next?',
      paragraphs: [
        'Hey collector,',
        'Every collector has a chase. Add the cards you are hunting to your wishlist so your next target is always one tap away.',
      ],
      ctaLabel: 'Build Your Chase List',
      ctaUrl: `${APP_URL}/wishlist`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      HAS_CARDS,
      sql`NOT EXISTS (SELECT 1 FROM user_wishlists uw WHERE uw.user_id = ${users.id})`,
      notAlreadySent('lifecycle-wishlist-nudge'),
    )),
    eligibilityNote: 'Has cards, empty wishlist.',
  },
  {
    key: 'reactivation',
    jobName: 'lifecycle-reactivation',
    stage: 'Retention',
    active: false,
    subject: 'Your vault has been waiting',
    preheader: 'New cards, images, and progress are ready when you are.',
    ctaLabel: 'Return to Your Vault',
    ctaUrl: APP_URL,
    render: () => lifecycleTemplate({
      preheader: 'New cards, images, and progress are ready when you are.',
      heading: 'Your vault has been waiting',
      paragraphs: [
        'Hey collector,',
        'It has been a while since your last visit, and the vault has kept growing: new sets, new images, and new collectors.',
        'Your collection is right where you left it. Come see what is new.',
      ],
      ctaLabel: 'Return to Your Vault',
      ctaUrl: APP_URL,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      HAS_CARDS,
      sql`${users.lastLogin} IS NOT NULL AND ${users.lastLogin} <= now() - interval '30 days'`,
      notAlreadySent('lifecycle-reactivation'),
    )),
    eligibilityNote: 'Inactive 30+ days with prior collection activity.',
  },
  {
    key: 'new-set-announcement',
    jobName: 'lifecycle-new-set-announcement',
    stage: 'Retention',
    active: false,
    subject: 'New cards added: [Set Name]',
    preheader: 'Browse the newest cards added to Marvel Card Vault.',
    ctaLabel: 'View New Set',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      preheader: 'Browse the newest cards added to Marvel Card Vault.',
      heading: 'New cards added: [Set Name]',
      paragraphs: [
        'Hey collector,',
        '[Set Name] just landed in the vault: [card count] cards ready to browse, track, and chase.',
        'This goes to collectors of related sets and brands, not the whole user base.',
      ],
      ctaLabel: 'View New Set',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => 0, // requires a specific set to target — computed per-campaign
    eligibilityNote: 'Per-set campaign: users who collect/viewed the related set/year/brand. Audience computed when a real set is chosen.',
  },
  {
    key: 'image-approved-xp',
    jobName: 'lifecycle-image-approved-xp',
    stage: 'Contribution',
    active: false,
    subject: 'Your image was approved',
    preheader: 'Thanks for helping complete the vault. XP has been added to your account.',
    ctaLabel: 'View Your Contribution',
    ctaUrl: `${APP_URL}/my-collection`,
    render: () => lifecycleTemplate({
      preheader: 'Thanks for helping complete the vault. XP has been added to your account.',
      heading: 'Your image was approved',
      paragraphs: [
        'Hey collector,',
        'Your card image was approved and is now live in the vault. Collector XP has been added to your account.',
        'Thanks for helping complete the vault for every collector who owns that card.',
      ],
      ctaLabel: 'View Your Contribution',
      ctaUrl: `${APP_URL}/my-collection`,
    }),
    // NOTE: an image-approved email already exists as a TRANSACTIONAL
    // notification (cardImageApprovedTemplate). This draft is a richer XP
    // variant; do not enable both or users get two emails per approval.
    eligibleCount: async () => 0, // event-triggered on approval
    eligibilityNote: 'Event-triggered on image approval. A transactional approval email already exists — replace it, do not double-send.',
  },
];

function notAlreadySent(jobName: string) {
  return sql`NOT EXISTS (SELECT 1 FROM email_logs el WHERE el.job_name = ${jobName} AND lower(trim(el.email)) = lower(trim(${users.email})))`;
}

export function getLifecycleEmail(key: string): LifecycleEmailDef | undefined {
  return LIFECYCLE_EMAILS.find(e => e.key === key);
}

// ---------------------------------------------------------------------------
// 14-day global frequency cap
// ---------------------------------------------------------------------------

/**
 * SQL fragment (against the users table) that is TRUE when the user has NOT
 * received any lifecycle/marketing email in the last LIFECYCLE_CAP_DAYS days.
 * Counts every 'lifecycle-%' and 'campaign-%' job EXCEPT the cap-exempt
 * welcome email and admin '-test' sends. Transactional emails have no
 * job_name in these namespaces, so they never count against the cap.
 */
const UNDER_CAP = sql`NOT EXISTS (
  SELECT 1 FROM email_logs el
  WHERE lower(trim(el.email)) = lower(trim(${users.email}))
    AND el.sent_at > now() - make_interval(days => ${LIFECYCLE_CAP_DAYS})
    AND (el.job_name LIKE 'lifecycle-%' OR el.job_name LIKE 'campaign-%')
    AND el.job_name <> 'lifecycle-welcome'
    AND el.job_name NOT LIKE '%-test'
)`;

/** Standalone cap check for a single email address (same rules as UNDER_CAP). */
export async function isUnderLifecycleCap(email: string): Promise<boolean> {
  const row = await db.execute(sql`
    SELECT 1 FROM email_logs el
    WHERE lower(trim(el.email)) = lower(trim(${email}))
      AND el.sent_at > now() - make_interval(days => ${LIFECYCLE_CAP_DAYS})
      AND (el.job_name LIKE 'lifecycle-%' OR el.job_name LIKE 'campaign-%')
      AND el.job_name <> 'lifecycle-welcome'
      AND el.job_name NOT LIKE '%-test'
    LIMIT 1
  `);
  return (row as any).rows ? (row as any).rows.length === 0 : (row as any).length === 0;
}

// ---------------------------------------------------------------------------
// Claim-then-send: duplicate-proof at the database level.
// A partial unique index on email_logs (job_name, lower(trim(email)))
// WHERE job_name LIKE 'lifecycle-%' backs this: we INSERT a 'sending' claim
// row FIRST (ON CONFLICT DO NOTHING — a concurrent/repeat attempt gets zero
// rows and skips), then send, then update the claim to 'sent' or 'failed'.
// A failed send is fail-closed: the claim row stays, so the user is never
// auto-retried into a possible double-send. Admin sees failures in status.
// ---------------------------------------------------------------------------

async function claimAndSend(
  def: LifecycleEmailDef,
  user: { id: number; email: string; displayName?: string | null }
): Promise<'sent' | 'failed' | 'skipped'> {
  // Re-check opt-in at send time (welcome is the account-creation exception).
  if (def.key !== 'welcome') {
    const u = await db.select({ optIn: users.marketingOptIn }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!u[0]?.optIn) return 'skipped';
  }

  // Atomic claim — the unique index guarantees at most one row per (job, email).
  const claim: any = await db.execute(sql`
    INSERT INTO email_logs (user_id, email, template, subject, job_name, status, lifecycle_stage)
    VALUES (${user.id}, ${user.email}, ${def.jobName}, ${def.subject}, ${def.jobName}, 'sending', ${def.stage})
    ON CONFLICT (job_name, lower(trim(email))) WHERE job_name LIKE 'lifecycle-%' AND job_name NOT LIKE '%-test'
    DO NOTHING
    RETURNING id
  `);
  const rows = claim.rows ?? claim;
  if (!rows || rows.length === 0) return 'skipped'; // already claimed/sent

  const claimId = rows[0].id;
  try {
    const { html, text } = def.render({ displayName: user.displayName });
    const messageId = await sendResendEmail({
      to: user.email,
      subject: def.subject,
      html,
      text,
      template: def.jobName,
      jobName: def.jobName,
      skipLog: true, // we own the log row
    });
    await db.execute(sql`
      UPDATE email_logs SET status = 'sent', provider_message_id = ${messageId || null}, sent_at = now()
      WHERE id = ${claimId}
    `);
    return 'sent';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute(sql`
      UPDATE email_logs SET status = 'failed', error = ${msg.slice(0, 500)}
      WHERE id = ${claimId}
    `).catch(e => console.error('[Lifecycle] Failed to record send failure:', e));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Welcome email (event-triggered from onboarding completion)
// ---------------------------------------------------------------------------

/**
 * Send the lifecycle welcome email to a NEW signup. Called fire-and-forget
 * from the onboarding-completion route; it must NEVER throw into the signup
 * flow. Guards: launch-date (no retroactive sends) + email_logs dedupe
 * (never sends twice). Exempt from the 14-day cap by design.
 */
export async function sendLifecycleWelcome(user: {
  id: number;
  email: string;
  createdAt: Date | string;
}): Promise<void> {
  const def = getLifecycleEmail('welcome')!;
  try {
    if (!user.email) return;
    const created = new Date(user.createdAt);
    if (created < LIFECYCLE_LAUNCH_DATE) {
      console.log(`[Lifecycle] Skipping welcome for pre-launch user ${user.id} (created ${created.toISOString()})`);
      return;
    }
    const result = await claimAndSend(def, { id: user.id, email: user.email });
    console.log(`[Lifecycle] Welcome email for user ${user.id}: ${result}`);
  } catch (error) {
    // Never let email failure affect signup.
    console.error(`[Lifecycle] Failed to send welcome email to user ${user.id}:`, error);
  }
}

// ---------------------------------------------------------------------------
// 24-hour first-card nudge (hourly cron)
// ---------------------------------------------------------------------------

let nudgeRunning = false; // single-flight guard
let nudgeLastRun: { at: Date; sent: number; failed: number; eligible: number } | null = null;

async function getFirstCardNudgeRecipients(limit: number) {
  const def = getLifecycleEmail('first-card-nudge')!;
  return db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(
      optedIn(),
      sql`${users.createdAt} >= ${LIFECYCLE_LAUNCH_DATE}`,          // never retroactive
      sql`${users.createdAt} <= now() - interval '24 hours'`,       // at least 24h old
      ZERO_CARDS,                                                    // zero cards
      notAlreadySent(def.jobName),                                   // never twice
      UNDER_CAP,                                                     // 14-day global cap
    ))
    .orderBy(users.createdAt)
    .limit(limit);
}

export async function runFirstCardNudgeNow(
  limit: number = NUDGE_BATCH_LIMIT
): Promise<{ sent: number; failed: number; eligible: number; skipped?: boolean }> {
  if (nudgeRunning) {
    console.warn('[Lifecycle] First-card nudge already running — skipping this trigger');
    return { sent: 0, failed: 0, eligible: 0, skipped: true };
  }
  nudgeRunning = true;
  try {
    const def = getLifecycleEmail('first-card-nudge')!;
    const batch = await getFirstCardNudgeRecipients(limit);
    if (batch.length === 0) {
      nudgeLastRun = { at: new Date(), sent: 0, failed: 0, eligible: 0 };
      return { sent: 0, failed: 0, eligible: 0 };
    }
    let sent = 0;
    let failed = 0;
    console.log(`[Lifecycle] First-card nudge: ${batch.length} eligible this run`);
    for (const u of batch) {
      const result = await claimAndSend(def, u);
      if (result === 'sent') {
        sent++;
        await new Promise(r => setTimeout(r, 500)); // respect Resend rate limit
      } else if (result === 'failed') {
        failed++;
        console.error(`[Lifecycle] First-card nudge failed for user ${u.id} (see email_logs)`);
      }
    }
    nudgeLastRun = { at: new Date(), sent, failed, eligible: batch.length };
    return { sent, failed, eligible: batch.length };
  } finally {
    nudgeRunning = false;
  }
}

const firstCardNudgeJob = new CronJob(
  '15 * * * *', // hourly at :15 — nudges land close to the 24h mark
  async () => {
    try {
      if (!process.env.RESEND_API_KEY) return;
      const r = await runFirstCardNudgeNow();
      if (r.eligible > 0) {
        console.log(`[Lifecycle] First-card nudge run: ${r.sent} sent, ${r.failed} failed`);
      }
    } catch (error) {
      console.error('[Lifecycle] Error in first-card nudge cron:', error);
    }
  },
  null,
  false,
  'America/Chicago'
);

let lifecycleCronStarted = false;

/**
 * Start the lifecycle cron jobs (currently: hourly first-card nudge only).
 * Wired directly at server startup, independent of EMAIL_CRON_ENABLED —
 * this system is behavior-triggered and self-limiting, not a blast scheduler.
 * Safe to call more than once.
 */
export function startLifecycleEmailCron(): void {
  if (lifecycleCronStarted) return;
  lifecycleCronStarted = true;
  firstCardNudgeJob.start();
  console.log('📧 Lifecycle email cron started (hourly first-card nudge; welcome is event-triggered; all other journeys DRAFT/disabled)');
}

// ---------------------------------------------------------------------------
// Admin status
// ---------------------------------------------------------------------------

export async function getLifecycleStatus() {
  const emails = await Promise.all(
    LIFECYCLE_EMAILS.map(async (e) => {
      let eligibleNow: number | null = null;
      try {
        eligibleNow = await e.eligibleCount();
      } catch (err) {
        console.error(`[Lifecycle] Failed to count eligibility for ${e.key}:`, err);
      }
      return {
        key: e.key,
        jobName: e.jobName,
        stage: e.stage,
        active: e.active,
        exemptFromCap: !!e.exemptFromCap,
        subject: e.subject,
        ctaLabel: e.ctaLabel,
        eligibleNow,
        eligibilityNote: e.eligibilityNote,
      };
    })
  );
  const sentRows = await db
    .select({ jobName: emailLogs.jobName, count: sql<number>`count(*)` })
    .from(emailLogs)
    .where(sql`${emailLogs.jobName} LIKE 'lifecycle-%'`)
    .groupBy(emailLogs.jobName);
  return {
    capDays: LIFECYCLE_CAP_DAYS,
    launchDate: LIFECYCLE_LAUNCH_DATE.toISOString(),
    nudgeCronRunning: firstCardNudgeJob.running || false,
    nudgeLastRun,
    totalsSent: Object.fromEntries(sentRows.map(r => [r.jobName || 'unknown', Number(r.count)])),
    emails,
  };
}
