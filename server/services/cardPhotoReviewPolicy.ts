export const wrongImageReasons = ["wrong_card", "multiple_cards", "back_image", "poor_quality", "other"] as const;
export type WrongImageReason = typeof wrongImageReasons[number];

/** Trusted uploaders still require review. Only a full admin bypasses it. */
export function canAutoApproveCardPhoto(user: { isAdmin?: boolean; trustedUploader?: boolean }) {
  return user.isAdmin === true;
}
export function imageReviewDetails(source: string) {
  const reason = source.startsWith("wrong_image:") ? source.slice("wrong_image:".length) : null;
  return { reviewKind: reason ? "wrong_image" : "photo", reviewReason: reason };
}
export function validateWrongImageReason(reason: unknown): WrongImageReason {
  if (!wrongImageReasons.includes(reason as WrongImageReason)) throw new Error("Choose a valid image-report reason");
  return reason as WrongImageReason;
}