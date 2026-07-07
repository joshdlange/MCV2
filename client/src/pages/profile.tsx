import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import AccountSettings from "@/components/profile/AccountSettings";

export default function Profile() {
  const [, setLocation] = useLocation();
  const { currentUser } = useAppStore();

  const hubHref = currentUser?.username ? `/collectors/${currentUser.username}` : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Account Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your personal info, billing, and privacy.
            </p>
          </div>
          {hubHref && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(hubHref)}
              className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50 rounded-full shrink-0"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              <span className="sm:hidden">Back</span>
              <span className="hidden sm:inline">Back to Collector Profile</span>
            </Button>
          )}
        </div>

        <AccountSettings />
      </div>
    </div>
  );
}
