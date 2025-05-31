import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { useAppStore } from "@/lib/store";
import { Search } from "lucide-react";
import { useLocation } from "wouter";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Login } from "@/components/auth/Login";
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

function DesktopHeader() {
  const [, setLocation] = useLocation();

  return (
    <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
      <div className="flex justify-end">
        <button 
          className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
          onClick={() => setLocation('/card-search')}
        >
          <Search className="w-5 h-5" />
          <span className="text-sm">Quick Search</span>
        </button>
      </div>
    </div>
  );
}

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
      
      {/* Mobile Header - shown on mobile only, fixed at top */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50">
        <MobileHeader />
      </div>
      
      {/* Desktop Header - shown on desktop only */}
      <div className="hidden lg:block lg:ml-80">
        <DesktopHeader />
      </div>
      
      {/* Mobile Menu Overlay */}
      <MobileMenu />
      
      {/* Main Content */}
      <div className="lg:ml-80 pt-16 lg:pt-0">
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

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <AppLayout>
      <Router />
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <AuthenticatedApp />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
