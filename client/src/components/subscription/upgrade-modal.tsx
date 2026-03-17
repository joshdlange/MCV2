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
import { useAppStore } from "@/lib/store";
import { queryClient } from "@/lib/queryClient";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
}

export function UpgradeModal({ isOpen, onClose, currentPlan }: UpgradeModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [iapReadiness, setIapReadiness] = useState<AppleIAPReadiness>(getAppleIAPReadiness());
  // Guards against double-tap on the retry link while preloadAppleIAP() is still
  // picking up. preloadAppleIAP() guards against parallel calls once readiness
  // flips to 'loading', but there is a brief window before that flip happens.
  const [isRetrying, setIsRetrying] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  // Subscribe to IAP readiness changes so the button reacts without polling
  useEffect(() => {
    if (!isAppleIAP()) return;
    const unsubscribe = subscribeToAppleIAPReadiness(setIapReadiness);
    // Sync in case readiness changed between renders
    setIapReadiness(getAppleIAPReadiness());
    return unsubscribe;
  }, []);

  // Reset retry lock whenever readiness moves away from 'failed'
  // (i.e. once loading begins or on success/unavailable)
  useEffect(() => {
    if (iapReadiness !== 'failed') {
      setIsRetrying(false);
    }
  }, [iapReadiness]);

  const handleUpgrade = async () => {
    if (currentPlan === 'SUPER_HERO') {
      toast({
        title: "You're already a Super Hero!",
        description: "You have unlimited access to all features.",
      });
      onClose();
      return;
    }

    if (isAppleIAP()) {
      // Web-subscription (Spotify model) — flag off: open marvelcardvault.com in Safari
      if (!APPLE_IAP_ENABLED) {
        console.log('[AppleIAP] flag disabled — opening web subscribe in Safari');
        window.open('https://app.marvelcardvault.com/subscribe', '_system');
        return;
      }

      // Native StoreKit flow — flag on (future re-enablement)
      // Hard gate: readiness MUST be 'ready' (all four conditions: plugin, store, product, offer)
      // The button is already disabled when not ready, but this is an explicit second check.
      if (!isAppleIAPReady()) {
        console.warn('[AppleIAP] handleUpgrade blocked — readiness is "' + getAppleIAPReadiness() + '", must be "ready"');
        return;
      }
      console.log('[AppleIAP] handleUpgrade: readiness=ready — proceeding to purchaseAppleSubscription');

      setIsLoading(true);
      try {
        const { currentUser } = useAppStore.getState();
        if (!currentUser?.id || !user) {
          throw new Error('Not logged in');
        }
        const result = await purchaseAppleSubscription(
          currentUser.id,
          () => user.getIdToken()
        );
        if (result.success) {
          toast({
            title: "Welcome, Super Hero!",
            description: "Your subscription is now active. Enjoy unlimited access!",
          });
          queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
          queryClient.invalidateQueries({ queryKey: ['/api/subscription/status'] });
          const store = useAppStore.getState();
          if (store.currentUser) {
            store.setCurrentUser({ ...store.currentUser, plan: 'SUPER_HERO', subscriptionStatus: 'active' });
          }
          onClose();
        } else if (result.cancelled) {
          // User cancelled — silent, no toast
        } else {
          toast({
            title: "Purchase Issue",
            description: result.error || "Something went wrong. Please try again.",
            variant: "destructive",
          });
        }
      } catch (error: any) {
        console.error("Apple IAP error:", error);
        toast({
          title: "Error",
          description: "Failed to start purchase. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      window.open('https://app.marvelcardvault.com/subscribe', '_system');
      return;
    }

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
        toast({
          title: "You're already subscribed!",
          description: "You have an active Super Hero subscription.",
        });
        onClose();
      } else {
        throw new Error(data.message || "No checkout URL received");
      }
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      toast({
        title: "Error",
        description: "Failed to start upgrade process. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Determine Apple IAP button state when on iOS
  const onIOS = isAppleIAP();
  // When APPLE_IAP_ENABLED is false, the button is always enabled (opens web)
  const iapButtonDisabled =
    isLoading ||
    (onIOS && APPLE_IAP_ENABLED && (iapReadiness === 'loading' || iapReadiness === 'unavailable' || iapReadiness === 'failed'));

  const handleIAPRetry = () => {
    if (isRetrying) {
      console.log('[AppleIAP] retry tap ignored — already retrying');
      return;
    }
    console.log('[AppleIAP] User tapped retry — calling preloadAppleIAP()');
    setIsRetrying(true);
    preloadAppleIAP();
  };

  function IAPStatusMessage() {
    if (!onIOS) return null;

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

  if (currentPlan === 'SUPER_HERO') {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] p-0 overflow-hidden border-0 rounded-2xl bg-gray-950 fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[100] [&>button]:text-white [&>button]:hover:text-gray-300" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Already a Super Hero</DialogTitle>
          <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex flex-col items-center">
            <img 
              src={logoImage} 
              alt="Marvelous Card Vault" 
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl mb-3"
            />
            <h2 className="text-lg sm:text-xl font-bold text-white text-center">
              You're Already a Super Hero!
            </h2>
          </div>

          <div className="px-5 sm:px-6 pt-3 sm:pt-4 pb-5 sm:pb-6 space-y-4 sm:space-y-5">
            <p className="text-gray-300 text-sm text-center leading-relaxed">
              No need to upgrade — you already have unlimited access to all features.
            </p>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-white">
                Your Super Hero powers include:
              </p>
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] p-0 overflow-hidden border-0 rounded-2xl bg-gray-950 fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[100] [&>button]:text-white [&>button]:hover:text-gray-300" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Upgrade to Super Hero</DialogTitle>
        <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex flex-col items-center">
          <img 
            src={logoImage} 
            alt="Marvelous Card Vault" 
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl mb-3"
          />
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
            <p className="text-sm font-semibold text-white">
              Upgrade to Super Hero and:
            </p>
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
                  {onIOS && !APPLE_IAP_ENABLED ? 'Subscribe to Super Hero' : 'Upgrade to Super Hero'}
                </>
              )}
            </Button>

            {onIOS && !APPLE_IAP_ENABLED ? (
              <p className="text-center text-xs text-gray-400 mt-1 leading-relaxed">
                You'll be taken to our website to complete your subscription.
                The app will update automatically when you return.
              </p>
            ) : (
              <IAPStatusMessage />
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-1">
              <Lock className="w-3 h-3" />
              <span>Your existing cards are safe. Upgrade anytime to keep adding.</span>
            </div>
          </div>

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
