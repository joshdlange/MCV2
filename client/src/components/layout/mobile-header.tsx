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
    // Height GROWS with the device safe-area inset (notch/cutout/status bar)
    // so the 64px content row is never squeezed and icons never hang off the
    // header. --safe-area-top (defined in index.css) is the max of iOS
    // env(safe-area-inset-top) and the native inset Capacitor injects on
    // Android edge-to-edge devices, where env() always reports 0.
    <div
      className="lg:hidden bg-white shadow-sm border-b border-gray-200 flex items-center justify-between gap-2"
      style={{
        paddingTop: "var(--safe-area-top)",
        paddingLeft: "calc(0.75rem + var(--safe-area-left))",
        paddingRight: "calc(0.75rem + var(--safe-area-right))",
        height: "calc(4rem + var(--safe-area-top))",
      }}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={toggleMobileMenu}
          className="text-gray-600 hover:text-gray-900 flex-shrink-0 w-11 h-11 flex items-center justify-center"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-marvel-red rounded-lg flex items-center justify-center flex-shrink-0">
            <img
              src={heroLogoWhite}
              alt="Marvelous Card Vault"
              className="w-5 h-5 object-contain"
            />
          </div>
          <h1 className="text-gray-900 font-bebas text-xl tracking-wide font-bold truncate">
            MARVELOUS CARD VAULT
          </h1>
        </div>
      </div>
      <div className="flex items-center flex-shrink-0">
        <NotificationBell />
        <button
          className="relative text-gray-600 hover:text-gray-900 w-10 h-11 flex items-center justify-center"
          onClick={() => setLocation('/social?tab=messages')}
          title="Messages"
          aria-label="Messages"
        >
          <MessageCircle className="w-5 h-5" />
          {(unreadMessages?.count || 0) > 0 && (
            <span className="absolute top-2 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500" />
          )}
        </button>
        <button
          className="text-gray-600 hover:text-gray-900 w-10 h-11 flex items-center justify-center"
          onClick={() => setLocation('/card-search')}
          aria-label="Search cards"
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
