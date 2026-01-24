import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, BookOpen, Grid3X3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CollectionItem, CardWithSet } from "@shared/schema";

interface BinderCard {
  cardNumber: number;
  owned: boolean;
  item?: CollectionItem;
  card?: CardWithSet;
}

interface BinderViewProps {
  ownedCards: CollectionItem[];
  allCardsInSet: CardWithSet[];
  totalCardsInSet: number;
  setName: string;
  onCardClick: (item: CollectionItem | CardWithSet) => void;
  onViewModeChange?: (mode: "binder" | "grid") => void;
  viewMode?: "binder" | "grid";
}

interface BinderSlotProps {
  card: BinderCard;
  slotIndex: number;
  onClick: () => void;
  isPageComplete: boolean;
}

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

function BinderSlot({ card, slotIndex, onClick, isPageComplete }: BinderSlotProps) {
  const isOwned = card.owned;
  const rawImageUrl = card.item?.card?.frontImageUrl || card.card?.frontImageUrl;
  const imageUrl = rawImageUrl && rawImageUrl !== PLACEHOLDER_IMAGE ? rawImageUrl : null;
  const cardName = card.item?.card?.name || card.card?.name || `Card #${card.cardNumber}`;
  const isInsert = card.item?.card?.isInsert || card.card?.isInsert;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: slotIndex * 0.05, duration: 0.2 }}
      onClick={onClick}
      className={`relative aspect-[2.5/3.5] rounded-lg overflow-hidden cursor-pointer 
        transition-all duration-300 hover:scale-[1.02] hover:shadow-xl
        ${isOwned 
          ? 'ring-2 ring-green-500/50 shadow-lg shadow-green-500/20' 
          : 'ring-1 ring-gray-600/30'
        }
        ${isPageComplete ? 'ring-2 ring-yellow-400/50' : ''}
      `}
      style={{
        background: isOwned 
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' 
          : 'linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%)'
      }}
      data-testid={`binder-slot-${card.cardNumber}`}
    >
      {isOwned && imageUrl ? (
        <div className="relative w-full h-full">
          <img
            src={imageUrl}
            alt={cardName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {isInsert && (
            <div className="absolute bottom-1 left-1 bg-purple-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
              <Sparkles className="w-3 h-3" />
            </div>
          )}
          <div className="absolute bottom-1 right-1 bg-green-600/90 text-white text-[10px] px-1.5 py-0.5 rounded font-bold shadow-lg">
            #{card.cardNumber}
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
          <div className="w-10 h-10 rounded-full bg-gray-700/50 flex items-center justify-center mb-2">
            <span className="text-gray-500 text-lg font-bold">?</span>
          </div>
          <span className="text-gray-400 text-[11px] font-medium leading-tight">
            #{card.cardNumber}
          </span>
          <span className="text-gray-500 text-[9px] mt-1 line-clamp-2 leading-tight">
            {cardName !== `Card #${card.cardNumber}` ? cardName : 'Missing'}
          </span>
        </div>
      )}
      
      <div className="absolute inset-0 pointer-events-none rounded-lg"
        style={{
          boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.05)'
        }}
      />
    </motion.div>
  );
}

export function BinderView({
  ownedCards,
  allCardsInSet,
  totalCardsInSet,
  setName,
  onCardClick,
  onViewModeChange,
  viewMode = "binder"
}: BinderViewProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [flipDirection, setFlipDirection] = useState<"left" | "right">("right");
  const cardsPerPage = 9;

  const ownedCardNumbers = useMemo(() => {
    return new Set(ownedCards.map(item => parseInt(item.card?.cardNumber || '0') || 0));
  }, [ownedCards]);

  const binderCards: BinderCard[] = useMemo(() => {
    const cards: BinderCard[] = [];
    
    for (let i = 1; i <= totalCardsInSet; i++) {
      const isOwned = ownedCardNumbers.has(i);
      const ownedItem = ownedCards.find(item => parseInt(item.card?.cardNumber || '0') === i);
      const setCard = allCardsInSet.find(card => parseInt(card.cardNumber) === i);
      
      cards.push({
        cardNumber: i,
        owned: isOwned,
        item: ownedItem,
        card: setCard
      });
    }
    
    return cards;
  }, [ownedCards, allCardsInSet, totalCardsInSet, ownedCardNumbers]);

  const totalPages = Math.ceil(binderCards.length / cardsPerPage);
  const currentCards = binderCards.slice(
    currentPage * cardsPerPage,
    (currentPage + 1) * cardsPerPage
  );

  const isPageComplete = currentCards.every(card => card.owned);
  const ownedOnPage = currentCards.filter(card => card.owned).length;
  const isSetComplete = ownedCards.length === totalCardsInSet;

  const handlePageChange = (direction: "prev" | "next") => {
    if (direction === "prev" && currentPage > 0) {
      setFlipDirection("left");
      setCurrentPage(prev => prev - 1);
    } else if (direction === "next" && currentPage < totalPages - 1) {
      setFlipDirection("right");
      setCurrentPage(prev => prev + 1);
    }
  };

  const handleCardClick = (card: BinderCard) => {
    if (card.item) {
      onCardClick(card.item);
    } else if (card.card) {
      onCardClick(card.card);
    }
  };

  const pageVariants = {
    enter: (direction: "left" | "right") => ({
      rotateY: direction === "right" ? 90 : -90,
      opacity: 0,
      scale: 0.9
    }),
    center: {
      rotateY: 0,
      opacity: 1,
      scale: 1
    },
    exit: (direction: "left" | "right") => ({
      rotateY: direction === "right" ? -90 : 90,
      opacity: 0,
      scale: 0.9
    })
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-gray-900">{setName}</h3>
          <Badge className="bg-gray-100 text-gray-700 text-xs">
            {ownedCards.length}/{totalCardsInSet}
          </Badge>
          {isSetComplete && (
            <Badge className="bg-green-100 text-green-700 text-xs animate-pulse">
              <Sparkles className="w-3 h-3 mr-1" />
              Complete!
            </Badge>
          )}
        </div>
        
        {onViewModeChange && (
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <Button
              variant={viewMode === "binder" ? "default" : "ghost"}
              size="sm"
              onClick={() => onViewModeChange("binder")}
              className={`rounded-none px-2 ${viewMode === "binder" ? "text-white" : "text-gray-900"}`}
              data-testid="button-binder-view"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-none px-2 ${viewMode === "grid" ? "text-white" : "text-gray-900"}`}
              data-testid="button-grid-view"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div 
        className="relative rounded-2xl p-4 sm:p-6"
        style={{
          background: 'linear-gradient(135deg, #1e1e2f 0%, #141422 50%, #0d0d1a 100%)',
          boxShadow: 'inset 0 2px 20px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.3)'
        }}
      >
        <div 
          className="absolute inset-0 rounded-2xl opacity-30 pointer-events-none"
          style={{
            background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)'
          }}
        />

        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePageChange("prev")}
            disabled={currentPage === 0}
            className="text-white hover:bg-white/10 disabled:opacity-30"
            data-testid="button-prev-page"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <div className="flex flex-col items-center">
            <span className="text-white/60 text-xs">Page</span>
            <span className="text-white font-bold text-lg">
              {currentPage + 1} <span className="text-white/40">of</span> {totalPages}
            </span>
            {isPageComplete && (
              <span className="text-yellow-400 text-[10px] flex items-center gap-1 mt-1">
                <Sparkles className="w-3 h-3" />
                Page Complete!
              </span>
            )}
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlePageChange("next")}
            disabled={currentPage >= totalPages - 1}
            className="text-white hover:bg-white/10 disabled:opacity-30"
            data-testid="button-next-page"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <div style={{ perspective: '1000px' }}>
          <AnimatePresence mode="wait" custom={flipDirection}>
            <motion.div
              key={currentPage}
              custom={flipDirection}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ 
                duration: 0.4, 
                ease: [0.4, 0, 0.2, 1]
              }}
              className={`grid grid-cols-3 gap-2 sm:gap-3
                ${isPageComplete ? 'ring-2 ring-yellow-400/30 rounded-xl p-1' : ''}
              `}
            >
              {currentCards.map((card, index) => (
                <BinderSlot
                  key={`${currentPage}-${card.cardNumber}`}
                  card={card}
                  slotIndex={index}
                  onClick={() => handleCardClick(card)}
                  isPageComplete={isPageComplete}
                />
              ))}
              
              {currentCards.length < cardsPerPage && 
                [...Array(cardsPerPage - currentCards.length)].map((_, i) => (
                  <div 
                    key={`empty-${i}`}
                    className="aspect-[2.5/3.5] rounded-lg bg-gray-800/30 border border-gray-700/20"
                  />
                ))
              }
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-4 flex justify-center">
          <div className="flex items-center gap-1.5">
            {[...Array(Math.min(totalPages, 10))].map((_, i) => {
              const pageIndex = totalPages <= 10 ? i : 
                currentPage < 5 ? i :
                currentPage > totalPages - 6 ? totalPages - 10 + i :
                currentPage - 5 + i;
              
              return (
                <button
                  key={i}
                  onClick={() => {
                    setFlipDirection(pageIndex > currentPage ? "right" : "left");
                    setCurrentPage(pageIndex);
                  }}
                  className={`w-2 h-2 rounded-full transition-all duration-200 
                    ${pageIndex === currentPage 
                      ? 'bg-white w-4' 
                      : 'bg-white/30 hover:bg-white/50'
                    }
                  `}
                  data-testid={`page-dot-${pageIndex}`}
                />
              );
            })}
          </div>
        </div>
        
        <div className="mt-3 flex justify-center">
          <span className="text-white/40 text-xs">
            {ownedOnPage}/9 cards on this page
          </span>
        </div>
      </div>
    </div>
  );
}
