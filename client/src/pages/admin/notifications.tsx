import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mail, ExternalLink, Send, Clock, CheckCircle2, Users, RefreshCw, AlertTriangle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────
// Resend test email (safe: sends one test email to an address you enter)
// ─────────────────────────────────────────────────────────────
function TestEmailCard() {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/test-resend-email", to.trim() ? { to: to.trim() } : {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Test email sent", description: data.message || "Check the inbox." });
      setConfirmed(false);
    },
    onError: () => {
      toast({ title: "Send failed", description: "Check the server logs.", variant: "destructive" });
      setConfirmed(false);
    },
  });

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-600">
              <Mail className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Resend Test Email</CardTitle>
              <p className="text-xs text-gray-500">Verify email delivery is working — sends one test message via Resend</p>
            </div>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Active</Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            type="email"
            placeholder="Recipient (blank = your admin email)"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="max-w-xs h-8 text-xs bg-white text-gray-900"
          />
          {!confirmed ? (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setConfirmed(true)}>
              <Send className="h-3 w-3 mr-1.5" /> Send Test Email
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-700 font-medium">
                Send one test email to {to.trim() || "your admin address"}?
              </span>
              <Button
                size="sm"
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
              >
                {sendMutation.isPending ? "Sending…" : "Yes, Send"}
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmed(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500">
          All app email (welcome, password reset, badges, digests, campaigns) goes through Resend from
          no-reply@marvelcardvault.com. This only sends a single test message.
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// All email activity — every email job that has ever sent (lifecycle,
// campaigns, transactional), with open/click tracking where available.
// ─────────────────────────────────────────────────────────────
interface EmailActivityJob {
  jobName: string;
  sent: number;
  sent30d: number;
  opened: number;
  clicked: number;
  failed: number;
  lastSentAt: string | null;
}

function EmailActivityCard() {
  const { data, isLoading } = useQuery<{ jobs: EmailActivityJob[] }>({
    queryKey: ["/api/admin/email-activity"],
  });

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600">
            <Mail className="h-4 w-4 text-white" />
          </div>
          <div>
            <CardTitle className="text-sm text-gray-900 dark:text-white">All Email Activity</CardTitle>
            <p className="text-xs text-gray-500">
              Every email the app has sent, by type — lifecycle journeys, campaigns, and one-off notifications.
              Opens/clicks only count for emails sent after tracking went live.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {isLoading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : !data?.jobs?.length ? (
          <p className="text-xs text-gray-400">No emails sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-1.5 pr-3 font-medium">Email type</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Last 30 days</th>
                  <th className="py-1.5 pr-3 font-medium text-right">All time</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Opened</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Clicked</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Failed</th>
                  <th className="py-1.5 font-medium text-right">Last sent</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.jobName} className="border-b border-gray-100 last:border-0" data-testid={`activity-${j.jobName}`}>
                    <td className="py-1.5 pr-3 font-mono text-gray-800 dark:text-gray-200 break-all">{j.jobName}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700 dark:text-gray-300">{j.sent30d}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700 dark:text-gray-300">{j.sent}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700 dark:text-gray-300">{j.opened} ({pct(j.opened, j.sent)})</td>
                    <td className="py-1.5 pr-3 text-right text-gray-700 dark:text-gray-300">{j.clicked} ({pct(j.clicked, j.sent)})</td>
                    <td className={`py-1.5 pr-3 text-right ${j.failed > 0 ? "text-red-600 font-medium" : "text-gray-400"}`}>{j.failed}</td>
                    <td className="py-1.5 text-right text-gray-500 whitespace-nowrap">{fmtDate(j.lastSentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Legacy campaign cards (moved here from the old Automation page)
// ─────────────────────────────────────────────────────────────
interface Thanks2uStatus {
  scheduled: string;
  jobRunning: boolean;
  manualSentAt: string | null;
  recipientCount: number;
  followUp: {
    scheduled: string;
    jobRunning: boolean;
    manualSentAt: string | null;
  };
}

function Thanks2uCampaignCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [followUpConfirmed, setFollowUpConfirmed] = useState(false);

  const { data: status, isLoading } = useQuery<Thanks2uStatus>({
    queryKey: ["/api/admin/thanks2u-status"],
  });

  const followUpMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/thanks2u-followup-send-now"),
    onSuccess: (data: any) => {
      toast({ title: "Follow-up sent!", description: `${data.sent} emails sent, ${data.failed} failed.` });
      setFollowUpConfirmed(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/thanks2u-status"] });
    },
    onError: () => {
      toast({ title: "Follow-up failed", description: "Something went wrong. Check the server logs.", variant: "destructive" });
      setFollowUpConfirmed(false);
    },
  });

  const followUpSent = !!status?.followUp?.manualSentAt;

  return (
    <div className="space-y-3">
      <Card className="border border-gray-200 opacity-90">
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-400">
                <Mail className="h-4 w-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm text-gray-900 dark:text-white">THANKS2U Blast #1 — June 10, 2026</CardTitle>
                <p className="text-xs text-gray-500">440 of 483 eligible users received it</p>
              </div>
            </div>
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Sent
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          <a
            href="/api/admin/thanks2u-preview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Preview Email
          </a>
        </CardContent>
      </Card>

      <Card className="border border-gray-200 opacity-90">
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-400">
                <Clock className="h-4 w-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm text-gray-900 dark:text-white">THANKS2U Follow-Up — June 24, 2026</CardTitle>
                <p className="text-xs text-gray-500">Sent to users who missed Blast #1</p>
              </div>
            </div>
            {followUpSent ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Sent
              </Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Legacy</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-3 space-y-3">
          {isLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : followUpSent ? (
            <p className="text-xs text-green-700 dark:text-green-400">
              ✅ Sent on {new Date(status!.followUp.manualSentAt!).toLocaleString()}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-amber-700">
                This campaign's scheduled dates have passed. Only use the manual send if you intentionally
                want to re-run the follow-up to anyone who missed it.
              </p>
              {!followUpConfirmed ? (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setFollowUpConfirmed(true)}>
                  <Send className="h-3 w-3 mr-1.5" /> Send Follow-Up Manually
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 font-medium">Really send real email to missed users now?</span>
                  <Button
                    size="sm"
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => followUpMutation.mutate()}
                    disabled={followUpMutation.isPending}
                  >
                    {followUpMutation.isPending ? "Sending…" : "Yes, Send Now"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setFollowUpConfirmed(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface VaultUpgradeDripStatus {
  dailyLimit: number;
  totalEligible: number;
  alreadySent: number;
  remaining: number;
  daysLeft: number;
  jobRunning: boolean;
  lastRun: { at: string; sent: number; failed: number; remaining: number } | null;
}

function VaultUpgradeDripCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);

  const { data: status, isLoading } = useQuery<VaultUpgradeDripStatus>({
    queryKey: ["/api/admin/campaigns/vault-upgrade/drip-status"],
  });

  const dripMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/campaigns/vault-upgrade/drip-now"),
    onSuccess: (data: any) => {
      if (data.skipped) {
        toast({ title: "Already sending", description: "A batch is already in progress. Try again in a moment." });
      } else {
        toast({ title: "Batch sent!", description: `${data.sent} sent, ${data.failed} failed, ${data.remaining} still remaining.` });
      }
      setConfirmed(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/campaigns/vault-upgrade/drip-status"] });
    },
    onError: () => {
      toast({ title: "Send failed", description: "Something went wrong. Check the server logs.", variant: "destructive" });
      setConfirmed(false);
    },
  });

  const done = !isLoading && status?.remaining === 0;

  return (
    <Card className="border border-gray-200 opacity-90">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-400">
              <Mail className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">"Your Vault Just Got Bigger" — Drip (July 2026)</CardTitle>
              <p className="text-xs text-gray-500">Announcement drip that finished in batches of {status?.dailyLimit ?? 90}/day</p>
            </div>
          </div>
          {done ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> All Sent
            </Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Legacy</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {isLoading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Eligible</p>
                <p className="font-semibold text-gray-900 dark:text-white">{status?.totalEligible ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Already Sent</p>
                <p className="font-semibold text-green-600">{status?.alreadySent ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Remaining</p>
                <p className="font-semibold text-amber-600">{status?.remaining ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Days Left</p>
                <p className="font-semibold text-gray-900 dark:text-white">{status?.daysLeft ?? 0}</p>
              </div>
            </div>

            {status?.lastRun && (
              <p className="text-xs text-gray-500">
                Last batch: {status.lastRun.sent} sent{status.lastRun.failed ? `, ${status.lastRun.failed} failed` : ""} on{" "}
                {new Date(status.lastRun.at).toLocaleString()}
              </p>
            )}

            {done ? (
              <p className="text-xs text-green-700 dark:text-green-400">✅ Everyone opted-in has received the announcement.</p>
            ) : (
              <div className="flex flex-wrap gap-2 items-center">
                {!confirmed ? (
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setConfirmed(true)}>
                    <Send className="h-3 w-3 mr-1.5" /> Send Remaining Batch
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-700 font-medium">
                      Really send real email to up to {status?.dailyLimit ?? 90} users now?
                    </span>
                    <Button
                      size="sm"
                      className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => dripMutation.mutate()}
                      disabled={dripMutation.isPending}
                    >
                      {dripMutation.isPending ? "Sending…" : "Yes, Send Now"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmed(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
                <a
                  href="/api/admin/email-preview?template=vault-upgrade-announcement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> Preview Email
                </a>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Lifecycle Emails — templates, statuses, eligible counts, hero images,
// preview + admin-only test sends. Test sends go ONLY to your admin email
// and never activate a template. There are deliberately NO activate/batch
// buttons here: activating a draft is a code change done with the agent.
// ─────────────────────────────────────────────────────────────
function LifecycleEmailsCard() {
  const { toast } = useToast();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/lifecycle/status"],
    refetchInterval: 60_000, // keep open/click rates fresh within a minute of webhook events
  });

  const testMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", "/api/admin/lifecycle/test", { key });
      return res.json();
    },
    onSuccess: (d: any) => toast({ title: "Test sent", description: `"${d.key}" sent to ${d.sentTo} only.` }),
    onError: (e: any) => toast({ title: "Test send failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: async ({ key, active, confirm }: { key: string; active: boolean; confirm?: string }) => {
      const res = await apiRequest("POST", "/api/admin/lifecycle/activate", { key, active, confirm });
      return res.json();
    },
    onSuccess: (d: any) => {
      toast({ title: d.active ? "Template activated" : "Template deactivated", description: `"${d.key}" is now ${d.active ? "LIVE — eligible users will be emailed automatically" : "a draft (no sends)"}.` });
      refetch();
    },
    onError: (e: any) => toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const toggleActive = (e: any) => {
    if (e.active) {
      if (window.confirm(`Deactivate "${e.key}"? It stops sending immediately and returns to Draft.`)) {
        activateMutation.mutate({ key: e.key, active: false });
      }
      return;
    }
    const expected = `ACTIVATE ${e.key}`;
    const typed = window.prompt(
      `Activating "${e.key}" will start emailing real eligible users (currently ${e.eligibleNow ?? 0} eligible).\n\n` +
        (e.longTail
          ? `This is a dormant/win-back email — once active, the hourly automation sends it automatically (drip, max 50/hour, and max 150 win-back emails per day across all of them).\n\n`
          : e.batchJourney
            ? `Once active, the hourly automation will start sending to eligible users (drip, one at a time, max 50/hour).\n\n`
            : `Once active, this email fires automatically when its trigger event happens.\n\n`) +
        `Type ${expected} to confirm:`
    );
    if (typed === null) return;
    if (typed.trim() !== expected) {
      toast({ title: "Not activated", description: `Confirmation text did not match "${expected}".`, variant: "destructive" });
      return;
    }
    activateMutation.mutate({ key: e.key, active: true, confirm: expected });
  };

  const openPreview = async (key: string) => {
    setPreviewKey(key);
    setPreviewHtml("");
    try {
      const res = await apiRequest("GET", `/api/admin/lifecycle/preview?key=${encodeURIComponent(key)}`);
      setPreviewHtml(await res.text());
    } catch {
      setPreviewHtml("<p style='color:red;padding:20px'>Failed to load preview.</p>");
      toast({ title: "Preview failed", variant: "destructive" });
    }
  };

  const emails: any[] = data?.emails ?? [];

  const statusBadge = (e: any) => {
    if (e.transactional) return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Transactional</Badge>;
    if (e.active) return <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Active</Badge>;
    return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Draft</Badge>;
  };

  const heroBadge = (e: any) => {
    if (!e.heroKey) return null;
    if (e.heroStatus === "reachable") return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Image reachable</Badge>;
    if (e.heroStatus === "unreachable") return <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Image NOT reachable</Badge>;
    return <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">No image configured</Badge>;
  };

  const anyUnreachable = emails.some((e) => e.heroKey && e.heroStatus === "unreachable");
  const usage = data?.monthlyUsage;
  const usagePct = usage ? Math.min(100, Math.round((usage.sent / usage.limit) * 100)) : 0;
  const usageColor = usagePct >= 100 ? "bg-red-600" : usagePct >= 80 ? "bg-amber-500" : "bg-green-600";

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-600">
              <Send className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Lifecycle Emails</CardTitle>
              <p className="text-xs text-gray-500">
                Every lifecycle template with status, eligible count, and hero image. Preview and test-send safely.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh counts
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {usage && (
          <div className="rounded-md border border-gray-200 px-3 py-2.5" data-testid="monthly-email-usage">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
              <p className="text-xs font-medium text-gray-900 dark:text-white">
                Emails sent this month (since {usage.monthStart})
              </p>
              <p className={`text-xs font-semibold ${usagePct >= 100 ? "text-red-600" : usagePct >= 80 ? "text-amber-600" : "text-gray-700 dark:text-gray-300"}`}>
                {usage.sent.toLocaleString()} / {usage.limit.toLocaleString()} ({usage.remaining.toLocaleString()} left)
              </p>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${usageColor}`} style={{ width: `${usagePct}%` }} />
            </div>
            {usagePct >= 100 ? (
              <p className="text-[11px] text-red-700 mt-1.5">
                Monthly limit reached — marketing lifecycle sends are automatically paused until next month.
                Billing-critical emails (welcome, payment failed, password reset) still go out.
              </p>
            ) : usagePct >= 80 ? (
              <p className="text-[11px] text-amber-700 mt-1.5">
                Approaching the monthly limit. Marketing sends stop automatically at {usage.limit.toLocaleString()}.
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1.5">
                Counts every email logged this calendar month. Marketing sends pause automatically at the limit;
                billing-critical emails are never blocked.
              </p>
            )}
          </div>
        )}
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            <strong>Test Send</strong> emails only YOUR admin address and never activates a template.
            Drafts cannot email users. Activating a template or running a batch send is a deliberate,
            confirmed action done outside this screen — real users get emailed when a template is active in production.
          </p>
        </div>
        {anyUnreachable && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-xs text-red-800">
              <strong>Some hero images are not reachable yet.</strong> Emails sent now would show broken image
              spots. Hero images may be unavailable until the next app production publish
              (app.marvelcardvault.com). Test sends still work but will include the broken image.
            </p>
          </div>
        )}
        {isLoading ? (
          <p className="text-xs text-gray-500">Loading templates…</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {emails.map((e) => (
              <div key={e.key} className="py-2.5 flex items-center gap-3 flex-wrap">
                {e.heroKey ? (
                  <img
                    src={`/email-assets/${e.heroKey}.jpg`}
                    alt={e.heroKey}
                    className="w-16 h-8 object-cover rounded border border-gray-200 shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-16 h-8 rounded border border-dashed border-gray-300 flex items-center justify-center text-[9px] text-gray-400 shrink-0">no hero</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-900 dark:text-white">{e.key}</span>
                    {statusBadge(e)}
                    {heroBadge(e)}
                    {e.exemptFromCap && !e.transactional && (
                      <Badge variant="outline" className="text-[10px]">cap-exempt</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate max-w-md">{e.subject}</p>
                  <p className="text-[10px] text-gray-400 break-all">
                    {e.heroUrl ? e.heroUrl : "No hero image"} · Eligible now: {e.eligibleNow ?? 0}
                  </p>
                  {e.stats && e.stats.sent > 0 ? (
                    <p className="text-[10px] text-gray-500" data-testid={`stats-${e.key}`}>
                      Sent {e.stats.sent} · Opened {e.stats.opened} ({Math.round((e.stats.opened / e.stats.sent) * 100)}%) · Clicked {e.stats.clicked} ({Math.round((e.stats.clicked / e.stats.sent) * 100)}%)
                    </p>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic" data-testid={`stats-${e.key}`}>
                      No data yet — no sends recorded for this template
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openPreview(e.key)}>
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={testMutation.isPending}
                    onClick={() => testMutation.mutate(e.key)}
                  >
                    <Send className="h-3 w-3 mr-1" /> Test Send
                  </Button>
                  {!e.transactional && e.key !== "welcome" && (
                    <Button
                      variant={e.active ? "outline" : "default"}
                      size="sm"
                      className={`h-7 text-xs ${e.active ? "text-red-600 border-red-200 hover:bg-red-50" : "bg-green-600 hover:bg-green-700 text-white"}`}
                      disabled={activateMutation.isPending}
                      onClick={() => toggleActive(e)}
                      data-testid={`button-toggle-${e.key}`}
                    >
                      {e.active ? "Deactivate" : "Activate"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {previewKey && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewKey(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <p className="text-sm font-semibold text-gray-900">Preview: {previewKey}</p>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreviewKey(null)}>Close</Button>
            </div>
            <iframe
              title={`preview-${previewKey}`}
              srcDoc={previewHtml || "<p style='padding:20px;font-family:sans-serif'>Loading…</p>"}
              sandbox=""
              className="w-full flex-1 min-h-[70vh] rounded-b-lg"
            />
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AdminNotifications() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Email & Notifications</h1>
          <p className="text-gray-600 dark:text-gray-300">
            Delivery testing, email activity, and campaign history. All app email is sent through Resend.
          </p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Mail className="h-3 w-3" />
          Notifications
        </Badge>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">All Email Activity</h2>
        <div className="space-y-3">
          <EmailActivityCard />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Lifecycle Emails</h2>
        <div className="space-y-3">
          <LifecycleEmailsCard />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Delivery & Contacts</h2>
        <div className="space-y-3">
          <TestEmailCard />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          Campaign History
          <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Legacy</Badge>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Past one-time campaigns, kept for reference. Their scheduled dates have passed — manual send buttons
          require confirmation and send real email, so leave them alone unless you have a reason.
        </p>
        <div className="space-y-3">
          <VaultUpgradeDripCard />
          <Thanks2uCampaignCard />
        </div>
      </div>

      <Separator />

      <Card className="border border-gray-200">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-gray-500">
            <strong className="text-gray-700">Monthly nudges & digest:</strong> the automated monthly email job is
            currently switched off (EMAIL_CRON_ENABLED is not set), so no scheduled marketing email goes out
            automatically. In-app notifications for upcoming set launches are sent by the system account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
