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
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(220, 38, 38, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: '#dc2626',
        borderWidth: 2,
        displayColors: false,
        padding: 12,
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
          font: {
            size: 12,
          },
        },
      },
      y: {
        grid: {
          color: 'rgba(220, 38, 38, 0.1)',
          lineWidth: 1,
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 12,
          },
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
        <Card className="border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Average Price
            </CardTitle>
            <DollarSign className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              ${marketMovement.averagePrice.toFixed(2)}
            </div>
            <div className="flex items-center mt-2">
              {marketMovement.percentChange >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={`text-sm font-medium ${
                marketMovement.percentChange >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {marketMovement.percentChange >= 0 ? '+' : ''}{marketMovement.percentChange.toFixed(1)}%
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">vs yesterday</span>
            </div>
          </CardContent>
        </Card>

        {/* Total Sold */}
        <Card className="border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Cards Sold (24h)
            </CardTitle>
            <ShoppingCart className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              {marketMovement.totalSold.toLocaleString()}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Marvel trading cards</p>
          </CardContent>
        </Card>

        {/* Highest Sale */}
        <Card className="border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Highest Sale
            </CardTitle>
            <TrendingUp className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              ${marketMovement.highestSale.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Last 24 hours</p>
          </CardContent>
        </Card>

        {/* Lowest Sale */}
        <Card className="border-red-200 dark:border-red-800 shadow-md hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Lowest Sale
            </CardTitle>
            <TrendingDown className="h-5 w-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              ${marketMovement.lowestSale.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card className="mb-8 border-red-200 dark:border-red-800 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-center text-red-600 dark:text-red-400">
            30-Day Marvel Card Price Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-96">
            {trendData.length > 1 ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 dark:text-gray-400">
                  Collecting trend data... Chart will appear after multiple days of data collection.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Gainers and Losers (Future Implementation) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-red-200 dark:border-red-800 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center">
              <TrendingUp className="mr-2" />
              Top Gainers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                Coming soon: Cards with the biggest price increases
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-800 shadow-md">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-red-600 dark:text-red-400 flex items-center">
              <TrendingDown className="mr-2" />
              Top Losers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                Coming soon: Cards with the biggest price decreases
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Source Info */}
      <div className="mt-8 text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Data sourced from eBay marketplace • Marvel Non-Sport Trading Card Singles • Updated daily
        </p>
      </div>
    </div>
  );
}