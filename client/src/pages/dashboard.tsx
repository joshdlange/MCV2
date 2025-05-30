
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";


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

        </div>
      </div>

      {/* Dashboard Content */}
      <div className="p-6">
        <StatsDashboard />
        
        {/* Recent Cards */}
        <div className="grid grid-cols-1 gap-6">
          <RecentCards />
        </div>
      </div>
    </div>
  );
}
