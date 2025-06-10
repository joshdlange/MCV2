import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps {
  src: string;
  alt: string;
  size: 'thumbnail' | 'detail' | 'full' | 'set' | 'mobile';
  className?: string;
  loading?: 'lazy' | 'eager';
  onClick?: () => void;
}

// Image size configurations for Cloudinary
const IMAGE_CONFIGS = {
  thumbnail: { w: 200, h: 280, q: 80 },
  detail: { w: 400, h: 560, q: 90 },
  full: { w: 800, h: 1120, q: 'auto' as const },
  set: { w: 150, h: 150, q: 80, c: 'fill' as const },
  mobile: { w: 150, h: 210, q: 70 },
} as const;

// Convert Google Drive URLs to direct view format
function convertGoogleDriveUrl(url: string): string {
  if (!url.includes('drive.google.com')) return url;
  
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
  }
  return url;
}

// Extract Google Drive file ID from URL
function extractGoogleDriveFileId(url: string): string | null {
  if (!url.includes('drive.google.com')) return null;
  
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return fileIdMatch ? fileIdMatch[1] : null;
}

// Build Cloudinary optimized URL with fallback handling
function buildCloudinaryUrl(originalUrl: string, config: typeof IMAGE_CONFIGS[keyof typeof IMAGE_CONFIGS]): string {
  if (!originalUrl) return '';
  
  // If already a Cloudinary URL, return as-is
  if (originalUrl.includes('cloudinary.com')) {
    return originalUrl;
  }
  
  // Convert Google Drive URLs to direct view format first
  const directUrl = convertGoogleDriveUrl(originalUrl);
  
  // Use environment variable for cloud name
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dqydhlszn';
  if (!cloudName) {
    // Fallback to converted URL if Cloudinary not configured
    return directUrl;
  }
  
  const { w, h, q } = config;
  const c = 'c' in config ? config.c : undefined;
  let transformations = `f_auto,q_${q}`;
  
  if (w) transformations += `,w_${w}`;
  if (h) transformations += `,h_${h}`;
  if (c) transformations += `,c_${c}`;
  
  // Use Cloudinary's fetch functionality to optimize the direct URL
  return `https://res.cloudinary.com/${cloudName}/image/fetch/${transformations}/${encodeURIComponent(directUrl)}`;
}

export function OptimizedImage({ 
  src, 
  alt, 
  size, 
  className, 
  loading = 'lazy',
  onClick 
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState('');
  const [fallbackAttempts, setFallbackAttempts] = useState(0);
  
  const config = IMAGE_CONFIGS[size];

  // Generate different URL formats for fallback chain
  const generateImageUrls = useCallback((originalUrl: string): string[] => {
    if (!originalUrl) return [];
    
    const urls: string[] = [];
    
    // If already a Cloudinary URL, just use it
    if (originalUrl.includes('cloudinary.com')) {
      urls.push(originalUrl);
      return urls;
    }
    
    // For external storage URLs (like PriceCharting/Google Storage/Google Drive), use image proxy
    if (originalUrl.includes('storage.googleapis.com') || 
        originalUrl.includes('pricecharting.com') || 
        originalUrl.includes('drive.google.com')) {
      // These URLs have CORS restrictions, so use our proxy
      const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
      urls.push(proxyUrl);
      return urls;
    }
    
    // For other URLs (not handled by proxy above)
    {
      // For other URLs, try Cloudinary optimization first, then direct
      urls.push(buildCloudinaryUrl(originalUrl, config));
      if (originalUrl !== urls[0]) {
        urls.push(originalUrl);
      }
    }
    
    return urls.filter(Boolean);
  }, [config]);

  // Initialize image loading
  useEffect(() => {
    if (src) {
      setIsLoading(true);
      setHasError(false);
      setFallbackAttempts(0);
      
      const urls = generateImageUrls(src);
      if (urls.length > 0) {
        setCurrentSrc(urls[0]);
      }
    }
  }, [src, generateImageUrls]);

  // Handle image loading errors with fallback chain
  const handleImageError = useCallback(() => {
    const urls = generateImageUrls(src);
    const nextAttempt = fallbackAttempts + 1;
    
    console.log(`Image failed to load: ${currentSrc}, attempt ${nextAttempt}/${urls.length}`);
    
    if (nextAttempt < urls.length) {
      // Try next URL in fallback chain
      console.log(`Trying fallback URL: ${urls[nextAttempt]}`);
      setCurrentSrc(urls[nextAttempt]);
      setFallbackAttempts(nextAttempt);
      setIsLoading(true);
    } else {
      // All fallbacks failed
      console.log(`All ${urls.length} image URLs failed for: ${src}`);
      setIsLoading(false);
      setHasError(true);
    }
  }, [src, fallbackAttempts, generateImageUrls, currentSrc]);

  // Handle successful image load
  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);

  // Use default "no image" placeholder when no image is available
  if (!src || hasError) {
    const defaultNoImageUrl = "https://drive.google.com/uc?export=view&id=1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF";
    
    return (
      <img
        src={defaultNoImageUrl}
        alt="No image available"
        className={cn(className)}
        onClick={onClick}
        onLoad={handleImageLoad}
      />
    );
  }
  
  return (
    <div className={cn("relative overflow-hidden bg-gray-100 rounded-lg", className)}>
      {isLoading && (
        <div 
          className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 animate-pulse flex items-center justify-center z-10"
          style={{ 
            width: config.w, 
            height: config.h,
            aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
          }}
        >
          <div className="text-gray-400 dark:text-gray-500 text-xs">Loading...</div>
        </div>
      )}
      <img
        src={currentSrc}
        alt={alt}
        loading={loading}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className={cn(
          "transition-all duration-300 w-full h-full object-cover",
          isLoading ? "opacity-0" : "opacity-100",
          onClick ? "cursor-pointer hover:opacity-90 hover:scale-105 transition-transform" : "",
          "rounded-lg",
          className
        )}
        style={{ 
          width: config.w, 
          height: config.h,
          aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
        }}
        onLoad={handleImageLoad}
        onError={handleImageError}
        onClick={onClick}
        // Add additional attributes for better iOS/Safari compatibility
        decoding="async"
      />
    </div>
  );
}