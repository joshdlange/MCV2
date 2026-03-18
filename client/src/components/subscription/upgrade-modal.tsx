import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles, Star, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import logoImage from "@assets/Marvelous_Card_Valut_-_Trans_1772678671637.png";
import { Capacitor } from '@capacitor/core';
import { useAuth } from "@/contexts/AuthContext";
import {
  isAppleIAP,
  isAppleIAPReady,
  purchaseAppleSubscription,
  preloadAppleIAP,
  getAppleIAPReadiness,
  subscribeToAppleIAPReadiness,
  APPLE_IAP_ENABLED,
  type AppleIAPReadiness,
} from "@/services/appleIAP";
import {
  REVENUECAT_ENABLED,
  isRevenueCatAvailable,
  getRCReadiness,
  subscribeToRCReadiness,
  retryRevenueCat,
  identifyRevenueCatUser,
  purchaseSuperHero,
  restoreRevenueCatPurchases,
  getRCCurrentOffering,
  type RCReadiness,
} from "@/services/revenueCat";
import { useAppStore } from "@/lib/store";
import { queryClient } from "@/lib/queryClient";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
}

export function UpgradeModal({ isOpen, onClose, currentPlan }: UpgradeModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [iapReadiness, setIapReadiness] = useState<AppleIAPReadiness>(getAppleIAPReadiness());
  const [rcReadiness, setRcReadiness] = useState<RCReadiness>(getRCReadiness());
  const [isRetrying, setIsRetrying] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const onIOS = isAppleIAP();
  const useRC = onIOS && REVENUECAT_ENABLED;

  // Subscribe to RevenueCat readiness changes
  useEffect(() => {
    if (!useRC) return;
    const unsub = subscribeToRCReadiness(setRcReadiness);
    setRcReadiness(getRCReadiness());
    return unsub;
  }, [useRC]);

  // Reset retry lock when RC readiness leaves 'failed'
  useEffect(() => {
    if (rcReadiness !== 'failed') setIsRetrying(false);
  }, [rcReadiness]);

  // Subscribe to old Apple IAP readiness changes (only used when RC is off)
  useEffect(() => {
    if (!onIOS || useRC) return;
    const unsubscribe = subscribeToAppleIAPReadiness(setIapReadiness);
    setIapReadiness(getAppleIAPReadiness());
    return unsubscribe;
  }, [onIOS, useRC]);

  useEffect(() => {
    if (iapReadiness !== 'failed') setIsRetrying(false);
  }, [iapReadiness]);

  // ── Derive RC price string from current offering ────────────────────────────
  const rcOffering = getRCCurrentOffering();
  const rcPackage = rcOffering?.availablePackages?.[0] ?? null;
  const rcPriceString: string =
    rcPackage?.product?.priceString ?? '$5.00';

  // ── Handle upgrade ──────────────────────────────────────────────────────────
  const handleUpgrade = async () => {
    if (currentPlan === 'SUPER_HERO') {
      toast({ title: "You're already a Super Hero!", description: "You have unlimited access to all features." });
      onClose();
      return;
    }

    // ── RevenueCat iOS path ─────────────────────────────────────────────────
    if (useRC) {
      if (rcReadiness !== 'ready') {
        console.warn('[RevenueCat] handleUpgrade blocked — readiness:', rcReadiness);
        return;
      }

      setIsLoading(true);
      try {
        const { currentUser } = useAppStore.getState();
        if (!currentUser?.id || !user) throw new Error('Not logged in');

        // Associate Firebase UID with RevenueCat before purchase
        await identifyRevenueCatUser(user.uid);

        const result = await purchaseSuperHero();

        if (result.success) {
          // Sync plan to backend
          const token = await user.getIdToken();
          await fetch('/api/revenuecat/activate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });

          queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscription/status'] });
          const store = useAppStore.getState();
          if (store.currentUser) {
            store.setCurrentUser({ ...store.currentUser, plan: 'SUPER_HERO', subscriptionStatus: 'active' });
          }
          toast({
            title: "Welcome, Super Hero!",
            description: "Your subscription is now active. Enjoy unlimited access!",
          });
          onClose();
        } else if (result.cancelled) {
          // Silent — user dismissed the sheet
        } else {
          toast({
            title: "Purchase Issue",
            description: result.error || "Something went wrong. Please try again.",
            variant: "destructive",
          });
        }
      } catch (err: any) {
        console.error('[RevenueCat] purchase error:', err);
        toast({ title: "Error", description: "Failed to start purchase. Please try again.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Old iOS paths (REVENUECAT_ENABLED = false) ──────────────────────────
    if (onIOS) {
      if (!APPLE_IAP_ENABLED) {
        console.log('[AppleIAP] flag disabled — opening web subscribe in Safari');
        window.open('https://app.marvelcardvault.com/subscribe', '_system');
        return;
      }

      if (!isAppleIAPReady()) {
        console.warn('[AppleIAP] handleUpgrade blocked — readiness:', getAppleIAPReadiness());
        return;
      }

      setIsLoading(true);
      try {
        const { currentUser } = useAppStore.getState();
        if (!currentUser?.id || !user) throw new Error('Not logged in');
        const result = await purchaseAppleSubscription(currentUser.id, () => user.getIdToken());
        if (result.success) {
          toast({ title: "Welcome, Super Hero!", description: "Your subscription is now active. Enjoy unlimited access!" });
          queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscription/status'] });
          const store = useAppStore.getState();
          if (store.currentUser) {
            store.setCurrentUser({ ...store.currentUser, plan: 'SUPER_HERO', subscriptionStatus: 'active' });
          }
          onClose();
        } else if (result.cancelled) {
          // Silent
        } else {
          toast({ title: "Purchase Issue", description: result.error || "Something went wrong. Please try again.", variant: "destructive" });
        }
      } catch (error: any) {
        console.error("Apple IAP error:", error);
        toast({ title: "Error", description: "Failed to start purchase. Please try again.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Android: open web subscribe ─────────────────────────────────────────
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      window.open('https://app.marvelcardvault.com/subscribe', '_system');
      return;
    }

    // ── Web: Stripe checkout ────────────────────────────────────────────────
    setIsLoading(true);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      const data = await response.json();
      if (response.ok && data.url) {
        window.location.href = data.url;
      } else if (response.status === 400 && data.message?.includes("already")) {
        toast({ title: "You're already subscribed!", description: "You have an active Super Hero subscription." });
        onClose();
      } else {
        throw new Error(data.message || "No checkout URL received");
      }
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      toast({ title: "Error", description: "Failed to start upgrade process. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Restore purchases (RevenueCat) ──────────────────────────────────────────
  const handleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    try {
      if (user) await identifyRevenueCatUser(user.uid);
      const result = await restoreRevenueCatPurchases();
      if (result.entitled) {
        const token = await user?.getIdToken();
        await fetch('/api/revenuecat/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscription/status'] });
        const store = useAppStore.getState();
        if (store.currentUser) {
          store.setCurrentUser({ ...store.currentUser, plan: 'SUPER_HERO', subscriptionStatus: 'active' });
        }
        toast({ title: "Purchases Restored!", description: "Your Super Hero subscription is active again." });
        onClose();
      } else if (result.success) {
        toast({ title: "No Active Subscription Found", description: "No previous Super Hero subscription was found on this Apple ID.", variant: "destructive" });
      } else {
        toast({ title: "Restore Failed", description: result.error || "Could not restore purchases. Please try again.", variant: "destructive" });
      }
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Button disabled logic ───────────────────────────────────────────────────
  const iapButtonDisabled =
    isLoading ||
    (useRC && (rcReadiness === 'loading' || rcReadiness === 'unavailable' || rcReadiness === 'failed')) ||
    (!useRC && onIOS && APPLE_IAP_ENABLED && (iapReadiness === 'loading' || iapReadiness === 'unavailable' || iapReadiness === 'failed'));

  // ── Button label ────────────────────────────────────────────────────────────
  function getButtonLabel() {
    if (isLoading) return null; // handled by spinner
    if (useRC) {
      if (rcReadiness === 'loading') return 'Loading…';
      if (rcReadiness === 'failed') return 'Unavailable';
      return `Subscribe — ${rcPriceString}/mo`;
    }
    if (onIOS && !APPLE_IAP_ENABLED) return 'Continue on Web';
    return 'Upgrade to Super Hero';
  }

  // ── RC status message ───────────────────────────────────────────────────────
  function RCStatusMessage() {
    if (!useRC) return null;

    if (rcReadiness === 'loading') {
      return (
        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading subscription options…</span>
        </div>
      );
    }

    if (rcReadiness === 'failed') {
      return (
        <button
          onClick={() => {
            if (isRetrying) return;
            setIsRetrying(true);
            retryRevenueCat();
          }}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors mt-1 py-1"
        >
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span>Unable to load subscription. Tap to retry.</span>
        </button>
      );
    }

    return null;
  }

  // ── Old Apple IAP status message (only used when RC is off) ────────────────
  const handleIAPRetry = () => {
    if (isRetrying) return;
    setIsRetrying(true);
    preloadAppleIAP();
  };

  function LegacyIAPStatusMessage() {
    if (!onIOS || useRC) return null;

    if (iapReadiness === 'loading') {
      return (
        <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Setting up in-app purchases…</span>
        </div>
      );
    }

    if (iapReadiness === 'failed') {
      return (
        <button
          onClick={handleIAPRetry}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors mt-1 py-1"
        >
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span>In-app purchases are unavailable right now. Tap to retry.</span>
        </button>
      );
    }

    if (iapReadiness === 'unavailable') {
      return (
        <div className="flex items-start gap-1.5 text-xs text-amber-400 mt-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>In-app purchases are not available on this device. Check your App Store account.</span>
        </div>
      );
    }

    return null;
  }

  // ── Already subscribed view ─────────────────────────────────────────────────
  if (currentPlan === 'SUPER_HERO') {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] p-0 overflow-hidden border-0 rounded-2xl bg-gray-950 fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[100] [&>button]:text-white [&>button]:hover:text-gray-300" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Already a Super Hero</DialogTitle>
          <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex flex-col items-center">
            <img src={logoImage} alt="Marvelous Card Vault" className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl mb-3" />
            <h2 className="text-lg sm:text-xl font-bold text-white text-center">You're Already a Super Hero!</h2>
          </div>

          <div className="px-5 sm:px-6 pt-3 sm:pt-4 pb-5 sm:pb-6 space-y-4 sm:space-y-5">
            <p className="text-gray-300 text-sm text-center leading-relaxed">
              No need to upgrade — you already have unlimited access to all features.
            </p>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">Your Super Hero powers include:</p>
              <div className="space-y-2.5">
                {[
                  "Unlimited cards in your collection",
                  "Show off your full binder to friends",
                  "Track every set, subset, and variant",
                ].map((feature, index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                    <span className="text-sm text-white">{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={onClose}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-yellow-900 font-bold py-5 sm:py-6 rounded-xl text-sm sm:text-base shadow-lg transition-all duration-200"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Got it!
            </Button>

            <p className="text-center text-[11px] text-gray-500 italic pt-1 border-t border-gray-800">
              This is a preview of what Sidekick users see when they hit the 250-card limit.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main upgrade modal ──────────────────────────────────────────────────────
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] p-0 overflow-hidden border-0 rounded-2xl bg-gray-950 fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[100] [&>button]:text-white [&>button]:hover:text-gray-300" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Upgrade to Super Hero</DialogTitle>
        <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex flex-col items-center">
          <img src={logoImage} alt="Marvelous Card Vault" className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl mb-3" />
          <h2 className="text-lg sm:text-xl font-bold text-white text-center">
            Your Sidekick limit has been reached
          </h2>
        </div>

        <div className="px-5 sm:px-6 pt-3 sm:pt-4 pb-5 sm:pb-6 space-y-4 sm:space-y-5">
          <p className="text-gray-300 text-sm text-center leading-relaxed">
            You've added all the cards a Sidekick can carry.
            To keep growing your vault, it's time to level up.
          </p>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-white">Upgrade to Super Hero and:</p>
            <div className="space-y-2.5">
              {[
                "Add unlimited cards to your collection",
                "Show off your full binder to friends",
                "Track every set, subset, and variant",
              ].map((feature, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <Star className="w-4 h-4 text-red-500 fill-red-500 flex-shrink-0" />
                  <span className="text-sm text-white">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleUpgrade}
              disabled={iapButtonDisabled}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-5 sm:py-6 rounded-xl text-sm sm:text-base shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Processing…
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  {getButtonLabel()}
                </>
              )}
            </Button>

            {useRC ? (
              <RCStatusMessage />
            ) : onIOS && !APPLE_IAP_ENABLED ? (
              <p className="text-center text-xs text-gray-400 mt-1 leading-relaxed">
                Subscriptions can be completed securely on our website.
                Your access will update automatically when you return to the app.
              </p>
            ) : (
              <LegacyIAPStatusMessage />
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-1">
              <Lock className="w-3 h-3" />
              <span>Your existing cards are safe. Upgrade anytime to keep adding.</span>
            </div>
          </div>

          {/* Restore Purchases — RevenueCat only */}
          {useRC && (
            <button
              onClick={handleRestore}
              disabled={isRestoring}
              className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1 disabled:opacity-50"
            >
              {isRestoring ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Restoring…
                </span>
              ) : (
                'Restore Purchases'
              )}
            </button>
          )}

          {/* Apple-required subscription disclosure — shown on all iOS paths */}
          {onIOS && (
            <div className="border-t border-gray-800 pt-3 space-y-1.5">
              <p className="text-center text-[11px] font-semibold text-gray-300">
                Super Hero Subscription
              </p>
              <p className="text-center text-[11px] text-gray-400">
                {rcPriceString}/month · 1 month, auto-renewing
              </p>
              <p className="text-center text-[11px] text-gray-400 leading-relaxed">
                Includes unlimited card tracking, tradeblock access, and premium collection tools.
                Cancel anytime in your account settings.
              </p>
              <div className="flex items-center justify-center gap-3 pt-0.5">
                <button
                  onClick={() => window.open('https://marvelcardvault.com/terms', '_system')}
                  className="text-[11px] text-red-400 hover:text-red-300 underline"
                >
                  Terms of Use
                </button>
                <span className="text-gray-600 text-[11px]">·</span>
                <button
                  onClick={() => window.open('https://marvelcardvault.com/privacy', '_system')}
                  className="text-[11px] text-red-400 hover:text-red-300 underline"
                >
                  Privacy Policy
                </button>
              </div>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full text-center text-sm text-gray-300 hover:text-white transition-colors py-2.5 border border-gray-600 hover:border-gray-400 rounded-xl"
          >
            Not now — I'll upgrade later
          </button>

          <p className="text-center text-[11px] text-gray-500 italic pt-1 border-t border-gray-800">
            Sidekicks save the day. Super Heroes complete the collection.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
