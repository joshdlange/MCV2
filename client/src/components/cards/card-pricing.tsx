import { useCardPricing } from "@/hooks/useCardPricing";
import { DollarSign } from "lucide-react";

interface CardPricingProps {
  cardId: number;
  className?: string;
}

export function CardPricing({ cardId, className = "" }: CardPricingProps) {
  const { data: pricing, isLoading } = useCardPricing(cardId);

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-1 text-sm text-gray-500 ${className}`}>
        <DollarSign className="w-3 h-3 animate-pulse" />
        <span className="text-xs">Loading...</span>
      </div>
    );
  }

  if (!pricing) {
    return (
      <div className={`flex items-center space-x-1 text-sm text-gray-400 ${className}`}>
        <DollarSign className="w-3 h-3" />
        <span className="text-xs">Pricing pending</span>
      </div>
    );
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getPriceColor = (price: number) => {
    if (price >= 50) return "text-green-600 font-semibold";
    if (price >= 20) return "text-blue-600 font-medium";
    if (price >= 5) return "text-gray-700";
    return "text-gray-500";
  };

  return (
    <div className={`flex items-center space-x-1 text-sm ${className}`}>
      <DollarSign className="w-3 h-3 text-green-600" />
      <span className={getPriceColor(pricing.avgPrice)}>
        {formatPrice(pricing.avgPrice)}
      </span>
      {pricing.salesCount > 0 && (
        <span className="text-xs text-gray-500">
          ({pricing.salesCount} sales)
        </span>
      )}
    </div>
  );
}