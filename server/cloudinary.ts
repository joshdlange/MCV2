import { v2 as cloudinary } from 'cloudinary';

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

export { cloudinary };