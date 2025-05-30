import { Link, useLocation } from "wouter";
import { AdminToggle } from "@/components/admin/admin-toggle";
import { useAppStore } from "@/lib/store";
import { NavigationItem } from "@/types";
import { Bolt, Settings } from "lucide-react";
import { 
  LayoutDashboard, 
  Grid3X3, 
  FolderOpen, 
  Heart, 
  PlusCircle, 
  Edit 
} from "lucide-react";

const navigationItems: NavigationItem[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", badge: "847" },
  { href: "/browse", label: "Browse Cards", icon: "Grid3X3" },
  { href: "/collection", label: "My Collection", icon: "FolderOpen", badge: "127" },
  { href: "/wishlist", label: "Wishlist", icon: "Heart", badge: "23" },
];

const adminItems: NavigationItem[] = [
  { href: "/admin/cards", label: "Add Cards", icon: "PlusCircle" },
  { href: "/admin/sets", label: "Manage Sets", icon: "Edit" },
];

const iconMap = {
  LayoutDashboard,
  Grid3X3,
  FolderOpen,
  Heart,
  PlusCircle,
  Edit,
};

export function Sidebar() {
  const [location] = useLocation();
  const { isAdminMode, currentUser } = useAppStore();

  const IconComponent = ({ iconName }: { iconName: string }) => {
    const Icon = iconMap[iconName as keyof typeof iconMap];
    return Icon ? <Icon className="w-5 h-5 mr-3" /> : null;
  };

  return (
    <div className="fixed inset-y-0 left-0 z-50 w-80 bg-white shadow-lg border-r border-gray-200 hidden lg:flex flex-col">
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
        {navigationItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <a 
              className={`flex items-center px-4 py-3 rounded-lg transition-colors group ${
                location === item.href 
                  ? 'bg-marvel-red text-white' 
                  : 'text-gray-700 hover:bg-marvel-red hover:text-white'
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
            </a>
          </Link>
        ))}

        {/* Admin Only Section */}
        {isAdminMode && currentUser?.isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Admin Tools
            </p>
            {adminItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <a 
                  className={`flex items-center px-4 py-3 rounded-lg transition-colors group ${
                    location === item.href 
                      ? 'bg-marvel-red text-white' 
                      : 'text-gray-700 hover:bg-marvel-red hover:text-white'
                  }`}
                >
                  <IconComponent iconName={item.icon} />
                  <span className="font-medium">{item.label}</span>
                </a>
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* User Profile */}
      {currentUser && (
        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <img 
              src={currentUser.avatar} 
              alt="User avatar" 
              className="w-8 h-8 rounded-full" 
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {currentUser.name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {currentUser.email}
              </p>
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
