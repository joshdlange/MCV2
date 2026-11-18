/** Device-local milestone tracking. Nothing here asserts that a review was shown or submitted. */
export const REVIEW_STATE_KEY = "mcv:native-review:device:v2";
export const REVIEW_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;
type Store = Pick<Storage, "getItem" | "setItem">;
export interface ReviewState {
  firstAppOpenAt: number;
  authenticatedSessionCount: number;
  lastSessionId: string;
  lastReviewPromptRequestedAt: number | null;
  reviewMilestoneAwarded: boolean;
  milestoneAwardedUserIds?: number[];
}
export function readReviewState(storage: Store): ReviewState | null {
  const raw = storage.getItem(REVIEW_STATE_KEY);
  if (!raw) return null;
  const state = JSON.parse(raw);
  if (!Number.isSafeInteger(state.authenticatedSessionCount) || state.authenticatedSessionCount < 1 ||
      typeof state.lastSessionId !== "string" || !Number.isFinite(state.firstAppOpenAt) ||
      (state.lastReviewPromptRequestedAt !== null && !Number.isFinite(state.lastReviewPromptRequestedAt)))
    throw new Error("Invalid review state");
  return state;
}
export function recordAuthenticatedSession(storage: Store, sessionId: string, now = Date.now()): ReviewState | null {
  try {
    const prior = readReviewState(storage);
    if (prior?.lastSessionId === sessionId) return prior;
    const state: ReviewState = {
      firstAppOpenAt: prior?.firstAppOpenAt ?? now,
      authenticatedSessionCount: (prior?.authenticatedSessionCount ?? 0) + 1,
      lastSessionId: sessionId,
      lastReviewPromptRequestedAt: prior?.lastReviewPromptRequestedAt ?? null,
      reviewMilestoneAwarded: prior?.reviewMilestoneAwarded ?? false,
      milestoneAwardedUserIds: prior?.milestoneAwardedUserIds ?? [],
    };
    storage.setItem(REVIEW_STATE_KEY, JSON.stringify(state));
    return state;
  } catch { return null; }
}

export async function awardSessionMilestone(options: {
  userId: number; storage: Store; award: (count: number) => Promise<boolean>;
}): Promise<void> {
  try {
    const state = readReviewState(options.storage);
    if (!state || state.authenticatedSessionCount < 4 ||
        state.milestoneAwardedUserIds?.includes(options.userId)) return;
    if (!await options.award(state.authenticatedSessionCount)) return;
    const latest = readReviewState(options.storage);
    if (!latest) return;
    latest.reviewMilestoneAwarded = true;
    latest.milestoneAwardedUserIds = [...new Set([...(latest.milestoneAwardedUserIds ?? []), options.userId])];
    options.storage.setItem(REVIEW_STATE_KEY, JSON.stringify(latest));
  } catch { /* Retry on a later normal app visit; never block the app or review opportunity. */ }
}

export async function requestMilestoneReview(options: {
  userId: number; native: boolean; available: boolean; storage: Store;
  request: () => Promise<void>; now?: number;
}): Promise<"skipped" | "requested" | "failed"> {
  if (!options.native || !options.available) return "skipped";
  try {
    const state = readReviewState(options.storage);
    const now = options.now ?? Date.now();
    // This release has only one opportunity: session four. No later-session catch-up or repeat campaign.
    if (!state || state.authenticatedSessionCount !== 4 ||
        (state.lastReviewPromptRequestedAt !== null &&
          now - state.lastReviewPromptRequestedAt < REVIEW_COOLDOWN_MS) ||
        options.storage.getItem(`mcv:native-review:fourth-launch:${options.userId}`)) return "skipped";
    state.lastReviewPromptRequestedAt = now;
    options.storage.setItem(REVIEW_STATE_KEY, JSON.stringify(state));
  } catch { return "skipped"; }
  try {
    await options.request();
    return "requested";
  } catch { return "failed"; }
}
