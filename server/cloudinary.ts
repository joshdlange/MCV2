import { v2 as cloudinary } from 'cloudinary';
import fetch from 'node-fetch';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Generate optimized image URL from any source (Google Drive, etc.)
export function getOptimizedImageUrl(originalUrl: string, options: {
  width?: number;
  height?: number;
  quality?: 'auto' | number;
  format?: 'auto' | 'webp' | 'jpg' | 'png';
  crop?: 'fill' | 'fit' | 'scale';
} = {}): string {
  const {
    width,
    height,
    quality = 'auto',
    format = 'auto',
    crop = 'fit'
  } = options;

  // Build transformation parameters
  const transformations: any = {
    fetch_format: format,
    quality: quality,
  };

  if (width) transformations.width = width;
  if (height) transformations.height = height;
  if (width || height) transformations.crop = crop;

  // Generate Cloudinary URL that fetches from the original source
  return cloudinary.url(originalUrl, {
    type: 'fetch',
    transformation: transformations,
    secure: true,
  });
}

// Predefined image sizes for different use cases
export const IMAGE_SIZES = {
  // Card thumbnails for grids
  CARD_THUMBNAIL: { width: 200, height: 280, quality: 80 },
  
  // Card detail view
  CARD_DETAIL: { width: 400, height: 560, quality: 90 },
  
  // Full resolution for zooming
  CARD_FULL: { width: 800, height: 1120, quality: 'auto' as const },
  
  // Set thumbnails
  SET_THUMBNAIL: { width: 150, height: 150, quality: 80, crop: 'fill' as const },
  
  // Mobile optimized
  CARD_MOBILE: { width: 150, height: 210, quality: 70 },
} as const;

// Helper functions for common use cases
export function getCardThumbnail(imageUrl: string): string {
  return getOptimizedImageUrl(imageUrl, IMAGE_SIZES.CARD_THUMBNAIL);
}

export function getCardDetail(imageUrl: string): string {
  return getOptimizedImageUrl(imageUrl, IMAGE_SIZES.CARD_DETAIL);
}

export function getCardFull(imageUrl: string): string {
  return getOptimizedImageUrl(imageUrl, IMAGE_SIZES.CARD_FULL);
}

export function getSetThumbnail(imageUrl: string): string {
  return getOptimizedImageUrl(imageUrl, IMAGE_SIZES.SET_THUMBNAIL);
}

export function getCardMobile(imageUrl: string): string {
  return getOptimizedImageUrl(imageUrl, IMAGE_SIZES.CARD_MOBILE);
}

// Upload image from file path or buffer to Cloudinary (CLOUDINARY-ONLY)
export async function uploadImage(filePathOrBuffer: string | Buffer, folder: string = 'marvel-cards'): Promise<string> {
  try {
    const uploadOptions: any = {
      folder: folder,
      resource_type: 'image',
      transformation: [
        { width: 800, height: 1120, crop: 'fit', quality: 'auto' },
        { format: 'auto' }
      ]
    };

    let result;
    if (Buffer.isBuffer(filePathOrBuffer)) {
      // Upload from buffer (NO LOCAL FILE SYSTEM USAGE)
      result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${filePathOrBuffer.toString('base64')}`, uploadOptions);
    } else {
      // Upload from file path (legacy support)
      result = await cloudinary.uploader.upload(filePathOrBuffer, uploadOptions);
    }

    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
}

// Upload user-submitted card image with validation and resizing
export async function uploadUserCardImage(
  fileBuffer: Buffer,
  userId: number,
  cardId: number,
  side: 'front' | 'back'
): Promise<string> {
  try {
    const folder = `user_uploads/${userId}/${cardId}`;
    const uploadOptions: any = {
      folder: folder,
      resource_type: 'image',
      public_id: side,
      overwrite: true,
      transformation: [
        { width: 1200, height: 1200, crop: 'limit', quality: 'auto' },
        { format: 'auto' }
      ]
    };

    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${fileBuffer.toString('base64')}`,
      uploadOptions
    );

    return result.secure_url;
  } catch (error) {
    console.error('User card image upload error:', error);
    throw error;
  }
}

// Upload main set thumbnail image
export async function uploadMainSetThumbnail(
  fileBuffer: Buffer,
  mainSetId: number
): Promise<string> {
  try {
    const uploadOptions: any = {
      folder: 'main-set-thumbnails',
      public_id: `main_set_${mainSetId}_${Date.now()}`,
      resource_type: 'image',
      transformation: [
        { width: 400, height: 400, crop: 'fit', quality: 'auto' },
        { format: 'auto' }
      ]
    };

    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${fileBuffer.toString('base64')}`,
      uploadOptions
    );

    return result.secure_url;
  } catch (error) {
    console.error('Main set thumbnail upload error:', error);
    throw error;
  }
}

// Check if URL is already a Cloudinary URL
export function isCloudinaryUrl(url: string): boolean {
  return url.includes('res.cloudinary.com') || url.includes('cloudinary.com');
}

// Download external image URL and upload to Cloudinary
export async function downloadAndUploadToCloudinary(
  externalUrl: string,
  mainSetId: number
): Promise<string> {
  try {
    // If already a Cloudinary URL, return as-is
    if (isCloudinaryUrl(externalUrl)) {
      console.log(`URL is already Cloudinary, skipping download: ${externalUrl}`);
      return externalUrl;
    }

    console.log(`Downloading external image for main set ${mainSetId}: ${externalUrl}`);

    // Fetch the image from the external URL
    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    // Get content type from response headers
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Validate it's actually an image
    if (!contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Check file size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error(`Image too large: ${buffer.length} bytes`);
    }

    // Upload to Cloudinary with proper mime type
    const uploadOptions: any = {
      folder: 'main-set-thumbnails',
      public_id: `main_set_${mainSetId}_${Date.now()}`,
      resource_type: 'image',
      transformation: [
        { width: 400, height: 400, crop: 'fit', quality: 'auto' },
        { format: 'auto' }
      ]
    };

    const result = await cloudinary.uploader.upload(
      `data:${contentType};base64,${buffer.toString('base64')}`,
      uploadOptions
    );

    console.log(`Successfully uploaded external image to Cloudinary for main set ${mainSetId}: ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    console.error(`Failed to download/upload external image for main set ${mainSetId}:`, error);
    // Return original URL if download fails
    return externalUrl;
  }
}

export { cloudinary };