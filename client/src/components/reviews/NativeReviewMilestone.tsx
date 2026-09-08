import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  areIntroFlowsComplete,
  useIntroFlow,
} from "@/contexts/IntroFlowContext";
import { apiRequest } from "@/lib/queryClient";
import { requestGooglePlayReview } from "@/services/appReview";
import VaultRegularMoment from "./VaultRegularMoment";

const REVIEW_DELAY_MS = 1800;

function createClaimId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function acknowledgeWithRetry(claimId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await apiRequest(
        "POST",
        "/api/mobile-review/vault-regular/acknowledge",
        { claimId },
      );
      const result = await response.json();
      return result.claimed === true;
    } catch (error) {
      console.error(`[AppReview] Badge acknowledgement attempt ${attempt} failed:`, error);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  return false;
}

/**
 * Waits for onboarding/profile dialogs to finish, celebrates the badge, then
 * asks Google Play for its native review card automatically. There is no
 * custom review CTA and no review result is observed or stored.
 */
export function NativeReviewMilestone() {
  const {
    nativeReviewMilestone,
    dismissNativeReviewMilestone,
  } = useAuth();
  const {
    profileCustomizationState,
    heardAboutState,
  } = useIntroFlow();
  const [open, setOpen] = useState(false);
  const startedKeyRef = useRef<string | null>(null);
  const claimRef = useRef<{ milestoneKey: string; claimId: string } | null>(null);

  const introFlowsComplete = areIntroFlowsComplete(
    profileCustomizationState,
    heardAboutState,
  );

  useEffect(() => {
    if (!nativeReviewMilestone || !introFlowsComplete) {
      setOpen(false);
      return;
    }

    const showWhenClear = () => {
      if (!document.querySelector('[role="dialog"]')) {
        setOpen(true);
        return true;
      }
      return false;
    };

    if (showWhenClear()) return;
    const interval = window.setInterval(() => {
      if (showWhenClear()) window.clearInterval(interval);
    }, 350);
    return () => window.clearInterval(interval);
  }, [introFlowsComplete, nativeReviewMilestone]);

  useEffect(() => {
    if (!open || !nativeReviewMilestone) return;
    const milestoneKey =
      `${nativeReviewMilestone.key}:${nativeReviewMilestone.loginNumber}`;
    if (startedKeyRef.current === milestoneKey) return;
    startedKeyRef.current = milestoneKey;
    if (claimRef.current?.milestoneKey !== milestoneKey) {
      claimRef.current = { milestoneKey, claimId: createClaimId() };
    }

    // This flow is intentionally time-driven from the earned milestone rather
    // than tied to the dialog button. Google may suppress the native card.
    void (async () => {
      const acknowledged = await acknowledgeWithRetry(claimRef.current!.claimId);
      if (!acknowledged) return;
      await new Promise(resolve => setTimeout(resolve, REVIEW_DELAY_MS));
      if (nativeReviewMilestone.platform === "android") {
        await requestGooglePlayReview();
      }
    })();
  }, [nativeReviewMilestone, open]);

  if (!nativeReviewMilestone) return null;

  return (
    <VaultRegularMoment
      open={open}
      onComplete={() => {
        setOpen(false);
        dismissNativeReviewMilestone();
      }}
    />
  );
}

export default NativeReviewMilestone;