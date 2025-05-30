
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";
import { QuickSearch } from "@/components/dashboard/quick-search";


export default function Dashboard() {

  return (
    <div className="min-h-screen bg-background">
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
        
        {/* Recent Cards */}
        <div className="mt-6">
          <RecentCards />
        </div>
      </div>
    </div>
  );
}
