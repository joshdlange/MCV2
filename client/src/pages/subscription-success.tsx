import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Zap, ArrowRight } from "lucide-react";

export default function SubscriptionSuccess() {
  const [, setLocation] = useLocation();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('session_id');
    setSessionId(id);
  }, []);

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
                <span>Full marketplace access</span>
              </div>
              <div className="flex items-center justify-center space-x-2 text-sm">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Advanced analytics</span>
              </div>
            </div>
          </div>

          {sessionId && (
            <div className="text-xs text-muted-foreground bg-gray-50 dark:bg-gray-800 p-3 rounded">
              Session ID: {sessionId}
            </div>
          )}

          <Button 
            onClick={() => setLocation("/")}
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