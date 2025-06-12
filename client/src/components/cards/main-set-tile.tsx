import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, Calendar } from "lucide-react";
import { Link } from "wouter";
import type { MainSet, CardSet, CardWithSet } from "@shared/schema";

interface MainSetTileProps {
  mainSet: MainSet;
  assignedSets: CardSet[];
}

export function MainSetTile({ mainSet, assignedSets }: MainSetTileProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [totalCards, setTotalCards] = useState<number>(0);

  // Calculate total cards across all assigned sets
  useEffect(() => {
    const total = assignedSets.reduce((sum, set) => sum + set.totalCards, 0);
    setTotalCards(total);
  }, [assignedSets]);

  // Fetch first card image for thumbnail fallback
  const { data: firstSetCards } = useQuery<CardWithSet[]>({
    queryKey: ["/api/cards", { setId: assignedSets[0]?.id }],
    enabled: !mainSet.thumbnailImageUrl && assignedSets.length > 0,
  });

  useEffect(() => {
    if (mainSet.thumbnailImageUrl) {
      setThumbnailUrl(mainSet.thumbnailImageUrl);
    } else if (firstSetCards && firstSetCards.length > 0) {
      const firstCard = firstSetCards[0];
      if (firstCard.frontImageUrl) {
        setThumbnailUrl(firstCard.frontImageUrl);
      } else {
        setThumbnailUrl("/images/image-coming-soon.png");
      }
    } else {
      setThumbnailUrl("/images/image-coming-soon.png");
    }
  }, [mainSet.thumbnailImageUrl, firstSetCards]);

  return (
    <Link href={`/browse/main-set/${mainSet.id}`}>
      <Card className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-[1.02] bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="relative aspect-[3/4] overflow-hidden rounded-t-lg">
            <img
              src={thumbnailUrl || "/images/image-coming-soon.png"}
              alt={mainSet.name}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "/images/image-coming-soon.png";
              }}
            />
            
            {/* Overlay with set count */}
            <div className="absolute top-2 right-2">
              <Badge variant="secondary" className="bg-black/70 text-white border-none">
                <Layers className="w-3 h-3 mr-1" />
                {assignedSets.length} {assignedSets.length === 1 ? 'Set' : 'Sets'}
              </Badge>
            </div>
          </div>
          
          <div className="p-4">
            <h3 className="font-semibold text-lg text-gray-900 mb-2 line-clamp-2 group-hover:text-red-600 transition-colors">
              {mainSet.name}
            </h3>
            
            {mainSet.notes && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                {mainSet.notes}
              </p>
            )}
            
            <div className="flex items-center justify-between text-sm text-gray-500">
              <div className="flex items-center">
                <Calendar className="w-4 h-4 mr-1" />
                Created {new Date(mainSet.createdAt).getFullYear()}
              </div>
              
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