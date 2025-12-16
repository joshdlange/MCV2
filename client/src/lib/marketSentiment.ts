export type MonthlyMarketMetric = {
  year: number;
  month: number;
  totalSalesCount: number;
  totalSalesValue: number;
  avgSalePrice: number;
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
  monthlyMetrics: MonthlyMarketMetric[];
  gainers24h: Mover[];
  losers24h: Mover[];
  gainers7d: Mover[];
  losers7d: Mover[];
  highestSale24h: number;
  lowestSale24h: number;
};

export type SentimentType = 'seller' | 'neutral' | 'buyer';

export interface MarketSentiment {
  type: SentimentType;
  label: string;
  description: string;
  avgPriceChangePct: number;
  volumeChangePct: number;
  color: string;
  bgColor: string;
}

export interface MonthlyKPIs {
  currentMonthVolume: number;
  volumeChangePct: number;
  currentMonthAvgPrice: number;
  avgPriceChangePct: number;
}

export function calculateMonthlyKPIs(metrics: MonthlyMarketMetric[]): MonthlyKPIs {
  if (metrics.length < 1) {
    return {
      currentMonthVolume: 0,
      volumeChangePct: 0,
      currentMonthAvgPrice: 0,
      avgPriceChangePct: 0,
    };
  }

  const current = metrics[metrics.length - 1];
  const previous = metrics.length >= 2 ? metrics[metrics.length - 2] : null;

  const volumeChangePct = previous && previous.totalSalesCount > 0
    ? ((current.totalSalesCount - previous.totalSalesCount) / previous.totalSalesCount) * 100
    : 0;

  const avgPriceChangePct = previous && previous.avgSalePrice > 0
    ? ((current.avgSalePrice - previous.avgSalePrice) / previous.avgSalePrice) * 100
    : 0;

  return {
    currentMonthVolume: current.totalSalesCount,
    volumeChangePct: parseFloat(volumeChangePct.toFixed(1)),
    currentMonthAvgPrice: current.avgSalePrice,
    avgPriceChangePct: parseFloat(avgPriceChangePct.toFixed(1)),
  };
}

export function calculateMarketSentiment(metrics: MonthlyMarketMetric[]): MarketSentiment {
  const kpis = calculateMonthlyKPIs(metrics);

  if (metrics.length < 2) {
    return {
      type: 'neutral',
      label: 'Neutral Market',
      description: 'Not enough data to determine market sentiment.',
      avgPriceChangePct: 0,
      volumeChangePct: 0,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
    };
  }

  const pctChange = kpis.avgPriceChangePct;

  if (pctChange > 10) {
    return {
      type: 'seller',
      label: "Seller's Market",
      description: "Prices are up—stronger conditions for sellers looking to capitalize on increased values.",
      avgPriceChangePct: pctChange,
      volumeChangePct: kpis.volumeChangePct,
      color: 'text-green-700',
      bgColor: 'bg-green-100',
    };
  } else if (pctChange < -5) {
    return {
      type: 'buyer',
      label: "Buyer's Market",
      description: "Prices are down—better entry points for buyers looking to expand their collection.",
      avgPriceChangePct: pctChange,
      volumeChangePct: kpis.volumeChangePct,
      color: 'text-blue-700',
      bgColor: 'bg-blue-100',
    };
  } else {
    return {
      type: 'neutral',
      label: 'Neutral Market',
      description: "Prices are relatively stable—balanced conditions for both buyers and sellers.",
      avgPriceChangePct: pctChange,
      volumeChangePct: kpis.volumeChangePct,
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

function aggregateDailyToMonthly(trendData: { date: string; averagePrice: number }[]): MonthlyMarketMetric[] {
  if (!trendData || trendData.length === 0) {
    return [];
  }

  const monthlyMap = new Map<string, { prices: number[]; count: number }>();

  for (const day of trendData) {
    const date = new Date(day.date);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { prices: [], count: 0 });
    }
    
    const entry = monthlyMap.get(key)!;
    entry.prices.push(day.averagePrice);
    entry.count += 1;
  }

  const metrics: MonthlyMarketMetric[] = [];
  
  Array.from(monthlyMap.entries()).forEach(([key, data]) => {
    const [year, month] = key.split('-').map(Number);
    const avgSalePrice = data.prices.reduce((a: number, b: number) => a + b, 0) / data.prices.length;
    const estimatedVolume = data.count * 5;
    
    metrics.push({
      year,
      month,
      totalSalesCount: estimatedVolume,
      totalSalesValue: parseFloat((estimatedVolume * avgSalePrice).toFixed(2)),
      avgSalePrice: parseFloat(avgSalePrice.toFixed(2)),
    });
  });

  return metrics.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

export function mapRawMarketDataToMarketTrendsData(raw: RawMarketData): MarketTrendsData {
  let monthlyMetrics = aggregateDailyToMonthly(raw.trendData);
  
  if (monthlyMetrics.length < 2) {
    monthlyMetrics = generateMonthlyMockData();
  }
  
  if (raw.marketMovement.totalSold > 0 && monthlyMetrics.length > 0) {
    const lastMonth = monthlyMetrics[monthlyMetrics.length - 1];
    lastMonth.totalSalesCount = raw.marketMovement.totalSold;
    lastMonth.avgSalePrice = raw.marketMovement.averagePrice;
    lastMonth.totalSalesValue = lastMonth.totalSalesCount * lastMonth.avgSalePrice;
  }

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
    monthlyMetrics,
    gainers24h,
    losers24h,
    gainers7d: gainers24h,
    losers7d: losers24h,
    highestSale24h: raw.marketMovement.highestSale,
    lowestSale24h: raw.marketMovement.lowestSale,
  };
}

export function generateMonthlyMockData(): MonthlyMarketMetric[] {
  const metrics: MonthlyMarketMetric[] = [];
  const today = new Date();
  
  let basePrice = 52;
  let baseVolume = 180;
  
  for (let i = 11; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    
    const priceFluctuation = (Math.random() - 0.4) * 6;
    basePrice = Math.max(35, Math.min(85, basePrice + priceFluctuation));
    
    const volumeFluctuation = (Math.random() - 0.5) * 40;
    baseVolume = Math.max(100, Math.min(350, baseVolume + volumeFluctuation));
    
    const totalSalesCount = Math.round(baseVolume);
    const avgSalePrice = parseFloat(basePrice.toFixed(2));
    const totalSalesValue = parseFloat((totalSalesCount * avgSalePrice).toFixed(2));
    
    metrics.push({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      totalSalesCount,
      totalSalesValue,
      avgSalePrice,
    });
  }
  
  return metrics;
}

export function generateRealisticMockData(): MarketTrendsData {
  const monthlyMetrics = generateMonthlyMockData();

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

  const gainers7d: Mover[] = [
    { cardName: "Deadpool #12", setName: "1991 Marvel Universe", currentPrice: 88.00, previousPrice: 72.00, percentChange: 22.22, imageUrl: "" },
    { cardName: "X-Men Team Card", setName: "1992 Marvel Masterpieces", currentPrice: 156.00, previousPrice: 132.00, percentChange: 18.18, imageUrl: "" },
    { cardName: "Magneto Hologram", setName: "1993 Marvel Universe", currentPrice: 95.00, previousPrice: 82.00, percentChange: 15.85, imageUrl: "" },
    { cardName: "Ghost Rider #77", setName: "1990 Marvel Universe", currentPrice: 54.00, previousPrice: 47.00, percentChange: 14.89, imageUrl: "" },
    { cardName: "Punisher #41", setName: "1991 Marvel Universe", currentPrice: 42.00, previousPrice: 37.00, percentChange: 13.51, imageUrl: "" },
  ];

  const losers7d: Mover[] = [
    { cardName: "Daredevil Common", setName: "1994 Marvel Flair", currentPrice: 6.00, previousPrice: 9.50, percentChange: -36.84, imageUrl: "" },
    { cardName: "Hawkeye #28", setName: "1991 Marvel Universe", currentPrice: 4.25, previousPrice: 6.00, percentChange: -29.17, imageUrl: "" },
    { cardName: "Black Widow Base", setName: "1992 Marvel Universe", currentPrice: 7.00, previousPrice: 9.50, percentChange: -26.32, imageUrl: "" },
    { cardName: "Falcon #55", setName: "1990 Marvel Universe", currentPrice: 5.50, previousPrice: 7.00, percentChange: -21.43, imageUrl: "" },
    { cardName: "Vision #63", setName: "1993 Marvel Universe", currentPrice: 8.25, previousPrice: 10.00, percentChange: -17.50, imageUrl: "" },
  ];

  return {
    monthlyMetrics,
    gainers24h,
    losers24h,
    gainers7d,
    losers7d,
    highestSale24h: 192.02,
    lowestSale24h: 11.51,
  };
}

export function getMonthLabel(month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] || '';
}
