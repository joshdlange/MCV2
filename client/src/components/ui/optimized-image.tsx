import React, { useState, useEffect } from "react";
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

// Convert Google Drive URLs to direct download format
function convertGoogleDriveUrl(url: string): string {
  if (!url.includes('drive.google.com')) return url;
  
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
  }
  return url;
}

function buildCloudinaryUrl(originalUrl: string, config: typeof IMAGE_CONFIGS[keyof typeof IMAGE_CONFIGS]): string {
  if (!originalUrl) return '';
  
  // If already a Cloudinary URL, return as-is
  if (originalUrl.includes('cloudinary.com')) {
    return originalUrl;
  }
  
  // Convert Google Drive URLs to direct download format first
  const directUrl = convertGoogleDriveUrl(originalUrl);
  
  const cloudName = 'dqydhlszn'; // Using your Cloudinary cloud name directly
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
  const [imgSrc, setImgSrc] = useState('');
  
  const config = IMAGE_CONFIGS[size];
  
  // Set up the image source when src changes
  useEffect(() => {
    if (src) {
      setIsLoading(true);
      setHasError(false);
      setImgSrc(convertGoogleDriveUrl(src));
    }
  }, [src]);
  
  if (!src || hasError) {
    return (
      <div 
        className={cn(
          "bg-muted flex items-center justify-center text-muted-foreground text-sm",
          className
        )}
        style={{ 
          width: config.w, 
          height: config.h,
          aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
        }}
      >
        {hasError ? 'Failed to load' : 'No image'}
      </div>
    );
  }
  
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {isLoading && (
        <div 
          className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center"
          style={{ 
            width: config.w, 
            height: config.h,
            aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
          }}
        >
          <div className="text-muted-foreground text-xs">Loading...</div>
        </div>
      )}
      <img
        src={imgSrc}
        alt={alt}
        loading={loading}
        className={cn(
          "transition-opacity duration-300",
          isLoading ? "opacity-0" : "opacity-100",
          onClick ? "cursor-pointer hover:opacity-90" : "",
          className
        )}
        style={{ 
          width: config.w, 
          height: config.h,
          aspectRatio: config.w && config.h ? `${config.w}/${config.h}` : undefined
        }}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        onClick={onClick}
      />
    </div>
  );
}