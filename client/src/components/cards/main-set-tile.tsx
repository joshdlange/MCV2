import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";
import { Link } from "wouter";
import type { MainSet, CardSet } from "@shared/schema";
import { formatSetName } from "@/lib/formatTitle";

interface MainSetTileProps {
  mainSet: MainSet;
  assignedSets: CardSet[];
}

const isPlaceholderImage = (url: string | null | undefined): boolean => {
  if (!url) return true;
  if (url.includes('1ZcGcRer-EEmpbUgDivHKVqU4Ck_G5TiF')) return true;
  if (url.includes('superhero-fallback')) return true;
  if (url.includes('card-placeholder_ysozlo')) return true;
  if (url.includes('image-coming-soon')) return true;
  return false;
};

const needsProxy = (url: string): boolean => {
  const proxyDomains = [
    'i.ebayimg.com',
    'ebayimg.com',
    'i5.walmartimages.com',
    'walmartimages.com',
    'cdn.shopify.com',
    'm.media-amazon.com',
    'media-amazon.com',
    'assets.dacw.co',
    'dacardworld1.imgix.net',
    'collectorsavenue.com',
    'tradercracks.com',
    'thetoytemple.com'
  ];
  return proxyDomains.some(domain => url.includes(domain));
};

const getProxiedUrl = (url: string): string => {
  if (needsProxy(url)) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  }
  return url;
};

export function MainSetTile({ mainSet, assignedSets }: MainSetTileProps) {
  const [totalCards, setTotalCards] = useState<number>(0);

  // Calculate total cards when assignedSets changes
  useEffect(() => {
    const total = assignedSets.reduce((sum, set) => {
      const cardCount = Number(set.totalCards) || 0;
      return sum + cardCount;
    }, 0);
    setTotalCards(total);
  }, [assignedSets]);

  // Determine thumbnail - use main set thumbnail if available, otherwise use placeholder
  const hasThumbnail = mainSet.thumbnailImageUrl && !isPlaceholderImage(mainSet.thumbnailImageUrl);
  const thumbnailUrl = hasThumbnail 
    ? getProxiedUrl(mainSet.thumbnailImageUrl!) 
    : "/uploads/marvel-card-vault-logo.png";
  const isUsingPlaceholder = !hasThumbnail;

  return (
    <Link href={`/browse/${mainSet.slug}`}>
      <Card className="group cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all bg-white border border-gray-200">
        <CardContent className="p-0">
          <div className="relative aspect-[3/4] sm:aspect-[2.5/3.5] overflow-hidden rounded-t-lg">
            <img
              src={thumbnailUrl}
              alt={mainSet.name}
              className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-105 ${isUsingPlaceholder ? 'grayscale opacity-60' : ''}`}
              loading="lazy"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "/uploads/marvel-card-vault-logo.png";
                target.classList.add('grayscale', 'opacity-60');
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
              {formatSetName(mainSet.name)}
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
