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
        
        // Find the first card with a real image (not the default fallback)
        const defaultFallbackUrl = "https://drive.google.com/uc?export=view&id=1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF";
        const cardWithImage = sortedCards.find((card: any) => 
          card.frontImageUrl && 
          card.frontImageUrl !== defaultFallbackUrl &&
          !card.frontImageUrl.includes('1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF')
        );
        
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

  // Fallback to default "no image" placeholder - use direct download link
  const defaultNoImageUrl = "https://drive.google.com/uc?export=download&id=1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF";
  
  return (
    <img
      src={defaultNoImageUrl}
      alt={`${setName} - No Image Available`}
      className={className}
      onError={(e) => {
        // If Google Drive link fails, use a simple placeholder
        const target = e.target as HTMLImageElement;
        target.style.background = 'linear-gradient(135deg, #e2e8f0, #cbd5e1)';
        target.style.display = 'flex';
        target.style.alignItems = 'center';
        target.style.justifyContent = 'center';
        target.style.color = '#64748b';
        target.style.fontSize = '12px';
        target.style.fontWeight = '500';
        target.alt = 'Image Unavailable';
        target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjFmNWY5Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzY0NzQ4YiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
      }}
    />
  );
}