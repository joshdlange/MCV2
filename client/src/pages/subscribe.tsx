import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/contexts/AuthContext";
import logoImage from "@assets/Marvelous_Card_Valut_-_Trans_1772678671637.png";

export default function Subscribe() {
  const [, setLocation] = useLocation();
  const { currentUser } = useAppStore();
  const { loading: authLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

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
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Try Again
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
