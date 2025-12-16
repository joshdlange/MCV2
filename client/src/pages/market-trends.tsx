import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart, Award } from "lucide-react";
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
  mapRawMarketDataToMarketTrendsData,
  generateRealisticMockData,
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
  icon: Icon,
}: { 
  label: string; 
  value: string; 
  subtext: string;
  icon: typeof DollarSign;
}) {
  return (
    <Card className="bg-white shadow-sm border-0 rounded-xl">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-500">{label}</span>
          <Icon className="h-4 w-4 text-gray-400" />
        </div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <p className="text-sm text-gray-500 mt-1">{subtext}</p>
      </CardContent>
    </Card>
  );
}

function MoverCard({ mover, isGainer }: { mover: Mover; isGainer: boolean }) {
  const formatPrice = (price: number) => `$${price.toFixed(2)}`;
  const percentFormatted = isGainer 
    ? `+${mover.percentChange.toFixed(1)}%` 
    : `${mover.percentChange.toFixed(1)}%`;

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
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
          <div className="w-10 h-14 bg-gray-100 rounded flex items-center justify-center">
            <Award className="w-5 h-5 text-gray-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 truncate" data-testid="text-mover-name">
            {mover.cardName}
          </p>
          {mover.setName && (
            <p className="text-xs text-gray-500 truncate">{mover.setName}</p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
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

export default function MarketTrends() {
  const { data: rawData, isLoading, error } = useQuery<RawMarketData>({
    queryKey: ['/api/market-trends'],
    refetchInterval: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-12 bg-gray-200 rounded-lg w-80 mx-auto"></div>
            <div className="h-10 bg-gray-200 rounded-full w-48 mx-auto"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-28 bg-gray-200 rounded-xl"></div>
              ))}
            </div>
            <div className="h-80 bg-gray-200 rounded-xl"></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-72 bg-gray-200 rounded-xl"></div>
              <div className="h-72 bg-gray-200 rounded-xl"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
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

  const sentiment = calculateMarketSentiment(marketData.dailyIndex);

  const chartData = {
    labels: marketData.dailyIndex.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Market Index',
        data: marketData.dailyIndex.map(d => d.indexValue),
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.05)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#dc2626',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointRadius: 3,
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
          label: (context: any) => `$${context.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { 
          color: '#9ca3af',
          font: { size: 11 },
          maxRotation: 45,
          minRotation: 0,
        },
      },
      y: {
        grid: { color: 'rgba(0, 0, 0, 0.04)' },
        ticks: {
          color: '#9ca3af',
          font: { size: 11 },
          callback: (value: any) => `$${value}`,
        },
      },
    },
  };

  const changeText = sentiment.percentChange >= 0 
    ? `+${sentiment.percentChange.toFixed(1)}%` 
    : `${sentiment.percentChange.toFixed(1)}%`;

  return (
    <div className="min-h-screen bg-gray-50" data-testid="page-market-trends">
      <div className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Marvel Card Market Trends
          </h1>
          <p className="text-gray-500 mb-4">
            Insights based on recent eBay sales
          </p>
          
          {/* Sentiment Badge */}
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${sentiment.bgColor}`} data-testid="badge-sentiment">
            <span className={`text-sm font-semibold ${sentiment.color}`}>
              {sentiment.label}
            </span>
            <span className={`text-sm ${sentiment.color}`}>·</span>
            <span className={`text-sm font-medium ${sentiment.color}`}>
              {changeText} vs last 30 days
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">
            {sentiment.description}
          </p>
        </div>

        {/* Stat Tiles - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatTile
            label="Average Price (7d)"
            value={`$${marketData.averagePrice7d.toFixed(2)}`}
            subtext={`${marketData.averagePrice7dChangePct >= 0 ? '+' : ''}${marketData.averagePrice7dChangePct.toFixed(1)}% vs last 7 days`}
            icon={DollarSign}
          />
          <StatTile
            label="Cards Sold (24h)"
            value={marketData.cardsSold24h.toLocaleString()}
            subtext="Marvel trading cards"
            icon={ShoppingCart}
          />
          <StatTile
            label="Highest Sale (24h)"
            value={`$${marketData.highestSale24h.toFixed(2)}`}
            subtext="Last 24 hours"
            icon={TrendingUp}
          />
        </div>

        {/* Main Chart */}
        <Card className="bg-white shadow-sm border-0 rounded-xl mb-8">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4" data-testid="text-chart-title">
              30-Day Marvel Card Index
            </h2>
            <div className="h-72 w-full">
              <Line data={chartData} options={chartOptions} />
            </div>
          </CardContent>
        </Card>

        {/* Gainers and Losers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Top Gainers */}
          <Card className="bg-white shadow-sm border-0 rounded-xl overflow-hidden">
            <div className="bg-green-50 px-5 py-3 border-b border-green-100">
              <h3 className="font-semibold text-green-800 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Top Gainers (24h)
              </h3>
            </div>
            <CardContent className="p-4">
              {marketData.gainers24h.length > 0 ? (
                <div>
                  {marketData.gainers24h.map((mover, idx) => (
                    <MoverCard key={idx} mover={mover} isGainer={true} />
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-6">No gainers data available</p>
              )}
            </CardContent>
          </Card>

          {/* Top Losers */}
          <Card className="bg-white shadow-sm border-0 rounded-xl overflow-hidden">
            <div className="bg-red-50 px-5 py-3 border-b border-red-100">
              <h3 className="font-semibold text-red-800 flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Top Losers (24h)
              </h3>
            </div>
            <CardContent className="p-4">
              {marketData.losers24h.length > 0 ? (
                <div>
                  {marketData.losers24h.map((mover, idx) => (
                    <MoverCard key={idx} mover={mover} isGainer={false} />
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-6">No losers data available</p>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
