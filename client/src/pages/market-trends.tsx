import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, ExternalLink, ShoppingCart, AlertCircle } from "lucide-react";
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
  RecentSale,
  TimeRange,
  calculateMarketSentiment,
  calculateDailyKPIs,
  mapRawMarketDataToMarketTrendsData,
  filterTrendDataByRange,
  formatChartLabels,
  hasEnoughData,
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
  trendData: { date: string; averagePrice: number; totalSold: number }[];
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
  recentSales: Array<{
    title: string;
    price: number;
    imageUrl?: string;
    itemWebUrl?: string;
    category?: string;
    soldDate: string;
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

  const handleClick = () => {
    if (mover.itemUrl) {
      window.open(mover.itemUrl, '_blank');
    }
  };

  return (
    <div 
      onClick={handleClick}
      className={`flex items-center justify-between py-2.5 px-3 border-l-3 ${isGainer ? 'border-l-green-400 bg-green-50/30' : 'border-l-red-400 bg-red-50/30'} rounded-r-lg mb-1.5 last:mb-0 ${mover.itemUrl ? 'cursor-pointer hover:bg-gray-50' : ''}`}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {mover.imageUrl ? (
          <img 
            src={mover.imageUrl} 
            alt={mover.cardName}
            className="w-10 h-14 object-cover rounded bg-gray-100"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-10 h-14 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
            <ShoppingCart className="w-4 h-4 text-gray-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 text-sm truncate" data-testid="text-mover-name">
            {mover.cardName}
          </p>
          <p className="text-xs text-gray-400">
            {formatPrice(mover.previousPrice)} → {formatPrice(mover.currentPrice)}
          </p>
          {mover.itemUrl && (
            <p className="text-xs text-blue-500 flex items-center gap-1">
              View on eBay <ExternalLink className="w-3 h-3" />
            </p>
          )}
        </div>
      </div>
      <span className={`text-sm font-semibold ml-2 ${isGainer ? 'text-green-600' : 'text-red-600'}`}>
        {percentFormatted}
      </span>
    </div>
  );
}

function RecentSaleCard({ sale }: { sale: RecentSale }) {
  const handleClick = () => {
    if (sale.itemWebUrl) {
      window.open(sale.itemWebUrl, '_blank');
    }
  };

  return (
    <div 
      onClick={handleClick}
      className={`flex items-center gap-3 p-3 bg-gray-50 rounded-lg ${sale.itemWebUrl ? 'cursor-pointer hover:bg-gray-100' : ''}`}
    >
      {sale.imageUrl ? (
        <img 
          src={sale.imageUrl} 
          alt={sale.title}
          className="w-12 h-16 object-cover rounded bg-gray-200"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-12 h-16 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
          <ShoppingCart className="w-5 h-5 text-gray-400" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm truncate">{sale.title}</p>
        <p className="text-lg font-bold text-green-600">${sale.price.toFixed(2)}</p>
        <p className="text-xs text-gray-400">
          Sold {new Date(sale.soldDate).toLocaleDateString()}
        </p>
      </div>
      {sale.itemWebUrl && (
        <ExternalLink className="w-4 h-4 text-gray-400" />
      )}
    </div>
  );
}

function TopMoversModule({ marketData }: { marketData: MarketTrendsData }) {
  const [moverType, setMoverType] = useState<'gainers' | 'losers'>('gainers');

  const movers = moverType === 'gainers' ? marketData.gainers : marketData.losers;
  const displayMovers = movers.slice(0, 5);
  const hasMovers = displayMovers.length > 0;

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
            Price Movers
          </h3>
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
          {hasMovers ? (
            displayMovers.map((mover, idx) => (
              <MoverRow key={idx} mover={mover} isGainer={moverType === 'gainers'} />
            ))
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No price movement data yet</p>
              <p className="text-gray-400 text-xs mt-1">Data will appear as we track more sales</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentSalesModule({ marketData }: { marketData: MarketTrendsData }) {
  const sales = marketData.recentSales.slice(0, 6);
  const hasSales = sales.length > 0;

  return (
    <Card className="bg-white shadow-sm border-0 rounded-xl">
      <CardContent className="p-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <ShoppingCart className="h-4 w-4 text-gray-600" />
          Recent Notable Sales
        </h3>

        {hasSales ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sales.map((sale, idx) => (
              <RecentSaleCard key={idx} sale={sale} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No recent sales data yet</p>
            <p className="text-gray-400 text-xs mt-1">Sales data will appear as we collect more market info</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotEnoughDataCard() {
  return (
    <Card className="bg-amber-50 border-amber-200">
      <CardContent className="p-6 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-900 mb-2">Building Your Market Data</h3>
        <p className="text-gray-600 text-sm max-w-md mx-auto">
          We're collecting real eBay sales data daily. As more data accumulates, you'll see detailed 
          price trends, market sentiment, and top movers. Check back soon!
        </p>
        <p className="text-gray-400 text-xs mt-4">
          Currently collecting data since July 2025
        </p>
      </CardContent>
    </Card>
  );
}

export default function MarketTrends() {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
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

  const marketData: MarketTrendsData = rawData 
    ? mapRawMarketDataToMarketTrendsData(rawData)
    : {
        trendData: [],
        gainers: [],
        losers: [],
        recentSales: [],
        highestSale: 0,
        lowestSale: 0,
        currentAvgPrice: 0,
        percentChange: 0,
        totalSold: 0,
      };

  const filteredTrendData = filterTrendDataByRange(marketData.trendData, timeRange);
  const hasData = hasEnoughData(filteredTrendData);
  const sentiment = calculateMarketSentiment(filteredTrendData, timeRange);
  const kpis = calculateDailyKPIs(filteredTrendData, timeRange);

  const chartLabels = formatChartLabels(filteredTrendData);
  const chartPrices = filteredTrendData.map(d => d.averagePrice);

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Avg Sale Price',
        data: chartPrices,
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
        pointRadius: 3,
        pointHoverRadius: 5,
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
          font: { size: 10 },
          maxTicksLimit: 10,
        },
      },
      y: {
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        ticks: {
          color: '#6b7280',
          font: { size: 11 },
          callback: (value: any) => `$${Number(value).toFixed(2)}`,
        },
      },
    },
  };

  const timeRangeLabel = timeRange === '30d' ? 'Last 30 Days' : timeRange === '60d' ? 'Last 60 Days' : 'Last 90 Days';

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-50 pb-20">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2" data-testid="page-title">
            Market Trends
          </h1>
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${sentiment.bgColor}`}>
            {sentiment.type === 'seller' && <TrendingUp className={`h-4 w-4 ${sentiment.color}`} />}
            {sentiment.type === 'buyer' && <TrendingDown className={`h-4 w-4 ${sentiment.color}`} />}
            <span className={`font-semibold text-sm ${sentiment.color}`}>{sentiment.label}</span>
          </div>
          <p className="text-gray-500 text-sm mt-2 max-w-lg mx-auto">
            {sentiment.description}
          </p>
        </div>

        <div className="flex justify-center mb-4">
          <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <TabsList className="bg-white shadow-sm">
              <TabsTrigger value="30d" className="px-4" data-testid="range-30d">30 Days</TabsTrigger>
              <TabsTrigger value="60d" className="px-4" data-testid="range-60d">60 Days</TabsTrigger>
              <TabsTrigger value="90d" className="px-4" data-testid="range-90d">90 Days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {!hasData ? (
          <NotEnoughDataCard />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile 
                label="Avg Price" 
                value={`$${kpis.avgPrice.toFixed(2)}`}
                subtext={`${kpis.priceChangePct >= 0 ? '+' : ''}${kpis.priceChangePct}% vs prior period`}
                subtextColor={kpis.priceChangePct > 0 ? 'text-green-600' : kpis.priceChangePct < 0 ? 'text-red-600' : 'text-gray-500'}
                icon={DollarSign}
              />
              <StatTile 
                label="Total Volume" 
                value={kpis.totalVolume.toLocaleString()}
                subtext={`${kpis.volumeChangePct >= 0 ? '+' : ''}${kpis.volumeChangePct}% vs prior period`}
                subtextColor={kpis.volumeChangePct > 0 ? 'text-green-600' : kpis.volumeChangePct < 0 ? 'text-red-600' : 'text-gray-500'}
                icon={BarChart3}
              />
              <StatTile 
                label="Highest Sale" 
                value={`$${marketData.highestSale.toFixed(2)}`}
                subtext={timeRangeLabel}
                icon={TrendingUp}
              />
              <StatTile 
                label="Lowest Sale" 
                value={`$${marketData.lowestSale.toFixed(2)}`}
                subtext={timeRangeLabel}
                icon={TrendingDown}
              />
            </div>

            <Card className="bg-white shadow-sm border-0 rounded-xl">
              <CardContent className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">Price Trend - {timeRangeLabel}</h3>
                <div className="h-64">
                  <Line data={chartData} options={chartOptions} />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopMoversModule marketData={marketData} />
          <RecentSalesModule marketData={marketData} />
        </div>

        <Card className="bg-gray-50 border-0">
          <CardContent className="p-4 text-center">
            <p className="text-xs text-gray-400">
              Data sourced from eBay completed listings. Updated daily at 6:00 AM EST.
              <br />
              {filteredTrendData.length} days of data available. Historical data accumulates over time.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
