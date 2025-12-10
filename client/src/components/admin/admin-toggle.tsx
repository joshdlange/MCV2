import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store";
import { Link } from "wouter";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdminToggle() {
  const { isAdminMode, toggleAdminMode, currentUser } = useAppStore();

  if (!currentUser?.isAdmin) {
    return null;
  }

  return (
    <div className="px-6 py-4 border-b border-border bg-muted">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-foreground">Admin Mode</span>
        <Switch
          checked={isAdminMode}
          onCheckedChange={toggleAdminMode}
          className="data-[state=checked]:bg-marvel-red"
        />
      </div>
      
      {/* Admin Tools Button - appears when Admin Mode is ON */}
      {isAdminMode && (
        <Link href="/admin">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full border-marvel-red text-marvel-red hover:bg-marvel-red hover:text-white transition-colors text-xs"
          >
            <Settings className="w-4 h-4 mr-2" />
            Admin Tools
          </Button>
        </Link>
      )}
    </div>
  );
}
