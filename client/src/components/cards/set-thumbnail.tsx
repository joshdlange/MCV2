import { useState, useEffect } from "react";
import { Star, Edit, Clock, Lock, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CardSet } from "@shared/schema";
import { formatSetName } from "@/lib/formatTitle";
import { getCardSetDisplayName } from "@/lib/setDisplayName";
import { useAppStore } from "@/lib/store";
import { useLocation } from "wouter";

interface SetThumbnailProps {
  set: CardSet;
  onClick: () => void;
  isFavorite: boolean;
  onFavorite: () => void;
  showAdminControls?: boolean;
  onEdit?: () => void;
  mainSetName?: string | null;
}

export function SetThumbnail({ set, onClick, isFavorite, onFavorite, showAdminControls, onEdit, mainSetName }: SetThumbnailProps) {
  const [firstCardImage, setFirstCardImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showStillPopulatingModal, setShowStillPopulatingModal] = useState(false);
  const { isAdminMode } = useAppStore();
  const [location] = useLocation();
  
  const isEmpty = set.totalCards === 0;
  
  const isAdminContext = isAdminMode || location.startsWith('/admin');
  const { displayName, isBaseSet } = getCardSetDisplayName({
    cardSetName: set.name,
    mainSetName,
    isAdmin: isAdminContext
  });
  
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

  const handleClick = () => {
    if (isEmpty) {
      setShowStillPopulatingModal(true);
    } else {
      onClick();
    }
  };

  return (
    <>
    <div 
      className={`group relative bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden ${
        isEmpty ? 'border-amber-200' : 'border-gray-200'
      }`}
      onClick={handleClick}
    >
      {/* Set Image */}
      <div className="aspect-[2.5/3.5] bg-gray-100 overflow-hidden relative">
        {loading ? (
          <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
            <div className="animate-spin w-6 h-6 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <>
          <img
            src={imageUrl}
            alt={set.name}
            className={`w-full h-full object-cover ${isEmpty ? 'grayscale opacity-60' : ''}`}
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = placeholderImage;
            }}
          />
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="bg-amber-500/90 rounded-full p-3">
                <Lock className="w-6 h-6 text-white" />
              </div>
            </div>
          )}
          </>
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
        <div className="flex items-start gap-1 mb-1">
          {isBaseSet && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200 text-xs px-1.5 py-0 shrink-0">
              Base
            </Badge>
          )}
          <h3 className="font-medium text-gray-900 text-xs leading-tight line-clamp-2 min-h-[2rem]">
            {isAdminContext ? formatSetName(set.name) : displayName}
          </h3>
        </div>
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
    
    <Dialog open={showStillPopulatingModal} onOpenChange={setShowStillPopulatingModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <Hammer className="w-5 h-5" />
            Still Populating
          </DialogTitle>
        </DialogHeader>
        <div className="text-center py-4">
          <div className="bg-amber-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Hammer className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">{displayName}</h3>
          <p className="text-gray-600 text-sm">
            We're still adding cards to this set. Check back soon!
          </p>
        </div>
        <div className="flex justify-center">
          <Button 
            variant="outline" 
            onClick={() => setShowStillPopulatingModal(false)}
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
