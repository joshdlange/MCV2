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

  // Use superhero logo for sets with no images  
  const superheroLogoUrl = '/uploads/superhero-fallback.svg';
  
  return (
    <img
      src={superheroLogoUrl}
      alt={`${setName} - Image Coming Soon`}
      className={className}
      onError={(e) => {
        // If local logo fails, use embedded SVG
        const target = e.target as HTMLImageElement;
        target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImNhcmRHcmFkaWVudCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6I2RjMjYyNjtzdG9wLW9wYWNpdHk6MSIgLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM5OTFiMWI7c3RvcC1vcGFjaXR5OjEiIC8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNjYXJkR3JhZGllbnQpIiBzdHJva2U9IiM3ZjFkMWQiIHN0cm9rZS13aWR0aD0iMyIgcng9IjEyIi8+PHJlY3QgeD0iOCIgeT0iOCIgd2lkdGg9IjE4NCIgaGVpZ2h0PSIyODQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZiYmYyNCIgc3Ryb2tlLXdpZHRoPSIyIiByeD0iOCIvPjx0ZXh0IHg9IjEwMCIgeT0iNDAiIGZvbnQtZmFtaWx5PSJBcmlhbCBCbGFjaywgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPk1BUlZFTDwvdGV4dD48dGV4dCB4PSIxMDAiIHk9IjYwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiNmYmJmMjQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkNBUkQgVkFVTFQ8L3RleHQ+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMTUwIiByPSI0NSIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC45Ii8+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMTUwIiByPSI0MCIgZmlsbD0iI2RjMjYyNiIvPjxwYXRoIGQ9Ik0xMDAgMTIwIEw4NSAxMzAgTDg1IDE3MCBMMTAWIE4MCBMMTE1IDE3MCBMMTE1IDEzMCBaIiBmaWxsPSIjZmZmZmZmIi8+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMTU1IiByPSI4IiBmaWxsPSIjZGMyNjI2Ii8+PHJlY3QgeD0iOTYiIHk9IjE1NSIgd2lkdGg9IjgiIGhlaWdodD0iMTUiIGZpbGw9IiNkYzI2MjYiLz48dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEwIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5UUkFESU5HIENBUkQ8L3RleHQ+PHRleHQgeD0iMTAwIiB5PSIyMzUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMCIgZmlsbD0iI2ZiYmYyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q09MTEVDVElPTjwvdGV4dD48cG9seWdvbiBwb2ludHM9IjIwLDIwIDM1LDIwIDIwLDM1IiBmaWxsPSIjZmJiZjI0Ii8+PHBvbHlnb24gcG9pbnRzPSIxODAsMjAgMTgwLDM1IDE2NSwyMCIgZmlsbD0iI2ZiYmYyNCIvPjxwb2x5Z29uIHBvaW50cz0iMjAsMjgwIDIwLDI2NSAzNSwyODAiIGZpbGw9IiNmYmJmMjQiLz48cG9seWdvbiBwb2ludHM9IjE4MCwyODAgMTY1LDI4MCAxODAsMjY1IiBmaWxsPSIjZmJiZjI0Ii8+PC9zdmc+';
      }}
    />
  );
}