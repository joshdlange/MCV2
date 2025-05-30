import { Button } from "@/components/ui/button";
import { Plus, Download } from "lucide-react";
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";
import { QuickActions } from "@/components/dashboard/quick-actions";

export default function Dashboard() {
  const handleQuickAdd = () => {
    console.log('Quick add card');
  };

  const handleExport = () => {
    console.log('Export data');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">DASHBOARD</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Welcome back! Here's your collection overview.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Button 
              onClick={handleQuickAdd}
              className="bg-marvel-red text-white hover:bg-red-700 flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Quick Add</span>
            </Button>
            <Button 
              variant="outline"
              onClick={handleExport}
              className="bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="p-6">
        <StatsDashboard />
        
        {/* Recent Cards & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RecentCards />
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
