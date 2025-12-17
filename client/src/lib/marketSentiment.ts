export type DailyTrendPoint = {
  date: string;
  averagePrice: number;
  totalSold: number;
};

export type Mover = {
  cardName: string;
  setName: string;
  currentPrice: number;
  previousPrice: number;
  percentChange: number;
  imageUrl?: string;
  itemUrl?: string;
};

export type RecentSale = {
  title: string;
  price: number;
  imageUrl?: string;
  itemWebUrl?: string;
  category?: string;
  soldDate: string;
};

export type MarketTrendsData = {
  trendData: DailyTrendPoint[];
  gainers: Mover[];
  losers: Mover[];
  recentSales: RecentSale[];
  highestSale: number;
  lowestSale: number;
  currentAvgPrice: number;
  percentChange: number;
  totalSold: number;
};

export type SentimentType = 'seller' | 'neutral' | 'buyer';

export interface MarketSentiment {
  type: SentimentType;
  label: string;
  description: string;
  avgPriceChangePct: number;
  color: string;
  bgColor: string;
}

export type TimeRange = '30d' | '60d' | '90d';

export interface DailyKPIs {
  avgPrice: number;
  priceChangePct: number;
  totalVolume: number;
  volumeChangePct: number;
  highestSale: number;
  lowestSale: number;
}

export function filterTrendDataByRange(trendData: DailyTrendPoint[], range: TimeRange): DailyTrendPoint[] {
  const days = range === '30d' ? 30 : range === '60d' ? 60 : 90;
  return trendData.slice(-days);
}

export function calculateDailyKPIs(trendData: DailyTrendPoint[], range: TimeRange): DailyKPIs {
  const filteredData = filterTrendDataByRange(trendData, range);
  
  if (filteredData.length < 2) {
    return {
      avgPrice: filteredData[0]?.averagePrice || 0,
      priceChangePct: 0,
      totalVolume: filteredData.reduce((sum, d) => sum + d.totalSold, 0),
      volumeChangePct: 0,
      highestSale: 0,
      lowestSale: 0,
    };
  }

  const currentPeriod = filteredData.slice(-Math.floor(filteredData.length / 2));
  const previousPeriod = filteredData.slice(0, Math.floor(filteredData.length / 2));

  const currentAvgPrice = currentPeriod.reduce((sum, d) => sum + d.averagePrice, 0) / currentPeriod.length;
  const previousAvgPrice = previousPeriod.reduce((sum, d) => sum + d.averagePrice, 0) / previousPeriod.length;
  
  const currentVolume = currentPeriod.reduce((sum, d) => sum + d.totalSold, 0);
  const previousVolume = previousPeriod.reduce((sum, d) => sum + d.totalSold, 0);

  const priceChangePct = previousAvgPrice > 0 
    ? ((currentAvgPrice - previousAvgPrice) / previousAvgPrice) * 100 
    : 0;
  
  const volumeChangePct = previousVolume > 0 
    ? ((currentVolume - previousVolume) / previousVolume) * 100 
    : 0;

  const allPrices = filteredData.map(d => d.averagePrice);
  
  return {
    avgPrice: parseFloat(currentAvgPrice.toFixed(2)),
    priceChangePct: parseFloat(priceChangePct.toFixed(1)),
    totalVolume: currentVolume + previousVolume,
    volumeChangePct: parseFloat(volumeChangePct.toFixed(1)),
    highestSale: Math.max(...allPrices),
    lowestSale: Math.min(...allPrices),
  };
}

export function calculateMarketSentiment(trendData: DailyTrendPoint[], range: TimeRange): MarketSentiment {
  const kpis = calculateDailyKPIs(trendData, range);

  if (trendData.length < 7) {
    return {
      type: 'neutral',
      label: 'Not Enough Data',
      description: 'We need more historical data to determine market sentiment. Check back as data accumulates.',
      avgPriceChangePct: 0,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
    };
  }

  const pctChange = kpis.priceChangePct;

  if (pctChange > 10) {
    return {
      type: 'seller',
      label: "Seller's Market",
      description: "Prices are trending up—good conditions for sellers looking to capitalize on increased values.",
      avgPriceChangePct: pctChange,
      color: 'text-green-700',
      bgColor: 'bg-green-100',
    };
  } else if (pctChange < -5) {
    return {
      type: 'buyer',
      label: "Buyer's Market",
      description: "Prices are trending down—better entry points for buyers looking to expand their collection.",
      avgPriceChangePct: pctChange,
      color: 'text-blue-700',
      bgColor: 'bg-blue-100',
    };
  } else {
    return {
      type: 'neutral',
      label: 'Stable Market',
      description: "Prices are relatively stable—balanced conditions for both buyers and sellers.",
      avgPriceChangePct: pctChange,
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
  trendData: { date: string; averagePrice: number; totalSold: number }[];
  topGainers: Array<{
    name: string;
    priceChange: number;
    previousPrice?: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>;
  topLosers: Array<{
    name: string;
    priceChange: number;
    previousPrice?: number;
    currentPrice: number;
    imageUrl?: string;
    itemUrl: string;
  }>;
  recentSales: Array<{
    title: string;
    price: number;
    imageUrl?: string;
    itemWebUrl?: string;
    category?: string;
    soldDate: string;
  }>;
}

export function mapRawMarketDataToMarketTrendsData(raw: RawMarketData): MarketTrendsData {
  const gainers: Mover[] = raw.topGainers.map(g => {
    const previousPrice = g.previousPrice ?? g.currentPrice / (1 + g.priceChange / 100);
    return {
      cardName: g.name,
      setName: '',
      currentPrice: g.currentPrice,
      previousPrice: previousPrice,
      percentChange: g.priceChange,
      imageUrl: g.imageUrl,
      itemUrl: g.itemUrl,
    };
  });

  const losers: Mover[] = raw.topLosers.map(l => {
    const previousPrice = l.previousPrice ?? l.currentPrice / (1 + l.priceChange / 100);
    return {
      cardName: l.name,
      setName: '',
      currentPrice: l.currentPrice,
      previousPrice: previousPrice,
      percentChange: l.priceChange,
      imageUrl: l.imageUrl,
      itemUrl: l.itemUrl,
    };
  });

  const recentSales: RecentSale[] = (raw.recentSales || []).map(s => ({
    title: s.title,
    price: s.price,
    imageUrl: s.imageUrl,
    itemWebUrl: s.itemWebUrl,
    category: s.category,
    soldDate: s.soldDate,
  }));

  return {
    trendData: raw.trendData || [],
    gainers,
    losers,
    recentSales,
    highestSale: raw.marketMovement.highestSale,
    lowestSale: raw.marketMovement.lowestSale,
    currentAvgPrice: raw.marketMovement.averagePrice,
    percentChange: raw.marketMovement.percentChange,
    totalSold: raw.marketMovement.totalSold,
  };
}

export function formatChartLabels(trendData: DailyTrendPoint[]): string[] {
  return trendData.map(d => {
    const date = new Date(d.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });
}

export function hasEnoughData(trendData: DailyTrendPoint[]): boolean {
  return trendData.length >= 7;
}
