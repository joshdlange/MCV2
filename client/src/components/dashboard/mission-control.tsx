import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Target,
  Search,
  Layers,
  ScanLine,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
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
  action: "add-cards" | "browse";
};

const BUILD_YOUR_VAULT: Mission = {
  headline: "Build Your Vault",
  copy: "Every card you add grows your collection value, earns XP, and helps complete your binders.",
  cta: "Add Cards",
  action: "add-cards",
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
      action: "browse",
    };
  }

  if (xp && !xp.isMaxLevel && xp.progressPct >= 60) {
    const remaining = Math.max(0, xp.xpForNextLevel - xp.xpIntoLevel);
    return {
      headline: "Level Up",
      copy: `You're ${remaining.toLocaleString()} XP from Level ${xp.level + 1}. Add cards, earn Super Powers, or contribute images to power up.`,
      cta: "Continue Building",
      action: "add-cards",
    };
  }

  return {
    headline: "Build Your Vault",
    copy: "Every card you add grows your collection value, earns XP, and helps complete your binders.",
    cta: "Add Cards",
    action: "add-cards",
  };
}

export function MissionCard({
  stats,
  isLoading,
  onAddCards,
}: {
  stats: CollectionStats | undefined;
  isLoading: boolean;
  onAddCards: () => void;
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
  const handleCta = () => {
    if (mission.action === "browse") {
      setLocation("/browse");
    } else {
      onAddCards();
    }
  };

  return (
    <div
      className="rounded-xl border p-4 shadow-xl"
      style={{
        background:
          "linear-gradient(135deg, #1c1917 0%, #111 55%, #1c0a0a 100%)",
        borderColor: "rgba(239,68,68,0.28)",
      }}
      data-testid="card-mission"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3 h-3 text-red-500" strokeWidth={2.5} />
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-red-400/90">
              Today's Mission
            </span>
          </div>
          <h3
            className="text-white font-bold text-base sm:text-lg leading-tight"
            data-testid="text-mission-headline"
          >
            {mission.headline}
          </h3>
          <p className="text-white/60 text-xs sm:text-sm leading-snug mt-0.5">
            {mission.copy}
          </p>
        </div>
        <Button
          onClick={handleCta}
          data-testid="button-mission-cta"
          className="w-full sm:w-auto shrink-0 min-h-[44px] font-semibold text-white border"
          style={{
            background: "linear-gradient(135deg, #dc2626, #b91c1c)",
            borderColor: "rgba(239,68,68,0.5)",
            boxShadow: "0 0 16px rgba(239,68,68,0.25)",
          }}
        >
          {mission.cta}
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

const ADD_OPTIONS = [
  {
    label: "Search Manually",
    description: "Find a specific card by name or number",
    icon: Search,
    color: "#ef4444",
    testId: "option-search-manually",
  },
  {
    label: "Browse Sets",
    description: "Explore sets and add cards as you go",
    icon: Layers,
    color: "#10b981",
    testId: "option-browse-sets",
  },
  {
    label: "Scan to Add",
    description: "Snap a photo and let the vault identify it",
    icon: ScanLine,
    color: "#f59e0b",
    testId: "option-scan-to-add",
  },
  {
    label: "View Trending Cards",
    description: "See what other collectors are chasing",
    icon: TrendingUp,
    color: "#a855f7",
    testId: "option-trending-cards",
  },
] as const;

export function AddCardsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [location, setLocation] = useLocation();

  const handleSelect = (label: (typeof ADD_OPTIONS)[number]["label"]) => {
    onOpenChange(false);
    switch (label) {
      case "Search Manually":
        setLocation("/card-search");
        break;
      case "Browse Sets":
        setLocation("/browse");
        break;
      case "Scan to Add":
        setLocation("/scan");
        break;
      case "View Trending Cards": {
        if (location !== "/") {
          setLocation("/");
        }
        // Wait for dialog close (and navigation, if any) before scrolling.
        setTimeout(() => {
          document
            .getElementById("trending-cards")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 200);
        break;
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-add-cards">
        <DialogHeader>
          <DialogTitle>Add Cards</DialogTitle>
          <DialogDescription>
            How would you like to build your vault?
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 mt-1">
          {ADD_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleSelect(opt.label)}
              data-testid={opt.testId}
              className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-accent px-3 py-3 min-h-[56px] text-left transition-colors"
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: `${opt.color}1f` }}
              >
                <opt.icon className="w-[18px] h-[18px]" style={{ color: opt.color }} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-foreground">{opt.label}</div>
                <div className="text-xs text-muted-foreground truncate">{opt.description}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
