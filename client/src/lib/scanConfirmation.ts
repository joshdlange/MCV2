export type PhotoSubmissionStatus = "idle" | "pending" | "submitted" | "approved" | "failed";

// Inspect the URL without query/fragment so cache-busting does not disguise a
// catalog placeholder. A load error is tracked separately by the scan screen.
export function hasUsableScanCardImage(imageUrl: string | null | undefined): boolean {
  if (!imageUrl?.trim()) return false;
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (/(^|\.)(placeholder\.com|placehold\.co|placehold\.it|placeholder\.pics)$/i.test(url.hostname)) return false;
    return !/(?:^|\/)(?:card[-_])?placeholder(?:[-_.]|\/|$)/i.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

export async function uploadScanFrontPhoto(
  cardId: number,
  file: File | null,
  getToken: () => Promise<string | undefined>,
  isCurrent: () => boolean,
  onAttempt?: () => void,
): Promise<{ autoApproved?: boolean }> {
  if (!file) throw new Error("The scan photo is no longer available. Please scan it again.");
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Your photo exceeds the 5MB review limit. Please crop it smaller and scan again.");
  }
  const token = await getToken();
  if (!isCurrent()) throw new Error("Scan cancelled");
  if (!token) throw new Error("Please sign in again to submit your photo for review.");
  const body = new FormData();
  body.append("frontImage", file);
  onAttempt?.();
  const response = await fetch(`/api/cards/${cardId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "Your photo could not be sent for review. Please try again later.");
  }
  return response.json();
}

export function scanCorrection(topMatchId: number | undefined, chosenCardId: number): "correct" | "wrong" | "not_found" {
  return topMatchId === chosenCardId ? "correct" : topMatchId ? "wrong" : "not_found";
}

// Keep photo submission separate from the collection request: adding a card is
// never evidence that the review queue accepted its image.
export async function submitScanPhoto(
  request: () => Promise<{ autoApproved?: boolean }>,
): Promise<PhotoSubmissionStatus> {
  try {
    const response = await request();
    return response.autoApproved ? "approved" : "submitted";
  } catch {
    return "failed";
  }
}