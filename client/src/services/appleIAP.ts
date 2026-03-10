import { Capacitor } from '@capacitor/core';

const APPLE_PRODUCT_ID = 'MCV_Apple_Superhero';

declare global {
  interface Window {
    CdvPurchase?: any;
  }
}

let storeInitialized = false;
let initPromise: Promise<void> | null = null;

function getStore() {
  return window.CdvPurchase?.store;
}

export function isAppleIAP(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

async function initializeStore(): Promise<void> {
  if (storeInitialized) return;
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    const store = getStore();
    if (!store) {
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
        initPromise = null;
        reject(err);
      });
  });

  return initPromise;
}

export async function purchaseAppleSubscription(
  userId: number,
  getIdToken: () => Promise<string>
): Promise<{ success: boolean; plan?: string; error?: string; cancelled?: boolean }> {
  try {
    await initializeStore();

    const store = getStore();
    const { Platform } = window.CdvPurchase;

    const product = store.get(APPLE_PRODUCT_ID, Platform.APPLE_APPSTORE);
    if (!product) {
      return { success: false, error: 'Subscription product not found. Please try again later.' };
    }

    const offer = product.getOffer();
    if (!offer) {
      return { success: false, error: 'Subscription offer not available. Please try again later.' };
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
            body: JSON.stringify({
              receiptData,
              userId,
            }),
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
