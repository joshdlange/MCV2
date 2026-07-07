import { useQuery } from "@tanstack/react-query";
import { StatsDashboard } from "@/components/dashboard/stats-dashboard";
import { RecentCards } from "@/components/dashboard/recent-cards";
import { QuickSearch } from "@/components/dashboard/quick-search";
import { TrendingCards } from "@/components/dashboard/trending-cards";
import { useAppStore } from "@/lib/store";
import type { XpProgress } from "@shared/xp";

export default function Dashboard() {
  const { currentUser } = useAppStore();

  // Same key + cache options as XpPowerMeter — reads the shared cache entry,
  // never fires an extra request. Fails gracefully to the generic subline.
  const { data: xp } = useQuery<XpProgress>({
    queryKey: ["/api/user/xp-summary"],
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const firstName = currentUser?.name?.trim().split(/\s+/)[0];
  const xpRemaining = xp ? Math.max(0, xp.xpForNextLevel - xp.xpIntoLevel) : 0;
  const subline =
    xp && !xp.isMaxLevel
      ? `You're ${xpRemaining.toLocaleString()} XP from Level ${xp.level + 1}. Keep building your vault.`
      : xp?.isMaxLevel
        ? "Max level reached. Keep building your vault."
        : "Keep building your Marvel card vault.";

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header - STICKY (offset for mobile header + safe area on mobile, top-0 on desktop) */}
      <div className="sticky top-[calc(4rem_+_env(safe-area-inset-top))] lg:top-0 z-10 bg-card shadow-sm border-b border-border px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bebas text-card-foreground tracking-wide truncate" data-testid="text-welcome-heading">
              {firstName ? `WELCOME BACK, ${firstName.toUpperCase()}.` : "WELCOME BACK."}
            </h2>
            <p className="text-sm text-muted-foreground font-roboto" data-testid="text-welcome-subline">
              {subline}
            </p>
          </div>

          {/* Quick Search in Header — hidden on mobile (mobile header has a search icon) */}
          <div className="hidden md:block w-80 shrink-0">
            <QuickSearch />
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="p-4 sm:p-6">
        <StatsDashboard />

        {/* Trending Cards */}
        <div className="mt-6 scroll-mt-[calc(10rem_+_env(safe-area-inset-top))] lg:scroll-mt-24" id="trending-cards">
          <TrendingCards />
        </div>

        {/* Recent Cards */}
        <div className="mt-6">
          <RecentCards />
        </div>
      </div>
    </div>
  );
}
