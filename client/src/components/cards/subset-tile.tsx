import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { CardSet } from "@shared/schema";

interface SubsetTileProps {
  subset: CardSet;
  onSubsetClick: (setId: number) => void;
}

export function SubsetTile({ subset, onSubsetClick }: SubsetTileProps) {
  // Get first card image for thumbnail if not available
  const { data: cards } = useQuery({
    queryKey: ['/api/cards', { setId: subset.id, limit: 1 }],
    enabled: !subset.imageUrl,
  });

  const thumbnailUrl = subset.imageUrl || cards?.[0]?.frontImageUrl || '/placeholder-card.jpg';
  const totalCards = subset.totalCards || 0;

  return (
    <Card 
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 overflow-hidden bg-white dark:bg-gray-800"
      onClick={() => onSubsetClick(subset.id)}
    >
      <div className="aspect-[3/4] relative overflow-hidden bg-gray-100 dark:bg-gray-700">
        <img
          src={thumbnailUrl}
          alt={subset.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          onError={(e) => {
            e.currentTarget.src = '/placeholder-card.jpg';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="bg-white/90 text-gray-900 text-xs">
            {totalCards} Cards
          </Badge>
        </div>
        {subset.subsetType && (
          <div className="absolute top-2 left-2">
            <Badge variant="outline" className="bg-blue-500/80 text-white border-blue-400 text-xs">
              {subset.subsetType}
            </Badge>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm leading-tight mb-1 line-clamp-2 text-gray-900 dark:text-gray-100">
          {subset.name}
        </h3>
        {subset.description && (
          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
            {subset.description}
          </p>
        )}
      </div>
    </Card>
  );
}