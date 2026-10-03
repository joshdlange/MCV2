export const IMAGE_REPORT_REASONS = [
  { value: "wrong_card", label: "Wrong card" },
  { value: "multiple_cards", label: "Multiple cards" },
  { value: "back_image", label: "Card back" },
  { value: "poor_quality", label: "Poor quality" },
  { value: "other", label: "Other" },
] as const;
export type ImageReportReason = typeof IMAGE_REPORT_REASONS[number]["value"];

export function imageReportReasonLabel(reason: string | null | undefined): string {
  return IMAGE_REPORT_REASONS.find(item => item.value === reason)?.label ?? reason ?? "Reason not supplied";
}

export function validateReportPhoto(file: File): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a photo no larger than 5MB.");
}

export async function reportCardImage(
  cardId: number,
  reason: ImageReportReason,
  file: File | null,
  getToken: () => Promise<string | undefined>,
): Promise<{ success: true; pendingImage: unknown; autoApproved: false }> {
  if (!IMAGE_REPORT_REASONS.some(item => item.value === reason)) throw new Error("Choose a report reason.");
  if (file) validateReportPhoto(file);
  const token = await getToken();
  if (!token) throw new Error("Please sign in again to report this image.");
  const body = new FormData();
  body.append("reason", reason);
  if (file) body.append("frontImage", file);
  const response = await fetch(`/api/cards/${cardId}/report-image`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, credentials: "include", body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true || result?.autoApproved !== false) {
    throw new Error(result?.message || "Your report could not be sent. Please try again.");
  }
  return result;
}

export interface ImageReviewRow {
  id: number;
  source: string;
  reviewKind?: "wrong_image" | "photo";
  reviewReason?: string | null;
  frontImageUrl?: string | null;
  backImageUrl?: string | null;
}
export function isWrongImageReport(row: ImageReviewRow): boolean {
  return row.reviewKind === "wrong_image" || row.source.startsWith("wrong_image:");
}
export function validReplacementImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
export function canApproveImageReview(row: ImageReviewRow, override = ""): boolean {
  if (override.trim()) return validReplacementImageUrl(override.trim());
  return isWrongImageReport(row) ? !!row.frontImageUrl : !!(row.frontImageUrl || row.backImageUrl);
}
export function bulkApprovableImageIds(rows: ImageReviewRow[], selected: ReadonlySet<number>): number[] {
  return rows.filter(row => !isWrongImageReport(row) && selected.has(row.id)).map(row => row.id);
}