import fetch from 'node-fetch';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

/**
 * Caches an image from a URL to Cloudinary storage
 * @param imageUrl - The source URL of the image
 * @param folderPrefix - Optional folder prefix for organization (e.g., 'upcoming-sets')
 * @returns The Cloudinary URL of the cached image
 */
export async function cacheImageToCloudinary(
  imageUrl: string,
  folderPrefix = 'upcoming-sets'
): Promise<string> {
  try {
    // Validate URL
    const parsedUrl = new URL(imageUrl);
    
    // Generate a unique filename based on the source URL
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
    const ext = parsedUrl.pathname.split('.').pop() || 'jpg';
    const publicId = `${folderPrefix}/${hash}`;

    // Upload to Cloudinary directly from URL
    const result = await cloudinary.uploader.upload(imageUrl, {
      public_id: publicId,
      folder: folderPrefix,
      overwrite: false, // Don't re-upload if already exists
      resource_type: 'image',
      transformation: [
        {
          width: 800,
          height: 600,
          crop: 'limit', // Limit max size but maintain aspect ratio
          quality: 'auto:good',
          fetch_format: 'auto', // Automatically choose best format (WebP, AVIF, etc.)
        }
      ]
    });

    return result.secure_url;
  } catch (error) {
    console.error('Image caching error:', error);
    throw new Error(`Failed to cache image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Downloads an image from a URL and returns the buffer
 * Useful for manual image processing before upload
 */
export async function downloadImage(imageUrl: string): Promise<Buffer> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarvelCardVault/1.0)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.buffer();
    return buffer;
  } catch (error) {
    console.error('Image download error:', error);
    throw new Error(`Failed to download image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validates that a URL points to an image
 */
export function isImageUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
    return imageExtensions.some(ext => path.endsWith(ext));
  } catch {
    return false;
  }
}
