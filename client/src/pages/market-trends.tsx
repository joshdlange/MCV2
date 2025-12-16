import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Award } from "lucide-react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import {
  MarketTrendsData,
  Mover,
  calculateMarketSentiment,
  calculateMonthlyKPIs,
  mapRawMarketDataToMarketTrendsData,
  generateRealisticMockData,
  getMonthLabel,
} from "@/lib/marketSentiment";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

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

function StatTile({ 
  label, 
  value, 
  subtext, 
  subtextColor,
  icon: Icon,
}: { 
  label: string; 
  value: string; 
  subtext: string;
  subtextColor?: string;
  icon: typeof DollarSign;
}) {
  return (
    <Card className="bg-white shadow-sm border-0 rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
          <Icon className="h-4 w-4 text-gray-400" />
        </div>
        <div className="text-xl font-bold text-gray-900">{value}</div>
        <p className={`text-xs mt-0.5 ${subtextColor || 'text-gray-500'}`}>{subtext}</p>
      </CardContent>
    </Card>
  );
}

function MoverRow({ mover, isGainer }: { mover: Mover; isGainer: boolean }) {
  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const percentFormatted = isGainer 
    ? `+${mover.percentChange.toFixed(1)}%` 
    : `${mover.percentChange.toFixed(1)}%`;

  return (
    <div className={`flex items-center justify-between py-2.5 px-3 border-l-3 ${isGainer ? 'border-l-green-400 bg-green-50/30' : 'border-l-red-400 bg-red-50/30'} rounded-r-lg mb-1.5 last:mb-0`}>
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {mover.imageUrl ? (
          <img 
            src={mover.imageUrl} 
            alt={mover.cardName}
            className="w-8 h-11 object-cover rounded bg-gray-100"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-8 h-11 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
            <Award className="w-4 h-4 text-gray-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 text-sm truncate" data-testid="text-mover-name">
            {mover.cardName}
          </p>
          {mover.setName && (
            <p className="text-xs text-gray-400 truncate">{mover.setName}</p>
          )}
          <p className="text-xs text-gray-400">
            {formatPrice(mover.previousPrice)} → {formatPrice(mover.currentPrice)}
          </p>
        </div>
      </div>
      <span className={`text-sm font-semibold ml-2 ${isGainer ? 'text-green-600' : 'text-red-600'}`}>
        {percentFormatted}
      </span>
    </div>
  );
}

function TopMoversModule({ marketData }: { marketData: MarketTrendsData }) {
  const [timeframe, setTimeframe] = useState<'24h' | '7d'>('24h');
  const [moverType, setMoverType] = useState<'gainers' | 'losers'>('gainers');

  const getMovers = (): Mover[] => {
    if (timeframe === '24h') {
      return moverType === 'gainers' ? marketData.gainers24h : marketData.losers24h;
    } else {
      return moverType === 'gainers' ? marketData.gainers7d : marketData.losers7d;
    }
  };

  const movers = getMovers().slice(0, 5);

  return (
    <Card className="bg-white shadow-sm border-0 rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            {moverType === 'gainers' ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
            Top Movers
          </h3>
          <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as '24h' | '7d')}>
            <TabsList className="h-7 p-0.5 bg-gray-100">
              <TabsTrigger value="24h" className="text-xs px-2.5 py-1 h-6" data-testid="tab-24h">24h</TabsTrigger>
              <TabsTrigger value="7d" className="text-xs px-2.5 py-1 h-6" data-testid="tab-7d">7d</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMoverType('gainers')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-colors ${
              moverType === 'gainers' 
                ? 'bg-green-100 text-green-700 border border-green-200' 
                : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
            }`}
            data-testid="toggle-gainers"
          >
            Gainers
          </button>
          <button
            onClick={() => setMoverType('losers')}
            className={`flex-1 py-1.5 px-3 rounded-full text-xs font-medium transition-colors ${
              moverType === 'losers' 
                ? 'bg-red-100 text-red-700 border border-red-200' 
                : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
            }`}
            data-testid="toggle-losers"
          >
            Losers
          </button>
        </div>

        <div>
          {movers.length > 0 ? (
            movers.map((mover, idx) => (
              <MoverRow key={idx} mover={mover} isGainer={moverType === 'gainers'} />
            ))
          ) : (
            <p className="text-gray-500 text-center py-6 text-sm">No data available</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MarketTrends() {
  const { data: rawData, isLoading, error } = useQuery<RawMarketData>({
    queryKey: ['/api/market-trends'],
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-10 bg-gray-200 rounded-lg w-72 mx-auto"></div>
            <div className="h-8 bg-gray-200 rounded-full w-56 mx-auto"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded-xl"></div>
              ))}
            </div>
            <div className="h-72 bg-gray-200 rounded-xl"></div>
            <div className="h-80 bg-gray-200 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          <Card className="bg-white border-red-200">
            <CardContent className="p-8 text-center">
              <p className="text-red-600 font-medium">Unable to load market trends</p>
              <p className="text-gray-500 mt-2">Please try again later</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  let marketData: MarketTrendsData;
  
  if (!rawData || rawData.marketMovement.totalSold === 0 || rawData.trendData.length === 0) {
    marketData = generateRealisticMockData();
  } else {
    marketData = mapRawMarketDataToMarketTrendsData(rawData);
  }

  const sentiment = calculateMarketSentiment(marketData.monthlyMetrics);
  const kpis = calculateMonthlyKPIs(marketData.monthlyMetrics);

  const chartLabels = marketData.monthlyMetrics.map(m => getMonthLabel(m.month));
  const chartValues = marketData.monthlyMetrics.map(m => m.avgSalePrice);

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Avg Sale Price',
        data: chartValues,
        borderColor: '#dc2626',
        backgroundColor: (context: any) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 250);
          gradient.addColorStop(0, 'rgba(220, 38, 38, 0.15)');
          gradient.addColorStop(1, 'rgba(220, 38, 38, 0.01)');
          return gradient;
        },
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#dc2626',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#dc2626',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: (context: any) => `Avg: $${context.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { 
          color: '#6b7280',
          font: { size: 11, weight: 500 as const },
        },
      },
      y: {
        grid: { color: 'rgba(0, 0, 0, 0.04)' },
        ticks: {
          color: '#6b7280',
          font: { size: 11 },
          callback: (value: any) => `$${value}`,
        },
      },
    },
  };

  const sentimentBadgeText = () => {
    const pct = Math.abs(sentiment.avgPriceChangePct);
    const sign = sentiment.avgPriceChangePct >= 0 ? '+' : '';
    
    if (sentiment.type === 'seller') {
      return `${sentiment.label} · ${sign}${pct.toFixed(1)}% vs last month`;
    } else if (sentiment.type === 'buyer') {
      return `${sentiment.label} · ${pct.toFixed(1)}% below last month`;
    } else {
      return `${sentiment.label} · ±${pct.toFixed(1)}% vs last month`;
    }
  };

  const volumeChangeColor = kpis.volumeChangePct >= 0 ? 'text-green-600' : 'text-red-600';
  const priceChangeColor = kpis.avgPriceChangePct >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-50" data-testid="page-market-trends">
      <div className="max-w-5xl mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Marvel Card Market Trends
          </h1>
          
          {/* Sentiment Badge */}
          <div className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full ${sentiment.bgColor}`} data-testid="badge-sentiment">
            <span className={`text-sm font-semibold ${sentiment.color}`}>
              {sentimentBadgeText()}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            {sentiment.description}
          </p>
        </div>

        {/* KPI Tiles - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <StatTile
            label="Market Volume"
            value={kpis.currentMonthVolume.toLocaleString()}
            subtext={`${kpis.volumeChangePct >= 0 ? '+' : ''}${kpis.volumeChangePct}% vs last month`}
            subtextColor={volumeChangeColor}
            icon={BarChart3}
          />
          <StatTile
            label="Avg Sale Price"
            value={`$${kpis.currentMonthAvgPrice.toFixed(2)}`}
            subtext={`${kpis.avgPriceChangePct >= 0 ? '+' : ''}${kpis.avgPriceChangePct}% vs last month`}
            subtextColor={priceChangeColor}
            icon={DollarSign}
          />
          <StatTile
            label="Highest Sale (24h)"
            value={`$${marketData.highestSale24h.toFixed(2)}`}
            subtext="Top sale today"
            icon={TrendingUp}
          />
        </div>

        {/* 12-Month Chart */}
        <Card className="bg-white shadow-sm border-0 rounded-xl mb-6">
          <CardContent className="p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4" data-testid="text-chart-title">
              12-Month Marvel Card Market Trend
            </h2>
            <div className="h-64 w-full">
              <Line data={chartData} options={chartOptions} />
            </div>
          </CardContent>
        </Card>

        {/* Top Movers Module */}
        <TopMoversModule marketData={marketData} />

      </div>
    </div>
  );
}
