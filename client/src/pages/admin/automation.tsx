import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BulkImageUpdater from "@/components/admin/bulk-image-updater";
import SchedulerManager from "@/components/admin/scheduler-manager";
import { PriceChartingImporter } from "@/components/admin/pricecharting-importer";
import { Settings, Image, Zap, Download, Mail, ExternalLink, Send, Clock, CheckCircle2, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  const [confirmed, setConfirmed] = useState(false);

  const { data: status, isLoading } = useQuery<Thanks2uStatus>({
    queryKey: ["/api/admin/thanks2u-status"],
    refetchInterval: 10000,
  });

  const [followUpConfirmed, setFollowUpConfirmed] = useState(false);

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/thanks2u-send-now"),
    onSuccess: (data: any) => {
      toast({ title: "Email blast sent!", description: `${data.sent} emails sent, ${data.failed} failed.` });
      setConfirmed(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/thanks2u-status"] });
    },
    onError: () => {
      toast({ title: "Send failed", description: "Something went wrong. Check the server logs.", variant: "destructive" });
      setConfirmed(false);
    },
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

  const blast1Sent = !!status?.manualSentAt;
  const followUpSent = !!status?.followUp?.manualSentAt;

  return (
    <div className="space-y-3">
      {/* ── Blast 1: June 10 ── */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500">
                <Mail className="h-4 w-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm text-gray-900 dark:text-white">Blast #1 — June 10</CardTitle>
                <p className="text-xs text-gray-500">440 of 483 eligible users received it</p>
              </div>
            </div>
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Sent
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex gap-2">
            <a
              href="/api/admin/thanks2u-preview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> Preview Email
            </a>
          </div>
        </CardContent>
      </Card>

      {/* ── Follow-Up: June 17 ── */}
      <Card className="border-2 border-amber-100">
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500">
                <Clock className="h-4 w-4 text-white" />
              </div>
              <div>
                <CardTitle className="text-sm text-gray-900 dark:text-white">Follow-Up — June 24</CardTitle>
                <p className="text-xs text-gray-500">43 missed users + any new signups since June 10</p>
              </div>
            </div>
            {followUpSent ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Sent
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                <Clock className="h-3 w-3 mr-1" /> Jun 24 · 9 AM CT
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pb-3 space-y-3">
          {isLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Sending To</p>
                <p className="font-semibold text-gray-900 dark:text-white">Anyone who missed #1</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">+ New Signups</p>
                <p className="font-semibold text-gray-900 dark:text-white">Included automatically</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Coupon</p>
                <p className="font-semibold text-red-600 font-mono tracking-widest">THANKS2U</p>
              </div>
            </div>
          )}

          {followUpSent && (
            <p className="text-xs text-green-700 dark:text-green-400">
              ✅ Sent on {new Date(status!.followUp.manualSentAt!).toLocaleString()}
            </p>
          )}

          {!followUpSent && (
            <div className="flex flex-wrap gap-2">
              {!followUpConfirmed ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                  onClick={() => setFollowUpConfirmed(true)}
                >
                  <Send className="h-3 w-3 mr-1.5" /> Send Now Instead
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 font-medium">Send to missed users right now?</span>
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
    refetchInterval: 10000,
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
    <Card className="border-2 border-red-100 dark:border-red-900">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-600">
              <Mail className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">"Your Vault Just Got Bigger" — Drip</CardTitle>
              <p className="text-xs text-gray-500">Finishing the announcement that hit the daily email limit</p>
            </div>
          </div>
          {done ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> All Sent
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
              <Clock className="h-3 w-3 mr-1" /> {status?.dailyLimit ?? 90}/day · 9 AM CT
            </Badge>
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

            <p className="text-xs text-gray-600 dark:text-gray-400">
              Runs automatically every morning at 9 AM Central, sending up to {status?.dailyLimit ?? 90} per day to anyone
              who hasn't received it yet — nobody gets it twice. It stops on its own once everyone is reached.
            </p>

            {status?.lastRun && (
              <p className="text-xs text-gray-500">
                Last batch: {status.lastRun.sent} sent{status.lastRun.failed ? `, ${status.lastRun.failed} failed` : ""} on{" "}
                {new Date(status.lastRun.at).toLocaleString()}
              </p>
            )}

            {done ? (
              <p className="text-xs text-green-700 dark:text-green-400">✅ Everyone opted-in has received the announcement.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!confirmed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => setConfirmed(true)}
                  >
                    <Send className="h-3 w-3 mr-1.5" /> Send Today's Batch Now
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-700 font-medium">
                      Send up to {status?.dailyLimit ?? 90} now?
                    </span>
                    <Button
                      size="sm"
                      className="text-xs bg-red-600 hover:bg-red-700 text-white"
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

interface RcAuditUser {
  userId: number;
  email: string;
  username: string;
  currentPlan: string;
  rcProduct: string;
  purchaseDate: string;
  expiresDate: string;
  fixed: boolean;
}

interface RcAuditResult {
  scanned: number;
  affected: number;
  errors: number;
  autoFixed: boolean;
  users: RcAuditUser[];
}

function RcAuditCard() {
  const { toast } = useToast();
  const [results, setResults] = useState<RcAuditResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (fix: boolean) => {
    setRunning(true);
    try {
      const res = await apiRequest("GET", `/api/admin/rc-audit?fix=${fix}`);
      const data: RcAuditResult = await res.json();
      setResults(data);
      if (fix && data.affected > 0) {
        toast({ title: `✅ Fixed ${data.affected} users`, description: "They've been upgraded to SUPER_HERO." });
      } else if (!fix && data.affected > 0) {
        toast({ title: `⚠️ Found ${data.affected} users needing upgrade`, description: "Click 'Fix All' to upgrade them.", variant: "destructive" });
      } else if (data.errors > 0) {
        toast({ title: "Scan incomplete", description: `${data.errors} RC lookups failed — results may be incomplete. Check server logs.`, variant: "destructive" });
      } else {
        toast({ title: "All clear!", description: `Scanned ${data.scanned} users — everyone who paid is upgraded.` });
      }
    } catch {
      toast({ title: "Audit failed", description: "Check server logs.", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-2 border-blue-100 dark:border-blue-900">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-600">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">RevenueCat Subscription Audit</CardTitle>
              <p className="text-xs text-gray-500">Find iOS users who paid but are still on SIDE_KICK</p>
            </div>
          </div>
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">iOS Billing</Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Scans every user account against RevenueCat. If someone has an active <code>super_hero</code> entitlement
          but their account still shows SIDE_KICK (e.g. because the activation call failed), this tool finds
          and optionally fixes them.
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
            onClick={() => run(false)}
            disabled={running}
          >
            {running ? <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
            Dry Run (Check Only)
          </Button>
          {results && results.affected > 0 && !results.autoFixed && (
            <Button
              size="sm"
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => run(true)}
              disabled={running}
            >
              <ShieldCheck className="h-3 w-3 mr-1.5" />
              Fix All ({results.affected})
            </Button>
          )}
        </div>

        {results && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-3 text-xs">
              <span className="text-gray-500">Scanned: <strong className="text-gray-900 dark:text-white">{results.scanned}</strong></span>
              <span className="text-gray-500">Need upgrade: <strong className={results.affected > 0 ? "text-amber-600" : "text-green-600"}>{results.affected}</strong></span>
              {results.autoFixed && <span className="text-green-600 font-medium">✅ All fixed</span>}
            </div>

            {results.users.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">User</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">RC Product</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Expires</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.users.map(u => (
                      <tr key={u.userId} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-white">{u.username}</p>
                          <p className="text-gray-400">{u.email}</p>
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300 font-mono">{u.rcProduct}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                          {new Date(u.expiresDate).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          {u.fixed ? (
                            <Badge className="bg-green-100 text-green-700 text-xs">Fixed ✓</Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-700 text-xs flex items-center gap-1 w-fit">
                              <AlertTriangle className="h-2.5 w-2.5" /> Needs fix
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminAutomation() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Data & Image Automation</h1>
          <p className="text-gray-600 dark:text-gray-300">Manage automated card data import, image processing, and bulk operations</p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Zap className="h-3 w-3" />
          Admin Tools
        </Badge>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-purple-500">
                <Download className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Data Import</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              PriceCharting API integration for Marvel card data population
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-blue-500">
                <Image className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Image Processing</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Automated image finding and processing using eBay Browse API
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-green-500">
                <Settings className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Rate Limiting</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Configurable delays to respect API limits and prevent rate limiting
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-purple-500">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Bulk Operations</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Process hundreds of cards with progress tracking and error reporting
            </p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* RevenueCat Subscription Audit */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" /> iOS Subscription Audit
        </h2>
        <RcAuditCard />
      </div>

      <Separator />

      {/* THANKS2U Email Campaign */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Mail className="h-5 w-5 text-red-500" /> Email Campaigns
        </h2>
        <div className="space-y-3">
          <VaultUpgradeDripCard />
          <Thanks2uCampaignCard />
        </div>
      </div>

      <Separator />

      {/* PriceCharting Importer */}
      <PriceChartingImporter />

      <Separator />

      {/* Background Scheduler */}
      <SchedulerManager />

      <Separator />

      {/* Bulk Image Updater */}
      <BulkImageUpdater />
    </div>
  );
}