import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Target, ChevronRight } from "lucide-react";
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

type Mission = {
  headline: string;
  copy: string;
  cta: string;
};

const BUILD_YOUR_VAULT: Mission = {
  headline: "Build Your Vault",
  copy: "Every card you add grows your collection value, earns XP, and helps complete your binders.",
  cta: "Add Cards",
};

function pickMission(stats: CollectionStats, xp: XpProgress | undefined): Mission {
  const totalCards = stats.totalCards || 0;

  // The /api/stats optimized endpoint returns `wishlistCount`, while the shared
  // CollectionStats type declares `wishlistItems` — read BOTH (same dual-source
  // as the Collection Snapshot tile) so the mission always matches the tile.
  const wishlistRaw =
    (stats as any).wishlistItems ?? (stats as any).wishlistCount;
  const wishlistKnown = typeof wishlistRaw === "number" && !isNaN(wishlistRaw);

  if (totalCards < 10) {
    return BUILD_YOUR_VAULT;
  }

  // Never claim the wishlist is empty unless we KNOW it is zero.
  if (!wishlistKnown) {
    return BUILD_YOUR_VAULT;
  }

  if (wishlistRaw === 0) {
    return {
      headline: "Start Your Wishlist",
      copy: "Track the cards you're chasing and get ready for future trades.",
      cta: "Browse Cards",
    };
  }

  if (xp && !xp.isMaxLevel && xp.progressPct >= 60) {
    const remaining = Math.max(0, xp.xpForNextLevel - xp.xpIntoLevel);
    return {
      headline: "Level Up",
      copy: `You're ${remaining.toLocaleString()} XP from Level ${xp.level + 1}. Add cards, earn Super Powers, or contribute images to power up.`,
      cta: "Continue Building",
    };
  }

  return BUILD_YOUR_VAULT;
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
  if (!stats || (stats.totalCards || 0) === 0) return null;

  const mission = pickMission(stats, xp);

  return (
    <div
      className="mission-card rounded-xl p-4 sm:p-5 shadow-xl"
      data-testid="card-mission"
    >
      <svg
        className="mission-card-web hidden sm:block"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="rgba(239,68,68,0.35)" strokeWidth="1">
          {/* Radial spokes from corner */}
          <line x1="200" y1="0" x2="0" y2="0" />
          <line x1="200" y1="0" x2="0" y2="60" />
          <line x1="200" y1="0" x2="0" y2="130" />
          <line x1="200" y1="0" x2="0" y2="200" />
          <line x1="200" y1="0" x2="70" y2="200" />
          <line x1="200" y1="0" x2="140" y2="200" />
          <line x1="200" y1="0" x2="200" y2="200" />
          {/* Concentric web strands (slightly sagging arcs between spokes) */}
          <path d="M 165 0 Q 160 12 154 21 Q 146 32 165 35" />
          <path d="M 130 0 Q 122 24 108 42 Q 90 63 130 70 M 130 70 Q 155 62 200 70" />
          <path d="M 95 0 Q 84 36 62 63 Q 34 95 95 105 M 95 105 Q 132 94 200 105" />
          <path d="M 60 0 Q 46 48 16 84 Q -8 112 0 118" />
          <path d="M 25 0 Q 8 60 0 78" />
          <path d="M 200 140 Q 128 128 68 158 Q 24 182 25 200" />
          <path d="M 200 175 Q 150 168 108 184 Q 78 194 75 200" />
        </g>
      </svg>
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 mb-1.5 px-2 py-0.5 rounded-full border border-red-500/30 bg-red-600/15">
            <Target className="w-3 h-3 text-red-500" strokeWidth={2.5} />
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-red-400/90">
              Today's Mission
            </span>
          </div>
          <h3
            className="text-white font-black italic uppercase text-xl sm:text-2xl leading-tight tracking-tight"
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
            onClick={() => setLocation("/browse")}
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
  );
}
