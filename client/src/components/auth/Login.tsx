import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { signInWithGoogleUnified } from "../../auth/googleSignIn";
import { signUpWithEmail, signInWithEmail, resetPassword } from "@/lib/firebase";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ArrowRight, Sparkles, Eye, EyeOff, Mail, Lock, User, AlertCircle, CheckCircle } from "lucide-react";
import marvelCardVaultLogo from "@assets/Marvel_Card_Vault_Logo_1765487074024.png";
import { useAppStore } from "@/lib/store";

export function Login() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('');
  const [signUpDisplayName, setSignUpDisplayName] = useState('');
  const [resetEmail, setResetEmail] = useState('');

  const { setCurrentUser } = useAppStore();

  const { data: allCards } = useQuery({
    queryKey: ["/api/cards"],
    select: (data: any) => {
      if (!Array.isArray(data)) return [];
      const shuffled = data.sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 12);
    },
  });

  useEffect(() => {
    if (allCards && allCards.length > 0) {
      const interval = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % allCards.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [allCards]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const cred = await signInWithGoogleUnified();
      console.log("Logged in as:", cred.user.uid);
      window.location.href = "/";
    } catch (err: any) {
      console.error("Google login failed:", err);
      setError(err.message || "Google sign-in failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    try {
      await signInWithEmail(signInEmail, signInPassword);
      window.location.href = "/";
    } catch (err: any) {
      console.error("Email sign-in failed:", err);
      if (err.code === 'auth/user-not-found') {
        setError("No account found with this email. Please sign up first.");
      } else if (err.code === 'auth/wrong-password') {
        setError("Incorrect password. Please try again.");
      } else if (err.code === 'auth/invalid-email') {
        setError("Please enter a valid email address.");
      } else if (err.code === 'auth/too-many-requests') {
        setError("Too many failed attempts. Please try again later.");
      } else {
        setError(err.message || "Sign-in failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (signUpPassword !== signUpConfirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    
    if (signUpPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    
    if (!signUpDisplayName.trim()) {
      setError("Please enter your display name.");
      return;
    }
    
    setIsLoading(true);
    
    try {
      await signUpWithEmail(signUpEmail, signUpPassword, signUpDisplayName);
      window.location.href = "/";
    } catch (err: any) {
      console.error("Email sign-up failed:", err);
      if (err.code === 'auth/email-already-in-use') {
        setError("An account with this email already exists. Please sign in instead.");
      } else if (err.code === 'auth/invalid-email') {
        setError("Please enter a valid email address.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password is too weak. Please use a stronger password.");
      } else {
        setError(err.message || "Sign-up failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);
    
    try {
      await resetPassword(resetEmail);
      setSuccessMessage("Password reset email sent! Check your inbox.");
      setResetEmail('');
    } catch (err: any) {
      console.error("Password reset failed:", err);
      if (err.code === 'auth/user-not-found') {
        setError("No account found with this email address.");
      } else if (err.code === 'auth/invalid-email') {
        setError("Please enter a valid email address.");
      } else {
        setError(err.message || "Password reset failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwipe = (direction: 'left' | 'right') => {
    if (!allCards || allCards.length === 0) return;
    
    if (direction === 'right') {
      setCurrentImageIndex((prev) => (prev + 1) % allCards.length);
    } else {
      setCurrentImageIndex((prev) => (prev - 1 + allCards.length) % allCards.length);
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <div className="flex flex-col lg:flex-row min-h-screen">
        
        {/* Left Side - Hero Section with Card Carousel */}
        <div className="w-full lg:w-1/2 relative flex flex-col justify-center items-center p-6 lg:p-12 bg-gradient-to-br from-red-900/30 via-black to-red-950/20">
          <div className="absolute inset-0 bg-gradient-to-br from-red-600/5 via-transparent to-red-600/10"></div>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
          
          {/* Logo & Branding */}
          <div className="relative z-10 text-center mb-8 lg:mb-10">
            <div className="flex items-center justify-center mb-4">
              <img 
                src={marvelCardVaultLogo} 
                alt="Marvel Card Vault" 
                className="w-48 h-48 lg:w-56 lg:h-56 object-contain"
              />
            </div>
            <p className="text-lg lg:text-xl text-gray-300 max-w-md mx-auto font-light">
              Your ultimate destination for collecting, trading, and tracking Marvel cards
            </p>
          </div>

          {/* Card Carousel */}
          {allCards && allCards.length > 0 && (
            <div className="relative z-10 w-full max-w-xs lg:max-w-sm">
              <div className="relative group">
                <div className="relative w-56 h-72 lg:w-64 lg:h-80 mx-auto rounded-xl overflow-hidden shadow-2xl shadow-red-500/20 border border-red-500/20 transform transition-all duration-500 hover:scale-105">
                  <img
                    src={allCards[currentImageIndex]?.frontImageUrl}
                    alt={allCards[currentImageIndex]?.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = '/placeholder-card.jpg';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-white font-bold text-lg leading-tight">
                      {allCards[currentImageIndex]?.name}
                    </h3>
                    <p className="text-gray-300 text-sm">
                      {allCards[currentImageIndex]?.set?.name}
                    </p>
                  </div>

                  <button
                    onClick={() => handleSwipe('left')}
                    className="lg:hidden absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-red-600/80 transition-colors"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => handleSwipe('right')}
                    className="lg:hidden absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/60 text-white p-2 rounded-full hover:bg-red-600/80 transition-colors"
                  >
                    →
                  </button>
                </div>

                <div className="flex justify-center mt-4 space-x-2">
                  {allCards.slice(0, 6).map((_: any, index: number) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        index === currentImageIndex % 6 
                          ? 'bg-red-500 scale-125' 
                          : 'bg-gray-600 hover:bg-gray-500'
                      }`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Feature Highlights */}
          <div className="relative z-10 grid grid-cols-3 gap-4 mt-8 lg:mt-10 max-w-md">
            <div className="text-center">
              <div className="text-2xl lg:text-3xl font-bold text-red-500">200K+</div>
              <div className="text-xs text-gray-400">Cards from every set</div>
            </div>
            <div className="text-center">
              <div className="text-2xl lg:text-3xl font-bold text-red-500">FREE</div>
              <div className="text-xs text-gray-400">To Start</div>
            </div>
            <div className="text-center">
              <div className="text-2xl lg:text-3xl font-bold text-red-500">Live</div>
              <div className="text-xs text-gray-400">Values</div>
            </div>
          </div>
        </div>

        {/* Right Side - Authentication */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 bg-gradient-to-b from-gray-900 to-black">
          <div className="w-full max-w-md">
            
            {showForgotPassword ? (
              /* Forgot Password Form */
              <Card className="bg-gray-900/80 border-gray-800 shadow-2xl backdrop-blur">
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-2xl font-bold text-white">Reset Password</CardTitle>
                  <CardDescription className="text-gray-400">
                    Enter your email and we'll send you a reset link
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  )}
                  {successMessage && (
                    <div className="flex items-center gap-2 p-3 bg-green-900/30 border border-green-500/30 rounded-lg text-green-400 text-sm">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      {successMessage}
                    </div>
                  )}
                  
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email" className="text-gray-300">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input
                          id="reset-email"
                          type="email"
                          placeholder="your@email.com"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                          required
                          data-testid="input-reset-email"
                        />
                      </div>
                    </div>
                    
                    <Button 
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-3 font-semibold"
                      data-testid="button-send-reset"
                    >
                      {isLoading ? "Sending..." : "Send Reset Link"}
                    </Button>
                  </form>
                  
                  <Button 
                    variant="ghost"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setError(null);
                      setSuccessMessage(null);
                    }}
                    className="w-full text-gray-400 hover:text-white"
                    data-testid="button-back-to-signin"
                  >
                    Back to Sign In
                  </Button>
                </CardContent>
              </Card>
            ) : (
              /* Sign In / Sign Up Tabs */
              <Card className="bg-gray-900/80 border-gray-800 shadow-2xl backdrop-blur">
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-2xl font-bold text-white">Welcome to the Vault</CardTitle>
                  <CardDescription className="text-gray-400">
                    Start building your Marvel collection today
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  )}
                  
                  <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'signin' | 'signup'); setError(null); }} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-gray-800 mb-4">
                      <TabsTrigger 
                        value="signin" 
                        className="data-[state=active]:bg-red-600 data-[state=active]:text-white"
                        data-testid="tab-signin"
                      >
                        Sign In
                      </TabsTrigger>
                      <TabsTrigger 
                        value="signup" 
                        className="data-[state=active]:bg-red-600 data-[state=active]:text-white"
                        data-testid="tab-signup"
                      >
                        Create Account
                      </TabsTrigger>
                    </TabsList>
                    
                    {/* Sign In Tab */}
                    <TabsContent value="signin" className="space-y-4">
                      <form onSubmit={handleEmailSignIn} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="signin-email" className="text-gray-300">Email</Label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signin-email"
                              type="email"
                              placeholder="your@email.com"
                              value={signInEmail}
                              onChange={(e) => setSignInEmail(e.target.value)}
                              className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signin-email"
                            />
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="signin-password" className="text-gray-300">Password</Label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signin-password"
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              value={signInPassword}
                              onChange={(e) => setSignInPassword(e.target.value)}
                              className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signin-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex justify-end">
                          <button 
                            type="button"
                            onClick={() => { setShowForgotPassword(true); setError(null); }}
                            className="text-sm text-red-400 hover:text-red-300 transition-colors"
                            data-testid="link-forgot-password"
                          >
                            Forgot password?
                          </button>
                        </div>
                        
                        <Button 
                          type="submit"
                          disabled={isLoading}
                          className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-3 font-semibold"
                          data-testid="button-signin"
                        >
                          {isLoading ? "Signing in..." : "Sign In"}
                        </Button>
                      </form>
                    </TabsContent>
                    
                    {/* Sign Up Tab */}
                    <TabsContent value="signup" className="space-y-4">
                      <form onSubmit={handleEmailSignUp} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="signup-name" className="text-gray-300">Display Name</Label>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signup-name"
                              type="text"
                              placeholder="Your name"
                              value={signUpDisplayName}
                              onChange={(e) => setSignUpDisplayName(e.target.value)}
                              className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signup-name"
                            />
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="signup-email" className="text-gray-300">Email</Label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signup-email"
                              type="email"
                              placeholder="your@email.com"
                              value={signUpEmail}
                              onChange={(e) => setSignUpEmail(e.target.value)}
                              className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signup-email"
                            />
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="signup-password" className="text-gray-300">Password</Label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signup-password"
                              type={showPassword ? "text" : "password"}
                              placeholder="Min 6 characters"
                              value={signUpPassword}
                              onChange={(e) => setSignUpPassword(e.target.value)}
                              className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signup-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="signup-confirm-password" className="text-gray-300">Confirm Password</Label>
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <Input
                              id="signup-confirm-password"
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="Confirm your password"
                              value={signUpConfirmPassword}
                              onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                              className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-red-500"
                              required
                              data-testid="input-signup-confirm-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300"
                            >
                              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        
                        <Button 
                          type="submit"
                          disabled={isLoading}
                          className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-3 font-semibold"
                          data-testid="button-signup"
                        >
                          {isLoading ? "Creating Account..." : "Create Account"}
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                  
                  {/* Divider */}
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-700"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-gray-900 px-3 text-gray-500">or continue with</span>
                    </div>
                  </div>
                  
                  {/* Google Sign In */}
                  <Button 
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    variant="outline"
                    className="w-full bg-white hover:bg-gray-100 text-gray-900 border-gray-300 py-3 font-semibold"
                    data-testid="button-google-signin"
                  >
                    <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </Button>
                  
                  {/* Terms */}
                  <p className="text-center text-xs text-gray-500 mt-4">
                    By continuing, you agree to our Terms of Service and Privacy Policy
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
