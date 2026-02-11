import { useState, useRef, useEffect } from "react";
import { cn, convertGoogleDriveUrl } from "@/lib/utils";

interface SimpleImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  width?: number;
  height?: number;
  priority?: boolean;
}

const CLOUDINARY_CLOUD_NAME = 'marvelcardvault';

function getOptimizedCloudinaryUrl(src: string, width: number): string {
  if (!src) return src;
  
  // Optimize existing Cloudinary images
  if (src.includes('res.cloudinary.com')) {
    const parts = src.split('/upload/');
    if (parts.length === 2) {
      return `${parts[0]}/upload/w_${width},q_auto,f_auto/${parts[1]}`;
    }
  }
  
  // Use Cloudinary fetch for external images (comc.com, etc.)
  // Cloudinary will fetch, cache, and optimize these on-demand
  // Note: Cloudinary fetch expects the raw URL (not URL-encoded) after transformations
  if (src.includes('comc.com') || src.includes('i.ebayimg.com')) {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/fetch/w_${width},q_auto,f_auto/${src}`;
  }
  
  return src;
}

export default function SimpleImage({ 
  src, 
  alt, 
  className, 
  onClick,
  width = 200,
  height = 280,
  priority = false
}: SimpleImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (priority) {
      setIsInView(true);
      return;
    }
    
    if (!imgRef.current) return;
    
    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const element = imgRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px',
        threshold: 0.01,
      }
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
      observer.disconnect();
    };
  }, [priority]);

  const needsFallback = !src || src.trim() === '' || src === 'No Image' || src === 'null' || src === 'undefined';
  const convertedSrc = needsFallback ? '' : convertGoogleDriveUrl(src);
  const optimizedSrc = needsFallback ? '' : getOptimizedCloudinaryUrl(convertedSrc, width);
  
  if (needsFallback || hasError) {
    return (
      <div 
        ref={imgRef}
        className={cn("bg-gray-100 dark:bg-gray-800 flex items-center justify-center", className)}
        style={{ width: '100%', aspectRatio: `${width}/${height}` }}
        onClick={onClick}
      >
        <img
          src="/uploads/marvel-card-vault-logo.png"
          alt="Marvel Card Vault"
          className="w-3/4 h-3/4 object-contain"
          width={width}
          height={height}
        />
      </div>
    );
  }

  return (
    <div
      ref={imgRef}
      className={cn("relative overflow-hidden", className)}
      style={{ width: '100%', aspectRatio: `${width}/${height}` }}
      onClick={onClick}
    >
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse flex items-center justify-center">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
      
      {isInView && (
        <img
          src={optimizedSrc}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className={cn(
            "w-full h-full object-cover rounded-lg transition-opacity duration-200",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
}