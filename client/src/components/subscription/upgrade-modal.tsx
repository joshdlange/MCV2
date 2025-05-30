import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Check, Star, Zap, Users, ShoppingCart, Database, Crown } from "lucide-react";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'collection_limit' | 'marketplace' | 'general';
}

export function UpgradeModal({ isOpen, onClose, reason }: UpgradeModalProps) {
  const getReasonMessage = () => {
    switch (reason) {
      case 'collection_limit':
        return "You've reached your 250 card limit on the SIDE KICK plan. Upgrade to SUPER HERO for unlimited storage!";
      case 'marketplace':
        return "The Marketplace is a SUPER HERO exclusive feature. Upgrade to buy and sell cards with other collectors!";
      default:
        return "Unlock the full power of Marvel Card Vault with SUPER HERO!";
    }
  };

  const handleUpgrade = () => {
    // TODO: Implement Stripe integration when ready
    console.log("Upgrade to SUPER HERO plan");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Crown className="w-6 h-6 text-yellow-500" />
            Unlock Your SUPER HERO Powers
          </DialogTitle>
          <DialogDescription className="text-center text-lg">
            {getReasonMessage()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* SIDE KICK Plan */}
          <Card className="border-gray-200">
            <CardHeader className="text-center pb-4">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Users className="w-5 h-5 text-blue-500" />
                <h3 className="text-xl font-bold">SIDE KICK</h3>
              </div>
              <Badge variant="secondary" className="w-fit mx-auto">Current Plan</Badge>
              <div className="text-2xl font-bold text-gray-600">FREE</div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm">Browse all card sets</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm">Track collection & wishlist</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm">View market trends</span>
              </div>
              <div className="flex items-start gap-2">
                <Database className="w-5 h-5 text-orange-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm">Store up to 250 cards</span>
              </div>
              <div className="flex items-start gap-2 opacity-50">
                <ShoppingCart className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-sm line-through">Marketplace access</span>
              </div>
            </CardContent>
          </Card>

          {/* SUPER HERO Plan */}
          <Card className="border-yellow-400 bg-gradient-to-br from-yellow-50 to-orange-50 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 px-3 py-1 text-sm font-bold">
              RECOMMENDED
            </div>
            <CardHeader className="text-center pb-4">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                <h3 className="text-xl font-bold">SUPER HERO</h3>
              </div>
              <Badge variant="default" className="w-fit mx-auto bg-yellow-500 hover:bg-yellow-600">Popular</Badge>
              <div className="text-3xl font-bold text-yellow-600">$4<span className="text-lg">/month</span></div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <Check className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">Everything in SIDE KICK</span>
              </div>
              <div className="flex items-start gap-2">
                <Database className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">Unlimited card storage</span>
              </div>
              <div className="flex items-start gap-2">
                <ShoppingCart className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">Full marketplace access</span>
              </div>
              <div className="flex items-start gap-2">
                <Star className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">Buy & sell with collectors</span>
              </div>
              <div className="flex items-start gap-2">
                <Crown className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">Priority support</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-center gap-3 mt-8">
          <Button variant="outline" onClick={onClose}>
            Maybe Later
          </Button>
          <Button onClick={handleUpgrade} className="bg-yellow-500 hover:bg-yellow-600 text-yellow-900 font-bold px-8">
            <Crown className="w-4 h-4 mr-2" />
            Upgrade to SUPER HERO
          </Button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          Cancel anytime. No hidden fees.
        </p>
      </DialogContent>
    </Dialog>
  );
}