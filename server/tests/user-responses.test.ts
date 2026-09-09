import test from "node:test";
import assert from "node:assert/strict";

import { toAuthUser, toPrivateProfileUser, toPublicProfileUser } from "../services/userResponses";

const databaseUser = {
  id: 42,
  firebaseUid: "firebase-secret-link",
  username: "collector",
  email: "collector@example.test",
  displayName: "Collector",
  photoURL: "https://example.test/avatar.png",
  bio: null,
  location: null,
  website: null,
  address: "legacy-address",
  isAdmin: false,
  trustedUploader: false,
  imageAdmin: false,
  plan: "SIDE_KICK",
  subscriptionStatus: "active",
  stripeCustomerId: "cus_private",
  stripeSubscriptionId: "sub_private",
  appleOriginalTransactionId: "apple_transaction_private",
  appleUserId: "apple_identity_private",
  showEmail: false,
  showCollection: true,
  showWishlist: true,
  showImageAttribution: true,
  emailUpdates: true,
  priceAlerts: true,
  friendActivity: true,
  profileVisibility: "public",
  onboardingComplete: true,
  heardAbout: null,
  favoriteSets: null,
  marketingOptIn: true,
  pushEnabled: false,
  signupShareToken: "private-attribution-token",
  lastLogin: null,
  loginStreak: 0,
  totalLogins: 4,
  nativeMobileLogins: 4,
  lastInactivityEmailSent: null,
  lastWeeklyDigestSent: null,
  marketplaceSuspended: false,
  marketplaceSuspendedAt: null,
  shippingAddressJson: "{\"street1\":\"Private\"}",
  sellerRating: null,
  sellerReviewCount: 0,
  collectorAvatarKey: null,
  collectorFocus: null,
  allowFollowers: true,
  showActivityInFeed: true,
  profileCustomizationCompletedAt: null,
  profileCustomizationDismissedAt: null,
  profileCustomizationSkips: 0,
  upgradedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  instagramUrl: null,
  whatnotUrl: null,
  ebayUrl: null,
} as any;

test("auth responses expose only fields needed to establish the app session", () => {
  const result = toAuthUser(databaseUser);
  assert.equal(result.id, 42);
  assert.equal(result.totalLogins, 4);
  assert.equal("firebaseUid" in result, false);
  assert.equal("stripeCustomerId" in result, false);
  assert.equal("appleUserId" in result, false);
  assert.equal("shippingAddressJson" in result, false);
  assert.equal("signupShareToken" in result, false);
});

test("private profile responses replace provider identifiers with booleans", () => {
  const result = toPrivateProfileUser(databaseUser);
  assert.equal(result.hasStripeCustomer, true);
  assert.equal(result.hasAppleSubscription, true);
  assert.equal("stripeCustomerId" in result, false);
  assert.equal("stripeSubscriptionId" in result, false);
  assert.equal("appleOriginalTransactionId" in result, false);
  assert.equal("appleUserId" in result, false);
  assert.equal("firebaseUid" in result, false);
  assert.equal(result.profileCustomizationSkips, 0);
  assert.equal(result.profileCustomizationCompletedAt, null);
});

test("public profile responses honor email privacy and omit account internals", () => {
  const hiddenEmail = toPublicProfileUser({
    ...databaseUser,
    photoURL: "https://localtest.me/avatar.png",
  });
  assert.equal("email" in hiddenEmail, false);
  assert.equal(hiddenEmail.photoURL, null);
  assert.equal("shippingAddressJson" in hiddenEmail, false);
  assert.equal("stripeCustomerId" in hiddenEmail, false);
  assert.equal("appleUserId" in hiddenEmail, false);

  const visibleEmail = toPublicProfileUser({
    ...databaseUser,
    showEmail: true,
  });
  assert.equal(visibleEmail.email, "collector@example.test");
});