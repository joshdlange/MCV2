/**
 * Lifecycle Email System v1 — Marvel Card Vault
 * ---------------------------------------------
 * Journey-based lifecycle emails driven by user behavior, per
 * .agents/skills/mcv-lifecycle-marketing/SKILL.md.
 *
 * ACTIVE now:
 *   - lifecycle-welcome              (sent at onboarding completion, new signups only)
 *   - lifecycle-first-card-nudge     (hourly cron; 24h after signup, zero cards)
 *   - lifecycle-empty-vault          (v2; hourly cron; onboarded 7+ days, zero cards, post-v1-launch signups only)
 *   - lifecycle-collection-momentum  (v2; hourly cron; 1-9 cards, stalled 7+ days, stall began after v2 launch)
 *
 * DRAFT (templates + eligibility counts only, active:false — flip one at a
 * time AFTER admin preview/test, never all at once):
 *   - all remaining journey emails defined in LIFECYCLE_EMAILS below,
 *     including the v3 set (payment-failed, subscription-cancelled,
 *     near-limit-500, tightened pc-binder-prompt/upgrade, missing-image,
 *     share-binder). The two billing emails are event-wired to the Stripe
 *     webhook but stay silent until their active flag is flipped.
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
import { db, pool } from '../db';
import { users, userCollections, userWishlists, pcBinders, pcBinderShareLinks, emailLogs, cards } from '../../shared/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { sendResendEmail } from '../services/emailService';

// Users created before this date never receive the welcome/nudge sequence.
// Set to the date this system shipped — do not move it backwards.
export const LIFECYCLE_LAUNCH_DATE = new Date('2026-08-08T00:00:00Z');

// v2 journeys (empty-vault follow-up, collection momentum) launched this date.
// Prevents retroactive blasts: momentum only fires for stalls that BEGIN after
// this date (last card add >= v2 launch); empty-vault only targets post-v1-launch
// signups (who received welcome/nudge). Do not move backwards.
export const LIFECYCLE_V2_LAUNCH_DATE = new Date('2026-08-10T00:00:00Z');

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
// Reusable MCV-branded hero images (v3). Emails render perfectly WITHOUT them:
// a null url means "no hero yet" and the template simply skips the image row.
// To activate a hero, upload the optimized image (600px wide, <150KB, PNG/JPG,
// original MCV art only — NO Marvel/Disney/Topps/Upper Deck characters, logos,
// or real card art) to Cloudinary under marvel-card-vault/email/<key> and put
// the delivery URL here. Never place critical info or promo codes only in
// images.
// ---------------------------------------------------------------------------

export type HeroImageKey =
  | 'email-vault-starter'
  | 'email-keep-building'
  | 'email-super-hero-upgrade'
  | 'email-pc-binder'
  | 'email-complete-the-vault'
  | 'email-comeback'
  | 'email-offer-pass'
  | 'email-collector-network';

export const HERO_IMAGES: Record<HeroImageKey, { url: string | null; alt: string }> = {
  'email-vault-starter':     { url: null, alt: 'A glowing collector vault opening with trading card silhouettes.' },
  'email-keep-building':     { url: null, alt: 'A stack of trading cards flowing into a collector binder.' },
  'email-super-hero-upgrade':{ url: null, alt: 'A premium vault interface with glowing card slots.' },
  'email-pc-binder':         { url: null, alt: 'A custom collector binder with organized card sections.' },
  'email-complete-the-vault':{ url: null, alt: 'A missing card image being filled with light.' },
  'email-comeback':          { url: null, alt: 'A dark collector vault lighting back up.' },
  'email-offer-pass':        { url: null, alt: 'A premium vault access pass.' },
  'email-collector-network': { url: null, alt: 'Collector avatars connected around shared card binders.' },
};

// ---------------------------------------------------------------------------
// Shared lifecycle template (dark theme + unsubscribe + non-affiliation footer)
// ---------------------------------------------------------------------------

function lifecycleTemplate(opts: {
  preheader: string;
  heading: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  /** Optional promo/coupon code rendered in a highlighted box above the CTA. */
  codeBlock?: { code: string; note: string };
  /** Optional small-print line rendered directly under the CTA button. */
  footnote?: string;
  /** Optional reusable hero image category. Skipped if no asset uploaded yet. */
  heroKey?: HeroImageKey;
}): { html: string; text: string } {
  const hero = opts.heroKey ? HERO_IMAGES[opts.heroKey] : null;
  const heroHtml = hero?.url
    ? `<tr><td style="padding:0;"><img src="${hero.url}" alt="${hero.alt}" width="600" style="width:100%;max-width:600px;height:auto;display:block;"></td></tr>`
    : '';
  const paragraphsHtml = opts.paragraphs
    .map(p => `<p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY};">${p}</p>`)
    .join('\n');
  const codeBlockHtml = opts.codeBlock ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="padding:4px 0 8px;">
            <div style="border:2px dashed ${BRAND_RED};border-radius:10px;background-color:${DARK_BG};padding:20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${TEXT_SECONDARY};">Your code</p>
              <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:4px;color:${TEXT_PRIMARY};font-family:'Courier New',Courier,monospace;">${opts.codeBlock.code}</p>
              <p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${TEXT_SECONDARY};">${opts.codeBlock.note}</p>
            </div>
          </td></tr></table>` : '';
  const footnoteHtml = opts.footnote
    ? `<p style="margin:0;font-size:12px;line-height:1.5;color:${TEXT_SECONDARY};text-align:center;">${opts.footnote}</p>`
    : '';
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
        ${heroHtml}
        <tr><td style="padding:20px 40px 40px;">
          <h1 style="margin:0 0 20px;font-size:28px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.2;">${opts.heading}</h1>
          ${paragraphsHtml}${codeBlockHtml}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="text-align:center;padding:20px 0 10px;">
            <a href="${opts.ctaUrl}" style="display:inline-block;padding:16px 32px;background-color:${BRAND_RED};color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">${opts.ctaLabel}</a>
          </td></tr></table>
          ${footnoteHtml}
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
    ...(opts.codeBlock ? ['', `Your code: ${opts.codeBlock.code}`, opts.codeBlock.note] : []),
    '',
    `${opts.ctaLabel}: ${opts.ctaUrl}`,
    ...(opts.footnote ? [opts.footnote] : []),
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
  exemptFromCap?: boolean;    // welcome + transactional/account-status emails
  /** Transactional/billing-critical: exempt from the 14-day marketing cap,
   *  event-triggered only, never batch-run. */
  transactional?: boolean;
  /** Reusable hero image category this email renders (if asset uploaded). */
  heroKey?: HeroImageKey;
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
    heroKey: 'email-vault-starter',
    jobName: 'lifecycle-welcome',
    stage: 'Activation',
    active: true,
    exemptFromCap: true,
    subject: 'Welcome to Marvel Card Vault',
    preheader: 'Your vault is ready. Start building your collection and earning XP.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-vault-starter',
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
    heroKey: 'email-vault-starter',
    jobName: 'lifecycle-first-card-nudge',
    stage: 'Activation',
    active: true,
    subject: 'Your vault is waiting',
    preheader: 'Add your first card and start earning Collector XP.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-vault-starter',
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

  // ---------------------- v2 ACTIVE journeys -------------------------------
  {
    key: 'empty-vault',
    heroKey: 'email-vault-starter',
    jobName: 'lifecycle-empty-vault',
    stage: 'Activation',
    active: true,
    subject: "Still empty? Let's fix that",
    preheader: 'Add one card and bring your vault to life.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-vault-starter',
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
    eligibleCount: async () => countUsers(EMPTY_VAULT_WHERE()),
    eligibilityNote: 'Onboarded, zero cards, account 7+ days old, created after v1 launch (received welcome/nudge era — never retroactive), opted in, not already sent, under 14-day cap.',
  },
  {
    key: 'collection-momentum',
    heroKey: 'email-keep-building',
    jobName: 'lifecycle-collection-momentum',
    stage: 'Engagement',
    active: true,
    subject: 'Your collection is off to a good start',
    preheader: 'Add a few more cards and keep your vault moving.',
    ctaLabel: 'Add More Cards',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-keep-building',
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
    eligibleCount: async () => countUsers(COLLECTION_MOMENTUM_WHERE()),
    eligibilityNote: '1-9 cards, no card added in 7+ days, most recent add AFTER v2 launch (stall began post-launch — never retroactive), opted in, not already sent, under 14-day cap.',
  },

  // ---------------------- v3 REVENUE / UPGRADE (all DRAFT) -----------------
  {
    key: 'payment-failed',
    jobName: 'lifecycle-payment-failed', // registry/preview identity; real sends log under billing-payment-failed (per-invoice dedupe)
    stage: 'Upgrade',
    active: false,
    exemptFromCap: true,
    transactional: true,
    subject: 'Action needed: keep your Super Hero access',
    preheader: 'There was an issue with your payment. Update billing to keep your vault upgraded.',
    ctaLabel: 'Update Billing',
    ctaUrl: `${APP_URL}/profile`,
    render: () => lifecycleTemplate({
      preheader: 'There was an issue with your payment. Update billing to keep your vault upgraded.',
      heading: 'Action needed: keep your Super Hero access',
      paragraphs: [
        'Hey collector,',
        'There was an issue processing your latest Super Hero payment.',
        'No stress: updating your billing info takes about a minute and keeps your unlimited cards, PC Binders, Market Trends, and Scan to Add active without interruption.',
      ],
      ctaLabel: 'Update Billing',
      ctaUrl: `${APP_URL}/profile`,
      footnote: 'Manage billing any time from your account settings.',
    }),
    eligibleCount: async () => 0, // event-triggered by Stripe invoice.payment_failed — never batch-sent
    eligibilityNote: 'TRANSACTIONAL, event-triggered by Stripe invoice.payment_failed (subscription invoices only). Deduped per invoice, exempt from the 14-day cap, ignores marketing opt-out (billing critical). Sends only when active flag is on AND in production.',
  },
  {
    key: 'subscription-cancelled',
    jobName: 'lifecycle-subscription-cancelled',
    stage: 'Upgrade',
    active: false,
    exemptFromCap: true, // account-status email tied to a billing event
    heroKey: 'email-comeback',
    subject: 'Your Super Hero access has ended',
    preheader: 'You can come back anytime and keep building without limits.',
    ctaLabel: 'Restart Super Hero',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      preheader: 'You can come back anytime and keep building without limits.',
      heading: 'Your Super Hero access has ended',
      paragraphs: [
        'Hey collector,',
        'Your Super Hero subscription has ended. Your vault and every card in it are safe and exactly where you left them.',
        'When you are ready to keep building without limits, Super Hero is one tap away: unlimited cards, PC Binders, Market Trends, Scan to Add, and the full collector toolkit.',
      ],
      heroKey: 'email-comeback',
      ctaLabel: 'Restart Super Hero',
      ctaUrl: `${APP_URL}/subscribe`,
    }),
    eligibleCount: async () => countUsers(and(
      optedIn(),
      NOT_SUPER_HERO,
      eq(users.subscriptionStatus, 'cancelled'),
      notAlreadySent('lifecycle-subscription-cancelled'),
    )),
    eligibilityNote: 'Event-triggered by Stripe customer.subscription.deleted (cancellations AFTER activation only — never retroactive to the existing cancelled backlog). Respects marketing opt-in, once per user. Count shown = historical cancelled users for reference; they are NOT auto-emailed.',
  },
  {
    key: 'near-limit-500',
    jobName: 'lifecycle-near-limit-500',
    stage: 'Upgrade',
    active: false,
    heroKey: 'email-super-hero-upgrade',
    subject: "You're building fast",
    preheader: "You're getting close to the Side Kick card limit. Super Hero gives you unlimited space.",
    ctaLabel: 'Upgrade to Super Hero',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      preheader: "You're getting close to the Side Kick card limit. Super Hero gives you unlimited space.",
      heading: "You're building fast",
      paragraphs: [
        'Hey collector,',
        'Your vault is growing fast: you are closing in on the Side Kick 500-card limit.',
        'Super Hero removes the ceiling entirely: unlimited cards, plus PC Binders, Market Trends, Scan to Add, and more room to keep building the collection your way.',
      ],
      heroKey: 'email-super-hero-upgrade',
      ctaLabel: 'Upgrade to Super Hero',
      ctaUrl: `${APP_URL}/subscribe`,
    }),
    eligibleCount: async () => countUsers(NEAR_LIMIT_500_WHERE()),
    eligibilityNote: 'Side Kick (not Super Hero), 400+ cards (80% of the 500 limit), opted in, not already sent, under 14-day cap. High-intent upgrade audience — the existing 400+ backlog IS the target once activated (once per user, 50/batch).',
  },

  // ------------------------- DRAFTS (disabled) -----------------------------
  {
    key: 'pc-binder-prompt',
    heroKey: 'email-pc-binder',
    jobName: 'lifecycle-pc-binder-prompt',
    stage: 'Engagement',
    active: false,
    subject: 'Build a binder around your favorites',
    preheader: 'Create a custom PC Binder for a character, artist, set, or chase list.',
    ctaLabel: 'Create a PC Binder',
    ctaUrl: `${APP_URL}/pc-binders`,
    render: () => lifecycleTemplate({
      heroKey: 'email-pc-binder',
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
    eligibleCount: async () => countUsers(PC_BINDER_PROMPT_WHERE()),
    eligibilityNote: 'Super Hero plan, 10+ cards, has never created a PC Binder, opted in, not already sent, under 14-day cap.',
  },
  {
    key: 'pc-binder-upgrade',
    heroKey: 'email-pc-binder',
    jobName: 'lifecycle-pc-binder-upgrade',
    stage: 'Upgrade',
    active: false,
    subject: 'PC Binders are waiting',
    preheader: 'Upgrade to Super Hero to build custom binders around the cards you care about most.',
    ctaLabel: 'Unlock PC Binders',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      heroKey: 'email-pc-binder',
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
    // v3: real intent signal — the PC Binders page fires an
    // upgrade_modal_shown analytics event with trigger='pc_binders' when a
    // free/Side Kick user hits the gate.
    eligibleCount: async () => countUsers(PC_BINDER_UPGRADE_WHERE()),
    eligibilityNote: 'Free/Side Kick who HIT THE PC BINDER GATE (upgrade_modal_shown with trigger=pc_binders), opted in, not already sent, under 14-day cap.',
  },
  {
    key: 'missing-image',
    heroKey: 'email-complete-the-vault',
    jobName: 'lifecycle-missing-image',
    stage: 'Contribution',
    active: false,
    subject: 'Help complete the vault',
    preheader: 'Some of your cards are missing images. Upload one and earn XP after approval.',
    ctaLabel: 'Upload an Image',
    ctaUrl: `${APP_URL}/my-collection`,
    render: () => lifecycleTemplate({
      heroKey: 'email-complete-the-vault',
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
    eligibleCount: async () => countUsers(MISSING_IMAGE_WHERE()),
    eligibilityNote: 'Owns a card missing its vault image, no image submitted in the last 30 days, opted in, not already sent, under 14-day cap.',
  },
  {
    key: 'share-binder',
    heroKey: 'email-collector-network',
    jobName: 'lifecycle-share-binder',
    stage: 'Referral/sharing',
    active: false,
    subject: 'Show off your vault',
    preheader: 'Share a binder with other collectors and earn XP.',
    ctaLabel: 'Share Your Binder',
    ctaUrl: `${APP_URL}/pc-binders`,
    render: () => lifecycleTemplate({
      heroKey: 'email-collector-network',
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
    eligibleCount: async () => countUsers(SHARE_BINDER_WHERE()),
    eligibilityNote: 'Has a PC Binder, has never shared one, opted in, not already sent, under 14-day cap.',
  },
  {
    key: 'wishlist-nudge',
    heroKey: 'email-keep-building',
    jobName: 'lifecycle-wishlist-nudge',
    stage: 'Engagement',
    active: false,
    subject: 'What are you chasing next?',
    preheader: 'Add cards to your wishlist so your next target is easy to track.',
    ctaLabel: 'Build Your Chase List',
    ctaUrl: `${APP_URL}/wishlist`,
    render: () => lifecycleTemplate({
      heroKey: 'email-keep-building',
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
    heroKey: 'email-comeback',
    jobName: 'lifecycle-reactivation',
    stage: 'Retention',
    active: false,
    subject: 'Your vault has been waiting',
    preheader: 'New cards, images, and progress are ready when you are.',
    ctaLabel: 'Return to Your Vault',
    ctaUrl: APP_URL,
    render: () => lifecycleTemplate({
      heroKey: 'email-comeback',
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
    heroKey: 'email-comeback',
    jobName: 'lifecycle-new-set-announcement',
    stage: 'Retention',
    active: false,
    subject: 'New cards added: [Set Name]',
    preheader: 'Browse the newest cards added to Marvel Card Vault.',
    ctaLabel: 'View New Set',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-comeback',
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
    heroKey: 'email-complete-the-vault',
    jobName: 'lifecycle-image-approved-xp',
    stage: 'Contribution',
    active: false,
    subject: 'Your image was approved',
    preheader: 'Thanks for helping complete the vault. XP has been added to your account.',
    ctaLabel: 'View Your Contribution',
    ctaUrl: `${APP_URL}/my-collection`,
    render: () => lifecycleTemplate({
      heroKey: 'email-complete-the-vault',
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

  // ------------- LONG-TAIL DORMANT / WIN-BACK (all DRAFT, admin-run only) ---
  // These target the EXISTING dormant backlog by design, so they are never
  // cron-run. Sending requires: def flipped active + admin endpoint with typed
  // confirmation + 150/day dormant cap + 50/batch + 14-day cap + once-per-user.
  {
    key: 'dormant-empty-vault',
    heroKey: 'email-vault-starter',
    jobName: 'lifecycle-dormant-empty-vault',
    stage: 'Retention',
    active: false,
    subject: 'Still collecting? Your vault is ready',
    preheader: 'Add one card and bring your Marvel Card Vault to life.',
    ctaLabel: 'Add Your First Card',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-vault-starter',
      preheader: 'Add one card and bring your Marvel Card Vault to life.',
      heading: 'Still collecting? Your vault is ready',
      paragraphs: [
        'Hey collector,',
        'Your vault is still here, but it looks like it never got its first card.',
        'Start small. Add one card, begin tracking your collection, and start earning Collector XP as you build.',
        'No need to organize everything today. Just add one card and get moving.',
      ],
      ctaLabel: 'Add Your First Card',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => countUsers(DORMANT_EMPTY_VAULT_WHERE()),
    eligibilityNote: 'Onboarded, zero cards, inactive 30+ days, opted in, not already sent, under 14-day cap. Targets existing backlog — admin-run only, typed confirmation required.',
  },
  {
    key: 'dormant-started',
    heroKey: 'email-keep-building',
    jobName: 'lifecycle-dormant-started',
    stage: 'Retention',
    active: false,
    subject: 'Pick up where you left off',
    preheader: 'Your vault is started. Keep building from there.',
    ctaLabel: 'Add More Cards',
    ctaUrl: `${APP_URL}/browse`,
    render: () => lifecycleTemplate({
      heroKey: 'email-keep-building',
      preheader: 'Your vault is started. Keep building from there.',
      heading: 'Pick up where you left off',
      paragraphs: [
        'Hey collector,',
        'You already started your vault. Now it is time to keep it moving.',
        'Add a few more cards, build your progress, and make your collection easier to track every time you come back.',
        'Your next card is a good place to restart.',
      ],
      ctaLabel: 'Add More Cards',
      ctaUrl: `${APP_URL}/browse`,
    }),
    eligibleCount: async () => countUsers(DORMANT_STARTED_WHERE()),
    eligibilityNote: '1-9 cards, inactive 30+ days, opted in, not already sent, under 14-day cap. Admin-run only, typed confirmation required.',
  },
  {
    key: 'dormant-engaged',
    heroKey: 'email-comeback',
    jobName: 'lifecycle-dormant-engaged',
    stage: 'Retention',
    active: false,
    subject: 'Your vault has been waiting',
    preheader: 'New progress, images, and collector tools are ready when you are.',
    ctaLabel: 'Return to Your Vault',
    ctaUrl: APP_URL,
    render: () => lifecycleTemplate({
      heroKey: 'email-comeback',
      preheader: 'New progress, images, and collector tools are ready when you are.',
      heading: 'Your vault has been waiting',
      paragraphs: [
        'Hey collector,',
        'Your Marvel Card Vault has been quiet for a bit.',
        'Come back in and keep building your collection. You can add cards, organize favorites, build PC Binders, check your progress, and keep leveling up with Collector XP.',
        'Your vault is ready when you are.',
      ],
      ctaLabel: 'Return to Your Vault',
      ctaUrl: APP_URL,
    }),
    eligibleCount: async () => countUsers(DORMANT_ENGAGED_WHERE()),
    eligibilityNote: '10+ cards, inactive 30+ days, opted in, not already sent, under 14-day cap. Admin-run only, typed confirmation required.',
  },
  {
    key: 'dormant-upgrade',
    heroKey: 'email-super-hero-upgrade',
    jobName: 'lifecycle-dormant-upgrade',
    stage: 'Upgrade',
    active: false,
    subject: 'Build more than a checklist',
    preheader: 'PC Binders, unlimited cards, Market Trends, and more are waiting in Super Hero.',
    ctaLabel: 'Explore Super Hero',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      heroKey: 'email-super-hero-upgrade',
      preheader: 'PC Binders, unlimited cards, Market Trends, and more are waiting in Super Hero.',
      heading: 'Build more than a checklist',
      paragraphs: [
        'Hey collector,',
        'You have already started building your vault. Super Hero gives you more room and more ways to organize the cards that matter most.',
        'Unlock unlimited cards, custom PC Binders, Market Trends, Scan to Add, and more tools built for serious collectors.',
      ],
      ctaLabel: 'Explore Super Hero',
      ctaUrl: `${APP_URL}/subscribe`,
    }),
    eligibleCount: async () => countUsers(DORMANT_UPGRADE_WHERE()),
    eligibilityNote: 'Free/Side Kick, 10+ cards (high intent), inactive 30+ days, opted in, not already sent, under 14-day cap. Admin-run only, typed confirmation required. Overlaps dormant-engaged: the 14-day cap + once-per-user rule sequence them; activate one at a time.',
  },
  {
    key: 'dormant-missing-image',
    heroKey: 'email-complete-the-vault',
    jobName: 'lifecycle-dormant-missing-image',
    stage: 'Contribution',
    active: false,
    subject: 'Help complete the vault',
    preheader: 'Some cards still need images. Upload one and earn XP after approval.',
    ctaLabel: 'Upload an Image',
    ctaUrl: `${APP_URL}/my-collection`,
    render: () => lifecycleTemplate({
      heroKey: 'email-complete-the-vault',
      preheader: 'Some cards still need images. Upload one and earn XP after approval.',
      heading: 'Help complete the vault',
      paragraphs: [
        'Hey collector,',
        'Some cards in the vault still need images, and collectors like you can help complete them.',
        'Upload a missing card image, help improve the vault for everyone, and earn Collector XP once it is approved.',
      ],
      ctaLabel: 'Upload an Image',
      ctaUrl: `${APP_URL}/my-collection`,
    }),
    eligibleCount: async () => countUsers(DORMANT_MISSING_IMAGE_WHERE()),
    eligibilityNote: 'Owns cards missing a front image, inactive 30+ days, opted in, not already sent, under 14-day cap. Admin-run only, typed confirmation required.',
  },
  {
    key: 'winback-90',
    heroKey: 'email-comeback',
    jobName: 'lifecycle-winback-90',
    stage: 'Retention',
    active: false,
    subject: 'A lot has changed in the vault',
    preheader: 'New cards, images, and collector tools have been added since you last visited.',
    ctaLabel: 'See What Is New',
    ctaUrl: APP_URL,
    render: () => lifecycleTemplate({
      heroKey: 'email-comeback',
      preheader: 'New cards, images, and collector tools have been added since you last visited.',
      heading: 'A lot has changed in the vault',
      paragraphs: [
        'Hey collector,',
        'A lot has changed since your last visit.',
        'Marvel Card Vault has added more ways to build, organize, and complete your collection, including better card images, custom PC Binders, Collector XP, and more tools to help your vault feel like yours.',
        'Come back and see what is new.',
      ],
      ctaLabel: 'See What Is New',
      ctaUrl: APP_URL,
    }),
    eligibleCount: async () => countUsers(WINBACK_90_WHERE()),
    eligibilityNote: 'Inactive 90+ days, opted in, not already sent, under 14-day cap. Only activate when there is REAL new product progress to show (new sets/images/features) — update copy per activation. Admin-run only, typed confirmation required.',
  },
  {
    key: 'babycomeback',
    heroKey: 'email-offer-pass',
    jobName: 'lifecycle-babycomeback',
    stage: 'Upgrade',
    active: false,
    subject: 'A little something to welcome you back',
    preheader: 'Use code BABYCOMEBACK for $5 off your first 2 months through web checkout.',
    ctaLabel: 'Redeem on Web',
    ctaUrl: `${APP_URL}/subscribe`,
    render: () => lifecycleTemplate({
      heroKey: 'email-offer-pass',
      preheader: 'Use code BABYCOMEBACK for $5 off your first 2 months through web checkout.',
      heading: 'A little something to welcome you back',
      paragraphs: [
        'Hey collector,',
        'Still building your Marvel card collection?',
        'Your vault is still here, and we would love to have you back.',
        'Use code BABYCOMEBACK for $5 off each of your first 2 months of the Super Hero monthly plan through web checkout:',
      ],
      codeBlock: {
        code: 'BABYCOMEBACK',
        note: 'Enter this code in the promo code field on the web checkout page for $5 off each of your first 2 months of Super Hero monthly.',
      },
      footnote: 'Promo code must be redeemed through web checkout. It is not available through iOS in-app purchase.',
      ctaLabel: 'Redeem on Web',
      ctaUrl: `${APP_URL}/subscribe`,
    }),
    eligibleCount: async () => countUsers(BABYCOMEBACK_WHERE()),
    eligibilityNote: 'LAST-DITCH: Free/Side Kick, inactive 180+ days (or 120+ days AND already got a prior dormant/win-back email), opted in, never sent, under 14-day cap. Web/Stripe checkout only — promo code BABYCOMEBACK confirmed active in Stripe ($5 off each of the first 2 months of Super Hero monthly) with allow_promotion_codes enabled. Admin-run only, typed confirmation required.',
  },
];

function notAlreadySent(jobName: string) {
  return sql`NOT EXISTS (SELECT 1 FROM email_logs el WHERE el.job_name = ${jobName} AND lower(trim(el.email)) = lower(trim(${users.email})))`;
}

// ---------------------------------------------------------------------------
// v2 journey eligibility (shared by eligibleCount, batch runner, admin counts)
// ---------------------------------------------------------------------------

/**
 * Empty Vault Follow-Up: onboarded, zero cards, account 7+ days old.
 * LAUNCH GATE: created after v1 launch (2026-08-08) — these users went through
 * the welcome/first-card-nudge sequence; the pre-launch empty-vault backlog
 * (hundreds of users) is never targeted.
 */
function EMPTY_VAULT_WHERE() {
  return and(
    optedIn(),
    eq(users.onboardingComplete, true),
    ZERO_CARDS,
    sql`${users.createdAt} >= ${LIFECYCLE_LAUNCH_DATE}`,
    sql`${users.createdAt} <= now() - interval '7 days'`,
    notAlreadySent('lifecycle-empty-vault'),
    UNDER_CAP,
  );
}

/**
 * Collection Momentum Nudge: 1-9 cards, stalled 7+ days.
 * LAUNCH GATE: the user's MOST RECENT card add must be on/after the v2 launch
 * date — the stall must begin after launch. Users who stalled months ago are
 * never targeted; first possible send is launch + 7 days.
 */
function COLLECTION_MOMENTUM_WHERE() {
  return and(
    optedIn(),
    sql`(SELECT count(*) FROM user_collections uc WHERE uc.user_id = ${users.id}) BETWEEN 1 AND 9`,
    sql`NOT EXISTS (SELECT 1 FROM user_collections uc WHERE uc.user_id = ${users.id} AND uc.acquired_date > now() - interval '7 days')`,
    sql`EXISTS (SELECT 1 FROM user_collections uc WHERE uc.user_id = ${users.id} AND uc.acquired_date >= ${LIFECYCLE_V2_LAUNCH_DATE})`,
    notAlreadySent('lifecycle-collection-momentum'),
    UNDER_CAP,
  );
}

// ---------------------------------------------------------------------------
// Long-tail dormant / win-back eligibility (all DRAFT — admin-run only)
// ---------------------------------------------------------------------------

// Inactivity = login inactivity (users.last_login), same measure as the
// original reactivation draft. Users with no last_login recorded are excluded.
const INACTIVE_30 = sql`${users.lastLogin} IS NOT NULL AND ${users.lastLogin} <= now() - interval '30 days'`;
const INACTIVE_90 = sql`${users.lastLogin} IS NOT NULL AND ${users.lastLogin} <= now() - interval '90 days'`;
const INACTIVE_120 = sql`${users.lastLogin} IS NOT NULL AND ${users.lastLogin} <= now() - interval '120 days'`;
const INACTIVE_180 = sql`${users.lastLogin} IS NOT NULL AND ${users.lastLogin} <= now() - interval '180 days'`;
const ONE_TO_NINE_CARDS = sql`(SELECT count(*) FROM user_collections uc WHERE uc.user_id = ${users.id}) BETWEEN 1 AND 9`;
const TEN_PLUS_CARDS = sql`(SELECT count(*) FROM user_collections uc WHERE uc.user_id = ${users.id}) >= 10`;
const NOT_SUPER_HERO = sql`${users.plan} <> 'SUPER_HERO'`;
const OWNS_CARD_MISSING_IMAGE = sql`EXISTS (
  SELECT 1 FROM user_collections uc
  JOIN cards c ON c.id = uc.card_id
  WHERE uc.user_id = ${users.id} AND (c.front_image_url IS NULL OR c.front_image_url = '')
)`;

function DORMANT_EMPTY_VAULT_WHERE() {
  return and(optedIn(), eq(users.onboardingComplete, true), ZERO_CARDS, INACTIVE_30,
    notAlreadySent('lifecycle-dormant-empty-vault'), UNDER_CAP);
}
function DORMANT_STARTED_WHERE() {
  return and(optedIn(), ONE_TO_NINE_CARDS, INACTIVE_30,
    notAlreadySent('lifecycle-dormant-started'), UNDER_CAP);
}
function DORMANT_ENGAGED_WHERE() {
  return and(optedIn(), TEN_PLUS_CARDS, INACTIVE_30,
    notAlreadySent('lifecycle-dormant-engaged'), UNDER_CAP);
}
function DORMANT_UPGRADE_WHERE() {
  return and(optedIn(), NOT_SUPER_HERO, TEN_PLUS_CARDS, INACTIVE_30,
    notAlreadySent('lifecycle-dormant-upgrade'), UNDER_CAP);
}
function DORMANT_MISSING_IMAGE_WHERE() {
  return and(optedIn(), OWNS_CARD_MISSING_IMAGE, INACTIVE_30,
    notAlreadySent('lifecycle-dormant-missing-image'), UNDER_CAP);
}
function WINBACK_90_WHERE() {
  return and(optedIn(), INACTIVE_90,
    notAlreadySent('lifecycle-winback-90'), UNDER_CAP);
}
/** Prior dormant/win-back email received (successfully). */
const HAD_PRIOR_WINBACK = sql`EXISTS (
  SELECT 1 FROM email_logs el
  WHERE lower(trim(el.email)) = lower(trim(${users.email}))
    AND el.job_name IN ('lifecycle-dormant-empty-vault','lifecycle-dormant-started','lifecycle-dormant-engaged','lifecycle-dormant-upgrade','lifecycle-dormant-missing-image','lifecycle-winback-90','lifecycle-reactivation')
    AND (el.status IS NULL OR el.status <> 'failed')
)`;
function BABYCOMEBACK_WHERE() {
  return and(
    optedIn(),
    NOT_SUPER_HERO,
    // Last-ditch: very dormant (180d), OR quite dormant (120d) and already
    // worked through at least one earlier win-back email.
    sql`(( ${INACTIVE_180} ) OR (( ${INACTIVE_120} ) AND ${HAD_PRIOR_WINBACK}))`,
    notAlreadySent('lifecycle-babycomeback'),
    UNDER_CAP,
  );
}

// ---------------------------------------------------------------------------
// v3 journey eligibility (product engagement + upgrade nudges — all DRAFT)
// ---------------------------------------------------------------------------

const SIDE_KICK_LIMIT = 500;
const NEAR_LIMIT_THRESHOLD = 400; // 80% of the Side Kick limit

function NEAR_LIMIT_500_WHERE() {
  return and(
    optedIn(),
    NOT_SUPER_HERO,
    sql`(SELECT count(*) FROM user_collections uc WHERE uc.user_id = ${users.id}) >= ${NEAR_LIMIT_THRESHOLD}`,
    notAlreadySent('lifecycle-near-limit-500'),
    UNDER_CAP,
  );
}
function PC_BINDER_PROMPT_WHERE() {
  return and(
    optedIn(),
    eq(users.plan, 'SUPER_HERO'),
    TEN_PLUS_CARDS,
    sql`NOT EXISTS (SELECT 1 FROM pc_binders pb WHERE pb.user_id = ${users.id})`,
    notAlreadySent('lifecycle-pc-binder-prompt'),
    UNDER_CAP,
  );
}
function PC_BINDER_UPGRADE_WHERE() {
  return and(
    optedIn(),
    NOT_SUPER_HERO,
    // Real intent: hit the PC Binder gate (UpgradeModal shown on /pc-binders)
    sql`EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.user_id = ${users.id} AND ae.event_type = 'upgrade_modal_shown' AND ae.trigger = 'pc_binders')`,
    notAlreadySent('lifecycle-pc-binder-upgrade'),
    UNDER_CAP,
  );
}
function MISSING_IMAGE_WHERE() {
  return and(
    optedIn(),
    OWNS_CARD_MISSING_IMAGE,
    // "Has not submitted an image recently" — no pending/approved submission in 30 days
    sql`NOT EXISTS (SELECT 1 FROM pending_card_images pci WHERE pci.user_id = ${users.id} AND pci.created_at > now() - interval '30 days')`,
    notAlreadySent('lifecycle-missing-image'),
    UNDER_CAP,
  );
}
function SHARE_BINDER_WHERE() {
  return and(
    optedIn(),
    sql`EXISTS (SELECT 1 FROM pc_binders pb WHERE pb.user_id = ${users.id})`,
    sql`NOT EXISTS (SELECT 1 FROM pc_binder_share_links psl JOIN pc_binders pb2 ON pb2.id = psl.binder_id WHERE pb2.user_id = ${users.id})`,
    notAlreadySent('lifecycle-share-binder'),
    UNDER_CAP,
  );
}

/**
 * CRON-runnable journeys (key -> eligibility WHERE). Welcome is event-only.
 * Long-tail dormant journeys are deliberately NOT here — they target the
 * existing backlog and may only run via the admin endpoint.
 * v3 journeys below the v2 pair are DRAFT (active:false): the runner refuses
 * inactive defs, so listing them here only makes them runnable AFTER Joshua
 * flips one active post-preview/test.
 */
const BATCH_JOURNEYS: Record<string, () => ReturnType<typeof and>> = {
  'empty-vault': EMPTY_VAULT_WHERE,
  'collection-momentum': COLLECTION_MOMENTUM_WHERE,
  // v3 (draft until individually activated)
  'near-limit-500': NEAR_LIMIT_500_WHERE,
  'pc-binder-prompt': PC_BINDER_PROMPT_WHERE,
  'pc-binder-upgrade': PC_BINDER_UPGRADE_WHERE,
  'missing-image': MISSING_IMAGE_WHERE,
  'share-binder': SHARE_BINDER_WHERE,
};

/** Admin-run-only long-tail journeys. Typed confirmation + 150/day cap. */
const LONGTAIL_JOURNEYS: Record<string, () => ReturnType<typeof and>> = {
  'dormant-empty-vault': DORMANT_EMPTY_VAULT_WHERE,
  'dormant-started': DORMANT_STARTED_WHERE,
  'dormant-engaged': DORMANT_ENGAGED_WHERE,
  'dormant-upgrade': DORMANT_UPGRADE_WHERE,
  'dormant-missing-image': DORMANT_MISSING_IMAGE_WHERE,
  'winback-90': WINBACK_90_WHERE,
  'babycomeback': BABYCOMEBACK_WHERE,
};
export const LONGTAIL_JOURNEY_KEYS = Object.keys(LONGTAIL_JOURNEYS);
const LONGTAIL_JOB_NAMES = LONGTAIL_JOURNEY_KEYS.map(k => `lifecycle-${k}`);
export const DORMANT_DAILY_CAP = 150;
/** Advisory lock key serializing all long-tail win-back runs globally. */
const LONGTAIL_ADVISORY_LOCK_KEY = 913151;

const journeyRunning: Record<string, boolean> = {};
const journeyLastRun: Record<string, { at: Date; sent: number; failed: number; eligible: number }> = {};

/**
 * Run one v2 batch journey now (admin endpoint + hourly cron). Same
 * guarantees as the first-card nudge: claim-then-send dedupe, 14-day cap,
 * launch gates, opt-in recheck at send time, batch limit, single-flight.
 */
export async function runLifecycleJourneyNow(
  key: string,
  limit: number = NUDGE_BATCH_LIMIT,
  opts?: { confirmedByAdmin?: boolean }
): Promise<{ sent: number; failed: number; eligible: number; skipped?: boolean; error?: string }> {
  // HARD GUARD: batch sends only ever run in the production deployment.
  // Dev/workspace can preview, test (admin-only), and see eligible counts,
  // but can never trigger real recipient sends — not even via the admin API.
  if (!process.env.REPLIT_DEPLOYMENT) {
    return { sent: 0, failed: 0, eligible: 0, skipped: true, error: 'Batch lifecycle sends only run in the production deployment' };
  }
  const def = getLifecycleEmail(key);
  const isLongTail = key in LONGTAIL_JOURNEYS;
  const whereFn = BATCH_JOURNEYS[key] || LONGTAIL_JOURNEYS[key];
  if (!def || !whereFn) return { sent: 0, failed: 0, eligible: 0, skipped: true, error: `Not a batch journey: ${key}` };
  if (!def.active) return { sent: 0, failed: 0, eligible: 0, skipped: true, error: `${key} is not active` };
  // Long-tail dormant/win-back journeys target the existing backlog. They are
  // never cron-run and each batch requires explicit typed admin confirmation.
  if (isLongTail && !opts?.confirmedByAdmin) {
    return { sent: 0, failed: 0, eligible: 0, skipped: true, error: `${key} is a dormant win-back journey — it only runs via the admin endpoint with typed confirmation` };
  }
  if (journeyRunning[key]) return { sent: 0, failed: 0, eligible: 0, skipped: true };
  journeyRunning[key] = true;
  // Long-tail runs are serialized GLOBALLY (across all keys AND all server
  // instances) via a session-level Postgres advisory lock held for the whole
  // run. This makes the 150/24h dormant cap concurrency-safe: the cap count
  // happens inside the lock, and claim rows get sent_at=now() immediately, so
  // no two overlapping runs can both see remaining capacity.
  let lockClient: import('pg').PoolClient | null = null;
  try {
    if (isLongTail) {
      lockClient = await pool.connect();
      const lockRes = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LONGTAIL_ADVISORY_LOCK_KEY]);
      if (!lockRes.rows[0]?.ok) {
        return { sent: 0, failed: 0, eligible: 0, skipped: true, error: 'Another dormant win-back run is already in progress — try again shortly.' };
      }
      // Daily dormant cap: max DORMANT_DAILY_CAP win-back emails per rolling
      // 24h across ALL long-tail journeys combined (in addition to 50/batch
      // and the per-user 14-day cap). Counted while holding the global lock.
      const capRes: any = await db.execute(sql`
        SELECT count(*)::int AS c FROM email_logs
        WHERE job_name IN (${sql.join(LONGTAIL_JOB_NAMES.map(n => sql`${n}`), sql`, `)})
          AND sent_at > now() - interval '24 hours'
          AND (status IS NULL OR status <> 'failed')
      `);
      const used = Number((capRes.rows ?? capRes)[0]?.c || 0);
      const remaining = DORMANT_DAILY_CAP - used;
      if (remaining <= 0) {
        return { sent: 0, failed: 0, eligible: 0, skipped: true, error: `Daily dormant win-back cap reached (${DORMANT_DAILY_CAP}/24h). Try again tomorrow.` };
      }
      limit = Math.min(limit, remaining);
    }
    const batch = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(whereFn())
      .orderBy(users.createdAt)
      .limit(limit);
    let sent = 0, failed = 0;
    if (batch.length > 0) console.log(`[Lifecycle] ${key}: ${batch.length} eligible this run`);
    for (const u of batch) {
      const result = await claimAndSend(def, u);
      if (result === 'sent') {
        sent++;
        await new Promise(r => setTimeout(r, 500)); // respect Resend rate limit
      } else if (result === 'failed') {
        failed++;
        console.error(`[Lifecycle] ${key} failed for user ${u.id} (see email_logs)`);
      }
    }
    journeyLastRun[key] = { at: new Date(), sent, failed, eligible: batch.length };
    return { sent, failed, eligible: batch.length };
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LONGTAIL_ADVISORY_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
    journeyRunning[key] = false;
  }
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
    AND (el.status IS NULL OR el.status <> 'failed')
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

  // Atomic claim. Two guarantees inside ONE transaction under a per-email
  // advisory lock (serializes concurrent lifecycle jobs for the same user):
  //   1. per-journey dedupe — the partial unique index on (job_name, email)
  //   2. GLOBAL 14-day cap — rechecked at claim time, so two DIFFERENT
  //      journeys (e.g. nudge cron + admin empty-vault run) can never both
  //      claim the same user inside the cap window.
  // The claim row gets sent_at=now() immediately so it counts against the cap
  // for any concurrent claim the moment it exists; failed sends are excluded
  // from the cap (status='failed') but still block their own journey forever.
  const rows: any[] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(lower(trim(${user.email}))))`);
    if (!def.exemptFromCap) {
      const cap: any = await tx.execute(sql`
        SELECT 1 FROM email_logs el
        WHERE lower(trim(el.email)) = lower(trim(${user.email}))
          AND el.sent_at > now() - make_interval(days => ${LIFECYCLE_CAP_DAYS})
          AND (el.job_name LIKE 'lifecycle-%' OR el.job_name LIKE 'campaign-%')
          AND el.job_name <> 'lifecycle-welcome'
          AND el.job_name NOT LIKE '%-test'
          AND (el.status IS NULL OR el.status <> 'failed')
        LIMIT 1
      `);
      const capRows = cap.rows ?? cap;
      if (capRows && capRows.length > 0) return [];
    }
    const claim: any = await tx.execute(sql`
      INSERT INTO email_logs (user_id, email, template, subject, job_name, status, lifecycle_stage, sent_at)
      VALUES (${user.id}, ${user.email}, ${def.jobName}, ${def.subject}, ${def.jobName}, 'sending', ${def.stage}, now())
      ON CONFLICT (job_name, lower(trim(email))) WHERE job_name LIKE 'lifecycle-%' AND job_name NOT LIKE '%-test'
      DO NOTHING
      RETURNING id
    `);
    return claim.rows ?? claim;
  });
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
    // Production-only: dev/test workspaces must never email real users.
    // Admin-only test sends go through POST /api/admin/lifecycle/test instead.
    if (!process.env.REPLIT_DEPLOYMENT) {
      console.log(`[Lifecycle] Welcome email skipped for user ${user.id}: not production (use the admin test endpoint for previews)`);
      return;
    }
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
  // Same production-only hard guard as the v2 batch journeys.
  if (!process.env.REPLIT_DEPLOYMENT) {
    console.warn('[Lifecycle] First-card nudge blocked: not in production deployment');
    return { sent: 0, failed: 0, eligible: 0, skipped: true };
  }
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
      // v2 active batch journeys (empty-vault, collection-momentum)
      for (const key of Object.keys(BATCH_JOURNEYS)) {
        const jr = await runLifecycleJourneyNow(key);
        if (jr.eligible > 0) {
          console.log(`[Lifecycle] ${key} run: ${jr.sent} sent, ${jr.failed} failed`);
        }
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
  console.log('📧 Lifecycle email cron started (hourly: first-card nudge + empty-vault + collection-momentum; welcome is event-triggered; remaining journeys DRAFT/disabled)');
}

// ---------------------------------------------------------------------------
// v3 event-triggered billing emails (Stripe webhook hooks)
// ---------------------------------------------------------------------------

/**
 * Payment failed (transactional). Triggered by Stripe invoice.payment_failed
 * for SUBSCRIPTION invoices only. Deduped PER INVOICE (a retry of the same
 * invoice never re-emails; a new billing cycle's failure may). Exempt from
 * the 14-day marketing cap and from marketing opt-out — this is billing
 * critical account status. Fire-and-forget: never throws into the webhook.
 * Guards: def.active flag (draft until Joshua approves) + production-only.
 */
export async function sendPaymentFailedEmail(user: {
  id: number; email: string; displayName?: string | null;
}, invoiceId: string): Promise<'sent' | 'failed' | 'skipped'> {
  const def = getLifecycleEmail('payment-failed')!;
  try {
    if (!def.active) return 'skipped';
    if (!process.env.REPLIT_DEPLOYMENT) {
      console.log(`[Lifecycle] payment-failed skipped for user ${user.id}: not production`);
      return 'skipped';
    }
    if (!user.email || !invoiceId) return 'skipped';
    const jobName = 'billing-payment-failed'; // outside lifecycle-% namespace: cap-exempt, no once-per-user index
    const template = `billing-payment-failed:${invoiceId}`;
    // Per-invoice dedupe under a per-email advisory lock.
    const rows: any[] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing:' + user.email.toLowerCase().trim()}))`);
      const dupe: any = await tx.execute(sql`
        SELECT 1 FROM email_logs
        WHERE job_name = ${jobName} AND template = ${template}
          AND lower(trim(email)) = lower(trim(${user.email}))
        LIMIT 1
      `);
      if ((dupe.rows ?? dupe).length > 0) return [];
      const claim: any = await tx.execute(sql`
        INSERT INTO email_logs (user_id, email, template, subject, job_name, status, lifecycle_stage, sent_at)
        VALUES (${user.id}, ${user.email}, ${template}, ${def.subject}, ${jobName}, 'sending', 'Transactional', now())
        RETURNING id
      `);
      return claim.rows ?? claim;
    });
    if (!rows || rows.length === 0) return 'skipped';
    const claimId = rows[0].id;
    try {
      const { html, text } = def.render({ displayName: user.displayName });
      const messageId = await sendResendEmail({
        to: user.email, subject: def.subject, html, text,
        template: jobName, jobName, skipLog: true,
      });
      await db.execute(sql`UPDATE email_logs SET status = 'sent', provider_message_id = ${messageId || null}, sent_at = now() WHERE id = ${claimId}`);
      return 'sent';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.execute(sql`UPDATE email_logs SET status = 'failed', error = ${msg.slice(0, 500)} WHERE id = ${claimId}`).catch(() => {});
      return 'failed';
    }
  } catch (error) {
    console.error(`[Lifecycle] payment-failed email error for user ${user.id}:`, error);
    return 'failed';
  }
}

/**
 * Subscription cancelled / Super Hero expired. Triggered by Stripe
 * customer.subscription.deleted AFTER the downgrade is recorded. Uses
 * claimAndSend: once per user ever, respects marketing opt-in (it carries a
 * win-back CTA), exempt from the 14-day cap (account status). NEVER
 * retroactive: only fires on live cancellation events while active.
 * Guards: def.active flag (draft) + production-only. Fire-and-forget.
 */
export async function sendSubscriptionCancelledEmail(user: {
  id: number; email: string; displayName?: string | null;
}): Promise<'sent' | 'failed' | 'skipped'> {
  const def = getLifecycleEmail('subscription-cancelled')!;
  try {
    if (!def.active) return 'skipped';
    if (!process.env.REPLIT_DEPLOYMENT) {
      console.log(`[Lifecycle] subscription-cancelled skipped for user ${user.id}: not production`);
      return 'skipped';
    }
    if (!user.email) return 'skipped';
    return await claimAndSend(def, user);
  } catch (error) {
    console.error(`[Lifecycle] subscription-cancelled email error for user ${user.id}:`, error);
    return 'failed';
  }
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
        transactional: !!e.transactional,
        heroKey: e.heroKey || null,
        heroUploaded: e.heroKey ? !!HERO_IMAGES[e.heroKey].url : false,
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
    v2LaunchDate: LIFECYCLE_V2_LAUNCH_DATE.toISOString(),
    journeyLastRun,
    totalsSent: Object.fromEntries(sentRows.map(r => [r.jobName || 'unknown', Number(r.count)])),
    emails,
  };
}
