import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, AlertCircle, Database, TrendingUp } from "lucide-react";

interface ApiStatus {
  browseApi: { hasAccess: boolean; message: string };
  marketplaceInsights: { hasAccess: boolean; message: string };
  recommendations: string[];
}

interface HistoricalData {
  dataSource: string;
  timeWindow: string;
  totalSales: number;
  averagePrice: number;
  priceRange: { min: number; max: number };
  dailySales: Array<{ date: string; price: number; quantity: number }>;
  topSellers: Array<{ title: string; price: number; soldDate: string; imageUrl?: string; itemUrl: string }>;
  note: string;
}

export default function ApiDemo() {
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [historicalLoading, setHistoricalLoading] = useState(false);

  const checkApiStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ebay-api-status');
      const data = await response.json();
      setApiStatus(data);
    } catch (error) {
      console.error('Failed to check API status:', error);
    } finally {
      setLoading(false);
    }
  };

  const getHistoricalData = async () => {
    setHistoricalLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/market-trends/historical', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      setHistoricalData(data);
    } catch (error) {
      console.error('Failed to get historical data:', error);
    } finally {
      setHistoricalLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
          eBay API Data Strategy Demo
        </h1>
        <p className="text-gray-600 dark:text-gray-300 text-lg">
          Demonstrating Marvel card market data capabilities and limitations
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* API Status Check */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="h-5 w-5 mr-2" />
              eBay API Access Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={checkApiStatus} 
              disabled={loading}
              className="mb-4"
            >
              {loading ? 'Checking...' : 'Check API Status'}
            </Button>

            {apiStatus && (
              <div className="space-y-4">
                {/* Browse API Status */}
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center">
                    {apiStatus.browseApi.hasAccess ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 mr-2" />
                    )}
                    <div>
                      <h4 className="font-medium">Browse API</h4>
                      <p className="text-sm text-gray-600">{apiStatus.browseApi.message}</p>
                    </div>
                  </div>
                  <Badge variant={apiStatus.browseApi.hasAccess ? "default" : "destructive"}>
                    {apiStatus.browseApi.hasAccess ? "Active" : "Error"}
                  </Badge>
                </div>

                {/* Marketplace Insights API Status */}
                <div className="flex items-center justify-between p-3 border rounded">
                  <div className="flex items-center">
                    {apiStatus.marketplaceInsights.hasAccess ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-500 mr-2" />
                    )}
                    <div>
                      <h4 className="font-medium">Marketplace Insights API</h4>
                      <p className="text-sm text-gray-600">{apiStatus.marketplaceInsights.message}</p>
                    </div>
                  </div>
                  <Badge variant={apiStatus.marketplaceInsights.hasAccess ? "default" : "secondary"}>
                    {apiStatus.marketplaceInsights.hasAccess ? "Approved" : "Pending"}
                  </Badge>
                </div>

                {/* Recommendations */}
                {apiStatus.recommendations.length > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Action Required:</strong>
                      <ul className="mt-2 space-y-1">
                        {apiStatus.recommendations.map((rec, index) => (
                          <li key={index}>• {rec}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Historical Data Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="h-5 w-5 mr-2" />
              Historical Sales Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={getHistoricalData} 
              disabled={historicalLoading}
              className="mb-4"
            >
              {historicalLoading ? 'Loading...' : 'Get Historical Data'}
            </Button>

            {historicalData && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
                    <h4 className="font-medium text-blue-700 dark:text-blue-300">Total Sales</h4>
                    <p className="text-2xl font-bold">{historicalData.totalSales.toLocaleString()}</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded">
                    <h4 className="font-medium text-green-700 dark:text-green-300">Avg Price</h4>
                    <p className="text-2xl font-bold">${historicalData.averagePrice.toFixed(2)}</p>
                  </div>
                </div>

                <div className="text-center p-3 bg-gray-50 dark:bg-gray-950 rounded">
                  <h4 className="font-medium">Price Range</h4>
                  <p className="text-lg">
                    ${historicalData.priceRange.min.toFixed(2)} - ${historicalData.priceRange.max.toFixed(2)}
                  </p>
                </div>

                <Alert>
                  <AlertDescription>
                    <strong>Data Source:</strong> {historicalData.dataSource}<br/>
                    <strong>Time Window:</strong> {historicalData.timeWindow}<br/>
                    <em>{historicalData.note}</em>
                  </AlertDescription>
                </Alert>

                {historicalData.topSellers.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Top Sales:</h4>
                    <div className="space-y-2">
                      {historicalData.topSellers.slice(0, 3).map((sale, index) => (
                        <div key={index} className="flex justify-between p-2 bg-gray-50 dark:bg-gray-950 rounded text-sm">
                          <span className="truncate mr-2">{sale.title}</span>
                          <span className="font-medium">${sale.price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Strategy Explanation */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>eBay Historical Data Strategy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-green-600 mb-2">✅ What We CAN Get:</h4>
              <ul className="space-y-1 text-sm">
                <li>• Browse API: Current active Marvel card listings</li>
                <li>• Current asking prices and inventory levels</li>
                <li>• Marketplace Insights API: Last 90 days of sales (with approval)</li>
                <li>• Real transaction prices and volumes</li>
                <li>• Daily sales trends and market movement</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-red-600 mb-2">❌ What We CAN'T Get:</h4>
              <ul className="space-y-1 text-sm">
                <li>• findCompletedItems API: Deprecated February 2025</li>
                <li>• Historical data beyond 90 days via official APIs</li>
                <li>• Bulk historical exports</li>
                <li>• Market research without business approval</li>
              </ul>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Recommendation:</strong> For comprehensive Marvel card market analysis, we recommend:
              <br/>1. Apply for eBay Marketplace Insights API business approval
              <br/>2. Use Terapeak (eBay's official research tool) for deeper historical analysis
              <br/>3. Consider third-party services like WatchCount.com for broader market data
              <br/>4. Build daily snapshots in our database to create our own historical dataset
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}