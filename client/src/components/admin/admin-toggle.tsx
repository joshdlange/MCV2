import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/lib/store";

export function AdminToggle() {
  const { isAdminMode, toggleAdminMode, currentUser } = useAppStore();

  if (!currentUser?.isAdmin) {
    return null;
  }

  return (
    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Admin Mode</span>
        <Switch
          checked={isAdminMode}
          onCheckedChange={toggleAdminMode}
          className="data-[state=checked]:bg-marvel-red"
        />
      </div>
    </div>
  );
}
