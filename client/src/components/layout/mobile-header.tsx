import { useAppStore } from "@/lib/store";
import { Menu, Search } from "lucide-react";
import heroLogoWhite from "@assets/noun-super-hero-380874-FFFFFF.png";
import { useLocation } from "wouter";
import { NotificationBell } from "@/components/NotificationBell";

export function MobileHeader() {
  const { toggleMobileMenu } = useAppStore();
  const [, setLocation] = useLocation();

  return (
    <div className="lg:hidden bg-white shadow-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <button 
          onClick={toggleMobileMenu}
          className="text-gray-600 hover:text-gray-900"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center space-x-2">
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
      </div>
      <div className="flex items-center space-x-3">
        <NotificationBell />
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
