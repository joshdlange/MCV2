import { useCardPricing } from "@/hooks/useCardPricing";
import { Button } from "@/components/ui/button";
import { RefreshCw, DollarSign } from "lucide-react";
import { useState } from "react";

interface CardPricingProps {
  cardId: number;
  className?: string;
}

export function CardPricing({ cardId, className = "" }: CardPricingProps) {
  const { data: pricing, isLoading, error, refetch } = useCardPricing(cardId);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch(`/api/card-pricing/${cardId}/refresh`, { method: 'POST' });
      await refetch();
    } catch (error) {
      console.error('Failed to refresh pricing:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 text-sm text-gray-500 ${className}`}>
        <DollarSign className="w-4 h-4 animate-pulse" />
        <span>Loading price...</span>
      </div>
    );
  }

  if (error || !pricing) {
    return (
      <div className={`flex items-center space-x-2 text-sm ${className}`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-6 px-2 text-xs text-blue-600 hover:text-blue-800"
        >
          {isRefreshing ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <DollarSign className="w-3 h-3" />
          )}
          Get Price
        </Button>
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
    <div className={`flex items-center space-x-2 text-sm ${className}`}>
      <DollarSign className="w-4 h-4 text-green-600" />
      <span className={getPriceColor(pricing.avgPrice)}>
        {formatPrice(pricing.avgPrice)}
      </span>
      {pricing.salesCount > 0 && (
        <span className="text-xs text-gray-500">
          ({pricing.salesCount} sales)
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="h-4 w-4 p-0 opacity-50 hover:opacity-100"
      >
        <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
}