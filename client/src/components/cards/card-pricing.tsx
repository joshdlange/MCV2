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

  const formatPrice = (price: number, salesCount: number) => {
    // Check for rate limit or error state
    if (price === -1) {
      return "Unavailable";
    }
    
    if (price === 0 && salesCount === 0) {
      return "$0.00";
    }
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getPriceColor = (price: number, salesCount: number) => {
    // Rate limit or error state indicator
    if (price === -1) {
      return "text-red-500 font-medium";
    }
    
    if (price >= 50) return "text-green-600 font-semibold";
    if (price >= 20) return "text-blue-600 font-medium";
    if (price >= 5) return "text-gray-700";
    return "text-gray-500";
  };

  return (
    <div className={`flex items-center space-x-1 text-sm ${className}`}>
      <DollarSign className="w-3 h-3 text-green-600" />
      <span className={getPriceColor(pricing.avgPrice, pricing.salesCount)}>
        {formatPrice(pricing.avgPrice, pricing.salesCount)}
      </span>
      {pricing.salesCount > 0 && pricing.salesCount !== -1 && (
        <span className="text-xs text-gray-500">
          ({pricing.salesCount} sales)
        </span>
      )}
    </div>
  );
}