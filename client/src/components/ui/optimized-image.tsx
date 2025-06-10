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
    
    // For external storage URLs (like PriceCharting/Google Storage), use image proxy
    if (originalUrl.includes('storage.googleapis.com') || originalUrl.includes('pricecharting.com')) {
      // These URLs have CORS restrictions, so use our proxy
      const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
      urls.push(proxyUrl);
      return urls;
    }
    
    // For Google Drive URLs, create fallback chain
    if (originalUrl.includes('drive.google.com')) {
      const fileId = extractGoogleDriveFileId(originalUrl);
      if (fileId) {
        // 1. First try Cloudinary optimized
        urls.push(buildCloudinaryUrl(originalUrl, config));
        
        // 2. Fallback to direct Google Drive view
        urls.push(`https://drive.google.com/uc?export=view&id=${fileId}`);
        
        // 3. Alternative Google Drive thumbnail (smaller, more reliable on mobile)
        urls.push(`https://drive.google.com/thumbnail?id=${fileId}&sz=w${config.w || 400}`);
        
        // 4. Last resort: original URL
        if (originalUrl !== urls[urls.length - 1]) {
          urls.push(originalUrl);
        }
      }
    } else {
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

  // Render placeholder for missing or failed images
  if (!src || hasError) {
    return (
      <div 
        className={cn(
          "bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm",
          className
        )}
        style={{ 
          width: config.w, 
          height: config.h,
          aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
        }}
        onClick={onClick}
      >
        <div className="text-center p-2">
          <div className="w-8 h-8 mx-auto mb-1 opacity-40">
            {/* Simple card icon SVG */}
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2l-4-5 1.41-1.41L12 13.17l2.59-2.58L16 12l-4 5z"/>
            </svg>
          </div>
          <div className="text-xs opacity-75">Image unavailable</div>
        </div>
      </div>
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