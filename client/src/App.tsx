import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { useAppStore } from "@/lib/store";
import { Search, MessageCircle } from "lucide-react";
import { useLocation } from "wouter";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";
import { useBackButton } from "@/hooks/useBackButton";
import heroLogoWhite from "@assets/noun-super-hero-380874-FFFFFF.png";
import { Login } from "@/components/auth/Login";
import { Onboarding } from "@/components/auth/Onboarding";
import Dashboard from "@/pages/dashboard";
import BrowseCards from "@/pages/browse-cards";
import MyCollection from "@/pages/my-collection";
import Wishlist from "@/pages/wishlist";
import Marketplace from "@/pages/marketplace";
import Profile from "@/pages/profile";
import Social from "@/pages/Social";
import FriendProfile from "@/pages/FriendProfile";
import AdminCardManagement from "@/pages/admin/card-management";
import AdminUsers from "@/pages/admin/users";
import AdminPayouts from "@/pages/admin/payouts";
import AdminMainSets from "@/pages/admin/main-sets";
import AdminUnassignedSets from "@/pages/admin/unassigned-sets";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminPage from "@/pages/admin";
import AdminAutomation from "@/pages/admin/automation";
import AdminUpcomingSets from "@/pages/admin/upcoming-sets";
import AdminImageApprovals from "@/pages/admin/image-approvals";
import AdminMigrationConsole from "@/pages/admin/migration-console";
import CardSearch from "@/pages/card-search";
import MarketTrends from "@/pages/market-trends";
import UpcomingSets from "@/pages/upcoming-sets";
import ApiDemo from "@/pages/api-demo";
import SubscriptionSuccess from "@/pages/subscription-success";
import SubscriptionCancelled from "@/pages/subscription-cancelled";
import Activity from "@/pages/Activity";
import NotFound from "@/pages/not-found";

function DesktopHeader() {
  const [, setLocation] = useLocation();
  
  return (
    <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="w-8 h-8 bg-marvel-red rounded-lg flex items-center justify-center">
          <img 
            src={heroLogoWhite} 
            alt="Marvel Card Vault" 
            className="w-5 h-5 object-contain"
          />
        </div>
        <h1 className="text-gray-900 font-bebas text-xl tracking-wide font-bold">
          MARVEL CARD VAULT
        </h1>
      </div>
      <div className="flex items-center space-x-4">
        <NotificationBell />
        <button 
          className="text-gray-600 hover:text-gray-900 p-2"
          onClick={() => setLocation('/social?tab=messages')}
          title="Messages"
        >
          <MessageCircle className="w-5 h-5" />
        </button>
        <button 
          className="text-gray-600 hover:text-gray-900 p-2"
          onClick={() => setLocation('/card-search')}
        >
          <Search className="w-5 h-5" />
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
      <Route path="/browse/:mainSetSlug" component={BrowseCards} />
      <Route path="/browse/:mainSetSlug/:setSlug" component={BrowseCards} />
      <Route path="/card-search" component={CardSearch} />
      <Route path="/my-collection" component={MyCollection} />
      <Route path="/wishlist" component={Wishlist} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/activity" component={Activity} />
      <Route path="/trends" component={MarketTrends} />
      <Route path="/upcoming-sets" component={UpcomingSets} />
      <Route path="/api-demo" component={ApiDemo} />
      <Route path="/profile" component={Profile} />
      <Route path="/social" component={Social} />
      <Route path="/friend-profile/:friendId" component={FriendProfile} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/automation" component={AdminAutomation} />
      <Route path="/admin/cards" component={AdminCardManagement} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/payouts" component={AdminPayouts} />
      <Route path="/admin/main-sets" component={AdminMainSets} />
      <Route path="/admin/unassigned-sets" component={AdminUnassignedSets} />
      <Route path="/admin/upcoming-sets" component={AdminUpcomingSets} />
      <Route path="/admin/image-approvals" component={AdminImageApprovals} />
      <Route path="/admin/migration-console" component={AdminMigrationConsole} />
      <Route path="/subscription-success" component={SubscriptionSuccess} />
      <Route path="/subscription-cancelled" component={SubscriptionCancelled} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();
  
  useBackButton();

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
    <>
      <Onboarding />
      <AppLayout>
        <Router />
      </AppLayout>
    </>
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
