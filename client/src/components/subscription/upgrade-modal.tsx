import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Sparkles, Star } from "lucide-react";
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] p-0 overflow-hidden border-0 rounded-2xl bg-gray-950 fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[100] [&>button]:text-white [&>button]:hover:text-gray-300" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Upgrade to Super Hero</DialogTitle>
        <div className="bg-gradient-to-b from-gray-900 to-gray-950 px-5 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 flex flex-col items-center">
          <img 
            src={logoImage} 
            alt="Marvel Card Vault" 
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl mb-3"
          />
          <h2 className="text-lg sm:text-xl font-bold text-white text-center">
            Your Sidekick limit has been reached
          </h2>
        </div>

        <div className="px-5 sm:px-6 pt-3 sm:pt-4 pb-5 sm:pb-6 space-y-4 sm:space-y-5">
          <p className="text-gray-300 text-sm text-center leading-relaxed">
            You've added all the cards a Sidekick can carry.
            To keep growing your vault, it's time to level up.
          </p>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-white">
              Upgrade to Super Hero and:
            </p>
            <div className="space-y-2.5">
              {[
                "Add unlimited cards to your collection",
                "Show off your full binder to friends",
                "Track every set, subset, and variant",
              ].map((feature, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <Star className="w-4 h-4 text-red-500 fill-red-500 flex-shrink-0" />
                  <span className="text-sm text-white">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <Button
              onClick={handleUpgrade}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-5 sm:py-6 rounded-xl text-sm sm:text-base shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-red-500/30"
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

            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
              <Lock className="w-3 h-3" />
              <span>Your existing cards are safe. Upgrade anytime to keep adding.</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full text-center text-sm text-gray-300 hover:text-white transition-colors py-2.5 border border-gray-600 hover:border-gray-400 rounded-xl"
          >
            Not now — I'll upgrade later
          </button>

          <p className="text-center text-[11px] text-gray-500 italic pt-1 border-t border-gray-800">
            Sidekicks save the day. Super Heroes complete the collection.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
