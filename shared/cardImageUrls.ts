export const LEGACY_DEAD_CARD_PLACEHOLDER_URL =
  "https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png";

function normalizedImageUrl(url: string | null | undefined): string {
  return (url ?? "").trim().split(/[?#]/, 1)[0];
}

export function isReplaceableLegacyCardPlaceholderUrl(
  url: string | null | undefined,
): boolean {
  return normalizedImageUrl(url) === LEGACY_DEAD_CARD_PLACEHOLDER_URL;
}

export function isDisplayableCardImageUrl(
  url: string | null | undefined,
): url is string {
  return Boolean((url ?? "").trim()) && !isReplaceableLegacyCardPlaceholderUrl(url);
}