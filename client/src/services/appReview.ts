import { Capacitor } from "@capacitor/core";
import { CapgoInAppReview } from "@capgo/capacitor-in-app-review";

/**
 * Requests Google's native review card. Google controls whether it is shown;
 * the API intentionally exposes no review-completion or rating result.
 */
export async function requestGooglePlayReview(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return false;
  }

  try {
    await CapgoInAppReview.requestReview();
    return true;
  } catch (error) {
    console.error("[AppReview] Native review request failed:", error);
    return false;
  }
}