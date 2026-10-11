import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Zap, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { Capacitor } from '@capacitor/core';
import { confirmUpgrade } from "@/lib/confirmUpgrade";

export default function SubscriptionSuccess() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { currentUser } = useAppStore();
  const { refreshUser } = useAuth();
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReturnButton, setShowReturnButton] = useState(false);
  const [retry, setRetry] = useState(0);

  // iOS deep link return: after web subscribe, fire the custom URL scheme to re-open the app
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('from_ios') !== 'true' || !/iPhone|iPad|iPod/.test(navigator.userAgent)) return;

    // Give Stripe webhook ~1.5 s to process, then attempt deep link
    const deepLinkTimer = setTimeout(() => {
      // Pass session_id through so the in-app deep link handler can call verify-checkout-session
      const sessionId = params.get('session_id');
      const deepLink = sessionId
        ? `marvelcardvault://subscription-success?session_id=${encodeURIComponent(sessionId)}`
        : 'marvelcardvault://subscription-success';
      window.location.href = deepLink;

      // Fallback: if the deep link didn't fire the app within 2 s, show manual button
      const fallbackTimer = setTimeout(() => {
        setShowReturnButton(true);
      }, 2000);

      return () => clearTimeout(fallbackTimer);
    }, 1500);

    return () => clearTimeout(deepLinkTimer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const verifyCheckout = async () => {
      setVerifying(true);
      setError(null);
      const params = new URLSearchParams(search);
      const sessionId = params.get('session_id');

      try {
        // A webhook may activate the account even if checkout verification
        // temporarily fails. Fresh account state is the final authority.
        let checkoutError: unknown;
        if (sessionId) {
          try {
            await apiRequest('POST', '/api/verify-checkout-session', { sessionId });
          } catch (err) {
            checkoutError = err;
          }
        }
        const active = await confirmUpgrade(refreshUser, controller.signal);
        if (controller.signal.aborted) return;
        if (!active) throw checkoutError || new Error("Your upgrade is not confirmed yet. Please retry; do not pay again.");
        queryClient.invalidateQueries({ queryKey: ['/api/auth/sync'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/stats'] });

        if (Capacitor.isNativePlatform()) {
          window.location.href = '/';
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error('Checkout verification failed:', err);
        setError('Your upgrade is not confirmed yet. Please retry; do not pay again.');
      } finally {
        if (!controller.signal.aborted) setVerifying(false);
      }
    };

    if (currentUser) {
      verifyCheckout();
    }
    return () => controller.abort();
  }, [search, currentUser?.id, retry]);

  if (verifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-blue-900/20 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="py-12">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-purple-600 mb-4" />
            <p className="text-muted-foreground">Activating your Super Hero membership...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-blue-900/20 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-orange-600 dark:text-orange-400" />
            </div>
            <CardTitle className="text-xl font-bold">Verification Pending</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              {error}
            </p>
            <p className="text-sm text-muted-foreground">
              If activation still cannot be confirmed, contact support. You do not need to purchase again.
            </p>
            <Button onClick={() => setRetry(value => value + 1)} className="w-full">Retry activation</Button>
            <Button 
              onClick={() => {
                queryClient.invalidateQueries();
                setLocation("/");
              }}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-blue-900/20 flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Welcome to Super Hero!
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Your subscription has been activated successfully. You now have access to:
            </p>
            
            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-center space-x-2 text-sm">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Unlimited card tracking</span>
              </div>
              <div className="flex items-center justify-center space-x-2 text-sm">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Full community access</span>
              </div>
              <div className="flex items-center justify-center space-x-2 text-sm">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Advanced analytics</span>
              </div>
            </div>
          </div>

          <Button 
            onClick={() => {
              queryClient.invalidateQueries();
              setLocation("/");
            }}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
            data-testid="button-go-to-dashboard"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          {showReturnButton && (
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() => { window.location.href = 'marvelcardvault://subscription-success'; }}
                className="w-full"
              >
                Tap here to return to Marvel Card Vault
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                If the app doesn't reopen automatically, switch back to Marvel Card Vault manually.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
