import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Zap, Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { XpProgress } from "@shared/xp";

interface XpSummary extends XpProgress {
  breakdown: { badgeXp: number; imageXp: number; cardXp: number; totalXp: number };
  recentXpEvents: Array<{
    id: number;
    eventType: string;
    points: number;
    cardId: number | null;
    cardName: string | null;
    createdAt: string;
  }>;
}

function BreakdownRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-foreground/80">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-foreground">{value.toLocaleString()} XP</span>
    </div>
  );
}

/** Fast, intentional loading shimmer — same height (h-2.5) as the real progress bar. */
function ShimmerBar() {
  return (
    <div className="relative h-2.5 bg-black/50 rounded-full overflow-hidden border border-white/10">
      <motion.div
        className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-amber-400/70 to-transparent"
        initial={{ x: "-120%" }}
        animate={{ x: "320%" }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/**
 * Slim Collector Power / XP bar. Sits INSIDE the dashboard stats container,
 * directly under the stat tiles.
 *
 * - Loads independently of the /api/stats query (stat tiles never wait on it).
 * - Cached: staleTime 60s + gcTime 5m + no window-focus refetch, so returning
 *   to the dashboard shows instant cached data instead of the skeleton.
 * - The loading state mirrors the loaded layout exactly (same structure at both
 *   breakpoints) so there is NO layout shift when the XP data arrives.
 * - Fails silently (returns null) so it can never block or break the dashboard.
 */
export function XpPowerMeter() {
  const { data, isLoading, isError } = useQuery<XpSummary>({
    queryKey: ["/api/user/xp-summary"],
    staleTime: 60_000, // treat as fresh for 60s — no refetch on remount within window
    gcTime: 5 * 60_000, // keep cached 5m so re-navigation renders instantly (no skeleton)
    refetchOnWindowFocus: false,
  });

  // Fail silently — never break the dashboard if XP can't load.
  if (isError) return null;

  const loading = isLoading || !data;
  const remaining = data ? Math.max(0, data.xpForNextLevel - data.xpIntoLevel) : 0;

  const progressBar = loading ? (
    <ShimmerBar />
  ) : (
    <div className="h-2.5 bg-black/50 rounded-full overflow-hidden border border-white/10">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500"
        style={{ boxShadow: "0 0 10px rgba(251,191,36,0.5)" }}
        initial={{ width: 0 }}
        animate={{ width: `${data!.isMaxLevel ? 100 : data!.progressPct}%` }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        data-testid="bar-xp-progress"
      />
    </div>
  );

  const detailsControl = loading ? (
    // Non-interactive placeholder with the same footprint as the real button.
    <div
      className="shrink-0 ml-auto flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold text-white/20"
      aria-hidden="true"
    >
      <Info className="w-3 h-3" />
      <span className="hidden md:inline">XP details</span>
    </div>
  ) : (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="shrink-0 ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-white/45 hover:text-amber-300 transition-colors"
          data-testid="button-xp-details"
        >
          <Info className="w-3 h-3" />
          <span className="hidden md:inline">XP details</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          XP Breakdown
        </div>
        <div className="space-y-1.5">
          <BreakdownRow label="Cards" value={data!.breakdown.cardXp} color="#ef4444" />
          <BreakdownRow label="Image Contributions" value={data!.breakdown.imageXp} color="#10b981" />
          <BreakdownRow label="Super Power XP" value={data!.breakdown.badgeXp} color="#a855f7" />
        </div>
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-sm font-bold">
          <span>Total</span>
          <span className="tabular-nums">{data!.totalXp.toLocaleString()} XP</span>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <div
      className="mt-2.5 pt-2.5 border-t border-white/[0.06]"
      data-testid={loading ? "loading-xp-power-meter" : "card-xp-power-meter"}
    >
      {/* Slim single row on tablet/desktop */}
      <div className="flex items-center gap-3">
        {/* Level badge */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 shrink-0${loading ? " animate-pulse" : ""}`}
            style={{ boxShadow: "0 0 12px 1px rgba(251,191,36,0.4)" }}
          >
            <Zap className="w-3.5 h-3.5 text-black" strokeWidth={2.5} fill="currentColor" />
          </div>
          <div className="leading-none">
            <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-amber-400/90">
              Collector
            </div>
            <div className="text-sm font-black text-white mt-0.5" data-testid="text-xp-level">
              {loading ? "Powering up…" : `Level ${data!.level}`}
            </div>
          </div>
        </div>

        {/* Progress bar (desktop/tablet) */}
        <div className="flex-1 min-w-0 hidden sm:block">{progressBar}</div>

        {/* Right meta (desktop/tablet) */}
        <div className="shrink-0 text-right hidden sm:block leading-tight">
          {loading ? (
            <>
              <div className="h-3.5 w-20 ml-auto rounded bg-white/10 animate-pulse" />
              <div className="h-3 w-24 mt-1 ml-auto rounded bg-white/10 animate-pulse" />
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-white tabular-nums" data-testid="text-xp-total">
                {data!.totalXp.toLocaleString()} <span className="text-white/40 font-medium">total XP</span>
              </div>
              <div
                className="text-[10px] font-semibold text-amber-300/90 tabular-nums"
                data-testid="text-xp-remaining"
              >
                {data!.isMaxLevel
                  ? "Max level reached"
                  : `${remaining.toLocaleString()} XP to Level ${data!.level + 1}`}
              </div>
            </>
          )}
        </div>

        {detailsControl}
      </div>

      {/* Progress bar + meta stacked below on mobile (rendered in BOTH states to keep height stable) */}
      <div className="sm:hidden mt-2">
        {progressBar}
        <div className="flex items-center justify-between mt-1">
          {loading ? (
            <>
              <div className="h-3 w-20 rounded bg-white/10 animate-pulse" />
              <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
            </>
          ) : (
            <>
              <span className="text-[10px] font-medium text-white/60 tabular-nums">
                {data!.totalXp.toLocaleString()} total XP
              </span>
              <span className="text-[10px] font-semibold text-amber-300/90 tabular-nums">
                {data!.isMaxLevel ? "Max level" : `${remaining.toLocaleString()} XP to Lvl ${data!.level + 1}`}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
