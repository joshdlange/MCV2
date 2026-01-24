import { useState, useEffect } from "react";
import { Star, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptimizedImage } from "@/components/ui/optimized-image";
import type { CardSet } from "@shared/schema";

interface SetThumbnailProps {
  set: CardSet;
  onClick: () => void;
  isFavorite: boolean;
  onFavorite: () => void;
  showAdminControls?: boolean;
  onEdit?: () => void;
}

export function SetThumbnail({ set, onClick, isFavorite, onFavorite, showAdminControls, onEdit }: SetThumbnailProps) {
  const [firstCardImage, setFirstCardImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const defaultFallbackUrl = "https://drive.google.com/uc?export=view&id=1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF";
  const cloudinaryPlaceholder = "https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png";
  
  const isPlaceholderImage = (url: string | null) => {
    if (!url) return true;
    if (url.includes('1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF')) return true;
    if (url.includes('superhero-fallback')) return true;
    if (url.includes('card-placeholder_ysozlo')) return true;
    return false;
  };

  useEffect(() => {
    if (isPlaceholderImage(set.imageUrl) && set.id) {
      console.log(`Fetching card image for set ${set.id}: ${set.name}`);
      setLoading(true);
      fetchFirstCardImage();
    }
  }, [set.id, set.imageUrl]);

  const fetchFirstCardImage = async () => {
    try {
      const response = await fetch(`/api/cards?setId=${set.id}&limit=50`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const cards = data.items || [];
      console.log(`Set ${set.id} has ${cards.length} cards`);
      
      if (cards.length > 0) {
        const sortedCards = cards.sort((a: any, b: any) => {
          const numA = parseInt(a.cardNumber) || 999999;
          const numB = parseInt(b.cardNumber) || 999999;
          return numA - numB;
        });
        
        const cardWithImage = sortedCards.find((card: any) => 
          card.frontImageUrl && 
          !isPlaceholderImage(card.frontImageUrl)
        );
        
        if (cardWithImage) {
          console.log(`Found card image for set ${set.id}: ${cardWithImage.frontImageUrl}`);
          setFirstCardImage(cardWithImage.frontImageUrl);
        } else {
          console.log(`No valid card images found for set ${set.id}`);
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

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFavorite();
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) onEdit();
  };

  return (
    <div 
      className="group relative bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
      onClick={onClick}
    >
      {/* Set Image */}
      <div className="aspect-[2.5/3.5] bg-gray-100 overflow-hidden relative">
        {loading ? (
          <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
        ) : firstCardImage ? (
          <img
            src={convertGoogleDriveUrl(firstCardImage)}
            alt={`${set.name} - First Card`}
            className="w-full h-full object-cover"
          />
        ) : set.imageUrl && !isPlaceholderImage(set.imageUrl) ? (
          <img
            src={convertGoogleDriveUrl(set.imageUrl)}
            alt={set.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src="/uploads/superhero-fallback.svg"
            alt={`${set.name} - Image Coming Soon`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxZjI5Mzc7c3RvcC1vcGFjaXR5OjEiIC8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMTExODI3O3N0b3Atb3BhY2l0eToxIiAvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjYmdHcmFkaWVudCkiIHN0cm9rZT0iIzM3NDE1MSIgc3Ryb2tlLXdpZHRoPSIyIiByeD0iOCIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjEyMCIgcj0iMzUiIGZpbGw9IiNGRjAwMUMiIHN0cm9rZT0iI2RjMjYyNiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTAwLCAxMjApIHNjYWxlKDAuOCkiPjxjaXJjbGUgY3g9IjAiIGN5PSItMTUiIHI9IjYiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNLTggLTggTDggLTggTDEyIDggTDggMjAgTC04IDIwIEwtMTIgOCBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTS0xMiAtNSBRLTIwIDAgLTE4IDE1IFEtMTUgMjUgLTggMjAgTC04IC04IFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNMTIgLTUgUTIwIDAgMTggMTUgUTE1IDI1IDggMjAgTDggLTggWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tOCAtNSBMLTE1IC0yIEwtMTIgOCBMLTggNSBaIiBmaWxsPSIjMDAwMDAwIi8+PHBhdGggZD0iTTggLTUgTDE1IC0yIEwxMiA4IEw4IDUgWiIgZmlsbD0iIzAwMDAwMCIvPjxwYXRoIGQ9Ik0tNCAyMCBMLTYgMzUgTC0yIDM1IEwwIDIwIFoiIGZpbGw9IiMwMDAwMDAiLz48cGF0aCBkPSJNNCAyMCBMNiAzNSBMMiAzNSBMMCAyMCBaIiBmaWxsPSIjMDAwMDAwIi8+PC9nPjx0ZXh0IHg9IjEwMCIgeT0iMjAwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JTUFHRTwvdGV4dD48dGV4dCB4PSIxMDAiIHk9IjIyMCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iYm9sZCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q09NSU5HIFRPT048L3RleHQ+PHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjMiIGhlaWdodD0iMjAiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxNzAiIHk9IjEwIiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMTAiIHdpZHRoPSIzIiBoZWlnaHQ9IjIwIiBmaWxsPSIjRkYwMDFDIi8+PHJlY3QgeD0iMTAiIHk9IjI4NyIgd2lkdGg9IjIwIiBoZWlnaHQ9IjMiIGZpbGw9IiNGRjAwMUMiLz48cmVjdCB4PSIxMCIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE3MCIgeT0iMjg3IiB3aWR0aD0iMjAiIGhlaWdodD0iMyIgZmlsbD0iI0ZGMDAxQyIvPjxyZWN0IHg9IjE4NyIgeT0iMjcwIiB3aWR0aD0iMyIgaGVpZ2h0PSIyMCIgZmlsbD0iI0ZGMDAxQyIvPjwvc3ZnPg==';
            }}
          />
        )}

        {/* Overlay Controls */}
        <div className="absolute top-2 right-2 flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 rounded-full shadow-sm ${
              isFavorite 
                ? 'bg-yellow-500 text-white hover:bg-yellow-600' 
                : 'bg-white/90 text-gray-600 hover:bg-white hover:text-yellow-500'
            }`}
            onClick={handleFavoriteClick}
          >
            <Star className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
          </Button>
          
          {showAdminControls && onEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 rounded-full bg-white/90 text-gray-600 hover:bg-white hover:text-blue-600 shadow-sm"
              onClick={handleEditClick}
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Set Info */}
      <div className="p-3">
        <h3 className="font-medium text-gray-900 text-xs leading-tight mb-1 line-clamp-2 min-h-[2.5rem]">
          {set.name}
        </h3>
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{set.year}</span>
          <span>{set.totalCards} cards</span>
        </div>
      </div>
    </div>
  );
}