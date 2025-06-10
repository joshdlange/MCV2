import { useState, useEffect } from "react";
import { OptimizedImage } from "@/components/ui/optimized-image";

interface SetThumbnailProps {
  setId: number;
  setName: string;
  setImageUrl?: string | null;
  className?: string;
}

export function SetThumbnail({ setId, setName, setImageUrl, className }: SetThumbnailProps) {
  const [firstCardImage, setFirstCardImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!setImageUrl && setId) {
      setLoading(true);
      fetchFirstCardImage();
    }
  }, [setId, setImageUrl]);

  const fetchFirstCardImage = async () => {
    try {
      const response = await fetch(`/api/cards?setId=${setId}&limit=50`);
      const cards = await response.json();
      
      if (cards.length > 0) {
        // Sort cards numerically by card number to get the true "first" card
        const sortedCards = cards.sort((a: any, b: any) => {
          const numA = parseInt(a.cardNumber) || 999999;
          const numB = parseInt(b.cardNumber) || 999999;
          return numA - numB;
        });
        
        // Find the first card with an image
        const cardWithImage = sortedCards.find((card: any) => card.frontImageUrl);
        
        if (cardWithImage) {
          setFirstCardImage(cardWithImage.frontImageUrl);
        }
      }
    } catch (error) {
      console.error('Failed to fetch first card image:', error);
    } finally {
      setLoading(false);
    }
  };

  const convertGoogleDriveUrl = (url: string) => {
    if (url.includes('drive.google.com')) {
      const fileId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (fileId) {
        return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }
    return url;
  };

  if (setImageUrl) {
    return (
      <img
        src={convertGoogleDriveUrl(setImageUrl)}
        alt={setName}
        className={className}
      />
    );
  }

  if (loading) {
    return (
      <div className={`${className} bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center`}>
        <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (firstCardImage) {
    return (
      <img
        src={convertGoogleDriveUrl(firstCardImage)}
        alt={`${setName} - First Card`}
        className={className}
      />
    );
  }

  // Fallback to gradient with set name
  return (
    <div className={`${className} bg-gradient-to-br from-marvel-red to-red-700 flex items-center justify-center`}>
      <span className="text-white text-sm md:text-lg font-bold text-center px-2 md:px-4">{setName}</span>
    </div>
  );
}