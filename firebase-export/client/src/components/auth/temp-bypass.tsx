import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TempAuthBypass() {
  const { setCurrentUser } = useAppStore();

  const handleTestLogin = () => {
    // Set a test user for testing Stripe integration
    setCurrentUser({
      id: 337, // Existing user ID from the database
      name: "Test User",
      email: "test@example.com",
      avatar: "",
      isAdmin: false,
      plan: "SIDE_KICK",
      subscriptionStatus: "active"
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-blue-900/20 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-center">Firebase Configuration Issue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            There's an issue with the Firebase configuration. You can test the Stripe subscription system with this temporary bypass.
          </p>
          <Button 
            onClick={handleTestLogin}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
          >
            Continue with Test User
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            This will allow you to test the subscription upgrade functionality.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}