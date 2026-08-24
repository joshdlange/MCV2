import crypto from "node:crypto";
import Stripe from "stripe";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  emailLogs,
  onboardingCompensationGrants,
  users,
} from "../../shared/schema";
import { sendResendEmail } from "./emailService";
import { onboardingRecoveryTemplate } from "./emailTemplates";

export const ONBOARDING_COMPENSATION_CAMPAIGN = "support-onboarding-header-recovery-v1";
export const ONBOARDING_COMPENSATION_SUBJECT = "We fixed your Marvelous Card Vault signup";
export const AFFECTED_ONBOARDING_USER_IDS = [420, 825, 1032, 1110, 1713, 1750, 1779] as const;

const REYNALDO_USER_ID = 1779;
const REYNALDO_PROMOTION_CODE = "REYNALDO3";
const SUPER_HERO_PRICE_ID = "price_1ShZCvHUwjq8stIzSBgrMa10";
const ONE_MONTH_COUPON_ID = "mcv_onboarding_fix_1mo_20260824";

export interface CompensationGrant {
  id: number;
  userId: number;
  email: string;
  displayName: string | null;
  offerMonths: number;
  promotionCode: string;
  status: string;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
}

export interface PromotionDetails {
  couponId: string;
  promotionCodeId: string;
}

export interface CompensationBatchDependencies {
  ensurePromotionCode(grant: CompensationGrant): Promise<PromotionDetails>;
  markCodeReady(grantId: number, promotion: PromotionDetails): Promise<void>;
  claimEmail(grantId: number): Promise<boolean>;
  sendEmail(grant: CompensationGrant): Promise<string | undefined>;
  markSent(grantId: number, providerMessageId?: string): Promise<void>;
  markFailed(grantId: number, error: string, phase: "code" | "email"): Promise<void>;
}

export interface CompensationBatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

export function compensationMonthsForUser(userId: number): number {
  return userId === REYNALDO_USER_ID ? 3 : 1;
}

export function isHeaderUnsafeProfileValue(value?: string | null): boolean {
  if (!value) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0xff) return true;
  }
  return false;
}

export function compensationCodeForUser(userId: number, secret: string): string {
  if (userId === REYNALDO_USER_ID) return REYNALDO_PROMOTION_CODE;
  if (!secret) throw new Error("SESSION_SECRET is required to create compensation codes");
  const suffix = crypto
    .createHmac("sha256", secret)
    .update(`${ONBOARDING_COMPENSATION_CAMPAIGN}:${userId}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `VAULTFIX-${suffix}`;
}

export async function runCompensationBatch(
  grants: CompensationGrant[],
  dependencies: CompensationBatchDependencies,
): Promise<CompensationBatchResult> {
  const result: CompensationBatchResult = { sent: 0, failed: 0, skipped: 0 };

  for (const grant of grants) {
    if (grant.status === "sent") {
      result.skipped++;
      continue;
    }

    try {
      const promotion = await dependencies.ensurePromotionCode(grant);
      await dependencies.markCodeReady(grant.id, promotion);
      const claimed = await dependencies.claimEmail(grant.id);
      if (!claimed) {
        result.skipped++;
        continue;
      }

      try {
        const providerMessageId = await dependencies.sendEmail(grant);
        await dependencies.markSent(grant.id, providerMessageId);
        result.sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await dependencies.markFailed(grant.id, message, "email");
        result.failed++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dependencies.markFailed(grant.id, message, "code");
      result.failed++;
    }
  }

  return result;
}

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required for onboarding compensation");
  }
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function stripeResourceMissing(error: unknown): boolean {
  const candidate = error as { code?: string; statusCode?: number };
  return candidate?.code === "resource_missing" || candidate?.statusCode === 404;
}

function couponIdFromPromotion(promotion: any): string {
  return typeof promotion.coupon === "string"
    ? promotion.coupon
    : promotion.coupon?.id;
}

function assertCouponShape(coupon: any, expectedMonths: number, productId?: string): void {
  if (!coupon || coupon.deleted || coupon.valid === false) {
    throw new Error("Stripe compensation coupon is missing or invalid");
  }
  if (coupon.amount_off !== 500 || coupon.currency !== "usd") {
    throw new Error("Stripe compensation coupon is not the expected $5 discount");
  }
  if (expectedMonths === 1 && coupon.duration !== "once") {
    throw new Error("Stripe one-month compensation coupon must apply once");
  }
  if (
    expectedMonths === 3
    && (coupon.duration !== "repeating" || coupon.duration_in_months !== 3)
  ) {
    throw new Error("Stripe Reynaldo coupon must repeat for three months");
  }
  if (productId && !coupon.applies_to?.products?.some((product: any) => {
    return (typeof product === "string" ? product : product?.id) === productId;
  })) {
    throw new Error("Stripe one-month compensation coupon is not restricted to Super Hero");
  }
}

async function ensureOneMonthCoupon(stripe: Stripe): Promise<any> {
  const price: any = await stripe.prices.retrieve(SUPER_HERO_PRICE_ID);
  const productId = typeof price.product === "string" ? price.product : price.product?.id;
  if (
    price.active !== true
    || price.unit_amount !== 500
    || price.currency !== "usd"
    || price.recurring?.interval !== "month"
    || price.recurring?.interval_count !== 1
    || !productId
  ) {
    throw new Error("Super Hero Stripe price is not the expected active $5 monthly plan");
  }

  let coupon: any;
  try {
    coupon = await stripe.coupons.retrieve(
      ONE_MONTH_COUPON_ID,
      { expand: ["applies_to"] } as any,
    );
  } catch (error) {
    if (!stripeResourceMissing(error)) throw error;
    try {
      coupon = await stripe.coupons.create({
        id: ONE_MONTH_COUPON_ID,
        amount_off: 500,
        currency: "usd",
        duration: "once",
        name: "Onboarding recovery: one month free",
        applies_to: { products: [productId] },
        metadata: {
          campaign: ONBOARDING_COMPENSATION_CAMPAIGN,
          priceId: SUPER_HERO_PRICE_ID,
        },
      } as any, {
        idempotencyKey: `${ONBOARDING_COMPENSATION_CAMPAIGN}-coupon-v2`,
      });
    } catch (createError) {
      // Another production instance may have created the deterministic coupon
      // after our retrieve. Retrieve it rather than creating a second coupon.
      coupon = await stripe.coupons.retrieve(
        ONE_MONTH_COUPON_ID,
        { expand: ["applies_to"] } as any,
      ).catch(() => {
        throw createError;
      });
    }
    // Stripe's applies_to field is expandable and can be omitted from create
    // responses. Retrieve it explicitly before enforcing product scope.
    coupon = await stripe.coupons.retrieve(
      ONE_MONTH_COUPON_ID,
      { expand: ["applies_to"] } as any,
    );
  }

  assertCouponShape(coupon, 1, productId);
  return coupon;
}

export function createPromotionEnsurer(stripe: Stripe) {
  let oneMonthCouponPromise: Promise<any> | null = null;
  const getOneMonthCoupon = () => {
    if (!oneMonthCouponPromise) {
      oneMonthCouponPromise = ensureOneMonthCoupon(stripe).catch((error) => {
        oneMonthCouponPromise = null;
        throw error;
      });
    }
    return oneMonthCouponPromise;
  };

  return async (grant: CompensationGrant): Promise<PromotionDetails> => {
    const existing = await stripe.promotionCodes.list({
      code: grant.promotionCode,
      limit: 10,
    });
    let promotion: any = existing.data.find((candidate: any) => candidate.active);

    if (grant.offerMonths === 3) {
      if (!promotion) throw new Error("Reynaldo's three-month Stripe code is not active");
      const coupon = typeof promotion.coupon === "string"
        ? await stripe.coupons.retrieve(promotion.coupon)
        : promotion.coupon;
      assertCouponShape(coupon, 3);
      if (promotion.max_redemptions !== 1 || promotion.times_redeemed > 0) {
        throw new Error("Reynaldo's three-month Stripe code is no longer unused and one-time");
      }
      return {
        couponId: coupon.id,
        promotionCodeId: promotion.id,
      };
    }

    const coupon = await getOneMonthCoupon();
    if (!promotion) {
      try {
        promotion = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: grant.promotionCode,
          max_redemptions: 1,
          restrictions: { first_time_transaction: true },
          metadata: {
            campaign: ONBOARDING_COMPENSATION_CAMPAIGN,
            userId: String(grant.userId),
          },
        } as any, {
          idempotencyKey: `${ONBOARDING_COMPENSATION_CAMPAIGN}-user-${grant.userId}`,
        });
      } catch (createError) {
        const raced = await stripe.promotionCodes.list({
          code: grant.promotionCode,
          limit: 10,
        });
        promotion = raced.data.find((candidate: any) => candidate.active);
        if (!promotion) throw createError;
      }
    }

    if (
      couponIdFromPromotion(promotion) !== coupon.id
      || promotion.max_redemptions !== 1
      || promotion.restrictions?.first_time_transaction !== true
    ) {
      throw new Error("Stripe compensation promotion code has unexpected restrictions");
    }

    return {
      couponId: coupon.id,
      promotionCodeId: promotion.id,
    };
  };
}

export interface CompensationIndexMetadata {
  index_name: string;
  indisunique: boolean;
  has_predicate: boolean;
  columns: string[];
}

export function compensationIndexesAreValid(rows: CompensationIndexMetadata[]): boolean {
  const byName = new Map(rows.map((row) => [row.index_name, row]));
  const recipient = byName.get("onboarding_comp_grant_user_campaign_idx");
  const code = byName.get("onboarding_comp_grant_promo_code_idx");
  return Boolean(
    recipient?.indisunique
    && recipient.has_predicate === false
    && recipient.columns.join(",") === "user_id,campaign"
    && code?.indisunique
    && code.has_predicate === false
    && code.columns.join(",") === "promotion_code",
  );
}

export async function assertCompensationSchemaReady(): Promise<void> {
  const tableResult: any = await db.execute(sql`
    SELECT to_regclass('public.onboarding_compensation_grants') AS table_name
  `);
  const tableRow = (tableResult.rows ?? tableResult)[0];
  if (!tableRow?.table_name) {
    throw new Error("Onboarding compensation schema has not been applied; no emails were sent");
  }

  const indexResult: any = await db.execute(sql`
    SELECT
      index_class.relname AS index_name,
      index_meta.indisunique,
      index_meta.indpred IS NOT NULL AS has_predicate,
      array_agg(attribute.attname ORDER BY key_column.ordinality) AS columns
    FROM pg_index index_meta
    JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
    JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    JOIN LATERAL unnest(index_meta.indkey)
      WITH ORDINALITY AS key_column(attnum, ordinality) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_class.oid
      AND attribute.attnum = key_column.attnum
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = 'onboarding_compensation_grants'
      AND index_class.relname IN (
        'onboarding_comp_grant_user_campaign_idx',
        'onboarding_comp_grant_promo_code_idx'
      )
    GROUP BY
      index_class.relname,
      index_meta.indisunique,
      index_meta.indpred
  `);
  const indexes = (indexResult.rows ?? indexResult) as CompensationIndexMetadata[];
  if (!compensationIndexesAreValid(indexes)) {
    throw new Error("Onboarding compensation uniqueness indexes are invalid; no emails were sent");
  }
}

async function freezeAffectedCohort(): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for onboarding compensation");

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext(${ONBOARDING_COMPENSATION_CAMPAIGN}))
    `);
    const recipients = await tx
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(inArray(users.id, [...AFFECTED_ONBOARDING_USER_IDS]));

    if (recipients.length !== AFFECTED_ONBOARDING_USER_IDS.length) {
      throw new Error(
        `Expected ${AFFECTED_ONBOARDING_USER_IDS.length} affected accounts but found ${recipients.length}`,
      );
    }
    if (recipients.some((recipient) => !recipient.email?.trim())) {
      throw new Error("An affected onboarding account has no deliverable email address");
    }
    if (recipients.some((recipient) => !isHeaderUnsafeProfileValue(recipient.displayName))) {
      throw new Error("An affected account no longer matches the verified Unicode failure signature");
    }

    for (const recipient of recipients) {
      await tx
        .insert(onboardingCompensationGrants)
        .values({
          userId: recipient.id,
          campaign: ONBOARDING_COMPENSATION_CAMPAIGN,
          offerMonths: compensationMonthsForUser(recipient.id),
          promotionCode: compensationCodeForUser(recipient.id, secret),
        })
        .onConflictDoNothing();
    }
  });
}

async function listOutstandingGrants(): Promise<CompensationGrant[]> {
  const rows = await db
    .select({
      id: onboardingCompensationGrants.id,
      userId: onboardingCompensationGrants.userId,
      email: users.email,
      displayName: users.displayName,
      offerMonths: onboardingCompensationGrants.offerMonths,
      promotionCode: onboardingCompensationGrants.promotionCode,
      status: onboardingCompensationGrants.status,
      stripeCouponId: onboardingCompensationGrants.stripeCouponId,
      stripePromotionCodeId: onboardingCompensationGrants.stripePromotionCodeId,
    })
    .from(onboardingCompensationGrants)
    .innerJoin(users, eq(onboardingCompensationGrants.userId, users.id))
    .where(
      and(
        eq(onboardingCompensationGrants.campaign, ONBOARDING_COMPENSATION_CAMPAIGN),
        inArray(onboardingCompensationGrants.status, ["pending", "code_ready", "code_failed"]),
      ),
    );
  return rows;
}

async function markCodeReady(
  grantId: number,
  promotion: PromotionDetails,
): Promise<void> {
  await db
    .update(onboardingCompensationGrants)
    .set({
      stripeCouponId: promotion.couponId,
      stripePromotionCodeId: promotion.promotionCodeId,
      status: "code_ready",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingCompensationGrants.id, grantId),
        inArray(onboardingCompensationGrants.status, ["pending", "code_ready", "code_failed"]),
      ),
    );
}

async function claimEmail(grantId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(onboardingCompensationGrants)
      .set({
        status: "sending",
        attempts: sql`${onboardingCompensationGrants.attempts} + 1`,
        lastAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(onboardingCompensationGrants.id, grantId),
          eq(onboardingCompensationGrants.status, "code_ready"),
        ),
      )
      .returning({
        id: onboardingCompensationGrants.id,
        userId: onboardingCompensationGrants.userId,
        emailLogId: onboardingCompensationGrants.emailLogId,
      });
    if (!claimed) return false;

    const [recipient] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, claimed.userId))
      .limit(1);
    if (!recipient?.email) throw new Error("Compensation recipient no longer exists");

    if (claimed.emailLogId) {
      await tx
        .update(emailLogs)
        .set({ status: "sending", error: null, sentAt: new Date() })
        .where(eq(emailLogs.id, claimed.emailLogId));
    } else {
      const [log] = await tx
        .insert(emailLogs)
        .values({
          userId: claimed.userId,
          email: recipient.email,
          template: "onboarding-header-recovery",
          subject: ONBOARDING_COMPENSATION_SUBJECT,
          jobName: ONBOARDING_COMPENSATION_CAMPAIGN,
          status: "sending",
          lifecycleStage: "Transactional",
        })
        .returning({ id: emailLogs.id });
      await tx
        .update(onboardingCompensationGrants)
        .set({ emailLogId: log.id })
        .where(eq(onboardingCompensationGrants.id, grantId));
    }
    return true;
  });
}

async function sendRecoveryEmail(grant: CompensationGrant): Promise<string | undefined> {
  const { html, text } = onboardingRecoveryTemplate({
    displayName: grant.displayName,
    promotionCode: grant.promotionCode,
    freeMonths: grant.offerMonths,
  });
  return db.transaction(async (tx) => {
    // Account deletion takes this same lock before staging. Holding it through
    // the provider call establishes a clear ordering: either the recovery email
    // is accepted first, or deletion cancels the grant before any send.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${"user-outbound-email:" + grant.userId})
      )
    `);
    const [active] = await tx
      .select({ id: onboardingCompensationGrants.id })
      .from(onboardingCompensationGrants)
      .innerJoin(users, eq(onboardingCompensationGrants.userId, users.id))
      .where(
        and(
          eq(onboardingCompensationGrants.id, grant.id),
          eq(onboardingCompensationGrants.status, "sending"),
          sql`NOT EXISTS (
            SELECT 1 FROM account_deletion_jobs adj
            WHERE adj.user_id = ${grant.userId}
              AND adj.status <> 'completed'
          )`,
        ),
      )
      .limit(1);
    if (!active) {
      throw new Error("Compensation send cancelled because the account is unavailable");
    }

    return sendResendEmail({
      to: grant.email,
      subject: ONBOARDING_COMPENSATION_SUBJECT,
      html,
      text,
      replyTo: "josh@marvelcardvault.com",
      template: "onboarding-header-recovery",
      jobName: ONBOARDING_COMPENSATION_CAMPAIGN,
      idempotencyKey: `${ONBOARDING_COMPENSATION_CAMPAIGN}-user-${grant.userId}`,
      skipLog: true,
    });
  });
}

async function markSent(grantId: number, providerMessageId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .update(onboardingCompensationGrants)
      .set({
        status: "sent",
        sentAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(onboardingCompensationGrants.id, grantId))
      .returning({ emailLogId: onboardingCompensationGrants.emailLogId });
    if (grant?.emailLogId) {
      await tx
        .update(emailLogs)
        .set({
          status: "sent",
          providerMessageId: providerMessageId || null,
          error: null,
          sentAt: new Date(),
        })
        .where(eq(emailLogs.id, grant.emailLogId));
    }
  });
}

async function markFailed(
  grantId: number,
  error: string,
  phase: "code" | "email",
): Promise<void> {
  const safeError = error.slice(0, 500);
  const grantStatus = phase === "code" ? "code_failed" : "send_failed";
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .update(onboardingCompensationGrants)
      .set({
        status: grantStatus,
        lastError: safeError,
        updatedAt: new Date(),
      })
      .where(eq(onboardingCompensationGrants.id, grantId))
      .returning({ emailLogId: onboardingCompensationGrants.emailLogId });
    if (grant?.emailLogId) {
      await tx
        .update(emailLogs)
        .set({ status: "failed", error: safeError })
        .where(eq(emailLogs.id, grant.emailLogId));
    }
  });
}

export async function runOnboardingCompensationNow(): Promise<CompensationBatchResult> {
  if (!process.env.REPLIT_DEPLOYMENT) {
    console.log("[OnboardingCompensation] Skipped outside a production deployment");
    return { sent: 0, failed: 0, skipped: 0 };
  }

  await assertCompensationSchemaReady();
  await freezeAffectedCohort();
  const grants = await listOutstandingGrants();
  const ensurePromotionCode = createPromotionEnsurer(getStripeClient());
  const result = await runCompensationBatch(grants, {
    ensurePromotionCode,
    markCodeReady,
    claimEmail,
    sendEmail: sendRecoveryEmail,
    markSent,
    markFailed,
  });
  console.log(
    `[OnboardingCompensation] Complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
  );
  return result;
}

let workerStarted = false;

export function startOnboardingCompensationWorker(): void {
  if (workerStarted || !process.env.REPLIT_DEPLOYMENT) return;
  workerStarted = true;
  const timer = setTimeout(() => {
    runOnboardingCompensationNow().catch((error) => {
      console.error(
        "[OnboardingCompensation] Worker failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, 2_000);
  timer.unref();
  console.log("[OnboardingCompensation] Production recovery worker scheduled");
}