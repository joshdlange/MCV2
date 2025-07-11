import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signInWithGoogle } from "@/lib/firebase";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ArrowRight, Sparkles, Info } from "lucide-react";
import heroLogoWhite from "@assets/noun-super-hero-380874-FFFFFF.png";
import { useAppStore } from "@/lib/store";

export function Login() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showFeatures, setShowFeatures] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'SIDE_KICK' | 'SUPER_HERO' | null>(null);
  const { setCurrentUser } = useAppStore();

  const { data: allCards } = useQuery({
    queryKey: ["/api/cards"],
    select: (data: any) => {
      if (!Array.isArray(data)) return [];
      // Randomize and take up to 12 cards for carousel
      const shuffled = data.sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 12);
    },
  });

  useEffect(() => {
    if (allCards && allCards.length > 0) {
      const interval = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % allCards.length);
      }, 4000); // Slower for better viewing
      
      return () => clearInterval(interval);
    }
  }, [allCards]);

  const handleGoogleSignIn = () => {
    signInWithGoogle();
  };

  const handlePlanSelection = (plan: 'SIDE_KICK' | 'SUPER_HERO') => {
    setSelectedPlan(plan);
    // Store the plan choice in localStorage so we can handle it after sign-in
    localStorage.setItem('selectedPlan', plan);
    handleGoogleSignIn();
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
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      {/* Hero Section */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Card Carousel Section */}
        <div className="w-full lg:w-3/5 relative flex flex-col justify-center items-center p-6 lg:p-12 bg-gradient-to-br from-purple-900/20 via-pink-900/20 to-blue-900/20">
          {/* Animated Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-pink-600/10 to-blue-600/10 animate-pulse"></div>
          
          {/* Logo */}
          <div className="relative z-10 text-center mb-8 lg:mb-12">
            <h1 className="text-4xl lg:text-6xl font-bold mb-4 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent">
              MARVEL
            </h1>
            <h2 className="text-2xl lg:text-3xl font-semibold text-white mb-2">Card Vault</h2>
            <p className="text-lg text-gray-300 max-w-md mx-auto">Collect, trade, and showcase your Marvel universe</p>
          </div>

          {/* Dynamic Card Carousel */}
          {allCards && allCards.length > 0 && (
            <div className="relative z-10 w-full max-w-sm lg:max-w-md">
              <div className="relative group">
                {/* Main Card Display */}
                <div className="relative w-64 h-80 lg:w-80 lg:h-96 mx-auto rounded-2xl overflow-hidden shadow-2xl transform transition-all duration-500 hover:scale-105">
                  <img
                    src={allCards[currentImageIndex]?.frontImageUrl}
                    alt={allCards[currentImageIndex]?.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = '/placeholder-card.jpg';
                    }}
                  />
                  
                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                  
                  {/* Card Info Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <h3 className="text-white font-bold text-xl lg:text-2xl mb-2 leading-tight">
                      {allCards[currentImageIndex]?.name}
                    </h3>
                    <p className="text-gray-300 text-sm lg:text-base mb-2">
                      {allCards[currentImageIndex]?.set?.name}
                    </p>
                    {allCards[currentImageIndex]?.isInsert && (
                      <span className="inline-block bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        INSERT
                      </span>
                    )}
                  </div>

                  {/* Mobile Swipe Buttons */}
                  <button
                    onClick={() => handleSwipe('left')}
                    className="lg:hidden absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => handleSwipe('right')}
                    className="lg:hidden absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                  >
                    →
                  </button>
                </div>

                {/* Card Indicators */}
                <div className="flex justify-center mt-6 space-x-2">
                  {allCards.slice(0, 8).map((_: any, index: number) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        index === currentImageIndex % 8 
                          ? 'bg-gradient-to-r from-pink-500 to-purple-500 scale-125' 
                          : 'bg-gray-600 hover:bg-gray-500'
                      }`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              </div>

              {/* Learn More Button */}
              <div className="text-center mt-8">
                <Button
                  variant="outline"
                  onClick={() => setShowFeatures(!showFeatures)}
                  className="bg-transparent border-gray-500 text-gray-300 hover:bg-gray-800 hover:text-white transition-all"
                >
                  <Info className="w-4 h-4 mr-2" />
                  Learn More
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Authentication Section */}
        <div className="w-full lg:w-2/5 flex items-center justify-center p-6 lg:p-12 bg-gradient-to-b from-gray-900 to-black">
          <div className="w-full max-w-md">
            {/* Main CTA Card */}
            <Card className="bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700 shadow-2xl">
              <CardHeader className="text-center pb-6">
                <div className="w-20 h-20 bg-gradient-to-r from-red-600 to-red-700 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                  <img 
                    src={heroLogoWhite} 
                    alt="Marvel Card Vault" 
                    className="w-10 h-10 object-contain"
                  />
                </div>
                <CardTitle className="text-3xl font-bold text-white mb-2">
                  Join the Vault
                </CardTitle>
                <CardDescription className="text-gray-300 text-lg">
                  Start your Marvel collection journey today
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Button 
                  onClick={handleGoogleSignIn}
                  className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-4 text-lg font-bold rounded-xl shadow-lg transform transition-all duration-200 hover:scale-105"
                  size="lg"
                >
                  <svg className="w-6 h-6 mr-3" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>

                {/* Quick Features */}
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-400">FREE</div>
                    <div className="text-xs text-gray-400">Start collecting</div>
                  </div>
                  <div className="p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-400">250+</div>
                    <div className="text-xs text-gray-400">Cards to track</div>
                  </div>
                </div>

                {/* Upgrade Option */}
                <div className="p-4 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-lg border border-purple-500/20">
                  <div className="text-center">
                    <div className="text-lg font-bold text-white mb-2">
                      Want unlimited cards?
                    </div>
                    <div className="text-sm text-gray-300 mb-3">
                      Upgrade to Super Hero for $4/month
                    </div>
                    <Button 
                      onClick={() => handlePlanSelection('SUPER_HERO')}
                      variant="outline"
                      size="sm"
                      className="border-purple-500 text-purple-300 hover:bg-purple-600 hover:text-white"
                    >
                      Subscribe Now
                    </Button>
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-xs text-gray-500">
                    By signing in, you agree to our Terms & Privacy Policy
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Features Modal/Section */}
      {showFeatures && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-white">Why Choose Marvel Card Vault?</h3>
              <Button
                variant="ghost"
                onClick={() => setShowFeatures(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </Button>
            </div>
            
            <div className="grid gap-6">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-white mb-1">Smart Collection Tracking</h4>
                  <p className="text-gray-400 text-sm">Organize your Marvel cards with condition tracking, set completion, and value estimates.</p>
                </div>
              </div>
              
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-pink-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-white mb-1">Marketplace Integration</h4>
                  <p className="text-gray-400 text-sm">Buy, sell, and trade with other collectors in our secure marketplace (SUPER HERO plan).</p>
                </div>
              </div>

              <div className="mt-6 p-6 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl border border-purple-700/30">
                <h4 className="font-bold text-white mb-3">Choose Your Plan</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button 
                    onClick={() => handlePlanSelection('SIDE_KICK')}
                    className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer text-left"
                  >
                    <div className="font-semibold text-gray-300">SIDE KICK</div>
                    <div className="text-2xl font-bold text-green-400 mb-2">FREE</div>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>• Up to 250 cards</li>
                      <li>• Basic tracking</li>
                      <li>• Wishlist management</li>
                    </ul>
                    <div className="mt-3 text-xs text-gray-500">Click to sign up</div>
                  </button>
                  <button 
                    onClick={() => handlePlanSelection('SUPER_HERO')}
                    className="p-4 bg-gradient-to-br from-purple-800 to-pink-800 rounded-lg border border-purple-500 hover:from-purple-700 hover:to-pink-700 transition-colors cursor-pointer text-left"
                  >
                    <div className="font-semibold text-white">SUPER HERO</div>
                    <div className="text-2xl font-bold text-white mb-2">$4/mo</div>
                    <ul className="text-sm text-gray-200 space-y-1">
                      <li>• Unlimited cards</li>
                      <li>• Marketplace access</li>
                      <li>• Advanced analytics</li>
                    </ul>
                    <div className="mt-3 text-xs text-gray-300">Click to sign up & subscribe</div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}