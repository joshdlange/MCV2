import { Capacitor } from '@capacitor/core';

const APPLE_PRODUCT_ID = 'MCV_Apple_Superhero';
const LOG = '[AppleIAP]';

declare global {
  interface Window {
    CdvPurchase?: any;
  }
}

// ── Readiness state ──────────────────────────────────────────────────────────
// 'unavailable' — not an iOS native build, or preload not yet started
// 'loading'     — preload in progress (plugin found, store initializing, or waiting for product)
// 'ready'       — ALL four conditions met: plugin exists, store initialized,
//                 product MCV_Apple_Superhero loaded, offer present
// 'failed'      — any condition failed; purchase must not be attempted
export type AppleIAPReadiness = 'unavailable' | 'loading' | 'ready' | 'failed';

let readiness: AppleIAPReadiness = 'unavailable';
const readinessListeners: Array<(r: AppleIAPReadiness) => void> = [];

function setReadiness(r: AppleIAPReadiness) {
  if (readiness === r) return;
  console.log(`${LOG} readiness: ${readiness} → ${r}`);
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

// Returns true ONLY when all four conditions are met
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

// ── Wait for product + offer ──────────────────────────────────────────────────
async function waitForProduct(store: any, platform: any, timeoutMs = 12000): Promise<any> {
  // Check synchronously first — product may already be present after store.initialize()
  const existing = store.get(APPLE_PRODUCT_ID, platform);
  if (existing) {
    console.log(`${LOG} product already cached:`, APPLE_PRODUCT_ID,
      '| offers:', existing.offers?.length ?? 0);
    if (existing.offers && existing.offers.length > 0) return existing;
  }

  console.log(`${LOG} waiting for product ${APPLE_PRODUCT_ID} (timeout ${timeoutMs}ms)…`);

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      console.warn(`${LOG} waitForProduct timed out after ${timeoutMs}ms`);
      reject(new Error('Product load timeout'));
    }, timeoutMs);

    const checkProduct = () => {
      const p = store.get(APPLE_PRODUCT_ID, platform);
      if (p) {
        console.log(`${LOG} product updated — offers: ${p.offers?.length ?? 0}`, p);
        if (p.offers && p.offers.length > 0) {
          clearTimeout(timeoutId);
          resolve(p);
        }
      }
    };

    store.when().productUpdated((p: any) => {
      if (p.id === APPLE_PRODUCT_ID) {
        console.log(`${LOG} productUpdated event — id: ${p.id}, offers: ${p.offers?.length ?? 0}`);
        checkProduct();
      }
    });

    store.when().ready(() => {
      console.log(`${LOG} store.ready event fired — checking product…`);
      checkProduct();
    });
  });
}

// ── Store initialization ─────────────────────────────────────────────────────
async function initializeStore(): Promise<void> {
  if (storeInitialized) {
    console.log(`${LOG} initializeStore: already initialized, skipping`);
    return;
  }
  if (initPromise) {
    console.log(`${LOG} initializeStore: init already in progress, reusing promise`);
    return initPromise;
  }

  initPromise = new Promise<void>((resolve, reject) => {
    // CHECK 1: plugin availability
    const pluginAvailable = typeof window.CdvPurchase !== 'undefined';
    console.log(`${LOG} CHECK 1 — window.CdvPurchase available: ${pluginAvailable}`);

    const store = getStore();
    const storeAvailable = typeof store !== 'undefined' && store !== null;
    console.log(`${LOG} CHECK 1 — window.CdvPurchase.store available: ${storeAvailable}`);

    if (!store) {
      const msg = 'In-app purchase plugin not available (window.CdvPurchase.store is null/undefined)';
      console.error(`${LOG} ${msg}`);
      storeInitialized = false;
      initPromise = null;
      reject(new Error(msg));
      return;
    }

    const { ProductType, Platform } = window.CdvPurchase;

    // CHECK 2: product registration
    console.log(`${LOG} CHECK 2 — registering product: ${APPLE_PRODUCT_ID}`);
    store.register([{
      id: APPLE_PRODUCT_ID,
      type: ProductType.PAID_SUBSCRIPTION,
      platform: Platform.APPLE_APPSTORE,
    }]);
    console.log(`${LOG} product registered`);

    // CHECK 3: store initialization
    console.log(`${LOG} CHECK 3 — calling store.initialize([APPLE_APPSTORE])…`);
    store.initialize([Platform.APPLE_APPSTORE])
      .then(() => {
        console.log(`${LOG} CHECK 3 — store.initialize() resolved ✓ storeInitialized = true`);
        storeInitialized = true;
        resolve();
      })
      .catch((err: any) => {
        console.error(`${LOG} CHECK 3 — store.initialize() FAILED:`, err);
        storeInitialized = false;
        initPromise = null;
        reject(err);
      });
  });

  return initPromise;
}

// ── Preload — called at app open in App(), before auth, before any user tap ──
export async function preloadAppleIAP(): Promise<void> {
  if (!isAppleIAP()) {
    console.log(`${LOG} preloadAppleIAP: not iOS native — skipping`);
    return;
  }

  // Idempotent: if already ready, nothing to do
  if (readiness === 'ready') {
    console.log(`${LOG} preloadAppleIAP: already ready — skipping`);
    return;
  }

  console.log(`${LOG} preloadAppleIAP: starting…`);
  setReadiness('loading');

  try {
    // Step 1–3: plugin + registration + store init
    await initializeStore();
    console.log(`${LOG} preloadAppleIAP: store init complete`);

    // Step 4–5: product load + offer check
    const store = getStore();
    const { Platform } = window.CdvPurchase;
    let product: any = null;

    try {
      product = await waitForProduct(store, Platform.APPLE_APPSTORE, 12000);
    } catch (_e) {
      // Timeout — do a final synchronous check before giving up
      console.warn(`${LOG} preloadAppleIAP: waitForProduct timed out — doing final sync check`);
      product = store.get(APPLE_PRODUCT_ID, Platform.APPLE_APPSTORE);
      console.log(`${LOG} preloadAppleIAP: final sync product:`, product,
        '| offers:', product?.offers?.length ?? 0);
    }

    // Strict ready gate — ALL four conditions must be true
    const pluginOk = typeof window.CdvPurchase !== 'undefined' && !!getStore();
    const storeOk = storeInitialized;
    const productOk = !!product;
    const offerOk = !!(product?.offers && product.offers.length > 0);

    console.log(`${LOG} readiness check:`,
      `plugin=${pluginOk}`,
      `storeInit=${storeOk}`,
      `product=${productOk}`,
      `offer=${offerOk}`,
      '| offers:', product?.offers?.length ?? 0
    );

    if (pluginOk && storeOk && productOk && offerOk) {
      const offer = product.getOffer ? product.getOffer() : product.offers[0];
      console.log(`${LOG} CHECK 4 — product loaded ✓  |  CHECK 5 — offer detected ✓`, offer);
      setReadiness('ready');
    } else {
      console.warn(`${LOG} preloadAppleIAP: readiness conditions NOT met — setting failed`);
      setReadiness('failed');
    }
  } catch (err) {
    console.error(`${LOG} preloadAppleIAP: fatal error — setting failed:`, err);
    setReadiness('failed');
  }
}

// ── Purchase ─────────────────────────────────────────────────────────────────
export async function purchaseAppleSubscription(
  userId: number,
  getIdToken: () => Promise<string>
): Promise<{ success: boolean; plan?: string; error?: string; cancelled?: boolean }> {
  // Hard gate — readiness MUST be 'ready' (all four conditions confirmed during preload)
  if (!isAppleIAPReady()) {
    console.warn(`${LOG} purchaseAppleSubscription called with readiness="${readiness}" — aborting`);
    return {
      success: false,
      error: 'In-app purchases are not ready yet. Please wait a moment and try again.',
    };
  }

  console.log(`${LOG} purchaseAppleSubscription: starting (readiness=${readiness})`);

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
      console.error(`${LOG} purchaseAppleSubscription: product not found after store ready`);
      return {
        success: false,
        error: 'Subscription product is not available right now. Please check your App Store account and try again.',
      };
    }

    const offer = product.getOffer ? product.getOffer() : (product.offers?.[0] ?? null);
    if (!offer) {
      console.error(`${LOG} purchaseAppleSubscription: product found but no offer available`, product);
      return { success: false, error: 'No subscription offer available. Please try again later.' };
    }

    // Log full offer + product state so we can confirm App Store config in Xcode logs
    console.log(`${LOG} offer details:`, JSON.stringify({
      id: offer?.id,
      productId: offer?.productId,
      pricingPhases: offer?.pricingPhases,
      offerId: offer?.offerId,
    }, null, 2));
    console.log(`${LOG} product state at purchase time:`, JSON.stringify({
      id: product?.id,
      state: product?.state,
      owned: product?.owned,
      type: product?.type,
      offers: product?.offers?.length,
    }, null, 2));

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
        console.log(`${LOG} ✅ approved handler fired — transaction:`, JSON.stringify({
          transactionId: transaction?.transactionIdentifier,
          state: transaction?.state,
          productId: transaction?.products?.[0]?.id,
          hasReceipt: !!transaction?.parentReceipt,
          hasNativeData: !!transaction?.parentReceipt?.nativeData,
          hasAppStoreReceipt: !!transaction?.parentReceipt?.nativeData?.appStoreReceipt,
        }, null, 2));
        try {
          const receipt = transaction.parentReceipt;
          const receiptData = receipt?.nativeData?.appStoreReceipt;

          if (!receiptData) {
            console.error(`${LOG} approved handler: no receiptData in transaction — full receipt:`, receipt);
            safeResolve({ success: false, error: 'Could not retrieve purchase receipt.' });
            transaction.finish();
            return;
          }

          console.log(`${LOG} verifying receipt with backend… (receiptData length: ${receiptData.length})`);
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
          console.log(`${LOG} receipt verification response:`, response.status, data);

          if (response.ok && data.success) {
            transaction.finish();
            safeResolve({ success: true, plan: data.plan });
          } else {
            safeResolve({ success: false, error: data.message || 'Verification failed.' });
            transaction.finish();
          }
        } catch (err: any) {
          console.error(`${LOG} receipt verification error:`, err);
          safeResolve({ success: false, error: 'Failed to verify purchase. Please contact support.' });
          transaction.finish();
        }
      };

      const cancelledHandler = () => {
        console.log(`${LOG} 🚫 cancelled handler fired — user dismissed StoreKit sheet`);
        safeResolve({ success: false, cancelled: true });
      };

      const errorHandler = (err: any) => {
        // Log the full error object so we can see code, message, and any platform details
        console.error(`${LOG} ❌ error handler fired:`, JSON.stringify({
          code: err?.code,
          message: err?.message,
          platform: err?.platform,
          productId: err?.productId,
          localizedDescription: err?.localizedDescription,
        }, null, 2), err);
        if (err?.code === 'E_USER_CANCELLED' || err?.message?.includes('cancel')) {
          console.log(`${LOG} classified as user cancellation`);
          safeResolve({ success: false, cancelled: true });
        } else {
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

      // Register handlers BEFORE calling store.order() to avoid missing early events
      store.when()
        .approved(approvedHandler)
        .cancelled(cancelledHandler)
        .error(errorHandler);

      console.log(`${LOG} calling store.order(offer) — StoreKit sheet should appear now`);
      store.order(offer)
        .then(() => {
          // store.order() resolving means the order was accepted by StoreKit (sheet shown or already owned)
          // The actual purchase result arrives via the approved/cancelled/error handlers above
          console.log(`${LOG} store.order() resolved ✓ — StoreKit sheet was presented (waiting for handler)`);
        })
        .catch((err: any) => {
          // store.order() rejecting means StoreKit itself refused to show the sheet
          console.error(`${LOG} store.order() REJECTED — StoreKit sheet did NOT appear:`, JSON.stringify({
            code: err?.code,
            message: err?.message,
            platform: err?.platform,
            localizedDescription: err?.localizedDescription,
          }, null, 2), err);
          if (err?.code === 'E_USER_CANCELLED' || err?.message?.includes('cancel')) {
            console.log(`${LOG} order rejection classified as cancellation`);
            safeResolve({ success: false, cancelled: true });
          } else {
            safeResolve({ success: false, error: 'Purchase could not be completed. Please try again.' });
          }
        });

      const timeoutId = setTimeout(() => {
        console.warn(`${LOG} purchase timed out after 120s — no handler fired`);
        safeResolve({
          success: false,
          error: 'Purchase timed out. If you were charged, please contact support.',
        });
      }, 120000);
    });
  } catch (err: any) {
    console.error(`${LOG} purchaseAppleSubscription unexpected error:`, err);
    if (err?.message?.includes('not available')) {
      return { success: false, error: 'In-app purchases are not available on this device.' };
    }
    return { success: false, error: 'Failed to start purchase. Please try again.' };
  }
}
