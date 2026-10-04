/** One automatic request per account/device milestone, not a claim of a review.
 * Stores may suppress the UI. Never reward, retry on dismissal, or redirect
 * automatically when the platform declines to display it.
 */
export async function requestMilestoneReview(options: {
  userId: number;
  nativeMobileLogins: number;
  available: boolean;
  storage: Pick<Storage, "getItem" | "setItem">;
  request: () => Promise<void>;
}): Promise<"skipped" | "requested" | "failed"> {
  if (!options.available || options.nativeMobileLogins < 4) return "skipped";
  const key = `mcv:native-review:fourth-launch:${options.userId}`;
  try {
    if (options.storage.getItem(key)) return "skipped";
    // Claim before calling the OS: prevents concurrent mounts and retry loops.
    // Keep the claim even on rejection; review failure must not nag the user.
    options.storage.setItem(key, "requested");
  } catch {
    // Without durable suppression, don't risk prompting on every visit.
    return "skipped";
  }
  try {
    await options.request();
    return "requested";
  } catch {
    return "failed";
  }
}