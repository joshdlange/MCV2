import { useAppStore } from "@/lib/store";
import { Menu, Search, Bolt } from "lucide-react";

export function MobileHeader() {
  const { toggleMobileMenu } = useAppStore();

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
            <Bolt className="text-white text-sm" />
          </div>
          <h1 className="text-marvel-red font-bebas text-xl tracking-wide">
            MARVEL VAULT
          </h1>
        </div>
      </div>
      <button className="text-gray-600 hover:text-gray-900">
        <Search className="w-5 h-5" />
      </button>
    </div>
  );
}
