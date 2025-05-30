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
    // Convert to the uc?export=view format that works more reliably for public images
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
