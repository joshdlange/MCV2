import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function MarketTrends() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">MARKET TRENDS</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Track card values and market movements.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="text-center py-16">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
              <TrendingUp className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Market Analysis Coming Soon</h3>
            <p className="text-gray-500 mb-6">
              This feature will show trending cards, price movements, and market insights.
            </p>
            <Button className="bg-marvel-red hover:bg-red-700">
              Get Notified
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}