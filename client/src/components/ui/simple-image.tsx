import React from "react";
import { cn } from "@/lib/utils";

interface SimpleImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

export default function SimpleImage({ src, alt, className, onClick }: SimpleImageProps) {
  // Check if we need fallback image
  const needsFallback = !src || src.trim() === '' || src === 'No Image' || src === 'null' || src === 'undefined';
  
  if (needsFallback) {
    return (
      <img
        src="/uploads/marvel-card-vault-logo.png"
        alt="Marvel Card Vault"
        className={cn("w-full h-full object-contain rounded-lg bg-gray-100 dark:bg-gray-800", className)}
        onClick={onClick}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("w-full h-full object-cover rounded-lg", className)}
      onClick={onClick}
      onError={(e) => {
        // Fallback to Marvel Card Vault logo
        const target = e.target as HTMLImageElement;
        target.src = "/uploads/marvel-card-vault-logo.png";
        target.className = cn("w-full h-full object-contain rounded-lg bg-gray-100 dark:bg-gray-800", className);
      }}
    />
  );
}