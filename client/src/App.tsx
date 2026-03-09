import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
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
import { ErrorBoundary } from "@/components/ErrorBoundary";

function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

const Dashboard = lazy(() => import("@/pages/dashboard"));
const BrowseCards = lazy(() => import("@/pages/browse-cards"));
const MyCollection = lazy(() => import("@/pages/my-collection"));
const Wishlist = lazy(() => import("@/pages/wishlist"));
const Marketplace = lazy(() => import("@/pages/marketplace"));
const Profile = lazy(() => import("@/pages/profile"));
const Social = lazy(() => import("@/pages/Social"));
const FriendProfile = lazy(() => import("@/pages/FriendProfile"));
const AdminCardManagement = lazy(() => import("@/pages/admin/card-management"));
const AdminUsers = lazy(() => import("@/pages/admin/users"));
const AdminPayouts = lazy(() => import("@/pages/admin/payouts"));
const AdminMainSets = lazy(() => import("@/pages/admin/main-sets"));
const AdminUnassignedSets = lazy(() => import("@/pages/admin/unassigned-sets"));
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminAutomation = lazy(() => import("@/pages/admin/automation"));
const AdminUpcomingSets = lazy(() => import("@/pages/admin/upcoming-sets"));
const AdminImageApprovals = lazy(() => import("@/pages/admin/image-approvals"));
const AdminMigrationConsole = lazy(() => import("@/pages/admin/migration-console"));
const AdminBaseSetPopulation = lazy(() => import("@/pages/admin/base-set-population"));
const CardSearch = lazy(() => import("@/pages/card-search"));
const MarketTrends = lazy(() => import("@/pages/market-trends"));
const UpcomingSets = lazy(() => import("@/pages/upcoming-sets"));
const SubscriptionSuccess = lazy(() => import("@/pages/subscription-success"));
const SubscriptionCancelled = lazy(() => import("@/pages/subscription-cancelled"));
const Subscribe = lazy(() => import("@/pages/subscribe"));
const Activity = lazy(() => import("@/pages/Activity"));
const SharedBinder = lazy(() => import("@/pages/shared-binder"));
const NotFound = lazy(() => import("@/pages/not-found"));

const PageSpinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full" />
  </div>
);

function DesktopHeader() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: unreadMessages } = useQuery<{ count: number }>({
    queryKey: ["/api/social/unread-count"],
    refetchInterval: 30000,
    enabled: !!user,
  });
  
  return (
    <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="w-8 h-8 bg-marvel-red rounded-lg flex items-center justify-center">
          <img 
            src={heroLogoWhite} 
            alt="Marvelous Card Vault" 
            className="w-5 h-5 object-contain"
          />
        </div>
        <h1 className="text-gray-900 font-bebas text-xl tracking-wide font-bold">
          MARVELOUS CARD VAULT
        </h1>
      </div>
      <div className="flex items-center space-x-4">
        <NotificationBell />
        <button 
          className="relative text-gray-600 hover:text-gray-900 p-2"
          onClick={() => setLocation('/social?tab=messages')}
          title="Messages"
        >
          <MessageCircle className="w-5 h-5" />
          {(unreadMessages?.count || 0) > 0 && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          )}
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
      <div className="hidden lg:block fixed inset-y-0 left-0 z-40">
        <Sidebar />
      </div>
      
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50">
        <MobileHeader />
      </div>
      
      <div className="hidden lg:block lg:ml-80">
        <DesktopHeader />
      </div>
      
      <MobileMenu />
      
      <div className="lg:ml-80 pt-16 lg:pt-0">
        {children}
      </div>
    </div>
  );
}

function Router() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageSpinner />}>
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
          <Route path="/admin/base-set-population" component={AdminBaseSetPopulation} />
          <Route path="/subscribe" component={Subscribe} />
          <Route path="/subscription-success" component={SubscriptionSuccess} />
          <Route path="/subscription-cancelled" component={SubscriptionCancelled} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RouteErrorBoundary>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();
  
  useBackButton();

  if (loading) {
    return <PageSpinner />;
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
  const [location] = useLocation();

  if (location.startsWith('/share/')) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <ErrorBoundary>
            <Suspense fallback={<PageSpinner />}>
              <Switch>
                <Route path="/share/:token" component={SharedBinder} />
              </Switch>
            </Suspense>
          </ErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

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
