import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";

interface CardValueProps {
  cardId: number;
}

interface PricingData {
  avgPrice: number;
  salesCount: number;
  lastFetched: string;
}

export function CardValue({ cardId }: CardValueProps) {
  const { data: pricing, isLoading } = useQuery<PricingData>({
    queryKey: ["/api/card-pricing", cardId],
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: false
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <DollarSign className="w-3 h-3" />
        <span>...</span>
      </div>
    );
  }

  if (!pricing || !pricing.avgPrice || pricing.avgPrice <= 0) {
    return (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <DollarSign className="w-3 h-3" />
        <span>N/A</span>
      </div>
    );
  }

  return (
    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs font-semibold">
      <DollarSign className="w-3 h-3 mr-1" />
      ${pricing.avgPrice.toFixed(2)}
    </Badge>
  );
}