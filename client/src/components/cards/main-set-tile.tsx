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
          <div className="relative aspect-[3/4] overflow-hidden rounded-t-lg">
            <img
              src={thumbnailUrl}
              alt={mainSet.name}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "/images/image-coming-soon.png";
              }}
            />
            <div className="absolute top-2 right-2">
              <Badge variant="secondary" className="bg-black/70 text-white border-none">
                <Layers className="w-3 h-3 mr-1" />
                {assignedSets.length} {assignedSets.length === 1 ? "Set" : "Sets"}
              </Badge>
            </div>
          </div>
          <div className="p-4">
            <h3 className="font-semibold text-lg text-gray-900 mb-2 line-clamp-2 group-hover:text-red-600 transition-colors">
              {mainSet.name}
            </h3>
            {mainSet.notes && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">{mainSet.notes}</p>
            )}
            <div className="text-right">
              <div className="font-medium text-gray-700">
                {totalCards.toLocaleString()} cards
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
