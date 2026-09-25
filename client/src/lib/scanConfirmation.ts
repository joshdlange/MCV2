export type PhotoSubmissionStatus = "idle" | "pending" | "submitted" | "approved" | "failed";

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