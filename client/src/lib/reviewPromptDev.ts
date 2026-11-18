import { REVIEW_STATE_KEY } from "./nativeReview";

// Vite removes this branch from production. No production UI or global helper.
if (import.meta.env.DEV) {
  Object.assign(window, {
    mcvResetReviewMilestone: () => {
      localStorage.removeItem(REVIEW_STATE_KEY);
      sessionStorage.removeItem("mcv:review:authenticated-opening");
      // Legacy review markers are retained; resetting current counters must not re-prompt prior users.
      window.location.reload();
    },
  });
}
