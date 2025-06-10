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
        target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxZjI5Mzc7c3RvcC1vcGFjaXR5OjEiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMTExODI3O3N0b3Atb3BhY2l0eToxIiAvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYmdHcmFkaWVudCkiIHN0cm9rZT0iIzM3NDE1MSIgc3Ryb2tlLXdpZHRoPSIyIiByeD0iOCIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjEyMCIgcj0iMzUiIGZpbGw9IiNGRjAwMUMiIHN0cm9rZT0iI2RjMjYyNiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTAwLCAxMjApIHNjYWxlKDAuOCkiPjxjaXJjbGUgY3g9IjAiIGN5PSItMTUiIHI9IjYiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNLTggLTggTDggLTggTDEyIDggTDggMjAgTC04IDIwIEwtMTIgOCBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTS0xMiAtNSBRLTIwIDAgLTE4IDE1IFEtMTUgMjUgLTggMjAgTC04IC04IFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNMTIgLTUgUTIwIDAgMTggMTUgUTE1IDI1IDggMjAgTDggLTggWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tOCAtNSBMLTE1IC0yIEwtMTIgOCBMLTggNSBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTTggLTUgTDE1IC0yIEwxMiA4IEw4IDUgWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tNCAyMCBMLTYgMzUgTC0yIDM1IEwwIDIwIFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNNCAyMCBMNiAzNSBMMiAzNSBMMCAyMCBaIiBmaWxsPSIjMDAwMDAwIi8+PC9nPjx0ZXh0IHg9IjEwMCIgeT0iMjAwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JTUFHRTwvdGV4dD48dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q09NSU5HIFRPT048L3RleHQ+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjMiIGhlaWdodD0iMjAiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxNzAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMTAiIHdpZHRoPSIzIiBoZWlnaHQ9IjIwIiBmaWxsPSIjRkYwMDFDIi8+PHJlY3QgeD0iMTAiIHk9IjI4NyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjMiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxMCIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE3MCIgeT0iMjg3IiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjwvc3ZnPg==';
      }}
    />
  );
}