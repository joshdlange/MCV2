import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { useAppStore } from "@/lib/store";
import Dashboard from "@/pages/dashboard";
import BrowseCards from "@/pages/browse-cards";
import MyCollection from "@/pages/my-collection";
import Wishlist from "@/pages/wishlist";
import Marketplace from "@/pages/marketplace";
import AdminCardManagement from "@/pages/admin/card-management";
import AdminUsers from "@/pages/admin/users";
import CardSearch from "@/pages/card-search";
import MarketTrends from "@/pages/market-trends";
import NotFound from "@/pages/not-found";

function MobileMenu() {
  const { isMobileMenuOpen, setMobileMenuOpen } = useAppStore();

  if (!isMobileMenuOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div 
        className="fixed inset-0 bg-black bg-opacity-50" 
        onClick={() => setMobileMenuOpen(false)}
      />
      <div className="fixed inset-y-0 left-0 w-80 bg-white shadow-lg">
        <div onClick={() => setMobileMenuOpen(false)}>
          <Sidebar />
        </div>
      </div>
    </div>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-40">
        <Sidebar />
      </div>
      
      {/* Mobile Header - shown on mobile only */}
      <div className="lg:hidden">
        <MobileHeader />
      </div>
      
      {/* Mobile Menu Overlay */}
      <MobileMenu />
      
      {/* Main Content */}
      <div className="lg:ml-80">
        {children}
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/browse" component={BrowseCards} />
      <Route path="/card-search" component={CardSearch} />
      <Route path="/collection" component={MyCollection} />
      <Route path="/wishlist" component={Wishlist} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/trends" component={MarketTrends} />
      <Route path="/admin/cards" component={AdminCardManagement} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppLayout>
          <Router />
        </AppLayout>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
