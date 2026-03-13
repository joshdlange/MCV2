import { useAppStore } from "@/lib/store";
import { Menu, Search, MessageCircle } from "lucide-react";
import heroLogoWhite from "@assets/noun-super-hero-380874-FFFFFF.png";
import { useLocation } from "wouter";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";

export function MobileHeader() {
  const { toggleMobileMenu } = useAppStore();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: unreadMessages } = useQuery<{ count: number }>({
    queryKey: ["/api/social/unread-count"],
    refetchInterval: 120000,
    staleTime: 60000,
    refetchOnWindowFocus: false,
    enabled: !!user,
  });

  return (
    <div className="lg:hidden bg-white shadow-sm border-b border-gray-200 px-4 flex items-center justify-between h-16" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center space-x-3">
        <button 
          onClick={toggleMobileMenu}
          className="text-gray-600 hover:text-gray-900 flex-shrink-0"
          style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center space-x-2">
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
      </div>
      <div className="flex items-center space-x-3">
        <NotificationBell />
        <button 
          className="relative text-gray-600 hover:text-gray-900"
          onClick={() => setLocation('/social?tab=messages')}
          title="Messages"
        >
          <MessageCircle className="w-5 h-5" />
          {(unreadMessages?.count || 0) > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          )}
        </button>
        <button 
          className="text-gray-600 hover:text-gray-900"
          onClick={() => setLocation('/card-search')}
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
