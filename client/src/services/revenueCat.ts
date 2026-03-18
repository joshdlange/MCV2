import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL } from '@revenuecat/purchases-capacitor';
import type { CustomerInfo } from '@revenuecat/purchases-capacitor';

// ── Feature flag ──────────────────────────────────────────────────────────────
// true  → iOS uses RevenueCat for native in-app purchase
// false → iOS falls back to web redirect (old APPLE_IAP_ENABLED / web flow)
export const REVENUECAT_ENABLED = true;

// Entitlement identifier configured in RevenueCat dashboard
export const RC_ENTITLEMENT_ID = 'super_hero';

// iOS API key — add VITE_REVENUECAT_IOS_API_KEY to Replit environment variables
const RC_IOS_API_KEY = import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined;

const LOG = '[RevenueCat]';

// ── Readiness state ───────────────────────────────────────────────────────────
export type RCReadiness = 'unavailable' | 'loading' | 'ready' | 'failed';

let _readiness: RCReadiness = 'unavailable';
let _configured = false;
let _currentOffering: any = null;

const _listeners: Array<(r: RCReadiness) => void> = [];

function setReadiness(r: RCReadiness) {
  if (_readiness === r) return;
  console.log(`${LOG} readiness: ${_readiness} → ${r}`);
  _readiness = r;
  _listeners.forEach((fn) => fn(r));
}

export function getRCReadiness(): RCReadiness {
  return _readiness;
}

export function subscribeToRCReadiness(fn: (r: RCReadiness) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

export function isRevenueCatAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function getRCCurrentOffering(): any {
  return _currentOffering;
}

// ── Initialize ────────────────────────────────────────────────────────────────
// Called at app startup (App.tsx). Fetches offerings and marks RC ready.
export async function initializeRevenueCat(): Promise<void> {
  if (!isRevenueCatAvailable() || !REVENUECAT_ENABLED) return;

  if (_readiness === 'loading' || _readiness === 'ready') {
    console.log(`${LOG} already ${_readiness} — skipping`);
    return;
  }

  if (!RC_IOS_API_KEY) {
    console.warn(`${LOG} VITE_REVENUECAT_IOS_API_KEY not set — cannot initialize`);
    setReadiness('failed');
    return;
  }

  setReadiness('loading');
  console.log(`${LOG} initializing…`);

  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    await Purchases.configure({ apiKey: RC_IOS_API_KEY });
    _configured = true;
    console.log(`${LOG} configured ✓`);

    const offerings = await Purchases.getOfferings();
    _currentOffering = offerings.current ?? null;
    console.log(`${LOG} offerings fetched — current: ${_currentOffering?.identifier ?? 'none'}, packages: ${_currentOffering?.availablePackages?.length ?? 0}`);

    if (_currentOffering && (_currentOffering.availablePackages?.length ?? 0) > 0) {
      setReadiness('ready');
    } else {
      console.warn(`${LOG} no packages in current offering`);
      setReadiness('failed');
    }
  } catch (err) {
    console.error(`${LOG} initialization error:`, err);
    setReadiness('failed');
  }
}

// ── Retry initialization ──────────────────────────────────────────────────────
export async function retryRevenueCat(): Promise<void> {
  if (_readiness === 'loading' || _readiness === 'ready') return;
  _configured = false;
  _currentOffering = null;
  setReadiness('unavailable');
  await initializeRevenueCat();
}

// ── Identify user ─────────────────────────────────────────────────────────────
// Associate Firebase UID with RevenueCat user record. Call before purchase.
export async function identifyRevenueCatUser(firebaseUid: string): Promise<void> {
  if (!_configured) return;
  try {
    await Purchases.logIn({ appUserID: firebaseUid });
    console.log(`${LOG} identified user: ${firebaseUid}`);
  } catch (err) {
    console.warn(`${LOG} logIn error:`, err);
  }
}

// ── Purchase ──────────────────────────────────────────────────────────────────
export async function purchaseSuperHero(): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
  cancelled?: boolean;
}> {
  if (!_configured) {
    return { success: false, error: 'RevenueCat is not ready. Please wait a moment and try again.' };
  }

  try {
    let offering = _currentOffering;
    if (!offering) {
      const result = await Purchases.getOfferings();
      offering = result.current;
      _currentOffering = offering;
    }

    const pkg = offering?.availablePackages?.[0] ?? null;
    if (!pkg) {
      return { success: false, error: 'No subscription package is available right now. Please try again later.' };
    }

    console.log(`${LOG} purchasing package: ${pkg.identifier}`);
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    const entitled = !!customerInfo.entitlements.active[RC_ENTITLEMENT_ID];
    console.log(`${LOG} purchase complete — entitled: ${entitled}`);

    return {
      success: entitled,
      customerInfo,
      error: entitled ? undefined : 'Subscription is not yet active. Please contact support.',
    };
  } catch (err: any) {
    console.error(`${LOG} purchase error:`, err);
    if (
      err.userCancelled === true ||
      err.code === 1 ||
      err.message?.toLowerCase().includes('cancel')
    ) {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message || 'Purchase could not be completed. Please try again.' };
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────
export async function restoreRevenueCatPurchases(): Promise<{
  success: boolean;
  entitled: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
}> {
  if (!_configured) {
    return { success: false, entitled: false, error: 'RevenueCat is not ready.' };
  }

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const entitled = !!customerInfo.entitlements.active[RC_ENTITLEMENT_ID];
    console.log(`${LOG} restore complete — entitled: ${entitled}`);
    return { success: true, entitled, customerInfo };
  } catch (err: any) {
    console.error(`${LOG} restore error:`, err);
    return { success: false, entitled: false, error: err.message || 'Restore failed. Please try again.' };
  }
}

// ── Check entitlement ─────────────────────────────────────────────────────────
export async function checkRCEntitlement(): Promise<boolean> {
  if (!_configured) return false;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return !!customerInfo.entitlements.active[RC_ENTITLEMENT_ID];
  } catch {
    return false;
  }
}
