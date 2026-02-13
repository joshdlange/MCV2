import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Zap, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";

export default function SubscriptionSuccess() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { currentUser } = useAppStore();
  const { refreshUser } = useAuth();
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifyCheckout = async () => {
      const params = new URLSearchParams(search);
      const sessionId = params.get('session_id');
      
      if (!sessionId) {
        setVerifying(false);
        setVerified(true);
        return;
      }

      try {
        const response = await apiRequest('POST', '/api/verify-checkout-session', { sessionId });
        const result = await response.json();
        
        console.log('Checkout verification result:', result);
        setVerified(true);
        
        await refreshUser();
        queryClient.invalidateQueries({ queryKey: ['/api/auth/sync'] });
        queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      } catch (err: any) {
        console.error('Checkout verification failed:', err);
        if (currentUser?.plan === 'SUPER_HERO') {
          setVerified(true);
        } else {
          setError(err.message || 'Failed to verify subscription');
        }
      } finally {
        setVerifying(false);
      }
    };

    if (currentUser) {
      verifyCheckout();
    }
  }, [search, currentUser?.id]);

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
              Your payment was received! Your account upgrade is being processed and should be active within a few minutes.
            </p>
            <p className="text-sm text-muted-foreground">
              If you don't see your upgrade after refreshing, please contact support.
            </p>
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
        </CardContent>
      </Card>
    </div>
  );
}
