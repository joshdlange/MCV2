import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function convertGoogleDriveUrl(url: string): string {
  if (!url) return url;
  
  // Check if it's a Google Drive URL with file/d/ format (including view links)
  const driveRegex = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
  const match = url.match(driveRegex);
  
  if (match) {
    const fileId = match[1];
    // Try the uc export format first, it's more reliable for direct display
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  
  // Handle sharing URLs with open?id= format
  const shareRegex = /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/;
  const shareMatch = url.match(shareRegex);
  
  if (shareMatch) {
    const fileId = shareMatch[1];
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  
  // Handle URLs that already have the correct format
  if (url.includes('googleusercontent.com') || url.includes('drive.google.com/thumbnail') || url.includes('drive.google.com/uc?export=view')) {
    return url;
  }
  
  // Return original URL if not a Google Drive URL
  return url;
}

/**
 * Delivery-optimize an image URL for a given display width.
 * - Cloudinary URLs get f_auto,q_auto,w_<width>,c_limit transformations injected
 *   (auto format like WebP/AVIF, auto quality, downscaled to what the grid cell needs).
 * - Google Drive URLs are normalized via convertGoogleDriveUrl.
 * - All other URLs are returned unchanged.
 */
export function optimizedImageUrl(url: string | null | undefined, width: number): string {
  if (!url) return "";

  const marker = "/image/upload/";
  const idx = url.indexOf(marker);
  if (url.includes("res.cloudinary.com") && idx !== -1) {
    const afterUpload = url.slice(idx + marker.length);
    // Don't double-transform URLs that already carry a transformation segment
    // (e.g. ".../upload/w_400,q_auto/..." or ".../upload/t_thumb/...").
    const firstSegment = afterUpload.split("/")[0];
    const hasTransform = /(^|,)[a-z]{1,3}_[^/]*/.test(firstSegment) && !firstSegment.startsWith("v");
    if (hasTransform) return url;
    // Serve 2x the CSS width so images stay sharp on high-DPI screens.
    const w = Math.round(width * 2);
    return `${url.slice(0, idx + marker.length)}f_auto,q_auto,w_${w},c_limit/${afterUpload}`;
  }

  return convertGoogleDriveUrl(url);
}
