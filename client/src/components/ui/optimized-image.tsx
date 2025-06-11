/**
 * High-performance image component with lazy loading, WebP support, and caching
 * Optimized for large card collections with minimal memory usage
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { performanceCache } from '@/lib/performance-cache';

interface OptimizedImageProps {
  src: string | null;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  placeholder?: string;
  priority?: boolean;
  onLoad?: () => void;
  onError?: () => void;
  fallback?: string;
}

export function OptimizedImage({
  src,
  alt,
  width = 300,
  height = 400,
  className = "",
  placeholder,
  priority = false,
  onLoad,
  onError,
  fallback = "/api/placeholder-card.svg"
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (priority || !imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observerRef.current?.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold: 0.1,
      }
    );

    if (imgRef.current) {
      observerRef.current.observe(imgRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [priority]);

  // Optimize image URL with WebP support and proxy
  const getOptimizedSrc = useCallback((originalSrc: string | null): string => {
    if (!originalSrc) return fallback;

    // Check if it's already a data URL or blob
    if (originalSrc.startsWith('data:') || originalSrc.startsWith('blob:')) {
      return originalSrc;
    }

    // Check cache first
    const cacheKey = `optimized-image-${originalSrc}`;
    const cached = performanceCache.get<string>(cacheKey);
    if (cached) return cached;

    // Use image proxy for external images
    const optimizedUrl = originalSrc.startsWith('http') 
      ? `/api/proxy-image?url=${encodeURIComponent(originalSrc)}&w=${width}&h=${height}&format=webp`
      : originalSrc;

    // Cache the optimized URL
    performanceCache.set(cacheKey, optimizedUrl, 30 * 60 * 1000); // 30 minute cache

    return optimizedUrl;
  }, [fallback, width, height]);

  // Update current src when in view
  useEffect(() => {
    if (isInView && src && !currentSrc) {
      setCurrentSrc(getOptimizedSrc(src));
    }
  }, [isInView, src, currentSrc, getOptimizedSrc]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    if (currentSrc !== fallback) {
      // Try fallback image
      setCurrentSrc(fallback);
      setHasError(false);
    } else {
      setHasError(true);
      onError?.();
    }
  }, [currentSrc, fallback, onError]);

  // Placeholder component
  const renderPlaceholder = () => (
    <div
      className={`bg-gray-200 dark:bg-gray-700 animate-pulse flex items-center justify-center ${className}`}
      style={{ width, height }}
    >
      {placeholder || (
        <svg
          className="w-12 h-12 text-gray-400"
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
      )}
    </div>
  );

  // Error state
  if (hasError) {
    return (
      <div
        className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-center ${className}`}
        style={{ width, height }}
      >
        <span className="text-red-500 text-sm">Image unavailable</span>
      </div>
    );
  }

  return (
    <div
      ref={imgRef}
      className={`relative overflow-hidden ${className}`}
      style={{ width, height }}
    >
      {/* Show placeholder while not in view or loading */}
      {(!isInView || !isLoaded) && renderPlaceholder()}
      
      {/* Actual image */}
      {isInView && currentSrc && (
        <img
          src={currentSrc}
          alt={alt}
          width={width}
          height={height}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      )}
    </div>
  );
}

// High-performance card image with Marvel-themed styling
export function CardImage({
  src,
  alt,
  cardNumber,
  setName,
  isInsert = false,
  priority = false,
  className = "",
}: {
  src: string | null;
  alt: string;
  cardNumber?: string;
  setName?: string;
  isInsert?: boolean;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative group ${className}`}>
      <OptimizedImage
        src={src}
        alt={alt}
        width={200}
        height={280}
        priority={priority}
        className="rounded-lg shadow-md transition-transform group-hover:scale-105"
        fallback="/api/placeholder-card.svg"
      />
      
      {/* Insert badge */}
      {isInsert && (
        <div className="absolute top-2 right-2 bg-yellow-500 text-black text-xs font-bold px-2 py-1 rounded">
          INSERT
        </div>
      )}
      
      {/* Card number overlay */}
      {cardNumber && (
        <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
          #{cardNumber}
        </div>
      )}
      
      {/* Hover overlay with set name */}
      {setName && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors duration-200 rounded-lg flex items-end p-3">
          <div className="text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 line-clamp-2">
            {setName}
          </div>
        </div>
      )}
    </div>
  );
}

// Preload critical images
export function preloadImages(imageSrcs: string[], priority: boolean = false) {
  const preloadPromises = imageSrcs.map((src) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to preload ${src}`));
      img.src = src;
      
      if (priority) {
        img.loading = 'eager';
      }
    });
  });

  return Promise.allSettled(preloadPromises);
}

// Image cache management
export const imageCache = {
  preloadCardImages: async (cards: Array<{ frontImageUrl: string | null }>) => {
    const imageSrcs = cards
      .map(card => card.frontImageUrl)
      .filter((src): src is string => !!src)
      .slice(0, 20); // Preload first 20 images

    if (imageSrcs.length > 0) {
      await preloadImages(imageSrcs, true);
    }
  },

  clearCache: () => {
    // Clear image cache entries
    const keys = ['optimized-image-'];
    keys.forEach(key => {
      // Remove cache entries that start with this key
      // Implementation depends on cache structure
    });
  }
};