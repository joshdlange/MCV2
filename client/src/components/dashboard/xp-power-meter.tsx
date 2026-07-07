import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Sparkles, Zap, Layers, Image as ImageIcon, Award } from "lucide-react";
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

function motivation(p: XpSummary): string {
  if (p.isMaxLevel) return "Maximum power reached — you're a true Marvel legend.";
  const remaining = Math.max(0, p.xpForNextLevel - p.xpIntoLevel);
  if (p.level <= 1 && p.xpIntoLevel === 0) return "Every card you add powers up your collector level.";
  if (p.progressPct >= 80) return `So close — just ${remaining.toLocaleString()} XP to Level ${p.level + 1}!`;
  if (p.progressPct >= 40) return `Halfway to Level ${p.level + 1}. Keep the momentum going.`;
  return `${remaining.toLocaleString()} XP to reach Level ${p.level + 1}.`;
}

function Chip({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2.5} />
      <span className="text-[11px] font-bold text-white tabular-nums">{value.toLocaleString()}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color, opacity: 0.75 }}>
        {label}
      </span>
    </div>
  );
}

export function XpPowerMeter() {
  const { data, isLoading, isError } = useQuery<XpSummary>({
    queryKey: ["/api/user/xp-summary"],
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div
        className="relative rounded-xl p-4 sm:p-5 border shadow-2xl overflow-hidden"
        style={{
          background:
            "radial-gradient(120% 120% at 0% 0%, rgba(239,68,68,0.16) 0%, transparent 55%), linear-gradient(180deg, #181818 0%, #0b0b0b 100%)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
        data-testid="loading-xp-power-meter"
      >
        {/* Gold glow accent */}
        <div
          className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(251,191,36,0.14) 0%, transparent 70%)" }}
        />
        <div className="relative flex items-center gap-2.5">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 shrink-0 animate-pulse"
            style={{ boxShadow: "0 0 16px 2px rgba(251,191,36,0.4)" }}
          >
            <Zap className="w-[18px] h-[18px] text-black" strokeWidth={2.5} fill="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-400/90 leading-none">
              Collector Power
            </div>
            <div className="text-white font-bold text-sm sm:text-base mt-1.5 leading-tight">
              Powering up your collector level…
            </div>
          </div>
        </div>
        {/* Shimmer progress bar */}
        <div className="relative mt-4 h-4 bg-black/50 rounded-full overflow-hidden border border-white/10">
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-amber-400/70 to-transparent"
            initial={{ x: "-120%" }}
            animate={{ x: "320%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    );
  }

  // Fail silently — never break the dashboard if XP can't load.
  if (isError || !data) return null;

  const remaining = Math.max(0, data.xpForNextLevel - data.xpIntoLevel);

  return (
    <div
      className="relative rounded-xl p-4 sm:p-5 border shadow-2xl overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 120% at 0% 0%, rgba(239,68,68,0.16) 0%, transparent 55%), linear-gradient(180deg, #181818 0%, #0b0b0b 100%)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
      data-testid="card-xp-power-meter"
    >
      {/* Gold glow accent */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(251,191,36,0.14) 0%, transparent 70%)" }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between gap-3 mb-3 sm:mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 shrink-0"
            style={{ boxShadow: "0 0 16px 2px rgba(251,191,36,0.4)" }}
          >
            <Zap className="w-[18px] h-[18px] text-black" strokeWidth={2.5} fill="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-400/90 leading-none">
              Collector Power
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span
                className="text-2xl font-black text-white leading-none"
                style={{ textShadow: "0 0 20px rgba(251,191,36,0.4)" }}
                data-testid="text-xp-level"
              >
                Level {data.level}
              </span>
              <span className="text-white/40 text-sm font-semibold">/ 50</span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-1 text-amber-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-lg font-black text-white tabular-nums" data-testid="text-xp-total">
              {data.totalXp.toLocaleString()}
            </span>
          </div>
          <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/40">Total XP</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative mb-2">
        <div className="h-4 bg-black/50 rounded-full overflow-hidden border border-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500"
            style={{ boxShadow: "0 0 12px rgba(251,191,36,0.6)" }}
            initial={{ width: 0 }}
            animate={{ width: `${data.progressPct}%` }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            data-testid="bar-xp-progress"
          />
        </div>
      </div>

      {/* XP into/for level + remaining */}
      <div className="flex items-center justify-between text-[11px] sm:text-xs mb-3">
        <span className="text-white/80 font-medium tabular-nums">
          {data.isMaxLevel
            ? "MAX LEVEL"
            : `${data.xpIntoLevel.toLocaleString()} / ${data.xpForNextLevel.toLocaleString()} XP`}
        </span>
        {!data.isMaxLevel && (
          <span className="text-amber-300/90 font-semibold tabular-nums" data-testid="text-xp-remaining">
            {remaining.toLocaleString()} XP to Level {data.level + 1}
          </span>
        )}
      </div>

      {/* Motivational copy */}
      <p className="text-white/60 text-xs sm:text-sm mb-3 leading-snug">{motivation(data)}</p>

      {/* Breakdown chips */}
      <div className="flex flex-wrap gap-2">
        <Chip icon={Layers} label="Cards" value={data.breakdown.cardXp} color="#ef4444" />
        <Chip icon={ImageIcon} label="Images" value={data.breakdown.imageXp} color="#10b981" />
        <Chip icon={Award} label="Powers" value={data.breakdown.badgeXp} color="#a855f7" />
      </div>
    </div>
  );
}
