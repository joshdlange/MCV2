export type DailyIndexPoint = {
  date: string;
  indexValue: number;
};

export type Mover = {
  cardName: string;
  setName: string;
  currentPrice: number;
  previousPrice: number;
  percentChange: number;
  imageUrl?: string;
};

export type MarketTrendsData = {
  dailyIndex: DailyIndexPoint[];
  gainers24h: Mover[];
  losers24h: Mover[];
  averagePrice7d: number;
  averagePrice7dChangePct: number;
  cardsSold24h: number;
  highestSale24h: number;
  lowestSale24h: number;
};

export type SentimentType = 'seller' | 'neutral' | 'buyer';

export interface MarketSentiment {
  type: SentimentType;
  label: string;
  description: string;
  percentChange: number;
  color: string;
  bgColor: string;
}

export function calculateMarketSentiment(dailyIndex: DailyIndexPoint[]): MarketSentiment {
  if (dailyIndex.length < 2) {
    return {
      type: 'neutral',
      label: 'Neutral Market',
      description: 'Not enough data to determine market sentiment.',
      percentChange: 0,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
    };
  }

  const currentIndex = dailyIndex[dailyIndex.length - 1].indexValue;
  const index30DaysAgo = dailyIndex[0].indexValue;
  
  const pctChange = ((currentIndex - index30DaysAgo) / index30DaysAgo) * 100;

  if (pctChange > 10) {
    return {
      type: 'seller',
      label: "Seller's Market",
      description: "Prices trending up vs last 30 days—stronger for sellers.",
      percentChange: pctChange,
      color: 'text-green-700',
      bgColor: 'bg-green-100',
    };
  } else if (pctChange < -5) {
    return {
      type: 'buyer',
      label: "Buyer's Market",
      description: "Prices are down vs last 30 days—better entry points for buyers.",
      percentChange: pctChange,
      color: 'text-blue-700',
      bgColor: 'bg-blue-100',
    };
  } else {
    return {
      type: 'neutral',
      label: 'Neutral Market',
      description: "Prices are relatively stable vs last 30 days.",
      percentChange: pctChange,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
    };
  }
}

interface RawMarketData {
  marketMovement: {
    averagePrice: number;
    percentChange: number;
    totalSold: number;
    highestSale: number;
    lowestSale: number;
  };
  trendData: { date: string; averagePrice: number }[];
  topGainers: Array<{
    name: string;
    priceChange: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>;
  topLosers: Array<{
    name: string;
    priceChange: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>;
}

export function mapRawMarketDataToMarketTrendsData(raw: RawMarketData): MarketTrendsData {
  const dailyIndex: DailyIndexPoint[] = raw.trendData.map(d => ({
    date: d.date,
    indexValue: d.averagePrice,
  }));

  const gainers24h: Mover[] = raw.topGainers.map(g => {
    const previousPrice = g.currentPrice / (1 + g.priceChange / 100);
    return {
      cardName: g.name,
      setName: '',
      currentPrice: g.currentPrice,
      previousPrice: previousPrice,
      percentChange: g.priceChange,
      imageUrl: g.imageUrl,
    };
  });

  const losers24h: Mover[] = raw.topLosers.map(l => {
    const previousPrice = l.currentPrice / (1 + l.priceChange / 100);
    return {
      cardName: l.name,
      setName: '',
      currentPrice: l.currentPrice,
      previousPrice: previousPrice,
      percentChange: l.priceChange,
      imageUrl: l.imageUrl,
    };
  });

  return {
    dailyIndex,
    gainers24h,
    losers24h,
    averagePrice7d: raw.marketMovement.averagePrice,
    averagePrice7dChangePct: raw.marketMovement.percentChange,
    cardsSold24h: raw.marketMovement.totalSold,
    highestSale24h: raw.marketMovement.highestSale,
    lowestSale24h: raw.marketMovement.lowestSale,
  };
}

export function generateRealisticMockData(): MarketTrendsData {
  const today = new Date();
  const dailyIndex: DailyIndexPoint[] = [];
  
  let basePrice = 55;
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    const fluctuation = (Math.random() - 0.5) * 8;
    basePrice = Math.max(40, Math.min(75, basePrice + fluctuation));
    
    dailyIndex.push({
      date: date.toISOString().split('T')[0],
      indexValue: parseFloat(basePrice.toFixed(2)),
    });
  }

  const avgPrice7d = dailyIndex.slice(-7).reduce((sum, d) => sum + d.indexValue, 0) / 7;
  const avgPrice7dPrev = dailyIndex.slice(-14, -7).reduce((sum, d) => sum + d.indexValue, 0) / 7;
  const avgPriceChange = ((avgPrice7d - avgPrice7dPrev) / avgPrice7dPrev) * 100;

  const gainers24h: Mover[] = [
    { cardName: "Spider-Man #1", setName: "1990 Marvel Universe", currentPrice: 145.00, previousPrice: 122.00, percentChange: 18.85, imageUrl: "" },
    { cardName: "Wolverine Hologram", setName: "1992 Marvel Masterpieces", currentPrice: 89.50, previousPrice: 78.00, percentChange: 14.74, imageUrl: "" },
    { cardName: "Venom #45", setName: "1991 Marvel Universe", currentPrice: 67.25, previousPrice: 59.00, percentChange: 13.98, imageUrl: "" },
    { cardName: "Iron Man Gold", setName: "1993 Marvel Masterpieces", currentPrice: 112.00, previousPrice: 99.50, percentChange: 12.56, imageUrl: "" },
    { cardName: "Thanos #89", setName: "1992 Marvel Universe", currentPrice: 78.50, previousPrice: 70.00, percentChange: 12.14, imageUrl: "" },
  ];

  const losers24h: Mover[] = [
    { cardName: "Captain America Base", setName: "1994 Marvel Flair", currentPrice: 12.50, previousPrice: 17.00, percentChange: -26.47, imageUrl: "" },
    { cardName: "Hulk #22", setName: "1990 Marvel Universe", currentPrice: 8.75, previousPrice: 11.50, percentChange: -23.91, imageUrl: "" },
    { cardName: "Storm Common", setName: "1991 Marvel Universe", currentPrice: 5.25, previousPrice: 6.75, percentChange: -22.22, imageUrl: "" },
    { cardName: "Cyclops #18", setName: "1992 Marvel Universe", currentPrice: 9.00, previousPrice: 11.00, percentChange: -18.18, imageUrl: "" },
    { cardName: "Beast #33", setName: "1993 Marvel Universe", currentPrice: 7.50, previousPrice: 9.00, percentChange: -16.67, imageUrl: "" },
  ];

  return {
    dailyIndex,
    gainers24h,
    losers24h,
    averagePrice7d: parseFloat(avgPrice7d.toFixed(2)),
    averagePrice7dChangePct: parseFloat(avgPriceChange.toFixed(1)),
    cardsSold24h: 122,
    highestSale24h: 192.02,
    lowestSale24h: 11.51,
  };
}
