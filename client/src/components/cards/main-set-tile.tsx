import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";
import { Link } from "wouter";
import type { MainSet, CardSet, CardWithSet } from "@shared/schema";

interface MainSetTileProps {
  mainSet: MainSet;
  assignedSets: CardSet[];
}

export function MainSetTile({ mainSet, assignedSets }: MainSetTileProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string>("/images/image-coming-soon.png");
  const [totalCards, setTotalCards] = useState<number>(0);

  // Calculate total cards
  useEffect(() => {
    const total = assignedSets.reduce((sum, set) => {
      const cardCount = Number(set.totalCards) || 0;
      return sum + cardCount;
    }, 0);
    setTotalCards(total);
  }, [assignedSets]);

  const validSetId = assignedSets.length > 0 ? assignedSets[0].id : null;

  // ✅ Always run the hook, conditionally enable it
  const { data: firstSetCards } = useQuery<CardWithSet[]>({
    queryKey: ["/api/cards", { setId: validSetId }],
    enabled: Boolean(validSetId && !mainSet.thumbnailImageUrl),
  });

  useEffect(() => {
    if (mainSet.thumbnailImageUrl) {
      setThumbnailUrl(mainSet.thumbnailImageUrl);
    } else if (firstSetCards && firstSetCards.length > 0) {
      const firstCard = firstSetCards[0];
      setThumbnailUrl(firstCard.frontImageUrl || "/images/image-coming-soon.png");
    }
  }, [mainSet.thumbnailImageUrl, firstSetCards]);

  return (
    <Link href={`/browse/${mainSet.slug}`}>
      <Card className="group cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="relative aspect-[3/4] sm:aspect-[2.5/3.5] overflow-hidden rounded-t-lg">
            <img
              src={thumbnailUrl}
              alt={mainSet.name}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
              loading="lazy"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "/images/image-coming-soon.png";
              }}
            />
            <div className="absolute top-1.5 right-1.5">
              <Badge variant="secondary" className="bg-black/70 text-white border-none text-xs px-1.5 py-0.5">
                <Layers className="w-2.5 h-2.5 mr-1" />
                {assignedSets.length}
              </Badge>
            </div>
          </div>
          <div className="p-1.5 sm:p-2.5">
            <h3 className="font-medium text-xs sm:text-xs text-gray-900 mb-1 sm:mb-1.5 line-clamp-2 leading-tight group-hover:text-red-600 transition-colors min-h-[1.5rem] sm:min-h-[2rem]">
              {mainSet.name}
            </h3>
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span className="truncate text-xs sm:text-xs">{totalCards.toLocaleString()} cards</span>
              <span className="text-gray-500 flex-shrink-0 ml-1">{assignedSets.length} sets</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
