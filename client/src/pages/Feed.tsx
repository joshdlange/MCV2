import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { avatarUrl } from "@/lib/collectorAvatars";
import { useSubscription } from "@/hooks/useSubscription";
import { useLocation } from "wouter";
import {
  Activity as ActivityIcon, Trophy, ArrowLeftRight, Sparkles,
  Award, BookOpen, Image as ImageIcon, Share2, Star, Crown, Loader2,
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

const EVENT_ICONS: Record<string, JSX.Element> = {
  first_card: <Sparkles className="w-4 h-4 text-yellow-500" />,
  collection_milestone: <Star className="w-4 h-4 text-amber-500" />,
  binder_created: <BookOpen className="w-4 h-4 text-blue-500" />,
  binder_shared: <Share2 className="w-4 h-4 text-emerald-500" />,
  badge_earned: <Award className="w-4 h-4 text-purple-500" />,
  level_milestone: <Trophy className="w-4 h-4 text-orange-500" />,
  image_approved: <ImageIcon className="w-4 h-4 text-cyan-500" />,
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
  return u.displayName || u.username || "A collector";
}

function UserAvatar({ user, size = "w-10 h-10" }: { user: FeedUser; size?: string }) {
  const src = avatarUrl(user.collectorAvatarKey) ?? user.photoURL ?? undefined;
  return (
    <Avatar className={size}>
      {src && <AvatarImage src={src} alt={displayName(user)} />}
      <AvatarFallback>{displayName(user).charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
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
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ActivityIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No activity yet</p>
            <p className="text-sm mt-1">
              {filter === "me"
                ? "Add cards, earn badges, and build binders to see your milestones here."
                : "Collector milestones will show up here as the community builds their vaults."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <Card key={event.id} data-testid={`feed-event-${event.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar user={event.user} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{displayName(event.user)}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Lv {event.user.collectorLevel}</Badge>
                      <span className="text-xs text-muted-foreground">{timeAgo(event.createdAt)}</span>
                    </div>
                    <p className="text-sm mt-0.5 flex items-center gap-1.5">
                      {EVENT_ICONS[event.eventType] ?? <Sparkles className="w-4 h-4 text-muted-foreground" />}
                      <span>{event.title}</span>
                    </p>
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {REACTIONS.map((r) => {
                        const count = event.reactions[r.key] ?? 0;
                        const active = event.myReaction === r.key;
                        return (
                          <button
                            key={r.key}
                            title={r.label}
                            data-testid={`reaction-${r.key}-${event.id}`}
                            disabled={reactMutation.isPending}
                            onClick={() =>
                              reactMutation.mutate({ eventId: event.id, reaction: r.key, remove: active })
                            }
                            className={`text-xs rounded-full border px-2 py-1 transition-colors ${
                              active
                                ? "bg-primary/10 border-primary text-primary font-medium"
                                : "border-border hover:bg-muted text-muted-foreground"
                            }`}
                          >
                            {r.emoji}{count > 0 ? ` ${count}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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

function LeaderboardList({ title, icon, entries, valueKey, valueLabel }: {
  title: string;
  icon: JSX.Element;
  entries: LeaderboardEntry[];
  valueKey: "xp" | "approved";
  valueLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No entries yet this week. Be the first!</p>
        ) : (
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={e.user.id} className="flex items-center gap-3" data-testid={`leaderboard-row-${valueKey}-${i}`}>
                <span className={`w-6 text-center text-sm font-bold ${i === 0 ? "text-yellow-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"}`}>
                  {i + 1}
                </span>
                <UserAvatar user={e.user} size="w-8 h-8" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName(e.user)}</p>
                  <p className="text-xs text-muted-foreground">Level {e.user.collectorLevel}</p>
                </div>
                <Badge variant="secondary">{e[valueKey] ?? 0} {valueLabel}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
      <Card className="border-dashed">
        <CardContent className="py-6 text-center text-muted-foreground text-sm">
          <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
          Set Builders leaderboard is coming soon.
        </CardContent>
      </Card>
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
    <Card>
      <CardContent className="py-16 text-center">
        <ArrowLeftRight className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
        <h3 className="text-lg font-semibold">Trade Feed is coming soon</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Soon you will be able to show off spare copies you are open to trading and see what other collectors are offering. No selling, no fees, just collector-to-collector trades.
        </p>
        {!isPremium && (
          <Button className="mt-6" onClick={() => setLocation("/subscribe")} data-testid="button-explore-super-hero">
            <Crown className="w-4 h-4 mr-2" />
            Explore Super Hero
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Feed() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ActivityIcon className="w-6 h-6 text-primary" />
          Feed
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Milestones, leaderboards, and community activity from the Vault.</p>
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
