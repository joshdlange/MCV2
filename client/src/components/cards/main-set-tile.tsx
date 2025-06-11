import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { CardSet } from "@shared/schema";

interface MainSetTileProps {
  mainSet: CardSet;
  onSetClick: (setId: number) => void;
}

export function MainSetTile({ mainSet, onSetClick }: MainSetTileProps) {
  // Get subset count for this main set
  const { data: subsets } = useQuery({
    queryKey: ['/api/card-sets', mainSet.id, 'subsets'],
  });

  // Get first card image for thumbnail from any subset
  const { data: cards } = useQuery({
    queryKey: ['/api/cards', { setId: mainSet.id, limit: 1 }],
    enabled: !mainSet.imageUrl && subsets && subsets.length > 0,
  });

  const thumbnailUrl = mainSet.imageUrl || (cards && cards.length > 0 ? cards[0]?.frontImageUrl : null) || '/placeholder-card.jpg';
  const subsetCount = (subsets && subsets.length) || 0;
  const totalCards = mainSet.totalCards || 0;

  return (
    <Card 
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 overflow-hidden bg-white dark:bg-gray-800"
      onClick={() => onSetClick(mainSet.id)}
    >
      <div className="aspect-[3/4] relative overflow-hidden bg-gray-100 dark:bg-gray-700">
        <img
          src={thumbnailUrl}
          alt={mainSet.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          onError={(e) => {
            e.currentTarget.src = '/placeholder-card.jpg';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="bg-white/90 text-gray-900 text-xs">
            {mainSet.year}
          </Badge>
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <div className="flex items-center justify-between text-white text-sm">
            <div className="flex flex-col">
              <span className="font-medium">{subsetCount} Sets</span>
              <span className="text-xs opacity-90">{totalCards.toLocaleString()} Cards</span>
            </div>
          </div>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm leading-tight mb-1 line-clamp-2 text-gray-900 dark:text-gray-100">
          {mainSet.name}
        </h3>
        {mainSet.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
            {mainSet.description}
          </p>
        )}
      </div>
    </Card>
  );
}