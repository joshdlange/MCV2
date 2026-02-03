
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";
import { QuickSearch } from "@/components/dashboard/quick-search";
import { TrendingCards } from "@/components/dashboard/trending-cards";


export default function Dashboard() {

  return (
    <div className="min-h-screen bg-background">
      {/* Beta Banner - NOT sticky */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3">
        <div className="text-center">
          <p className="font-semibold text-sm md:text-base">
            🙏 Thanks for being a beta user of Marvel Card Vault! We're still building, and more cards will be added to the database every day. Come back and stay tuned for updates!
          </p>
        </div>
      </div>

      {/* Page Header - STICKY (top-16 on mobile for mobile header, top-0 on desktop) */}
      <div className="sticky top-16 lg:top-0 z-10 bg-card shadow-sm border-b border-border px-6 py-4">
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
        
        {/* Recent Cards */}
        <div className="mt-6">
          <RecentCards />
        </div>
      </div>
    </div>
  );
}
