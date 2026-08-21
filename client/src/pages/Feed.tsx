import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { avatarUrl } from "@/lib/collectorAvatars";
import { useSubscription } from "@/hooks/useSubscription";
import { useLocation, Link } from "wouter";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import type { CardWithSet, CollectionItem, WishlistItem } from "@shared/schema";
import noCardImagePlaceholder from "@assets/image_1784478496002.png";
import {
  Activity as ActivityIcon, Trophy, ArrowLeftRight, Sparkles,
  Award, BookOpen, Image as ImageIcon, Share2, Star, Crown, Loader2,
  ChevronDown, ChevronUp, ExternalLink, Layers, UserPlus, Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedUser {
  id: number;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  collectorAvatarKey: string | null;
  collectorLevel: number;
}

interface FeedEvent {
  id: number;
  eventType: string;
  title: string;
  metadata: Record<string, unknown> | null;
  relatedType?: string | null;
  relatedId?: number | null;
  previewImages?: string[] | null;
  image: string | null;
  createdAt: string;
  user: FeedUser;
  reactions: Record<string, number>;
  myReaction: string | null;
}

interface FeedResponse {
  events: FeedEvent[];
  nextCursor: string | null;
}

interface LeaderboardEntry {
  user: FeedUser;
  xp?: number;
  approved?: number;
}

interface LeaderboardsResponse {
  topXp: LeaderboardEntry[];
  topImageContributors: LeaderboardEntry[];
  allTimeTopXp: LeaderboardEntry[];
}

type FeedFilter = "everyone" | "following" | "friends" | "me";

interface FollowingResponse {
  viewerId: number;
  ids: number[];
}

interface DiscoverCollector {
  id: number;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  collectorAvatarKey: string | null;
  collectorFocus: string | null;
  collectorLevel: number;
}

const REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: "fire_pull", emoji: "🔥", label: "Fire Pull" },
  { key: "hero_move", emoji: "⚡", label: "Hero Move" },
  { key: "need_this", emoji: "👀", label: "Need This" },
  { key: "vault_worthy", emoji: "🏆", label: "Vault Worthy" },
];

// Per-event-type presentation: chip label, chip colors, icon.
const EVENT_STYLE: Record<string, {
  chip: string;
  chipClass: string;
  icon: JSX.Element;
}> = {
  first_card: {
    chip: "First Card",
    chipClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    icon: <Sparkles className="w-3.5 h-3.5" />,
  },
  collection_milestone: {
    chip: "Milestone",
    chipClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: <Star className="w-3.5 h-3.5" />,
  },
  binder_created: {
    chip: "New Binder",
    chipClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: <BookOpen className="w-3.5 h-3.5" />,
  },
  binder_shared: {
    chip: "Binder Shared",
    chipClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: <Share2 className="w-3.5 h-3.5" />,
  },
  badge_earned: {
    chip: "Badge Earned",
    chipClass: "bg-purple-500/10 text-purple-300 border-purple-500/25",
    icon: <Award className="w-3.5 h-3.5" />,
  },
  level_milestone: {
    chip: "Level Up",
    chipClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    icon: <Trophy className="w-3.5 h-3.5" />,
  },
  image_approved: {
    chip: "Image Added",
    chipClass: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    icon: <ImageIcon className="w-3.5 h-3.5" />,
  },
};

const DEFAULT_STYLE = {
  chip: "Activity",
  chipClass: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  icon: <Sparkles className="w-3.5 h-3.5" />,
};

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function displayName(u: FeedUser): string {
  // Usernames only in the feed — never real names (displayName is a fallback
  // for the rare account with no username).
  return u.username || u.displayName || "A collector";
}

function UserAvatar({ user, size = "w-10 h-10" }: { user: FeedUser; size?: string }) {
  const src = avatarUrl(user.collectorAvatarKey) ?? user.photoURL ?? undefined;
  return (
    <Avatar className={`${size} ring-2 ring-red-600/40`}>
      {src && <AvatarImage src={src} alt={displayName(user)} referrerPolicy="no-referrer" />}
      <AvatarFallback className="bg-zinc-800 text-zinc-200">{displayName(user).charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function LevelPill({ level }: { level: number }) {
  // Collector-status treatment: charcoal + gold, not an alert-red chip.
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-900 text-amber-300/90 border border-zinc-700">
      Lv {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event hero visual (large preview area — the focal point of each card)
// ---------------------------------------------------------------------------

const Halftone = ({ opacity = 0.14 }: { opacity?: number }) => (
  <div
    className="absolute inset-0 pointer-events-none"
    style={{ opacity, backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px)", backgroundSize: "8px 8px" }}
  />
);

// Presentation tiers: Hero (major achievements) vs Standard (normal events).
// Grouped repetitive events render as Compact rows in GroupedBadgeCard.
type EventTier = "hero" | "standard";

function eventTier(event: FeedEvent): EventTier {
  const md = (event.metadata as any) ?? {};
  if (event.eventType === "badge_earned") {
    // Only truly special badges get the hero treatment.
    return /top 10 collector/i.test(event.title) ? "hero" : "standard";
  }
  if (event.eventType === "collection_milestone") {
    return Number(md.milestone ?? 0) >= 250 ? "hero" : "standard";
  }
  if (event.eventType === "level_milestone") {
    const lv = Number(md.level ?? 0);
    return lv >= 10 && lv % 5 === 0 ? "hero" : "standard";
  }
  if (md.setName || md.subsetName) return "hero"; // set/subset completion
  return "standard";
}

function EventHero({ event }: { event: FeedEvent }) {
  const style = EVENT_STYLE[event.eventType] ?? DEFAULT_STYLE;
  const md = (event.metadata as any) ?? {};
  const tier = eventTier(event);
  const isTop10 = event.eventType === "badge_earned" && /top 10 collector/i.test(event.title);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const displayImage = event.image && event.image !== failedImageUrl ? event.image : null;

  // Top 10 Collector: major-achievement gold treatment
  if (isTop10) {
    return (
      <div className="relative h-36 sm:h-40 rounded-lg overflow-hidden border border-amber-500/40 bg-zinc-950 flex items-center justify-center gap-4 px-4">
        <Halftone opacity={0.08} />
        {displayImage && (
          <img src={displayImage} alt="Top 10 Collector badge" loading="lazy"
            onError={() => setFailedImageUrl(displayImage)}
            className="w-24 h-24 sm:w-28 sm:h-28 object-contain rounded-full drop-shadow-[0_0_20px_rgba(251,191,36,0.5)] relative" />
        )}
        <div className="relative">
          <p className="text-amber-300 font-black text-base sm:text-xl tracking-wide flex items-center gap-2">
            <Crown className="w-5 h-5 shrink-0" /> TOP 10 COLLECTOR
          </p>
          <p className="text-[11px] sm:text-xs text-amber-200/70 mt-0.5">Made the all-time Top 10 XP leaderboard</p>
        </div>
      </div>
    );
  }

  // Badge earned (normal): badge medallion on a layered dark panel.
  // Three rotating treatments for variety: "ring" (crisp red ring + top
  // glint), "halo" (soft red glow over a dotted band), and "gold"
  // (polished gold double ring with a gold accent line).
  if (event.eventType === "badge_earned") {
    const variant = (["ring", "halo", "gold"] as const)[event.id % 3];
    const gold = variant === "gold";
    const halo = variant === "halo";
    const badgeImg = displayImage ? (
      <div className="w-16 h-16 sm:w-[4.75rem] sm:h-[4.75rem] rounded-full overflow-hidden">
        <img src={displayImage} alt="Badge" loading="lazy"
          onError={() => setFailedImageUrl(displayImage)}
          className="w-full h-full object-cover scale-110" />
      </div>
    ) : (
      <Award className="w-10 h-10 text-white/85" />
    );
    return (
      <div className="relative h-32 sm:h-36 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center">
        <Halftone opacity={gold ? 0.12 : 0.05} />
        {/* layered band / accent line across the middle */}
        {gold ? (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-gradient-to-r from-amber-700/20 via-amber-400/80 to-amber-700/20" />
        ) : (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-16 sm:h-20 bg-zinc-900/70 border-y border-zinc-800/80">
            <Halftone opacity={0.1} />
          </div>
        )}
        {halo && <div className="absolute w-36 h-36 rounded-full bg-red-600/20 blur-2xl" />}
        {gold && <div className="absolute w-36 h-36 rounded-full bg-amber-500/10 blur-2xl" />}
        <div
          className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-zinc-950 flex items-center justify-center ${
            gold
              ? "border-[3px] border-amber-500 ring-2 ring-amber-800/70 ring-offset-2 ring-offset-zinc-950 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
              : halo
                ? "border border-red-400/70 shadow-[0_0_26px_rgba(220,38,38,0.4)]"
                : "border-2 border-red-600 ring-2 ring-zinc-800 ring-offset-2 ring-offset-zinc-950 shadow-[0_0_16px_rgba(220,38,38,0.3)]"
          }`}
        >
          {variant === "ring" && (
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-red-500 blur-[2px] shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
          )}
          {badgeImg}
        </div>
      </div>
    );
  }

  // Card image events (first card, image approved, etc.): card front on a blurred backdrop
  if (displayImage) {
    return (
      <div className={`relative ${tier === "hero" ? "h-40 sm:h-44" : "h-32 sm:h-36"} rounded-lg overflow-hidden border border-white/10 bg-zinc-950`}>
        <div className="absolute inset-0 bg-center bg-cover blur-xl opacity-40 scale-110" style={{ backgroundImage: `url(${displayImage})` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
        <img src={displayImage} alt="Card" loading="lazy"
          onError={() => setFailedImageUrl(displayImage)}
          className="relative h-full mx-auto py-2 object-contain drop-shadow-[0_8px_18px_rgba(0,0,0,0.65)]" />
      </div>
    );
  }

  // Card events remain identifiable and clickable even when the shared card
  // database does not have a usable image yet.
  if (event.relatedType === "card" && event.relatedId) {
    return (
      <div className="relative h-32 sm:h-36 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center">
        <Halftone opacity={0.05} />
        <img
          src={noCardImagePlaceholder}
          alt="Card image not yet available"
          className="relative h-full max-w-[55%] py-2 object-contain opacity-90"
        />
        <span className="absolute bottom-2 right-3 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
          View card details
        </span>
      </div>
    );
  }

  // Collection milestone: Hero for 250+ (gold accent), Standard (red/charcoal) below
  if (event.eventType === "collection_milestone") {
    const hero = tier === "hero";
    return (
      <div className={`relative ${hero ? "h-32 sm:h-36 border-amber-500/30" : "h-20 sm:h-24 border-zinc-800"} rounded-lg overflow-hidden border bg-zinc-950 flex items-center justify-center gap-3`}>
        <Halftone opacity={hero ? 0.08 : 0.05} />
        <Layers className={`${hero ? "w-8 h-8" : "w-6 h-6"} text-white/60 relative`} />
        <div className="relative text-center">
          <p className={`${hero ? "text-4xl sm:text-5xl text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.3)]" : "text-2xl sm:text-3xl text-white"} font-black drop-shadow`}>{String(md.milestone ?? "")}</p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Cards in the Vault</p>
        </div>
      </div>
    );
  }

  // Level up: Hero for big milestone levels (gold), Standard otherwise (red/charcoal)
  if (event.eventType === "level_milestone") {
    const hero = tier === "hero";
    return (
      <div className={`relative ${hero ? "h-32 sm:h-36 border-amber-500/30" : "h-20 sm:h-24 border-zinc-800"} rounded-lg overflow-hidden border bg-zinc-950 flex items-center justify-center`}>
        <Halftone opacity={hero ? 0.08 : 0.05} />
        <div className="relative text-center">
          <p className={`${hero ? "text-3xl sm:text-4xl text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.35)]" : "text-xl sm:text-2xl text-white"} font-black`}>
            LEVEL {String(md.level ?? "")}
          </p>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${hero ? "text-amber-200/60" : "text-white/50"} flex items-center justify-center gap-1`}>
            <Trophy className="w-3.5 h-3.5" /> Collector status rising
          </p>
        </div>
      </div>
    );
  }

  // Binder created/shared: styled binder card with the binder name
  if (event.eventType === "binder_created" || event.eventType === "binder_shared") {
    const binderName = md.binderName as string | undefined;
    const previews = (event.previewImages ?? []).slice(0, 3);
    return (
      <div className={`relative ${previews.length > 0 ? "h-32 sm:h-36" : "h-24 sm:h-28"} rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center gap-4 px-4`}>
        <Halftone opacity={0.06} />
        {previews.length > 0 ? (
          <div className="relative flex items-center">
            {previews.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="Card in binder"
                loading="lazy"
                className={`h-24 sm:h-28 rounded-md object-contain border border-zinc-700 bg-zinc-900 shadow-[0_6px_14px_rgba(0,0,0,0.6)] ${i > 0 ? "-ml-5" : ""}`}
                style={{ transform: `rotate(${(i - (previews.length - 1) / 2) * 6}deg)`, zIndex: i }}
              />
            ))}
          </div>
        ) : (
          <div className="relative w-12 h-16 rounded-r-md rounded-l-sm bg-zinc-900 border border-zinc-700 shadow-lg flex items-center justify-center">
            <div className="absolute left-1 top-1 bottom-1 w-1 rounded bg-red-600/70" />
            <BookOpen className="w-5 h-5 text-zinc-300" />
          </div>
        )}
        {binderName && (
          <p className="relative text-sm sm:text-base font-bold text-white/90 max-w-[50%] line-clamp-2">{binderName}</p>
        )}
      </div>
    );
  }

  // Set/subset completed or other events with a set name: completion stamp
  if (md.setName || md.subsetName) {
    return (
      <div className="relative h-32 sm:h-36 rounded-lg overflow-hidden border border-amber-500/30 bg-zinc-950 flex items-center justify-center gap-3 px-4">
        <Halftone opacity={0.08} />
        <div className="relative w-12 h-12 rounded-full border-2 border-amber-400/60 flex items-center justify-center rotate-[-8deg]">
          <Star className="w-6 h-6 text-amber-300" />
        </div>
        <div className="relative">
          <p className="text-sm sm:text-base font-black text-white/90 line-clamp-2">{String(md.subsetName ?? md.setName)}</p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300/80">Completed</p>
        </div>
      </div>
    );
  }

  // Generic fallback tile
  return (
    <div className="relative h-20 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 flex items-center justify-center">
      <Halftone opacity={0.05} />
      <span className="text-white/85 relative [&>svg]:w-8 [&>svg]:h-8">{style.icon}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed item detail popup (badge details / card details)
// ---------------------------------------------------------------------------

export interface FeedDetail {
  kind: "badge" | "card";
  event: FeedEvent;
}

function FeedDetailDialog({ detail, onClose }: { detail: FeedDetail | null; onClose: () => void }) {
  const event = detail?.event ?? null;

  // Badge details: enrich from the badges catalog (description, rarity).
  const { data: badges } = useQuery<any[]>({
    queryKey: ["/api/badges"],
    enabled: detail?.kind === "badge",
    staleTime: 5 * 60 * 1000,
  });
  const badge = detail?.kind === "badge" && event?.relatedId
    ? badges?.find((b) => b.id === event.relatedId)
    : undefined;

  // Card details: fetch the card the event refers to.
  const { data: rawCard, isLoading: cardIsLoading, isError: cardFailed } = useQuery<CardWithSet & { cardSet?: CardWithSet["set"] }>({
    queryKey: [`/api/cards/${event?.relatedId}`],
    enabled: detail?.kind === "card" && !!event?.relatedId,
    staleTime: 5 * 60 * 1000,
  });
  const card = rawCard
    ? ({ ...rawCard, set: rawCard.set ?? rawCard.cardSet } as CardWithSet)
    : null;

  const {
    data: collection,
    isLoading: collectionIsLoading,
    isError: collectionFailed,
  } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
    enabled: detail?.kind === "card",
  });
  const {
    data: wishlist,
    isLoading: wishlistIsLoading,
    isError: wishlistFailed,
  } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
    enabled: detail?.kind === "card",
  });
  const collectionItem = card
    ? collection?.find(item => (item.cardId ?? item.card?.id) === card.id)
    : undefined;
  const wishlistItem = card
    ? wishlist?.find(item => (item.cardId ?? item.card?.id) === card.id)
    : undefined;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const ownershipActions = useRef(new Set<string>());

  const refreshOwnership = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
  };
  const beginOwnershipAction = (key: string): boolean => {
    if (ownershipActions.current.has(key)) return false;
    ownershipActions.current.add(key);
    return true;
  };
  const endOwnershipAction = (key: string) => {
    ownershipActions.current.delete(key);
  };

  const addToCollection = useMutation({
    mutationFn: async (cardId: number) =>
      (await apiRequest("POST", "/api/collection", { cardId, incrementExisting: false })).json(),
    onSuccess: (item: CollectionItem) => {
      queryClient.setQueryData<CollectionItem[]>(["/api/collection"], (current = []) => {
        const withoutCard = current.filter(entry => (entry.cardId ?? entry.card?.id) !== item.cardId);
        return [...withoutCard, { ...item, card: card! }];
      });
      refreshOwnership();
      toast({ title: "Card added to collection" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add card", description: error.message, variant: "destructive" });
    },
    onSettled: (_data, _error, cardId) => endOwnershipAction(`collection:add:${cardId}`),
  });
  const removeFromCollection = useMutation({
    mutationFn: (itemId: number) => apiRequest("DELETE", `/api/collection/${itemId}`),
    onSuccess: () => {
      queryClient.setQueryData<CollectionItem[]>(["/api/collection"], (current = []) =>
        current.filter(entry => entry.id !== collectionItem?.id),
      );
      refreshOwnership();
      toast({ title: "Card removed from collection" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove card", description: error.message, variant: "destructive" });
    },
    onSettled: (_data, _error, itemId) => endOwnershipAction(`collection:remove:${itemId}`),
  });
  const addToWishlist = useMutation({
    mutationFn: async (cardId: number) =>
      (await apiRequest("POST", "/api/wishlist", { cardId, priority: 1 })).json(),
    onSuccess: (item: WishlistItem) => {
      queryClient.setQueryData<WishlistItem[]>(["/api/wishlist"], (current = []) => {
        const withoutCard = current.filter(entry => (entry.cardId ?? entry.card?.id) !== item.cardId);
        return [...withoutCard, { ...item, card: card! }];
      });
      refreshOwnership();
      toast({ title: "Card added to wishlist" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add card to wishlist", description: error.message, variant: "destructive" });
    },
    onSettled: (_data, _error, cardId) => endOwnershipAction(`wishlist:add:${cardId}`),
  });
  const removeFromWishlist = useMutation({
    mutationFn: (itemId: number) => apiRequest("DELETE", `/api/wishlist/${itemId}`),
    onSuccess: () => {
      queryClient.setQueryData<WishlistItem[]>(["/api/wishlist"], (current = []) =>
        current.filter(entry => entry.id !== wishlistItem?.id),
      );
      refreshOwnership();
      toast({ title: "Card removed from wishlist" });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove card from wishlist", description: error.message, variant: "destructive" });
    },
    onSettled: (_data, _error, itemId) => endOwnershipAction(`wishlist:remove:${itemId}`),
  });

  if (!detail || !event) return null;
  const md = (event.metadata as any) ?? {};

  if (detail.kind === "card") {
    if (cardIsLoading || collectionIsLoading || wishlistIsLoading) {
      return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-lg bg-zinc-900 border-zinc-700 text-zinc-100">
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-300">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading card details…
            </div>
          </DialogContent>
        </Dialog>
      );
    }
    if (cardFailed || collectionFailed || wishlistFailed || !card) {
      return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-lg bg-zinc-900 border-zinc-700 text-zinc-100">
            <DialogHeader><DialogTitle>Card unavailable</DialogTitle></DialogHeader>
            <p className="text-sm text-zinc-400">This card could not be loaded. It may have been retired or merged.</p>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <CardDetailModal
        card={card}
        isOpen
        onClose={onClose}
        isInCollection={!!collectionItem}
        isInWishlist={!!wishlistItem}
        collectionItemId={collectionItem?.id}
        collectionQuantity={collectionItem?.quantity}
        onAddToCollection={() => {
          const key = `collection:add:${card.id}`;
          if (beginOwnershipAction(key)) addToCollection.mutate(card.id);
        }}
        onRemoveFromCollection={collectionItem ? () => {
          const key = `collection:remove:${collectionItem.id}`;
          if (beginOwnershipAction(key)) removeFromCollection.mutate(collectionItem.id);
        } : undefined}
        onAddToWishlist={() => {
          const key = `wishlist:add:${card.id}`;
          if (beginOwnershipAction(key)) addToWishlist.mutate(card.id);
        }}
        onRemoveFromWishlist={wishlistItem ? () => {
          const key = `wishlist:remove:${wishlistItem.id}`;
          if (beginOwnershipAction(key)) removeFromWishlist.mutate(wishlistItem.id);
        } : undefined}
        onCardUpdate={(updatedCard) => {
          queryClient.setQueryData([`/api/cards/${card.id}`], updatedCard);
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-lg bg-zinc-900 border-zinc-700 text-zinc-100">
        <>
            <DialogHeader>
              <DialogTitle className="text-zinc-100">{badge?.name ?? md.badgeName ?? "Badge earned"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-2">
              {(badge?.iconUrl || event.image) ? (
                <div className="w-28 h-28 rounded-full bg-zinc-950 border-2 border-red-600/60 shadow-[0_0_24px_rgba(220,38,38,0.3)] flex items-center justify-center overflow-hidden">
                  <img src={badge?.iconUrl ?? event.image!} alt="Badge" className="w-full h-full object-cover scale-110" />
                </div>
              ) : (
                <Award className="w-16 h-16 text-red-400" />
              )}
              {badge?.rarity && (
                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-amber-500/40 text-amber-300 bg-amber-500/10">
                  {badge.rarity}{badge.category ? ` · ${badge.category}` : ""}
                </span>
              )}
              {badge?.description && (
                <p className="text-sm text-zinc-300 text-center">{badge.description}</p>
              )}
              <p className="text-xs text-zinc-500 text-center">
                Earned by <span className="font-semibold text-zinc-300">{displayName(event.user)}</span> · {timeAgo(event.createdAt)}
              </p>
              {event.user.username && (
                <Link
                  href={`/collectors/${event.user.username}`}
                  onClick={onClose}
                  className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1"
                  data-testid="link-detail-profile"
                >
                  View {displayName(event.user)}'s profile <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
        </>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reactions row
// ---------------------------------------------------------------------------

function ReactionRow({ event, pending, onReact }: {
  event: FeedEvent;
  pending: boolean;
  onReact: (eventId: number, reaction: string, remove: boolean) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {REACTIONS.map((r) => {
        const count = event.reactions[r.key] ?? 0;
        const active = event.myReaction === r.key;
        return (
          <button
            key={r.key}
            title={r.label}
            data-testid={`reaction-${r.key}-${event.id}`}
            disabled={pending}
            onClick={() => onReact(event.id, r.key, active)}
            className={`text-xs rounded-full border px-2.5 py-1 transition-all ${
              active
                ? "bg-red-600/20 border-red-500/60 text-red-300 font-semibold shadow-[0_0_10px_rgba(220,38,38,0.25)]"
                : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800 text-zinc-400"
            }`}
          >
            {r.emoji}{count > 0 ? ` ${count}` : ""}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single event card
// ---------------------------------------------------------------------------

function FollowInlineButton({ user, followState }: { user: FeedUser; followState: FollowState | null }) {
  if (!followState || !user.username) return null;
  if (user.id === followState.viewerId || followState.ids.includes(user.id)) return null;
  return (
    <button
      onClick={() => followState.follow(user.username!)}
      disabled={followState.pendingUsername === user.username}
      data-testid={`button-follow-${user.id}`}
      className="text-[11px] font-bold rounded-full bg-zinc-100 text-red-700 hover:bg-white px-2.5 py-0.5 inline-flex items-center gap-1 transition-colors shadow-sm disabled:opacity-60"
    >
      <UserPlus className="w-3 h-3" /> Follow
    </button>
  );
}

interface FollowState {
  viewerId: number;
  ids: number[];
  pendingUsername: string | null;
  follow: (username: string) => void;
}

function EventCard({ event, pending, onReact, followState, onOpenDetail }: {
  event: FeedEvent;
  pending: boolean;
  onReact: (eventId: number, reaction: string, remove: boolean) => void;
  followState: FollowState | null;
  onOpenDetail?: (detail: FeedDetail) => void;
}) {
  const style = EVENT_STYLE[event.eventType] ?? DEFAULT_STYLE;
  const shareToken = event.eventType === "binder_shared" ? (event.metadata as any)?.shareToken as string | undefined : undefined;
  // binder_created events link to the in-app binder view (server enforces
  // the owner's collection privacy at read time).
  const binderHref = !shareToken && event.eventType === "binder_created" && event.relatedType === "binder" && event.relatedId && event.user.username
    ? `/collectors/${event.user.username}/binders/${event.relatedId}`
    : null;
  const profileHref = event.user.username ? `/collectors/${event.user.username}` : null;

  // Where does clicking the hero/title take you? Badge → badge popup,
  // card-related → card popup, binder → the binder, otherwise → profile.
  const [, navigate] = useLocation();
  const heroAction: (() => void) | null = onOpenDetail
    ? event.eventType === "badge_earned"
      ? () => onOpenDetail({ kind: "badge", event })
      : event.relatedType === "card" && event.relatedId
        ? () => onOpenDetail({ kind: "card", event })
        : shareToken
          ? () => navigate(`/pc-share/${shareToken}`)
          : binderHref
            ? () => navigate(binderHref)
            : profileHref
              ? () => navigate(profileHref)
              : null
    : null;

  return (
    <div
      data-testid={`feed-event-${event.id}`}
      className="rounded-xl bg-zinc-900 border border-zinc-800 hover:border-red-900/60 transition-colors shadow-lg shadow-black/20 overflow-hidden"
    >
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          {profileHref ? (
            <Link href={profileHref} data-testid={`link-feed-avatar-${event.id}`}>
              <UserAvatar user={event.user} size="w-9 h-9" />
            </Link>
          ) : (
            <UserAvatar user={event.user} size="w-9 h-9" />
          )}
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            {profileHref ? (
              <Link href={profileHref} className="font-semibold text-sm text-zinc-100 truncate hover:text-red-400 transition-colors">
                {displayName(event.user)}
              </Link>
            ) : (
              <span className="font-semibold text-sm text-zinc-100 truncate">{displayName(event.user)}</span>
            )}
            <LevelPill level={event.user.collectorLevel} />
            <FollowInlineButton user={event.user} followState={followState} />
            <span className="text-xs text-zinc-500">{timeAgo(event.createdAt)}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${style.chipClass}`}>
            {style.icon}{style.chip}
          </span>
        </div>

        <div
          className={`mt-3 ${heroAction ? "cursor-pointer" : ""}`}
          onClick={heroAction ?? undefined}
          data-testid={`feed-event-hero-${event.id}`}
        >
          <EventHero event={event} />
        </div>

        <p
          className={`text-sm text-zinc-200 leading-snug mt-3 ${heroAction ? "cursor-pointer" : ""}`}
          onClick={heroAction ?? undefined}
        >
          <span className="font-semibold">{displayName(event.user)}</span> {event.title}
        </p>

        <div className="flex items-center justify-between gap-2 flex-wrap mt-2.5">
          <ReactionRow event={event} pending={pending} onReact={onReact} />
          <div className="flex gap-3">
            {shareToken && (
              <Link href={`/pc-share/${shareToken}`} className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
                View Binder <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {binderHref && (
              <Link href={binderHref} className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                View Binder <ExternalLink className="w-3 h-3" />
              </Link>
            )}
            {event.relatedType === "card" && event.relatedId && heroAction && (
              <button
                type="button"
                onClick={heroAction}
                className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1"
                data-testid={`button-view-card-${event.id}`}
              >
                View Card <ExternalLink className="w-3 h-3" />
              </button>
            )}
            {event.user.username && (
              <Link href={`/collectors/${event.user.username}`} className="text-xs text-zinc-500 hover:text-red-400 inline-flex items-center gap-1">
                View Profile <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped badge card (noise control: N consecutive badges from same user/day)
// ---------------------------------------------------------------------------

interface EventGroup {
  key: string;
  events: FeedEvent[]; // >1 means grouped
}

function groupEvents(events: FeedEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let run: FeedEvent[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= 2) {
      groups.push({ key: `g-${run[0].id}`, events: run });
    } else {
      for (const e of run) groups.push({ key: `e-${e.id}`, events: [e] });
    }
    run = [];
  };
  for (const e of events) {
    const prev = run[run.length - 1];
    const sameRun =
      prev &&
      e.eventType === "badge_earned" &&
      prev.eventType === "badge_earned" &&
      prev.user.id === e.user.id &&
      new Date(prev.createdAt).toDateString() === new Date(e.createdAt).toDateString();
    if (e.eventType === "badge_earned" && (run.length === 0 || sameRun)) {
      run.push(e);
    } else {
      flush();
      if (e.eventType === "badge_earned") run.push(e);
      else groups.push({ key: `e-${e.id}`, events: [e] });
    }
  }
  flush();
  return groups;
}

// Variety pass for the Everyone feed: avoid more than 2 same-type cards
// back-to-back by pulling the next different-type card forward. Purely a
// display-order tweak within the loaded window — no events are dropped.
function diversifyGroups(groups: EventGroup[]): EventGroup[] {
  const out = [...groups];
  const typeOf = (g: EventGroup) => g.events[0].eventType;
  for (let i = 2; i < out.length; i++) {
    if (typeOf(out[i]) === typeOf(out[i - 1]) && typeOf(out[i]) === typeOf(out[i - 2])) {
      let j = i + 1;
      while (j < out.length && typeOf(out[j]) === typeOf(out[i])) j++;
      if (j < out.length) {
        const [g] = out.splice(j, 1);
        out.splice(i, 0, g);
      }
    }
  }
  return out;
}

function GroupedBadgeCard({ group, pending, onReact, followState, onOpenDetail }: {
  group: EventGroup;
  pending: boolean;
  onReact: (eventId: number, reaction: string, remove: boolean) => void;
  followState: FollowState | null;
  onOpenDetail?: (detail: FeedDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const first = group.events[0];
  const icons = group.events.filter(e => e.image).slice(0, 4);
  const profileHref = first.user.username ? `/collectors/${first.user.username}` : null;

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 hover:border-red-900/60 transition-colors shadow-lg shadow-black/20 overflow-hidden" data-testid={`feed-group-${first.id}`}>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          {profileHref ? (
            <Link href={profileHref}><UserAvatar user={first.user} size="w-9 h-9" /></Link>
          ) : (
            <UserAvatar user={first.user} size="w-9 h-9" />
          )}
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            {profileHref ? (
              <Link href={profileHref} className="font-semibold text-sm text-zinc-100 truncate hover:text-red-400 transition-colors">
                {displayName(first.user)}
              </Link>
            ) : (
              <span className="font-semibold text-sm text-zinc-100 truncate">{displayName(first.user)}</span>
            )}
            <LevelPill level={first.user.collectorLevel} />
            <FollowInlineButton user={first.user} followState={followState} />
            <span className="text-xs text-zinc-500">{timeAgo(first.createdAt)}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${EVENT_STYLE.badge_earned.chipClass}`}>
            <Award className="w-3.5 h-3.5" />{group.events.length} Badges
          </span>
        </div>

        {/* Compact strip: small badge icon cluster — grouped events stay low-key */}
        <div className="flex items-center gap-3 mt-3">
          <div className="flex -space-x-2.5 shrink-0">
            {icons.length > 0 ? icons.map((e) => (
              <div key={e.id} className="w-10 h-10 rounded-full bg-zinc-950/80 border border-zinc-700 flex items-center justify-center ring-2 ring-zinc-900">
                <img src={e.image!} alt="Badge" className="w-7 h-7 object-contain rounded-full" loading="lazy" />
              </div>
            )) : (
              <div className="w-10 h-10 rounded-full bg-zinc-950/80 border border-zinc-700 flex items-center justify-center">
                <Award className="w-5 h-5 text-white/85" />
              </div>
            )}
            {group.events.length > icons.length && icons.length > 0 && (
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center ring-2 ring-zinc-900 text-xs font-black text-zinc-300">
                +{group.events.length - icons.length}
              </div>
            )}
          </div>
          <p className="text-sm text-zinc-200 flex-1 min-w-0">
            <span className="font-semibold">{displayName(first.user)}</span> earned {group.events.length} badges
          </p>
          <button
            onClick={() => setExpanded(v => !v)}
            data-testid={`button-expand-group-${first.id}`}
            className="text-xs text-zinc-400 hover:text-red-400 inline-flex items-center gap-1 shrink-0"
          >
            {expanded ? <>Hide <ChevronUp className="w-3.5 h-3.5" /></> : <>Show all <ChevronDown className="w-3.5 h-3.5" /></>}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
            {group.events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 flex-wrap">
                <div
                  className={`w-9 h-9 rounded-full bg-zinc-950 border border-zinc-700 flex items-center justify-center shrink-0 ${onOpenDetail ? "cursor-pointer" : ""}`}
                  onClick={onOpenDetail ? () => onOpenDetail({ kind: "badge", event: e }) : undefined}
                >
                  {e.image ? <img src={e.image} alt="Badge" className="w-7 h-7 object-contain" loading="lazy" /> : <Award className="w-4 h-4 text-white/90" />}
                </div>
                <span
                  className={`text-sm text-zinc-300 flex-1 min-w-0 ${onOpenDetail ? "cursor-pointer hover:text-zinc-100" : ""}`}
                  onClick={onOpenDetail ? () => onOpenDetail({ kind: "badge", event: e }) : undefined}
                >
                  {e.title}
                </span>
                <ReactionRow event={e} pending={pending} onReact={onReact} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityTab() {
  const [filter, setFilter] = useState<FeedFilter>("everyone");
  const [extraEvents, setExtraEvents] = useState<FeedEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingFollowUsername, setPendingFollowUsername] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedDetail | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["/api/feed", filter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/feed?filter=${filter}`);
      return res.json();
    },
  });

  const { data: followingData } = useQuery<FollowingResponse>({
    queryKey: ["/api/feed/following"],
    queryFn: async () => (await apiRequest("GET", "/api/feed/following")).json(),
  });

  const followMutation = useMutation({
    mutationFn: async (username: string) => {
      setPendingFollowUsername(username);
      return (await apiRequest("POST", `/api/collectors/${username}/follow`)).json();
    },
    onSuccess: (_data, username) => {
      toast({ title: `Following @${username}`, description: "Their activity will show in your Following feed." });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/following"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/discover"] });
      if (filter === "following" || filter === "friends") {
        queryClient.invalidateQueries({ queryKey: ["/api/feed", filter] });
      }
    },
    onError: (err: any) => {
      toast({ title: "Could not follow", description: String(err?.message || err), variant: "destructive" });
    },
    onSettled: () => setPendingFollowUsername(null),
  });

  const followState: FollowState | null = followingData
    ? {
        viewerId: followingData.viewerId,
        ids: followingData.ids,
        pendingUsername: pendingFollowUsername,
        follow: (username) => followMutation.mutate(username),
      }
    : null;

  const events = [...(data?.events ?? []), ...extraEvents];
  const nextCursor = cursor ?? data?.nextCursor ?? null;
  const groups = useMemo(() => {
    const g = groupEvents(events);
    // "Me" keeps strict history order; Everyone (and other filters) prioritize variety.
    return filter === "me" ? g : diversifyGroups(g);
  }, [events, filter]);

  // Pagination session: bumped on every filter change so an in-flight page
  // request from a previous filter can never append into the new one.
  const pageSessionRef = useRef(0);

  const changeFilter = (f: FeedFilter) => {
    pageSessionRef.current++;
    setFilter(f);
    setExtraEvents([]);
    setCursor(null);
    setLoadingMore(false);
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const session = pageSessionRef.current;
    setLoadingMore(true);
    try {
      const res = await apiRequest("GET", `/api/feed?filter=${filter}&before=${encodeURIComponent(nextCursor)}`);
      const page: FeedResponse = await res.json();
      if (session !== pageSessionRef.current) return; // filter changed mid-flight
      setExtraEvents(prev => [...prev, ...page.events]);
      setCursor(page.nextCursor ?? "");
      if (!page.nextCursor) setCursor("");
    } catch {
      if (session === pageSessionRef.current) {
        toast({ title: "Could not load more", variant: "destructive" });
      }
    } finally {
      if (session === pageSessionRef.current) setLoadingMore(false);
    }
  };

  // Infinite scroll: when the sentinel at the bottom of the list becomes
  // visible, load the next page automatically (replaces the Load More button).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, isLoading, events.length]);

  // Pull-to-refresh (touch devices): dragging down while already at the top
  // of the page re-fetches the feed and resets pagination.
  const [refreshing, setRefreshing] = useState(false);
  const [pullPx, setPullPx] = useState(0);
  const touchStartYRef = useRef<number | null>(null);
  const PULL_TRIGGER_PX = 56;

  const refreshFeed = async () => {
    if (refreshing) return;
    setRefreshing(true);
    pageSessionRef.current++; // cancel any in-flight loadMore append
    setExtraEvents([]);
    setCursor(null);
    setLoadingMore(false);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/feed", filter] }),
        queryClient.refetchQueries({ queryKey: ["/api/feed/following"] }),
      ]);
    } finally {
      setRefreshing(false);
      setPullPx(0);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null || refreshing) return;
    const dy = e.touches[0].clientY - touchStartYRef.current;
    if (dy > 0 && window.scrollY <= 0) {
      // Dampen the drag so the indicator feels elastic.
      setPullPx(Math.min(dy * 0.4, 80));
    } else {
      setPullPx(0);
    }
  };
  const onTouchEnd = () => {
    if (pullPx >= PULL_TRIGGER_PX && !refreshing) {
      refreshFeed();
    } else {
      setPullPx(0);
    }
    touchStartYRef.current = null;
  };

  const reactMutation = useMutation({
    mutationFn: async ({ eventId, reaction, remove }: { eventId: number; reaction: string; remove: boolean }) => {
      const res = remove
        ? await apiRequest("DELETE", `/api/feed/${eventId}/react`)
        : await apiRequest("POST", `/api/feed/${eventId}/react`, { reaction });
      return { eventId, ...(await res.json()) };
    },
    onSuccess: (result) => {
      const patch = (e: FeedEvent) =>
        e.id === result.eventId ? { ...e, reactions: result.reactions, myReaction: result.myReaction } : e;
      queryClient.setQueryData<FeedResponse>(["/api/feed", filter], (old) =>
        old ? { ...old, events: old.events.map(patch) } : old,
      );
      setExtraEvents(prev => prev.map(patch));
      if (result.xpAwarded > 0) {
        toast({ title: `+${result.xpAwarded} XP`, description: "Thanks for cheering on a fellow collector!" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Reaction failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  const onReact = (eventId: number, reaction: string, remove: boolean) =>
    reactMutation.mutate({ eventId, reaction, remove });

  return (
    <div
      className="space-y-4"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {(pullPx > 0 || refreshing) && (
        <div
          className="flex justify-center items-center overflow-hidden transition-[height] duration-150"
          style={{ height: refreshing ? 40 : pullPx }}
          data-testid="feed-pull-refresh"
        >
          <Loader2
            className={`w-5 h-5 text-zinc-400 ${refreshing ? "animate-spin" : ""}`}
            style={!refreshing ? { transform: `rotate(${pullPx * 3}deg)`, opacity: Math.min(pullPx / PULL_TRIGGER_PX, 1) } : undefined}
          />
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {(["everyone", "following", "friends", "me"] as FeedFilter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => changeFilter(f)}
            data-testid={`button-filter-${f}`}
          >
            {f === "everyone" ? "Everyone" : f === "following" ? "Following" : f === "friends" ? "Friends" : "Me"}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 py-12 text-center text-zinc-400">
          <ActivityIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-zinc-300">
            {filter === "following" ? "Nothing here yet" : filter === "friends" ? "No friends yet" : "No activity yet"}
          </p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            {filter === "me"
              ? "Add cards, earn badges, and build binders to see your milestones here."
              : filter === "following"
                ? "Follow collectors to personalize your Feed."
                : filter === "friends"
                  ? "Friends are mutual follows. Follow collectors you know, and when they follow back, they'll show up here."
                  : "Collector milestones will show up here as the community builds their vaults."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) =>
            g.events.length > 1 ? (
              <GroupedBadgeCard key={g.key} group={g} pending={reactMutation.isPending} onReact={onReact} followState={followState} onOpenDetail={setDetail} />
            ) : (
              <EventCard key={g.key} event={g.events[0]} pending={reactMutation.isPending} onReact={onReact} followState={followState} onOpenDetail={setDetail} />
            ),
          )}
          {nextCursor && nextCursor !== "" && (
            <div ref={sentinelRef} className="flex justify-center py-4" data-testid="feed-infinite-sentinel">
              {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>
          )}
        </div>
      )}
      <FeedDetailDialog detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Find Collectors (discovery)
// ---------------------------------------------------------------------------

const DISCOVER_COLLAPSED_KEY = "mcv-feed-discover-collapsed";

function DiscoverCollectorsPanel() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(DISCOVER_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingFollowUsername, setPendingFollowUsername] = useState<string | null>(null);

  const { data: followingData } = useQuery<FollowingResponse>({
    queryKey: ["/api/feed/following"],
    queryFn: async () => (await apiRequest("GET", "/api/feed/following")).json(),
  });

  const followMutation = useMutation({
    mutationFn: async (username: string) => {
      setPendingFollowUsername(username);
      return (await apiRequest("POST", `/api/collectors/${username}/follow`)).json();
    },
    onSuccess: (_data, username) => {
      toast({ title: `Following @${username}`, description: "Their activity will show in your Following feed." });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/following"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/discover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not follow", description: String(err?.message || err), variant: "destructive" });
    },
    onSettled: () => setPendingFollowUsername(null),
  });

  const followState: FollowState | null = followingData
    ? {
        viewerId: followingData.viewerId,
        ids: followingData.ids,
        pendingUsername: pendingFollowUsername,
        follow: (username) => followMutation.mutate(username),
      }
    : null;
  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(DISCOVER_COLLAPSED_KEY, v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };
  const { data } = useQuery<{ collectors: DiscoverCollector[] }>({
    queryKey: ["/api/feed/discover"],
    queryFn: async () => (await apiRequest("GET", "/api/feed/discover")).json(),
  });
  const collectors = (data?.collectors ?? []).slice(0, 6);
  if (collectors.length === 0) return null;

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden" data-testid="panel-discover">
      <button
        onClick={toggle}
        data-testid="button-toggle-discover"
        className="w-full px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between text-left"
      >
        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-red-400" /> New to the Vault — Collectors to Follow
        </h3>
        <span className="text-zinc-500">{collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}</span>
      </button>
      {!collapsed && (
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {collectors.map((c) => (
            <div key={c.id} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-3 flex flex-col items-center text-center gap-1.5 min-w-0">
              <UserAvatar user={{ ...c, collectorLevel: c.collectorLevel }} size="w-12 h-12" />
              {c.username ? (
                <Link href={`/collectors/${c.username}`} className="text-xs font-semibold text-zinc-200 truncate w-full hover:text-red-400">
                  {c.username}
                </Link>
              ) : (
                <span className="text-xs font-semibold text-zinc-200 truncate w-full">{displayName(c as FeedUser)}</span>
              )}
              <LevelPill level={c.collectorLevel} />
              {c.collectorFocus && <p className="text-[10px] text-zinc-500 line-clamp-2 leading-tight">{c.collectorFocus}</p>}
              {c.username && followState && (
                <button
                  onClick={() => followState.follow(c.username!)}
                  disabled={followState.pendingUsername === c.username}
                  data-testid={`button-discover-follow-${c.id}`}
                  className="mt-auto text-[11px] font-bold rounded-full bg-zinc-100 text-red-700 hover:bg-white px-3 py-1 inline-flex items-center gap-1 transition-colors shadow-sm disabled:opacity-60"
                >
                  <UserPlus className="w-3 h-3" /> Follow
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboards tab
// ---------------------------------------------------------------------------

const RANK_CLASSES = [
  "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  "bg-zinc-400/20 text-zinc-300 border-zinc-400/40",
  "bg-amber-700/20 text-amber-500 border-amber-700/40",
];

function LeaderboardList({ title, icon, entries, valueKey, valueLabel, followState }: {
  title: string;
  icon: JSX.Element;
  entries: LeaderboardEntry[];
  valueKey: "xp" | "approved";
  valueLabel: string;
  followState?: FollowState | null;
}) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 border-l-2 border-l-red-600">
        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">{icon}{title}</h3>
      </div>
      <div className="p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4 text-center">No entries yet this week. Be the first!</p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e, i) => (
              <div
                key={e.user.id}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${i < 3 ? "bg-zinc-800/60" : ""}`}
                data-testid={`leaderboard-row-${valueKey}-${i}`}
              >
                <span className={`w-7 h-7 shrink-0 rounded-full border text-xs font-black flex items-center justify-center ${RANK_CLASSES[i] ?? "border-zinc-700 text-zinc-500"}`}>
                  {i + 1}
                </span>
                {e.user.username ? (
                  <Link href={`/collectors/${e.user.username}`} data-testid={`link-leaderboard-avatar-${e.user.id}`}>
                    <UserAvatar user={e.user} size="w-8 h-8" />
                  </Link>
                ) : (
                  <UserAvatar user={e.user} size="w-8 h-8" />
                )}
                <div className="flex-1 min-w-0">
                  {e.user.username ? (
                    <Link href={`/collectors/${e.user.username}`} className="block text-sm font-medium text-zinc-200 truncate hover:text-red-400 transition-colors">
                      {displayName(e.user)}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-zinc-200 truncate">{displayName(e.user)}</p>
                  )}
                  <p className="text-xs text-zinc-500">Level {e.user.collectorLevel}</p>
                </div>
                <FollowInlineButton user={e.user} followState={followState ?? null} />
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-zinc-900 text-zinc-200 border border-zinc-700 shrink-0">
                  {e[valueKey] ?? 0} {valueLabel}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderboardsTab() {
  const { data, isLoading } = useQuery<LeaderboardsResponse>({
    queryKey: ["/api/feed/leaderboards"],
  });

  // Follow state so leaderboard rows can offer a Follow button, mirroring the
  // pattern used by the main feed tab.
  const [pendingFollowUsername, setPendingFollowUsername] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: followingData } = useQuery<FollowingResponse>({
    queryKey: ["/api/feed/following"],
    queryFn: async () => (await apiRequest("GET", "/api/feed/following")).json(),
  });
  const followMutation = useMutation({
    mutationFn: async (username: string) => {
      setPendingFollowUsername(username);
      return (await apiRequest("POST", `/api/collectors/${username}/follow`)).json();
    },
    onSuccess: (_data, username) => {
      toast({ title: `Following @${username}`, description: "Their activity will show in your Following feed." });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/following"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feed/discover"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not follow", description: String(err?.message || err), variant: "destructive" });
    },
    onSettled: () => setPendingFollowUsername(null),
  });
  const followState: FollowState | null = followingData
    ? {
        viewerId: followingData.viewerId,
        ids: followingData.ids,
        pendingUsername: pendingFollowUsername,
        follow: (username) => followMutation.mutate(username),
      }
    : null;

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-zinc-800">Weekly rankings reset every Monday. Earn XP by adding cards, earning badges, contributing images, and cheering on other collectors.</p>
      <LeaderboardList
        title="Top 10 Collectors — All-Time XP"
        icon={<Crown className="w-4 h-4 text-yellow-500" />}
        entries={data?.allTimeTopXp ?? []}
        valueKey="xp"
        valueLabel="XP"
        followState={followState}
      />
      <p className="text-xs text-zinc-500 -mt-2">Collectors who make the all-time Top 10 earn the exclusive Top 10 Collector badge.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <LeaderboardList
          title="Top XP This Week"
          icon={<Trophy className="w-4 h-4 text-yellow-500" />}
          entries={data?.topXp ?? []}
          valueKey="xp"
          valueLabel="XP"
          followState={followState}
        />
        <LeaderboardList
          title="Top Image Contributors"
          icon={<ImageIcon className="w-4 h-4 text-cyan-500" />}
          entries={data?.topImageContributors ?? []}
          valueKey="approved"
          valueLabel="images"
          followState={followState}
        />
      </div>
      <div className="rounded-xl border border-dashed border-zinc-700 py-6 text-center text-zinc-500 text-sm">
        <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
        Set Builders leaderboard is coming soon.
      </div>
      <DiscoverCollectorsPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade Feed tab (coming soon)
// ---------------------------------------------------------------------------

function TradeFeedTab() {
  const { isPremium } = useSubscription();
  const [, setLocation] = useLocation();

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden relative">
      <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(45deg, #dc2626 0, #dc2626 1px, transparent 1px, transparent 12px)" }} />
      <div className="py-16 px-6 text-center relative">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-600/25 to-red-900/40 border border-red-600/30 flex items-center justify-center">
          <ArrowLeftRight className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-bold text-zinc-100">Trade Feed is coming soon</h3>
        <p className="text-sm text-zinc-400 mt-2 max-w-md mx-auto">
          Soon you will be able to show off spare copies you are open to trading and see what other collectors are offering. No selling, no fees, just collector-to-collector trades.
        </p>
        {!isPremium && (
          <Button className="mt-6" onClick={() => setLocation("/subscribe")} data-testid="button-explore-super-hero">
            <Crown className="w-4 h-4 mr-2" />
            Explore Super Hero
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Feed() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      {/* MCV-native header: dark charcoal, subtle halftone, thin red accent — no gradient wash */}
      <div className="mb-6 rounded-xl bg-zinc-950 border border-zinc-800 border-t-2 border-t-red-600 px-5 py-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "10px 10px" }} />
        <h1 className="text-2xl font-black text-white flex items-center gap-2 relative" data-testid="text-feed-title">
          <ActivityIcon className="w-6 h-6 text-red-500" />
          Feed
        </h1>
        <p className="text-sm text-zinc-400 mt-1 relative">Milestones, leaderboards, and community activity from the Vault.</p>
      </div>
      <Tabs defaultValue="activity">
        <TabsList className="mb-4">
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="leaderboards" data-testid="tab-leaderboards">Leaderboards</TabsTrigger>
          <TabsTrigger value="trade" data-testid="tab-trade">Trade Feed</TabsTrigger>
        </TabsList>
        <TabsContent value="activity"><ActivityTab /></TabsContent>
        <TabsContent value="leaderboards"><LeaderboardsTab /></TabsContent>
        <TabsContent value="trade"><TradeFeedTab /></TabsContent>
      </Tabs>
    </div>
  );
}
