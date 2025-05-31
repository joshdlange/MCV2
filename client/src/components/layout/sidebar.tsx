import { Link, useLocation } from "wouter";
import { AdminToggle } from "@/components/admin/admin-toggle";
import { useAppStore } from "@/lib/store";
import { NavigationItem } from "@/types";
import { UpgradeModal } from "@/components/subscription/upgrade-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bolt, Settings, Crown, LogOut } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { signOutUser } from "@/lib/firebase";
import { 
  LayoutDashboard, 
  Grid3X3, 
  FolderOpen, 
  Heart, 
  PlusCircle, 
  Edit,
  Search,
  TrendingUp,
  Users,
  Store
} from "lucide-react";

const getNavigationItems = (userPlan: string): NavigationItem[] => [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/browse", label: "Browse Cards", icon: "Grid3X3" },
  { href: "/collection", label: "My Collection", icon: "FolderOpen" },
  { href: "/wishlist", label: "Wishlist", icon: "Heart" },
  { 
    href: "/marketplace", 
    label: "Marketplace", 
    icon: "Store",
    badge: userPlan === 'SIDE_KICK' ? "👑" : undefined
  },
  { href: "/trends", label: "Market Trends", icon: "TrendingUp" },
];

const adminItems: NavigationItem[] = [
  { href: "/admin/cards", label: "Add Cards", icon: "PlusCircle" },
  { href: "/admin/users", label: "Manage Users", icon: "Users" },
];

const iconMap = {
  LayoutDashboard,
  Grid3X3,
  FolderOpen,
  Heart,
  PlusCircle,
  Edit,
  Search,
  TrendingUp,
  Users,
  Store,
};

export function Sidebar() {
  const [location] = useLocation();
  const { isAdminMode, currentUser } = useAppStore();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const { data: collectionStats } = useQuery({
    queryKey: ["/api/stats"],
  });

  const IconComponent = ({ iconName }: { iconName: string }) => {
    const Icon = iconMap[iconName as keyof typeof iconMap];
    return Icon ? <Icon className="w-5 h-5 mr-3" /> : null;
  };

  return (
    <div className="h-screen w-80 bg-background shadow-lg border-r border-border flex flex-col">
      {/* Logo & Branding */}
      <div className="flex items-center px-6 py-4 bg-marvel-red">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
            <Bolt className="text-marvel-red text-xl" />
          </div>
          <div>
            <h1 className="text-white font-bebas text-2xl tracking-wide">MARVEL</h1>
            <p className="text-white/80 text-sm font-roboto">Card Vault</p>
          </div>
        </div>
      </div>

      {/* Admin Toggle */}
      <AdminToggle />

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {getNavigationItems(currentUser?.plan || 'SIDE_KICK').map((item) => (
          <Link key={item.href} href={item.href}>
            <div 
              className={`flex items-center px-4 py-3 rounded-lg transition-colors group cursor-pointer ${
                location === item.href 
                  ? 'bg-marvel-red text-white' 
                  : 'text-foreground hover:bg-marvel-red hover:text-white'
              }`}
            >
              <IconComponent iconName={item.icon} />
              <span className="font-medium">{item.label}</span>
              {item.badge && (
                <span className={`ml-auto text-xs px-2 py-1 rounded-full ${
                  location === item.href
                    ? 'bg-white text-marvel-red'
                    : 'bg-marvel-red text-white group-hover:bg-white group-hover:text-marvel-red'
                }`}>
                  {item.badge}
                </span>
              )}
            </div>
          </Link>
        ))}

        {/* Upgrade Section for SIDE KICK users */}
        {currentUser && currentUser.plan === 'SIDE_KICK' && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button 
              onClick={() => setShowUpgradeModal(true)}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-yellow-900 font-bold py-3 px-4 rounded-lg shadow-lg transform hover:scale-105 transition-all duration-200"
            >
              <Crown className="w-5 h-5 mr-2" />
              Upgrade to SUPER HERO
            </Button>
            <div className="mt-2 px-2">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Collection Limit</span>
                <Badge variant="outline" className="text-xs">
                  {collectionStats?.totalCards || 0} / 250
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* Plan Badge for SUPER HERO users */}
        {currentUser && currentUser.plan === 'SUPER_HERO' && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <div className="flex items-center justify-center">
              <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500 text-yellow-900 px-3 py-1">
                <Crown className="w-4 h-4 mr-1" />
                SUPER HERO
              </Badge>
            </div>
          </div>
        )}

        {/* Admin Only Section */}
        {isAdminMode && currentUser?.isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Admin Tools
            </p>
            {adminItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div 
                  className={`flex items-center px-4 py-3 rounded-lg transition-colors group cursor-pointer ${
                    location === item.href 
                      ? 'bg-marvel-red text-white' 
                      : 'text-foreground hover:bg-marvel-red hover:text-white'
                  }`}
                >
                  <IconComponent iconName={item.icon} />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* Upgrade Modal */}
      <UpgradeModal 
        isOpen={showUpgradeModal} 
        onClose={() => setShowUpgradeModal(false)} 
      />

      {/* User Profile */}
      {currentUser && (
        <div className="border-t border-border p-4">
          <div className="flex items-center space-x-3">
            <img 
              src={currentUser.avatar} 
              alt="User avatar" 
              className="w-8 h-8 rounded-full" 
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {currentUser.name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {currentUser.email}
              </p>
            </div>
            <button className="text-muted-foreground hover:text-foreground">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
