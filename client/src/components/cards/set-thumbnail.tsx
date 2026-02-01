import { useState, useEffect } from "react";
import { Star, Edit, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CardSet } from "@shared/schema";
import { formatSetName } from "@/lib/formatTitle";

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
  
  const placeholderImage = "/uploads/set-placeholder.jpg";
  
  const isPlaceholderImage = (url: string | null) => {
    if (!url) return true;
    if (url.includes('1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF')) return true;
    if (url.includes('superhero-fallback')) return true;
    if (url.includes('card-placeholder_ysozlo')) return true;
    if (url.includes('set-placeholder')) return true;
    return false;
  };

  useEffect(() => {
    if (isPlaceholderImage(set.imageUrl) && set.id && set.totalCards > 0) {
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
      const cards = data.items ?? data.cards ?? data;
      
      if (Array.isArray(cards) && cards.length > 0) {
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
  
  const hasValidSetImage = set.imageUrl && !isPlaceholderImage(set.imageUrl);
  const hasValidFirstCardImage = firstCardImage && !isPlaceholderImage(firstCardImage);
  const imageUrl = hasValidSetImage 
    ? convertGoogleDriveUrl(set.imageUrl!) 
    : hasValidFirstCardImage 
      ? convertGoogleDriveUrl(firstCardImage!)
      : placeholderImage;

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
        ) : (
          <img
            src={imageUrl}
            alt={set.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = placeholderImage;
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
          {formatSetName(set.name)}
        </h3>
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{set.year}</span>
          {set.totalCards === 0 ? (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 text-xs px-1.5 py-0.5">
              <Clock className="w-3 h-3 mr-1" />
              Coming Soon
            </Badge>
          ) : (
            <span>{set.totalCards} cards</span>
          )}
        </div>
      </div>
    </div>
  );
}
