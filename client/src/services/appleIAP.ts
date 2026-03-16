import { Capacitor } from '@capacitor/core';

const APPLE_PRODUCT_ID = 'MCV_Apple_Superhero';

declare global {
  interface Window {
    CdvPurchase?: any;
  }
}

// ── Readiness state ──────────────────────────────────────────────────────────
export type AppleIAPReadiness = 'unavailable' | 'loading' | 'ready' | 'failed';

let readiness: AppleIAPReadiness = 'unavailable';
const readinessListeners: Array<(r: AppleIAPReadiness) => void> = [];

function setReadiness(r: AppleIAPReadiness) {
  readiness = r;
  readinessListeners.forEach((fn) => fn(r));
}

export function getAppleIAPReadiness(): AppleIAPReadiness {
  return readiness;
}

export function subscribeToAppleIAPReadiness(
  fn: (r: AppleIAPReadiness) => void
): () => void {
  readinessListeners.push(fn);
  return () => {
    const idx = readinessListeners.indexOf(fn);
    if (idx >= 0) readinessListeners.splice(idx, 1);
  };
}

export function isAppleIAPReady(): boolean {
  return readiness === 'ready';
}

// ── Internal store state ─────────────────────────────────────────────────────
let storeInitialized = false;
let initPromise: Promise<void> | null = null;

function getStore() {
  return window.CdvPurchase?.store;
}

export function isAppleIAP(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// ── Wait for product with offers ─────────────────────────────────────────────
async function waitForProduct(store: any, platform: any, timeoutMs = 8000): Promise<any> {
  const existing = store.get(APPLE_PRODUCT_ID, platform);
  if (existing && existing.offers && existing.offers.length > 0) return existing;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Product load timeout'));
    }, timeoutMs);

    const checkProduct = () => {
      const p = store.get(APPLE_PRODUCT_ID, platform);
      if (p && p.offers && p.offers.length > 0) {
        clearTimeout(timeoutId);
        resolve(p);
      }
    };

    store.when().productUpdated((p: any) => {
      if (p.id === APPLE_PRODUCT_ID) checkProduct();
    });

    store.when().ready(() => {
      checkProduct();
    });
  });
}

// ── Store initialization ─────────────────────────────────────────────────────
async function initializeStore(): Promise<void> {
  if (storeInitialized) return;
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    const store = getStore();
    if (!store) {
      storeInitialized = false;
      initPromise = null;
      reject(new Error('In-app purchase plugin not available'));
      return;
    }

    const { ProductType, Platform } = window.CdvPurchase;

    store.register([{
      id: APPLE_PRODUCT_ID,
      type: ProductType.PAID_SUBSCRIPTION,
      platform: Platform.APPLE_APPSTORE,
    }]);

    store.initialize([Platform.APPLE_APPSTORE])
      .then(() => {
        storeInitialized = true;
        resolve();
      })
      .catch((err: any) => {
        console.error('Store initialization failed:', err);
        storeInitialized = false;
        initPromise = null;
        reject(err);
      });
  });

  return initPromise;
}

// ── Preload (called at app start, not on tap) ─────────────────────────────────
export async function preloadAppleIAP(): Promise<void> {
  if (!isAppleIAP()) return;

  // Already loaded — nothing to do
  if (readiness === 'ready') return;

  setReadiness('loading');

  try {
    await initializeStore();

    // Wait for the product to appear with a valid offer
    const store = getStore();
    const { Platform } = window.CdvPurchase;
    try {
      const product = await waitForProduct(store, Platform.APPLE_APPSTORE, 12000);
      if (product && product.offers && product.offers.length > 0) {
        setReadiness('ready');
      } else {
        setReadiness('failed');
      }
    } catch (_e) {
      // waitForProduct timed out — check one more time synchronously
      const product = store.get(APPLE_PRODUCT_ID, Platform.APPLE_APPSTORE);
      if (product && product.offers && product.offers.length > 0) {
        setReadiness('ready');
      } else {
        setReadiness('failed');
      }
    }
  } catch (err) {
    console.warn('Apple IAP preload failed:', err);
    setReadiness('failed');
  }
}

// ── Purchase ─────────────────────────────────────────────────────────────────
export async function purchaseAppleSubscription(
  userId: number,
  getIdToken: () => Promise<string>
): Promise<{ success: boolean; plan?: string; error?: string; cancelled?: boolean }> {
  // Belt-and-suspenders: if not ready, return silently (UI should prevent this)
  if (!isAppleIAPReady()) {
    console.warn('Apple IAP: purchaseAppleSubscription called before IAP is ready');
    return { success: false, error: 'In-app purchases are not ready yet. Please wait a moment and try again.' };
  }

  try {
    const store = getStore();
    const { Platform } = window.CdvPurchase;

    let product: any;
    try {
      product = await waitForProduct(store, Platform.APPLE_APPSTORE, 10000);
    } catch (_e) {
      product = store.get(APPLE_PRODUCT_ID, Platform.APPLE_APPSTORE);
    }

    if (!product) {
      return { success: false, error: 'Subscription product is not available right now. Please check your App Store account and try again.' };
    }

    const offer = product.getOffer ? product.getOffer() : (product.offers?.[0] ?? null);
    if (!offer) {
      return { success: false, error: 'No subscription offer available. Please try again later.' };
    }

    return new Promise((resolve) => {
      let resolved = false;

      const safeResolve = (result: { success: boolean; plan?: string; error?: string; cancelled?: boolean }) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      const approvedHandler = async (transaction: any) => {
        try {
          const receipt = transaction.parentReceipt;
          const receiptData = receipt?.nativeData?.appStoreReceipt;

          if (!receiptData) {
            safeResolve({ success: false, error: 'Could not retrieve purchase receipt.' });
            transaction.finish();
            return;
          }

          const token = await getIdToken();
          const response = await fetch('/api/apple-iap/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ receiptData, userId }),
          });

          const data = await response.json();

          if (response.ok && data.success) {
            transaction.finish();
            safeResolve({ success: true, plan: data.plan });
          } else {
            safeResolve({ success: false, error: data.message || 'Verification failed.' });
            transaction.finish();
          }
        } catch (err: any) {
          console.error('Receipt verification error:', err);
          safeResolve({ success: false, error: 'Failed to verify purchase. Please contact support.' });
          transaction.finish();
        }
      };

      const cancelledHandler = () => {
        safeResolve({ success: false, cancelled: true });
      };

      const errorHandler = (err: any) => {
        if (err?.code === 'E_USER_CANCELLED' || err?.message?.includes('cancel')) {
          safeResolve({ success: false, cancelled: true });
        } else {
          console.error('Store error:', err);
          safeResolve({ success: false, error: 'Purchase could not be completed. Please try again.' });
        }
      };

      const cleanup = () => {
        try {
          store.off(approvedHandler);
          store.off(cancelledHandler);
          store.off(errorHandler);
        } catch (_e) {}
        clearTimeout(timeoutId);
      };

      store.when()
        .approved(approvedHandler)
        .cancelled(cancelledHandler)
        .error(errorHandler);

      store.order(offer).catch((err: any) => {
        if (err?.code === 'E_USER_CANCELLED' || err?.message?.includes('cancel')) {
          safeResolve({ success: false, cancelled: true });
        } else {
          console.error('Purchase order error:', err);
          safeResolve({ success: false, error: 'Purchase could not be completed. Please try again.' });
        }
      });

      const timeoutId = setTimeout(() => {
        safeResolve({ success: false, error: 'Purchase timed out. If you were charged, please contact support.' });
      }, 120000);
    });
  } catch (err: any) {
    console.error('Apple IAP error:', err);
    if (err?.message?.includes('not available')) {
      return { success: false, error: 'In-app purchases are not available on this device.' };
    }
    return { success: false, error: 'Failed to start purchase. Please try again.' };
  }
}
