import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signInWithGoogle } from "@/lib/firebase";

export function Login() {
  const handleGoogleSignIn = () => {
    signInWithGoogle();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-600 to-blue-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-red-600">MARVEL</CardTitle>
          <CardTitle className="text-xl">Card Vault</CardTitle>
          <CardDescription>
            Sign in to manage your Marvel card collection
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleGoogleSignIn}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}