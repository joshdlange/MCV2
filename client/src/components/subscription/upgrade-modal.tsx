import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Lock, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import logoImage from "@assets/Marvel_Card_Vault_Logo_Small_1770411162419.png";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
}

export function UpgradeModal({ isOpen, onClose, currentPlan }: UpgradeModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/create-checkout-session");
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      toast({
        title: "Error",
        description: "Failed to start upgrade process. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (currentPlan === "SUPER_HERO") return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-0 rounded-2xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Upgrade to Super Hero</DialogTitle>
        <div className="bg-gradient-to-b from-gray-900 to-black px-6 pt-6 pb-4 flex flex-col items-center">
          <img 
            src={logoImage} 
            alt="Marvel Card Vault" 
            className="w-20 h-20 rounded-xl mb-3"
          />
          <h2 className="text-xl font-bold text-white text-center">
            Your Sidekick limit has been reached
          </h2>
        </div>

        <div className="px-6 pt-4 pb-6 space-y-5">
          <p className="text-gray-600 text-sm text-center leading-relaxed">
            You've added all the cards a Sidekick can carry.
            To keep growing your vault, it's time to level up.
          </p>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">
              Upgrade to Super Hero and:
            </p>
            <div className="space-y-2.5">
              {[
                "Add unlimited cards to your collection",
                "Show off your full binder to friends",
                "Track every set, subset, and variant",
              ].map((feature, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-red-600" />
                  </div>
                  <span className="text-sm text-gray-700">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <Button
              onClick={handleUpgrade}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-6 rounded-xl text-base shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-red-500/30"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Upgrade to Super Hero
                </>
              )}
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
              <Lock className="w-3 h-3" />
              <span>Your existing cards are safe. Upgrade anytime to keep adding.</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
          >
            Not now — I'll upgrade later
          </button>

          <p className="text-center text-[11px] text-gray-400 italic pt-1 border-t border-gray-100">
            Sidekicks save the day. Super Heroes complete the collection.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
