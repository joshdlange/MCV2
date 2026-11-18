import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChevronRight, Target } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { pickMission } from "@/lib/dailyMission";
import { useNativeReview } from "@/hooks/useNativeReview";
import type { CollectionStats } from "@shared/schema";
import type { XpProgress } from "@shared/xp";


/**
 * Shares the exact same query key + cache options as XpPowerMeter, so this
 * NEVER triggers an extra network request — it reads the same cached entry.
 */
function useXpSummary() {
  return useQuery<XpProgress>({
    queryKey: ["/api/user/xp-summary"],
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function MissionCard({
  stats,
  isLoading,
}: {
  stats: CollectionStats | undefined;
  isLoading: boolean;
}) {
  const [, setLocation] = useLocation();
  const { data: xp } = useXpSummary();
  const totalLogins = useAppStore((state) => state.currentUser?.totalLogins ?? 0);
  useNativeReview(!isLoading && !!stats);

  if (isLoading) {
    return (
      <div
        className="rounded-xl border p-4 shadow-xl animate-pulse"
        style={{
          background: "linear-gradient(135deg, #1c1917 0%, #111 100%)",
          borderColor: "rgba(239,68,68,0.2)",
        }}
        data-testid="loading-mission-card"
      >
        <div className="h-2.5 w-28 rounded bg-white/10 mb-2.5" />
        <div className="h-5 w-40 rounded bg-white/10 mb-2" />
        <div className="h-3.5 w-full max-w-md rounded bg-white/10" />
      </div>
    );
  }

  // Fail silently — never block the dashboard. When the collection is empty,
  // the onboarding banner below already IS the mission.
  if (!stats) return null;

  const mission = pickMission(stats as any, xp, totalLogins);
  if ((stats.totalCards || 0) === 0 && !mission.review) return null;

  return (
    <>
      <div
        className="mission-card rounded-xl p-4 sm:p-5 shadow-xl"
        data-testid="card-mission"
      >
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 mb-1.5 px-2 py-0.5 rounded-full border border-red-500/30 bg-red-600/15">
              <Target className="w-3 h-3 text-red-500" strokeWidth={2.5} />
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-red-400/90">
                Today's Mission
              </span>
            </div>
            <h3
              className="mission-headline uppercase text-2xl sm:text-3xl leading-tight"
              data-testid="text-mission-headline"
            >
              {mission.headline}
            </h3>
            <p className="text-white/60 text-xs sm:text-sm leading-snug mt-0.5 max-w-xl">
              {mission.copy}
            </p>
          </div>
          <div className="shrink-0 w-full sm:w-auto flex flex-col items-stretch sm:items-end gap-1.5">
            <Button
              onClick={() => setLocation(mission.href ?? "/browse")}
              data-testid="button-mission-cta"
              className="w-full sm:w-auto shrink-0 min-h-[44px] font-semibold text-white border transition-shadow hover:shadow-[0_0_24px_rgba(239,68,68,0.45)] active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                borderColor: "rgba(239,68,68,0.5)",
                boxShadow: "0 0 16px rgba(239,68,68,0.25)",
              }}
            >
              {mission.cta}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
            <span className="text-[10px] text-red-400/70 font-semibold tracking-wider uppercase text-center sm:text-right">
              Earn XP as you build
            </span>
          </div>
        </div>
      </div>

    </>
  );
}
