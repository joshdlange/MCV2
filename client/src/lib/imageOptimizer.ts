const CLOUDINARY_CLOUD_NAME = 'dgu7hjfvn';

export function getOptimizedImageUrl(src: string, width: number = 400): string {
  if (!src) return src;
  
  // Route comc.com images through Cloudinary fetch for caching/CDN
  if (src.includes('comc.com')) {
    const encodedUrl = encodeURIComponent(src);
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/w_${width},q_auto,f_auto/${encodedUrl}`;
  }
  
  // Optimize existing Cloudinary images
  if (src.includes('res.cloudinary.com')) {
    const parts = src.split('/upload/');
    if (parts.length === 2) {
      return `${parts[0]}/upload/w_${width},q_auto,f_auto/${parts[1]}`;
    }
  }
  
  return src;
}
