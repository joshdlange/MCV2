import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import logoImage from "@assets/Marvelous_Card_Valut_-_Trans_1772678671637.png";

export default function Subscribe() {
  const [, setLocation] = useLocation();
  const { currentUser } = useAppStore();
  const { loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) return;

    if (currentUser.plan === 'SUPER_HERO') {
      setLocation("/");
      return;
    }

    if (redirecting) return;
    setRedirecting(true);

    const startCheckout = async () => {
      try {
        const response = await apiRequest("POST", "/api/create-checkout-session");
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          setError("Could not start checkout. Please try again.");
          setRedirecting(false);
        }
      } catch (err: any) {
        console.error("Error creating checkout session:", err);
        const errMsg = err?.message || '';
        if (errMsg.includes('400') && errMsg.includes('already')) {
          setLocation("/");
          return;
        }
        setError("Something went wrong. Please try again.");
        setRedirecting(false);
      }
    };

    startCheckout();
  }, [currentUser?.id, authLoading]);

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const resp = await apiRequest('POST', '/api/restore-subscription');
      const data = await resp.json();
      if (data.success) {
        await refreshUser();
        queryClient.invalidateQueries({ queryKey: ['/api/auth/sync'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
        toast({ title: "Subscription restored!", description: "Welcome to Super Hero! Redirecting you now." });
        setTimeout(() => setLocation("/"), 1500);
      } else {
        toast({ title: "Couldn't restore", description: data.message || "No active subscription found.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Couldn't restore", description: "No active subscription found for your account. Contact support if you believe this is an error.", variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center bg-gray-900 border-gray-800">
          <CardContent className="py-12 space-y-4">
            <img src={logoImage} alt="Marvelous Card Vault" className="w-16 h-16 mx-auto rounded-xl" />
            <AlertCircle className="w-10 h-10 mx-auto text-red-500" />
            <p className="text-gray-300">{error}</p>
            <Button
              onClick={() => { setError(null); window.location.reload(); }}
              className="bg-red-600 hover:bg-red-700 text-white w-full"
            >
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={handleRestore}
              disabled={restoring}
              className="w-full border-gray-600 text-gray-300 hover:text-white hover:border-gray-400"
            >
              {restoring ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking...</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" />Already paid? Restore subscription</>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setLocation("/")}
              className="text-gray-400 hover:text-white"
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center bg-gray-900 border-gray-800">
        <CardContent className="py-12 space-y-4">
          <img src={logoImage} alt="Marvelous Card Vault" className="w-16 h-16 mx-auto rounded-xl" />
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-red-500" />
          <p className="text-gray-300">
            {authLoading ? "Signing you in..." : "Redirecting to checkout..."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
