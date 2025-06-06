import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MarketTrends() {
  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="bg-card shadow-sm border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-card-foreground tracking-wide">MARKET TRENDS</h2>
            <p className="text-sm text-muted-foreground font-roboto">
              Track pricing movements and market insights for your collection.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-bebas text-xl tracking-wide">COMING SOON</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Market trends and pricing analytics are coming soon. This will show detailed insights
              about your collection's value changes over time, top performing cards, and market opportunities.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}