export const BADGE_IMAGE_VERSION = "badge-thumbnails-v1";

export type BadgeImageSize = "thumbs" | "large";

/**
 * Routes local badge artwork to the optimized WebP derivative. The version
 * query is required because badge directories are served with immutable cache
 * headers; bump it whenever derivatives are regenerated from changed artwork.
 */
export function getBadgeImageUrl(
  iconUrl: string,
  size: BadgeImageSize = "thumbs",
): string {
  const match = iconUrl.match(
    /^\/(uploads\/badges|badge_images)\/([^/?]+)\.(?:png|jpe?g)(?:\?.*)?$/i,
  );
  if (!match) return iconUrl;

  return `/${match[1]}/${size}/${match[2]}.webp?v=${BADGE_IMAGE_VERSION}`;
}