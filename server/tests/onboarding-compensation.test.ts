import assert from "node:assert/strict";
import test from "node:test";
import {
  compensationCodeForUser,
  compensationIndexesAreValid,
  compensationMonthsForUser,
  createPromotionEnsurer,
  isHeaderUnsafeProfileValue,
  runCompensationBatch,
  type CompensationBatchDependencies,
  type CompensationGrant,
} from "../services/onboardingCompensation";
import { onboardingRecoveryTemplate } from "../services/emailTemplates";

function grant(overrides: Partial<CompensationGrant> = {}): CompensationGrant {
  return {
    id: 1,
    userId: 420,
    email: "collector@example.test",
    displayName: "Collector \u201cUnicode\u201d",
    offerMonths: 1,
    promotionCode: "VAULTFIX-TEST",
    status: "pending",
    stripeCouponId: null,
    stripePromotionCodeId: null,
    ...overrides,
  };
}

test("Reynaldo keeps three months while other affected users get one", () => {
  assert.equal(compensationMonthsForUser(1779), 3);
  assert.equal(compensationCodeForUser(1779, "test-secret"), "REYNALDO3");
  assert.equal(compensationMonthsForUser(420), 1);
  const code = compensationCodeForUser(420, "test-secret");
  assert.match(code, /^VAULTFIX-[A-F0-9]{10}$/);
  assert.equal(code, compensationCodeForUser(420, "test-secret"));
  assert.notEqual(code, compensationCodeForUser(825, "test-secret"));
});

test("only characters outside the browser header byte range match the incident", () => {
  assert.equal(isHeaderUnsafeProfileValue("Plain ASCII"), false);
  assert.equal(isHeaderUnsafeProfileValue("Jos\u00e9"), false);
  assert.equal(isHeaderUnsafeProfileValue("Collector \u201cUnicode\u201d"), true);
  assert.equal(isHeaderUnsafeProfileValue("Collector \ud83e\uddb8"), true);
});

test("schema validation requires the exact unique indexes and columns", () => {
  const valid = [
    {
      index_name: "onboarding_comp_grant_user_campaign_idx",
      indisunique: true,
      has_predicate: false,
      columns: ["user_id", "campaign"],
    },
    {
      index_name: "onboarding_comp_grant_promo_code_idx",
      indisunique: true,
      has_predicate: false,
      columns: ["promotion_code"],
    },
  ];
  assert.equal(compensationIndexesAreValid(valid), true);
  assert.equal(
    compensationIndexesAreValid(valid.map((index) => ({ ...index, indisunique: false }))),
    false,
  );
  assert.equal(
    compensationIndexesAreValid([
      valid[0],
      { ...valid[1], columns: ["stripe_promotion_code_id"] },
    ]),
    false,
  );
});

test("Stripe setup verifies the $5 monthly plan and creates a one-use grant", async () => {
  const couponCreates: any[] = [];
  const promotionCreates: any[] = [];
  let createdCoupon: any = null;
  const fakeStripe: any = {
    prices: {
      retrieve: async () => ({
        active: true,
        unit_amount: 500,
        currency: "usd",
        product: "prod_super_hero",
        recurring: { interval: "month", interval_count: 1 },
      }),
    },
    coupons: {
      retrieve: async () => {
        if (createdCoupon) return createdCoupon;
        const error: any = new Error("missing");
        error.code = "resource_missing";
        throw error;
      },
      create: async (params: any) => {
        couponCreates.push(params);
        createdCoupon = {
          id: params.id,
          amount_off: params.amount_off,
          currency: params.currency,
          duration: params.duration,
          applies_to: params.applies_to,
          valid: true,
        };
        return createdCoupon;
      },
    },
    promotionCodes: {
      list: async () => ({ data: [] }),
      create: async (params: any) => {
        promotionCreates.push(params);
        return {
          id: "promo_one",
          active: true,
          coupon: params.coupon,
          max_redemptions: params.max_redemptions,
          restrictions: params.restrictions,
        };
      },
    },
  };

  const ensure = createPromotionEnsurer(fakeStripe);
  const result = await ensure(grant());
  assert.equal(result.couponId, "mcv_onboarding_fix_1mo_20260824");
  assert.deepEqual(couponCreates[0], {
    id: "mcv_onboarding_fix_1mo_20260824",
    amount_off: 500,
    currency: "usd",
    duration: "once",
    name: "Onboarding recovery: one month free",
    applies_to: { products: ["prod_super_hero"] },
    metadata: {
      campaign: "support-onboarding-header-recovery-v1",
      priceId: "price_1ShZCvHUwjq8stIzSBgrMa10",
    },
  });
  assert.equal(promotionCreates[0].max_redemptions, 1);
  assert.deepEqual(promotionCreates[0].restrictions, { first_time_transaction: true });
});

test("Reynaldo validation reuses only the active unused three-month code", async () => {
  let createCalls = 0;
  const fakeStripe: any = {
    prices: { retrieve: async () => { throw new Error("monthly coupon should not load"); } },
    coupons: { retrieve: async () => { throw new Error("expanded coupon should be used"); } },
    promotionCodes: {
      list: async () => ({
        data: [{
          id: "promo_three",
          active: true,
          code: "REYNALDO3",
          max_redemptions: 1,
          times_redeemed: 0,
          coupon: {
            id: "coupon_three",
            amount_off: 500,
            currency: "usd",
            duration: "repeating",
            duration_in_months: 3,
            valid: true,
          },
        }],
      }),
      create: async () => {
        createCalls++;
        throw new Error("must not create Reynaldo's existing code");
      },
    },
  };

  const ensure = createPromotionEnsurer(fakeStripe);
  const result = await ensure(grant({
    userId: 1779,
    offerMonths: 3,
    promotionCode: "REYNALDO3",
  }));
  assert.deepEqual(result, {
    couponId: "coupon_three",
    promotionCodeId: "promo_three",
  });
  assert.equal(createCalls, 0);
});

test("recovery template safely renders Unicode names and the correct offer", () => {
  const oneMonth = onboardingRecoveryTemplate({
    displayName: 'Collector <One> \u201cTest\u201d',
    promotionCode: "VAULTFIX-ONE",
    freeMonths: 1,
  });
  assert.match(oneMonth.html, /Collector &lt;One&gt; \u201cTest\u201d/);
  assert.match(oneMonth.html, /here is one month of Super Hero free/i);
  assert.match(oneMonth.text, /VAULTFIX-ONE/);
  assert.doesNotMatch(oneMonth.html, /\{\{UNSUBSCRIBE_URL\}\}/);

  const threeMonths = onboardingRecoveryTemplate({
    displayName: "Reynaldo",
    promotionCode: "REYNALDO3",
    freeMonths: 3,
  });
  assert.match(threeMonths.html, /here is 3 months of Super Hero free/i);
});

test("concurrent compensation attempts claim and send only once", async () => {
  let claimed = false;
  let sends = 0;
  let sent = false;
  const dependencies: CompensationBatchDependencies = {
    ensurePromotionCode: async () => ({
      couponId: "coupon_1",
      promotionCodeId: "promo_1",
    }),
    markCodeReady: async () => {},
    claimEmail: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    sendEmail: async () => {
      sends++;
      return "message_1";
    },
    markSent: async () => {
      sent = true;
    },
    markFailed: async () => {
      throw new Error("markFailed should not run");
    },
  };

  const target = grant();
  const [first, second] = await Promise.all([
    runCompensationBatch([target], dependencies),
    runCompensationBatch([target], dependencies),
  ]);

  assert.equal(sends, 1);
  assert.equal(sent, true);
  assert.equal(first.sent + second.sent, 1);
  assert.equal(first.skipped + second.skipped, 1);
});

test("a Stripe failure is recorded and no recovery email is sent", async () => {
  let sends = 0;
  let failure = "";
  const result = await runCompensationBatch([grant()], {
    ensurePromotionCode: async () => {
      throw new Error("Stripe unavailable");
    },
    markCodeReady: async () => {},
    claimEmail: async () => true,
    sendEmail: async () => {
      sends++;
      return "should-not-send";
    },
    markSent: async () => {},
    markFailed: async (_grantId, error, phase) => {
      failure = error;
      assert.equal(phase, "code");
    },
  });

  assert.equal(sends, 0);
  assert.equal(result.failed, 1);
  assert.match(failure, /Stripe unavailable/);
});