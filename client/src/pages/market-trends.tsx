import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, ShoppingCart } from "lucide-react";
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
} from "chart.js";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface MarketTrendsData {
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

export default function MarketTrends() {
  const { data, isLoading, error } = useQuery<MarketTrendsData>({
    queryKey: ['/api/market-trends'],
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded mb-8"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Market Trends Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 dark:text-gray-300">
              Unable to fetch market trends data. Please try again later.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.marketMovement.totalSold === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8 text-center bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
          Marvel Card Market Trends
        </h1>
        <Card className="border-yellow-200 dark:border-yellow-800">
          <CardHeader>
            <CardTitle className="text-yellow-600 dark:text-yellow-400">No Market Data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 dark:text-gray-300">
              No Marvel card sales data is currently available. Market trends will appear here once data is collected.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { marketMovement, trendData } = data;

  // Chart configuration
  const chartData = {
    labels: trendData.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Average Price',
        data: trendData.map(d => d.averagePrice),
        borderColor: '#dc2626', // Marvel red
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#dc2626',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: '7-Day Price Trend',
        font: {
          size: 18,
          weight: 'bold' as const,
        },
        color: '#1f2937',
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: '#dc2626',
        borderWidth: 1,
        displayColors: false,
        callbacks: {
          label: (context: any) => `$${context.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#6b7280',
        },
      },
      y: {
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          color: '#6b7280',
          callback: (value: any) => `$${value}`,
        },
      },
    },
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
          Marvel Card Market Trends
        </h1>
        <p className="text-gray-600 dark:text-gray-300 text-lg">
          Real-time insights from eBay marketplace data
        </p>
      </div>

      {/* Market Summary Panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Average Price */}
        <Card className="border-2 border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-white dark:from-red-950 dark:to-gray-900">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300">
              Average Price
            </CardTitle>
            <DollarSign className="h-4 w-4 text-red-600 dark:text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-800 dark:text-red-200">
              ${marketMovement.averagePrice.toFixed(2)}
            </div>
            <div className="flex items-center mt-2">
              {marketMovement.percentChange >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={`text-sm font-medium ${
                marketMovement.percentChange >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {marketMovement.percentChange >= 0 ? '+' : ''}{marketMovement.percentChange.toFixed(1)}%
              </span>
              <span className="text-xs text-gray-500 ml-2">vs yesterday</span>
            </div>
          </CardContent>
        </Card>

        {/* Total Sold */}
        <Card className="border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950 dark:to-gray-900">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Cards Sold (24h)
            </CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">
              {marketMovement.totalSold.toLocaleString()}
            </div>
            <p className="text-xs text-gray-500 mt-2">Marvel trading cards</p>
          </CardContent>
        </Card>

        {/* Highest Sale */}
        <Card className="border-2 border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-white dark:from-green-950 dark:to-gray-900">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
              Highest Sale
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-800 dark:text-green-200">
              ${marketMovement.highestSale.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-2">Last 24 hours</p>
          </CardContent>
        </Card>

        {/* Lowest Sale */}
        <Card className="border-2 border-orange-200 dark:border-orange-800 bg-gradient-to-br from-orange-50 to-white dark:from-orange-950 dark:to-gray-900">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-300">
              Lowest Sale
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-800 dark:text-orange-200">
              ${marketMovement.lowestSale.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-2">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      {/* Price Trend Chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-xl text-gray-900 dark:text-white">
            7-Day Price Movement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-96 w-full">
            <Line data={chartData} options={chartOptions} />
          </div>
        </CardContent>
      </Card>

      {/* Top Gainers and Losers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Gainers */}
        <Card className="border-green-200 dark:border-green-800">
          <CardHeader>
            <CardTitle className="flex items-center text-green-700 dark:text-green-300">
              <TrendingUp className="h-5 w-5 mr-2" />
              Top Gainers (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topGainers.length > 0 ? (
              <div className="space-y-4">
                {data.topGainers.map((card, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                    <div className="flex items-center space-x-3">
                      {card.imageUrl && (
                        <img src={card.imageUrl} alt={card.name} className="w-12 h-16 object-cover rounded" />
                      )}
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{card.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">${card.currentPrice.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-green-600 dark:text-green-400 font-semibold">
                        +{card.priceChange.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No price gainers data available</p>
            )}
          </CardContent>
        </Card>

        {/* Top Losers */}
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="flex items-center text-red-700 dark:text-red-300">
              <TrendingDown className="h-5 w-5 mr-2" />
              Top Losers (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topLosers.length > 0 ? (
              <div className="space-y-4">
                {data.topLosers.map((card, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                    <div className="flex items-center space-x-3">
                      {card.imageUrl && (
                        <img src={card.imageUrl} alt={card.name} className="w-12 h-16 object-cover rounded" />
                      )}
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{card.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">${card.currentPrice.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-red-600 dark:text-red-400 font-semibold">
                        {card.priceChange.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No price losers data available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}