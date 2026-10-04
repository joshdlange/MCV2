import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";
import { useAppStore } from "@/lib/store";
import { requestMilestoneReview } from "@/lib/nativeReview";

/** Only mounted on the dashboard, never during camera, checkout or sign-in. */
export function useNativeReview(ready: boolean) {
  const userId = useAppStore(state => state.currentUser?.id);
  const launches = useAppStore(state => state.currentUser?.nativeMobileLogins ?? 0);
  useEffect(() => {
    if (!ready || !userId || launches < 4 || !Capacitor.isNativePlatform()
      || !Capacitor.isPluginAvailable("InAppReview")) return;
    const timer = window.setTimeout(() => {
      // Don't interrupt another popup or request while the app is backgrounded.
      if (document.visibilityState !== "visible" || document.querySelector('[role="dialog"]')) return;
      try {
        void requestMilestoneReview({
          userId, nativeMobileLogins: launches, available: true,
          storage: window.localStorage, request: () => InAppReview.requestReview(),
        }).then(result => {
          if (result === "failed") console.warn("[NativeReview] Store review request unavailable");
        });
      } catch {
        // Storage access can be denied. No prompt without durable suppression.
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [ready, userId, launches]);
}