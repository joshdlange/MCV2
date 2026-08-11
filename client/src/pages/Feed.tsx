import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { avatarUrl } from "@/lib/collectorAvatars";
import { useSubscription } from "@/hooks/useSubscription";
import { useLocation, Link } from "wouter";
import {
  Activity as ActivityIcon, Trophy, ArrowLeftRight, Sparkles,
  Award, BookOpen, Image as ImageIcon, Share2, Star, Crown, Loader2,
  ChevronDown, ChevronUp, ExternalLink, Layers,
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
}

const REACTIONS: { key: string; emoji: string; label: string }[] = [
  { key: "fire_pull", emoji: "🔥", label: "Fire Pull" },
  { key: "hero_move", emoji: "⚡", label: "Hero Move" },
  { key: "need_this", emoji: "👀", label: "Need This" },
  { key: "vault_worthy", emoji: "🏆", label: "Vault Worthy" },
];

// Per-event-type presentation: chip label, chip colors, icon, emblem gradient.
const EVENT_STYLE: Record<string, {
  chip: string;
  chipClass: string;
  icon: JSX.Element;
  emblem: string; // gradient classes for the fallback visual tile
}> = {
  first_card: {
    chip: "First Card",
    chipClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    icon: <Sparkles className="w-3.5 h-3.5" />,
    emblem: "from-yellow-500/30 to-amber-700/40",
  },
  collection_milestone: {
    chip: "Milestone",
    chipClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: <Star className="w-3.5 h-3.5" />,
    emblem: "from-amber-500/30 to-red-700/40",
  },
  binder_created: {
    chip: "New Binder",
    chipClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    emblem: "from-blue-500/30 to-indigo-700/40",
  },
  binder_shared: {
    chip: "Binder Shared",
    chipClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: <Share2 className="w-3.5 h-3.5" />,
    emblem: "from-emerald-500/30 to-teal-700/40",
  },
  badge_earned: {
    chip: "Badge Earned",
    chipClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    icon: <Award className="w-3.5 h-3.5" />,
    emblem: "from-purple-500/30 to-fuchsia-700/40",
  },
  level_milestone: {
    chip: "Level Up",
    chipClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    icon: <Trophy className="w-3.5 h-3.5" />,
    emblem: "from-orange-500/30 to-red-700/40",
  },
  image_approved: {
    chip: "Image Added",
    chipClass: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    icon: <ImageIcon className="w-3.5 h-3.5" />,
    emblem: "from-cyan-500/30 to-blue-700/40",
  },
};

const DEFAULT_STYLE = {
  chip: "Activity",
  chipClass: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  icon: <Sparkles className="w-3.5 h-3.5" />,
  emblem: "from-zinc-500/30 to-zinc-700/40",
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
      {src && <AvatarImage src={src} alt={displayName(user)} />}
      <AvatarFallback className="bg-zinc-800 text-zinc-200">{displayName(user).charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function LevelPill({ level }: { level: number }) {
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600/15 text-red-400 border border-red-600/30">
      Lv {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event visual preview (left tile)
// ---------------------------------------------------------------------------

function EventVisual({ event }: { event: FeedEvent }) {
  const style = EVENT_STYLE[event.eventType] ?? DEFAULT_STYLE;
  const isCardImage = event.image && event.eventType !== "badge_earned";

  if (event.image && event.eventType === "badge_earned") {
    // Badge emblem: circular icon on a glowing tile
    return (
      <div className={`w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl bg-gradient-to-br ${style.emblem} border border-white/10 flex items-center justify-center`}>
        <img src={event.image} alt="Badge" className="w-11 h-11 sm:w-14 sm:h-14 object-contain drop-shadow-lg" loading="lazy" />
      </div>
    );
  }
  if (isCardImage) {
    // Card front: portrait thumbnail
    return (
      <div className="w-14 sm:w-16 shrink-0 rounded-lg overflow-hidden border border-white/10 shadow-lg shadow-black/40">
        <img src={event.image!} alt="Card" className="w-full aspect-[2.5/3.5] object-cover" loading="lazy" />
      </div>
    );
  }
  // Styled fallback tile per event type
  const binderName = (event.metadata as any)?.binderName as string | undefined;
  return (
    <div className={`w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl bg-gradient-to-br ${style.emblem} border border-white/10 flex flex-col items-center justify-center gap-1 px-1 relative overflow-hidden`}>
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)", backgroundSize: "6px 6px" }} />
      <span className="text-white/90 relative">
        {event.eventType === "collection_milestone" ? <Layers className="w-6 h-6" /> : <span className="[&>svg]:w-6 [&>svg]:h-6">{style.icon}</span>}
      </span>
      {(event.eventType === "collection_milestone") && (
        <span className="text-[11px] font-black text-white/90 relative">{String((event.metadata as any)?.milestone ?? "")}</span>
      )}
      {(event.eventType === "level_milestone") && (
        <span className="text-[11px] font-black text-white/90 relative">Lv {String((event.metadata as any)?.level ?? "")}</span>
      )}
      {binderName && (
        <span className="text-[9px] font-semibold text-white/80 relative text-center leading-tight line-clamp-2">{binderName}</span>
      )}
    </div>
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

function EventCard({ event, pending, onReact }: {
  event: FeedEvent;
  pending: boolean;
  onReact: (eventId: number, reaction: string, remove: boolean) => void;
}) {
  const style = EVENT_STYLE[event.eventType] ?? DEFAULT_STYLE;
  const shareToken = event.eventType === "binder_shared" ? (event.metadata as any)?.shareToken as string | undefined : undefined;

  return (
    <div
      data-testid={`feed-event-${event.id}`}
      className="rounded-xl bg-zinc-900 border border-zinc-800 hover:border-red-900/60 transition-colors shadow-lg shadow-black/20 overflow-hidden"
    >
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <UserAvatar user={event.user} size="w-9 h-9" />
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-zinc-100 truncate">{displayName(event.user)}</span>
            <LevelPill level={event.user.collectorLevel} />
            <span className="text-xs text-zinc-500">{timeAgo(event.createdAt)}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${style.chipClass}`}>
            {style.icon}{style.chip}
          </span>
        </div>

        <div className="flex gap-3 mt-3">
          <EventVisual event={event} />
          <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
            <p className="text-sm text-zinc-200 leading-snug">
              <span className="font-semibold">{displayName(event.user)}</span> {event.title}
            </p>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <ReactionRow event={event} pending={pending} onReact={onReact} />
              <div className="flex gap-3">
                {shareToken && (
                  <Link href={`/pc-share/${shareToken}`} className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
                    View Binder <ExternalLink className="w-3 h-3" />
                  </Link>
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
    if (run.length >= 3) {
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

function GroupedBadgeCard({ group, pending, onReact }: {
  group: EventGroup;
  pending: boolean;
  onReact: (eventId: number, reaction: string, remove: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const first = group.events[0];
  const icons = group.events.filter(e => e.image).slice(0, 4);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 hover:border-red-900/60 transition-colors shadow-lg shadow-black/20 overflow-hidden" data-testid={`feed-group-${first.id}`}>
      <div className="p-3.5 sm:p-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <UserAvatar user={first.user} size="w-9 h-9" />
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-zinc-100 truncate">{displayName(first.user)}</span>
            <LevelPill level={first.user.collectorLevel} />
            <span className="text-xs text-zinc-500">{timeAgo(first.createdAt)}</span>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${EVENT_STYLE.badge_earned.chipClass}`}>
            <Award className="w-3.5 h-3.5" />{group.events.length} Badges
          </span>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <div className="flex -space-x-3 shrink-0">
            {icons.length > 0 ? icons.map((e) => (
              <div key={e.id} className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500/30 to-fuchsia-700/40 border border-white/10 flex items-center justify-center ring-2 ring-zinc-900">
                <img src={e.image!} alt="Badge" className="w-8 h-8 object-contain" loading="lazy" />
              </div>
            )) : (
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500/30 to-fuchsia-700/40 border border-white/10 flex items-center justify-center">
                <Award className="w-5 h-5 text-white/90" />
              </div>
            )}
            {group.events.length > icons.length && icons.length > 0 && (
              <div className="w-11 h-11 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center ring-2 ring-zinc-900 text-xs font-bold text-zinc-300">
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
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500/30 to-fuchsia-700/40 border border-white/10 flex items-center justify-center shrink-0">
                  {e.image ? <img src={e.image} alt="Badge" className="w-7 h-7 object-contain" loading="lazy" /> : <Award className="w-4 h-4 text-white/90" />}
                </div>
                <span className="text-sm text-zinc-300 flex-1 min-w-0">{e.title}</span>
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
  const [filter, setFilter] = useState<"everyone" | "me">("everyone");
  const [extraEvents, setExtraEvents] = useState<FeedEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<FeedResponse>({
    queryKey: ["/api/feed", filter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/feed?filter=${filter}`);
      return res.json();
    },
  });

  const events = [...(data?.events ?? []), ...extraEvents];
  const nextCursor = cursor ?? data?.nextCursor ?? null;
  const groups = useMemo(() => groupEvents(events), [events]);

  const changeFilter = (f: "everyone" | "me") => {
    setFilter(f);
    setExtraEvents([]);
    setCursor(null);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await apiRequest("GET", `/api/feed?filter=${filter}&before=${encodeURIComponent(nextCursor)}`);
      const page: FeedResponse = await res.json();
      setExtraEvents(prev => [...prev, ...page.events]);
      setCursor(page.nextCursor ?? "");
      if (!page.nextCursor) setCursor("");
    } catch {
      toast({ title: "Could not load more", variant: "destructive" });
    } finally {
      setLoadingMore(false);
    }
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
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filter === "everyone" ? "default" : "outline"}
          onClick={() => changeFilter("everyone")}
          data-testid="button-filter-everyone"
        >
          Everyone
        </Button>
        <Button
          size="sm"
          variant={filter === "me" ? "default" : "outline"}
          onClick={() => changeFilter("me")}
          data-testid="button-filter-me"
        >
          Me
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 py-12 text-center text-zinc-400">
          <ActivityIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-zinc-300">No activity yet</p>
          <p className="text-sm mt-1">
            {filter === "me"
              ? "Add cards, earn badges, and build binders to see your milestones here."
              : "Collector milestones will show up here as the community builds their vaults."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) =>
            g.events.length > 1 ? (
              <GroupedBadgeCard key={g.key} group={g} pending={reactMutation.isPending} onReact={onReact} />
            ) : (
              <EventCard key={g.key} event={g.events[0]} pending={reactMutation.isPending} onReact={onReact} />
            ),
          )}
          {nextCursor && nextCursor !== "" && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore} data-testid="button-load-more">
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more"}
              </Button>
            </div>
          )}
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

function LeaderboardList({ title, icon, entries, valueKey, valueLabel }: {
  title: string;
  icon: JSX.Element;
  entries: LeaderboardEntry[];
  valueKey: "xp" | "approved";
  valueLabel: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-950/40 to-transparent">
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
                <UserAvatar user={e.user} size="w-8 h-8" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">{displayName(e.user)}</p>
                  <p className="text-xs text-zinc-500">Level {e.user.collectorLevel}</p>
                </div>
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-600/15 text-red-400 border border-red-600/30">
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

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Rankings reset every Monday. Earn XP by adding cards, earning badges, contributing images, and cheering on other collectors.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <LeaderboardList
          title="Top XP This Week"
          icon={<Trophy className="w-4 h-4 text-yellow-500" />}
          entries={data?.topXp ?? []}
          valueKey="xp"
          valueLabel="XP"
        />
        <LeaderboardList
          title="Top Image Contributors"
          icon={<ImageIcon className="w-4 h-4 text-cyan-500" />}
          entries={data?.topImageContributors ?? []}
          valueKey="approved"
          valueLabel="images"
        />
      </div>
      <div className="rounded-xl border border-dashed border-zinc-700 py-6 text-center text-zinc-500 text-sm">
        <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
        Set Builders leaderboard is coming soon.
      </div>
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
      {/* Dark header panel: title always sits on a dark surface, never white-on-white */}
      <div className="mb-6 rounded-xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-red-950/60 border border-zinc-800 px-5 py-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "10px 10px" }} />
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
