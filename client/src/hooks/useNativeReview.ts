import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";
import { useAppStore } from "@/lib/store";
import { awardSessionMilestone, requestMilestoneReview } from "@/lib/nativeReview";
import { apiRequest } from "@/lib/queryClient";
import "@/lib/reviewPromptDev";

/** Only mounted on the dashboard, never during camera, checkout or sign-in. */
export function useNativeReview(ready: boolean) {
  const userId = useAppStore(state => state.currentUser?.id);
  const onboarded = useAppStore(state => state.currentUser?.onboardingComplete);
  useEffect(() => {
    if (!ready || !userId || !onboarded) return;
    try {
      void awardSessionMilestone({
        userId, storage: window.localStorage,
        award: async sessionCount => {
          const response = await apiRequest("POST", "/api/badges/returning-collector-milestone", { sessionCount });
          return (await response.json()).awarded === true;
        },
      });
    } catch { /* Optional achievement must not affect dashboard loading. */ }
  }, [ready, userId, onboarded]);
  useEffect(() => {
    if (!ready || !userId || !onboarded || !Capacitor.isNativePlatform()
      || !Capacitor.isPluginAvailable("InAppReview")) return;
    const timer = window.setTimeout(() => {
      // Don't interrupt another popup or request while the app is backgrounded.
      if (document.visibilityState !== "visible" ||
          document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      try {
        void requestMilestoneReview({
          userId, native: Capacitor.isNativePlatform(),
          available: Capacitor.isPluginAvailable("InAppReview"),
          // Both live guards above are evaluated in this timer callback. The helper
          // persists the claim and invokes this immediately, with no await in between.
          // Do not silently skip inside this callback after recording a request date.
          storage: window.localStorage, request: () => InAppReview.requestReview(),
        });
      } catch {
        // Storage access can be denied. No prompt without durable suppression.
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [ready, userId, onboarded]);
}