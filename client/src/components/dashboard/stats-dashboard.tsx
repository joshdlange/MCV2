import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Info, Layers, DollarSign, Heart, Plus, ArrowRight, Zap } from "lucide-react";
import type { CollectionStats } from "@shared/schema";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const TILES = [
  {
    key: "cards",
    label: "CARDS",
    icon: Layers,
    color: "#ef4444",
    colorMuted: "rgba(239,68,68,0.15)",
    gradient: "from-red-700 to-red-500",
    tooltip: "Total cards in your collection.",
    fill: false,
  },
  {
    key: "value",
    label: "VALUE",
    icon: DollarSign,
    color: "#10b981",
    colorMuted: "rgba(16,185,129,0.15)",
    gradient: "from-emerald-700 to-emerald-500",
    tooltip: "Estimated value based on recent eBay sales.",
    fill: false,
  },
  {
    key: "wishlist",
    label: "WISHLIST",
    icon: Heart,
    color: "#ec4899",
    colorMuted: "rgba(236,72,153,0.15)",
    gradient: "from-pink-700 to-pink-500",
    tooltip: "Cards you're chasing.",
    fill: true,
  },
  {
    key: "powers",
    label: "POWERS",
    icon: Zap,
    color: "#a855f7",
    colorMuted: "rgba(168,85,247,0.15)",
    gradient: "from-purple-700 to-purple-500",
    tooltip: "Badges and achievements you've earned.",
    fill: true,
  },
] as const;

function useCountUp(target: number, duration = 900) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  const prev = useRef(0);

  useEffect(() => {
    if (target === prev.current) return;
    const from = prev.current;
    prev.current = target;
    start.current = null;

    const step = (ts: number) => {
      if (start.current === null) start.current = ts;
      const progress = Math.min((ts - start.current) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (target - from) * ease));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return display;
}

function PowerTile({
  tile,
  rawValue,
  displayValue,
  onClick,
}: {
  tile: typeof TILES[number];
  rawValue: number;
  displayValue: string;
  onClick: () => void;
}) {
  const animated = useCountUp(rawValue);
  const formattedCount =
    rawValue >= 10000
      ? `${(animated / 1000).toFixed(1)}K`
      : animated.toLocaleString();

  const shown = tile.key === "value" ? displayValue : formattedCount;

  return (
    <motion.div
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-2 px-4 py-4 rounded-xl cursor-pointer overflow-hidden"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      whileHover={{ y: -3, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      {/* Shimmer sweep */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.07) 50%, transparent 65%)",
          backgroundSize: "200% 100%",
        }}
        animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
        transition={{ duration: 3.5, repeat: Infinity, repeatDelay: 1.8, ease: "linear" }}
      />

      {/* Hover bottom accent line */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${tile.color}, transparent)` }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      />

      {/* Icon badge */}
      <div className="relative flex items-center justify-center">
        {/* Outer pulse ring */}
        <motion.div
          className="absolute rounded-full"
          style={{ width: 52, height: 52, border: `1px solid ${tile.color}`, opacity: 0.3 }}
          animate={{ scale: [1, 1.18, 1], opacity: [0.3, 0.08, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Icon circle */}
        <div
          className={`relative w-11 h-11 rounded-full flex items-center justify-center bg-gradient-to-br ${tile.gradient} shadow-lg`}
          style={{ boxShadow: `0 0 16px 2px ${tile.color}44` }}
        >
          <tile.icon
            className="w-5 h-5 text-white"
            strokeWidth={2.5}
            fill={tile.fill ? "currentColor" : "none"}
          />
        </div>
      </div>

      {/* Number */}
      <span
        className="text-2xl font-black text-white leading-none tracking-tight"
        style={{ textShadow: `0 0 20px ${tile.color}66` }}
      >
        {shown}
      </span>

      {/* Label row */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: tile.color, opacity: 0.8 }}>
          {tile.label}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="w-2.5 h-2.5" style={{ color: tile.color, opacity: 0.5 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-w-xs p-3 text-sm">
            {tile.tooltip}
          </PopoverContent>
        </Popover>
      </div>
    </motion.div>
  );
}

export function StatsDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = useQuery<CollectionStats>({
    queryKey: ["/api/stats"],
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: userBadges } = useQuery<any[]>({
    queryKey: ["/api/social/user-badges"],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="bg-[#111] rounded-xl p-3 border border-white/[0.07] shadow-xl">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {TILES.map((t) => (
            <div key={t.key} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.04] animate-pulse">
              <div className="w-11 h-11 rounded-full bg-white/10" />
              <div className="h-6 w-12 bg-white/10 rounded" />
              <div className="h-2.5 w-10 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Failed to load statistics</p>
      </div>
    );
  }

  const totalCards = stats.totalCards || 0;
  const totalValue = stats.totalValue ? parseFloat(stats.totalValue.toString()) : 0;
  const wishlistItems = (stats as any).wishlistItems || (stats as any).wishlistCount || 0;
  const superpowersCount = userBadges?.length || 0;

  const valueDisplay =
    totalValue >= 10000
      ? `$${(totalValue / 1000).toFixed(1)}K`
      : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const tileData = [
    { tile: TILES[0], rawValue: totalCards, displayValue: totalCards.toLocaleString(), onClick: () => setLocation("/my-collection") },
    { tile: TILES[1], rawValue: Math.round(totalValue), displayValue: valueDisplay, onClick: () => setLocation("/trends") },
    { tile: TILES[2], rawValue: wishlistItems, displayValue: wishlistItems.toLocaleString(), onClick: () => setLocation("/wishlist") },
    { tile: TILES[3], rawValue: superpowersCount, displayValue: superpowersCount.toLocaleString(), onClick: () => setLocation("/social?tab=superpowers") },
  ];

  return (
    <div className="space-y-4">
      {/* ── Power Badge Bar ── */}
      <div
        className="rounded-xl p-2.5 border shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #181818 0%, #111 100%)",
          borderColor: "rgba(255,255,255,0.07)",
        }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {tileData.map(({ tile, rawValue, displayValue, onClick }) => (
            <div key={tile.key} className="group">
              <PowerTile tile={tile} rawValue={rawValue} displayValue={displayValue} onClick={onClick} />
            </div>
          ))}
        </div>
      </div>

      {/* Onboarding / Next Steps */}
      {totalCards === 0 ? (
        <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-xl p-5 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-xl font-bold mb-1">Let's build your first Marvel vault.</h3>
              <p className="text-red-100 text-sm">
                Add a few cards to unlock stats, total value, and set progress tracking.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => setLocation("/browse")}
                className="bg-white text-red-600 hover:bg-red-50 font-semibold shadow-md"
                data-testid="button-add-first-cards"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Cards
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/browse")}
                className="border-white text-white bg-white/10 hover:bg-white/20 text-sm font-semibold"
                data-testid="link-explore-sets"
              >
                Explore sets first
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      ) : totalCards < 50 ? (
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-5 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold mb-1">Nice start! Keep building your collection.</h3>
              <p className="text-gray-300 text-sm">
                You've added <span className="text-white font-semibold">{totalCards} cards</span> so far.
                Add more to unlock richer value insights and set completion tracking.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => setLocation("/browse")}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold shadow-md"
                data-testid="button-add-more-cards"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add More Cards
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLocation("/browse")}
                className="text-gray-300 hover:bg-white/10 text-sm"
                data-testid="link-view-sets"
              >
                View All Sets
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
