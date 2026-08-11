import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Activity, EyeOff, Eye, Database } from "lucide-react";

interface FeedStats {
  totalEvents: number;
  hiddenEvents: number;
  eventsToday: number;
  totalReactions: number;
  reactionsToday: number;
  feedXpToday: number;
  eventsByType: { eventType: string; count: number }[];
}

interface AdminFeedEvent {
  id: number;
  userId: number;
  eventType: string;
  title: string;
  hidden: boolean;
  createdAt: string;
  username: string | null;
  displayName: string | null;
}

export default function AdminFeed() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dryRunResults, setDryRunResults] = useState<Record<string, number> | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<FeedStats>({
    queryKey: ["/api/admin/feed/stats"],
  });
  const { data: recent, isLoading: recentLoading } = useQuery<AdminFeedEvent[]>({
    queryKey: ["/api/admin/feed/recent"],
  });

  const backfillMutation = useMutation({
    mutationFn: async (confirm: boolean) => {
      const res = await apiRequest("POST", "/api/admin/feed/backfill", { confirm });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.dryRun) {
        setDryRunResults(data.results);
        toast({ title: "Dry run complete", description: "Nothing was written. Review the counts below." });
      } else {
        setDryRunResults(null);
        const total = Object.values(data.results as Record<string, number>).reduce((a, b) => a + b, 0);
        toast({ title: "Backfill complete", description: `${total} feed events created.` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/feed/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/feed/recent"] });
      }
    },
    onError: (err: any) => toast({ title: "Backfill failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const hideMutation = useMutation({
    mutationFn: async ({ id, hidden }: { id: number; hidden: boolean }) => {
      const res = await apiRequest("POST", `/api/admin/feed/${id}/hide`, { hidden });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feed/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feed/stats"] });
    },
    onError: (err: any) => toast({ title: "Update failed", description: String(err?.message || err), variant: "destructive" }),
  });

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6" /> Feed Admin
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Feed health, backfill, and moderation.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Stats</CardTitle></CardHeader>
        <CardContent>
          {statsLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : stats ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground">Total events</p><p className="text-xl font-bold">{stats.totalEvents}</p></div>
              <div><p className="text-muted-foreground">Events today</p><p className="text-xl font-bold">{stats.eventsToday}</p></div>
              <div><p className="text-muted-foreground">Hidden events</p><p className="text-xl font-bold">{stats.hiddenEvents}</p></div>
              <div><p className="text-muted-foreground">Total reactions</p><p className="text-xl font-bold">{stats.totalReactions}</p></div>
              <div><p className="text-muted-foreground">Reactions today</p><p className="text-xl font-bold">{stats.reactionsToday}</p></div>
              <div><p className="text-muted-foreground">Reaction XP today</p><p className="text-xl font-bold">{stats.feedXpToday}</p></div>
            </div>
          ) : null}
          {stats && stats.eventsByType.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {stats.eventsByType.map((t) => (
                <Badge key={t.eventType} variant="secondary">{t.eventType}: {t.count}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" /> Backfill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Backfills the last 90 days of badges, binders, shares, and approved images, plus all-time first-card and collection milestones. Dedupe keys prevent duplicates, so it is safe to re-run. Always dry run first.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => backfillMutation.mutate(false)} disabled={backfillMutation.isPending} data-testid="button-backfill-dryrun">
              {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Dry run"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (window.confirm("Write backfill events to the feed? This cannot be undone (events can be hidden individually).")) {
                  backfillMutation.mutate(true);
                }
              }}
              disabled={backfillMutation.isPending || !dryRunResults}
              data-testid="button-backfill-confirm"
            >
              Run backfill
            </Button>
          </div>
          {dryRunResults && (
            <div className="text-sm bg-muted rounded-md p-3">
              <p className="font-medium mb-1">Dry run — would insert:</p>
              {Object.entries(dryRunResults).map(([k, v]) => (
                <p key={k} className="text-muted-foreground">{k}: {v}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent events</CardTitle></CardHeader>
        <CardContent>
          {recentLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : !recent || recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feed events yet.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((e) => (
                <div key={e.id} className={`flex items-center gap-3 text-sm border rounded-md px-3 py-2 ${e.hidden ? "opacity-50" : ""}`}>
                  <Badge variant="outline" className="shrink-0">{e.eventType}</Badge>
                  <span className="truncate flex-1">
                    <span className="font-medium">{e.displayName || e.username || `User ${e.userId}`}</span> {e.title}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => hideMutation.mutate({ id: e.id, hidden: !e.hidden })}
                    title={e.hidden ? "Unhide" : "Hide from feed"}
                    data-testid={`button-hide-${e.id}`}
                  >
                    {e.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
