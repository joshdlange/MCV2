
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";
import { QuickSearch } from "@/components/dashboard/quick-search";
import { TrendingCards } from "@/components/dashboard/trending-cards";
import { BulkPricingRefresh } from "@/components/dashboard/bulk-pricing-refresh";


export default function Dashboard() {

  return (
    <div className="min-h-screen bg-background">
      {/* Beta Banner */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3">
        <div className="text-center">
          <p className="font-semibold text-sm md:text-base">
            🙏 Thanks for being a beta user of Marvel Card Vault! We're still building, and more cards will be added to the database every day. Come back and stay tuned for updates!
          </p>
        </div>
      </div>

      {/* Page Header */}
      <div className="bg-card shadow-sm border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-card-foreground tracking-wide">DASHBOARD</h2>
            <p className="text-sm text-muted-foreground font-roboto">
              Welcome back! Here's your collection overview.
            </p>
          </div>
          
          {/* Quick Search in Header */}
          <div className="w-80">
            <QuickSearch />
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="p-6">
        <StatsDashboard />
        
        {/* Trending Cards */}
        <div className="mt-6">
          <TrendingCards />
        </div>
        
        {/* Bulk Pricing Refresh */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2">
            <RecentCards />
          </div>
          <div>
            <BulkPricingRefresh />
          </div>
        </div>
      </div>
    </div>
  );
}
