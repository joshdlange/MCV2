import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UpgradeModal } from "./upgrade-modal";
import { Crown, AlertTriangle } from "lucide-react";

interface CardLimitWarningProps {
  currentCards: number;
  userPlan: string;
  variant?: "warning" | "limit-reached";
}

export function CardLimitWarning({ currentCards, userPlan, variant = "warning" }: CardLimitWarningProps) {
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  
  const isAtLimit = currentCards >= 250;
  const isNearLimit = currentCards >= 200;
  
  if (userPlan === "SUPER_HERO") return null;
  
  if (variant === "limit-reached" || isAtLimit) {
    return (
      <>
        <Alert className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <span className="font-medium text-red-800 dark:text-red-200">
                Collection limit reached!
              </span>
              <p className="text-red-700 dark:text-red-300 mt-1 text-sm">
                You've reached the 250 card limit for Side Kick plans. Upgrade to Super Hero for unlimited cards.
              </p>
            </div>
            <Button 
              onClick={() => setShowUpgradeModal(true)}
              size="sm"
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white ml-4"
            >
              <Crown className="w-4 h-4 mr-1" />
              Upgrade Now
            </Button>
          </AlertDescription>
        </Alert>
        
        <UpgradeModal 
          isOpen={showUpgradeModal} 
          onClose={() => setShowUpgradeModal(false)} 
          currentPlan={userPlan}
        />
      </>
    );
  }
  
  if (variant === "warning" && isNearLimit) {
    return (
      <>
        <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <span className="font-medium text-yellow-800 dark:text-yellow-200">
                Approaching card limit
              </span>
              <p className="text-yellow-700 dark:text-yellow-300 mt-1 text-sm">
                You have {250 - currentCards} cards remaining in your Side Kick plan.
              </p>
            </div>
            <Button 
              onClick={() => setShowUpgradeModal(true)}
              size="sm"
              variant="outline"
              className="border-yellow-500 text-yellow-700 hover:bg-yellow-100 ml-4"
            >
              <Crown className="w-4 h-4 mr-1" />
              Upgrade
            </Button>
          </AlertDescription>
        </Alert>
        
        <UpgradeModal 
          isOpen={showUpgradeModal} 
          onClose={() => setShowUpgradeModal(false)} 
          currentPlan={userPlan}
        />
      </>
    );
  }
  
  return null;
}