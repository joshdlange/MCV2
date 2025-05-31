import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signInWithGoogle } from "@/lib/firebase";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Check, Crown, Star, TrendingUp, Shield, Users } from "lucide-react";

export function Login() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const { data: featuredCards } = useQuery({
    queryKey: ["/api/trending-cards"],
    select: (data: any) => Array.isArray(data) ? data.slice(0, 8) : [],
  });

  useEffect(() => {
    if (featuredCards && featuredCards.length > 0) {
      const interval = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % featuredCards.length);
      }, 3000);
      
      return () => clearInterval(interval);
    }
  }, [featuredCards]);

  const handleGoogleSignIn = () => {
    signInWithGoogle();
  };

  const features = [
    {
      icon: <Star className="w-5 h-5" />,
      title: "Track Your Collection",
      description: "Organize and catalog your Marvel trading cards with detailed information and condition tracking."
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      title: "Market Insights",
      description: "Stay updated with real-time market trends and card valuations."
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Secure & Reliable",
      description: "Your collection data is safely stored and backed up with enterprise-grade security."
    },
    {
      icon: <Users className="w-5 h-5" />,
      title: "Community Marketplace",
      description: "Connect with other collectors to buy, sell, and trade cards."
    }
  ];

  const plans = [
    {
      name: "SIDE KICK",
      price: "Free",
      features: ["Up to 250 cards", "Basic collection tracking", "Card search", "Wishlist management"],
      popular: false
    },
    {
      name: "SUPER HERO",
      price: "$4/month",
      features: ["Unlimited cards", "Marketplace access", "Advanced analytics", "Priority support"],
      popular: true
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Side - Marketing Content */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center p-6 lg:p-12 bg-gradient-to-br from-red-600/10 to-gray-800/50 backdrop-blur-sm">
          <div className="max-w-xl">
            {/* Logo */}
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-white mb-2">
                <span className="text-red-500">MARVEL</span> Card Vault
              </h1>
              <p className="text-xl text-gray-300">The ultimate Marvel trading card collection manager</p>
            </div>

            {/* Featured Card Carousel */}
            {featuredCards && featuredCards.length > 0 && (
              <div className="mb-8 lg:mb-8">
                <div className="relative w-48 h-64 lg:w-64 lg:h-80 mx-auto mb-4 rounded-lg overflow-hidden shadow-2xl">
                  <img
                    src={featuredCards[currentImageIndex]?.frontImageUrl}
                    alt={featuredCards[currentImageIndex]?.name}
                    className="w-full h-full object-cover transition-opacity duration-500"
                    onError={(e) => {
                      e.currentTarget.src = '/placeholder-card.jpg';
                    }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <h3 className="text-white font-semibold">{featuredCards[currentImageIndex]?.name}</h3>
                    <p className="text-gray-300 text-sm">{featuredCards[currentImageIndex]?.set?.name}</p>
                  </div>
                </div>
                <div className="flex justify-center space-x-2">
                  {featuredCards.map((card: any, index: number) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentImageIndex ? 'bg-red-500' : 'bg-gray-600'
                      }`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Features */}
            <div className="space-y-4 mb-8">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start space-x-3">
                  <div className="flex-shrink-0 text-red-500 mt-1">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{feature.title}</h3>
                    <p className="text-gray-400 text-sm">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pricing Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {plans.map((plan, index) => (
                <div key={index} className={`p-4 rounded-lg border ${plan.popular ? 'border-red-500 bg-red-500/10' : 'border-gray-600 bg-gray-800/30'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                    {plan.popular && <Crown className="w-4 h-4 text-yellow-500" />}
                  </div>
                  <p className="text-red-500 font-bold text-lg mb-3">{plan.price}</p>
                  <ul className="space-y-1">
                    {plan.features.slice(0, 2).map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center text-xs text-gray-300">
                        <Check className="w-3 h-3 text-green-500 mr-1 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side - Authentication */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-8">
          <Card className="w-full max-w-md bg-gray-800/90 border-gray-700 backdrop-blur-sm shadow-2xl">
            <CardHeader className="text-center pb-8">
              <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-xl">M</span>
              </div>
              <CardTitle className="text-2xl font-bold text-white">Welcome Back</CardTitle>
              <CardDescription className="text-gray-300">
                Sign in to access your Marvel card collection
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <Button 
                onClick={handleGoogleSignIn}
                className="w-full bg-red-600 hover:bg-red-700 text-white py-3 text-lg font-medium"
                size="lg"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>

              <div className="text-center">
                <p className="text-sm text-gray-400">
                  By signing in, you agree to our Terms of Service and Privacy Policy
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}