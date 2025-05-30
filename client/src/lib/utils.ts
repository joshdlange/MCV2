import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function convertGoogleDriveUrl(url: string): string {
  if (!url) return url;
  
  // Check if it's a Google Drive URL
  const driveRegex = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
  const match = url.match(driveRegex);
  
  if (match) {
    const fileId = match[1];
    // Convert to direct image URL format
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  
  // Also handle sharing URLs
  const shareRegex = /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/;
  const shareMatch = url.match(shareRegex);
  
  if (shareMatch) {
    const fileId = shareMatch[1];
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  
  // Return original URL if not a Google Drive URL
  return url;
}
