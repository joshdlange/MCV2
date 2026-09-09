import { users } from "../../shared/schema";
import { normalizeTrustedAvatarUrl } from "../../shared/trustedAvatarUrl";

type DatabaseUser = typeof users.$inferSelect;

function safePhotoUrl(value: string | null): string | null {
  return normalizeTrustedAvatarUrl(value);
}

export function toAuthUser(user: DatabaseUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    photoURL: safePhotoUrl(user.photoURL),
    isAdmin: user.isAdmin,
    imageAdmin: user.imageAdmin,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    onboardingComplete: user.onboardingComplete,
    totalLogins: user.totalLogins,
  };
}

export function toPrivateProfileUser(user: DatabaseUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    photoURL: safePhotoUrl(user.photoURL),
    bio: user.bio,
    location: user.location,
    website: user.website,
    shippingAddressJson: user.shippingAddressJson,
    isAdmin: user.isAdmin,
    imageAdmin: user.imageAdmin,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    hasStripeCustomer: Boolean(user.stripeCustomerId),
    hasAppleSubscription: Boolean(user.appleOriginalTransactionId),
    showEmail: user.showEmail,
    showCollection: user.showCollection,
    showWishlist: user.showWishlist,
    showImageAttribution: user.showImageAttribution,
    emailUpdates: user.emailUpdates,
    priceAlerts: user.priceAlerts,
    friendActivity: user.friendActivity,
    marketingOptIn: user.marketingOptIn,
    pushEnabled: user.pushEnabled,
    profileVisibility: user.profileVisibility,
    collectorAvatarKey: user.collectorAvatarKey,
    collectorFocus: user.collectorFocus,
    allowFollowers: user.allowFollowers,
    showActivityInFeed: user.showActivityInFeed,
    onboardingComplete: user.onboardingComplete,
    heardAbout: user.heardAbout,
    profileCustomizationCompletedAt: user.profileCustomizationCompletedAt,
    profileCustomizationDismissedAt: user.profileCustomizationDismissedAt,
    profileCustomizationSkips: user.profileCustomizationSkips,
    createdAt: user.createdAt,
  };
}

export function toPublicProfileUser(user: DatabaseUser) {
  return {
    id: user.id,
    username: user.username,
    ...(user.showEmail ? { email: user.email } : {}),
    displayName: user.displayName,
    photoURL: safePhotoUrl(user.photoURL),
    bio: user.bio,
    location: user.location,
    website: user.website,
    instagramUrl: user.instagramUrl,
    whatnotUrl: user.whatnotUrl,
    ebayUrl: user.ebayUrl,
    collectorAvatarKey: user.collectorAvatarKey,
    collectorFocus: user.collectorFocus,
    profileVisibility: user.profileVisibility,
    allowFollowers: user.allowFollowers,
    createdAt: user.createdAt,
  };
}