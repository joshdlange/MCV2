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
// Brevo contact-list sync (external write: pushes user list to Brevo)
// ─────────────────────────────────────────────────────────────
function ContactSyncCard() {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState(false);

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/sync-contacts"),
    onSuccess: () => {
      toast({ title: "Contact sync complete", description: "User list pushed to Brevo." });
      setConfirmed(false);
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Check the server logs.", variant: "destructive" });
      setConfirmed(false);
    },
  });

  return (
    <Card className="border border-amber-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500">
              <Users className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Brevo Contact-List Sync</CardTitle>
              <p className="text-xs text-gray-500">Pushes all app users to the Brevo contact list (list management only — sends no email)</p>
            </div>
          </div>
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">External Write</Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            This pushes the full user list to Brevo in one go and there is no preview of how many contacts
            will be sent. It does not email anyone, but only run it when you actually need Brevo refreshed.
          </span>
        </p>
        {!confirmed ? (
          <Button
            size="sm"
            variant="outline"
            className="text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
            onClick={() => setConfirmed(true)}
          >
            <RefreshCw className="h-3 w-3 mr-1.5" /> Sync Contacts to Brevo
          </Button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-amber-800 font-medium">Push the entire user list to Brevo now?</span>
            <Button
              size="sm"
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? "Syncing…" : "Yes, Sync Now"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmed(false)}>
              Cancel
            </Button>
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

export default function AdminNotifications() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Email & Notifications</h1>
          <p className="text-gray-600 dark:text-gray-300">
            Delivery testing, contact-list management, and campaign history. All app email is sent through Resend.
          </p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Mail className="h-3 w-3" />
          Notifications
        </Badge>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Delivery & Contacts</h2>
        <div className="space-y-3">
          <TestEmailCard />
          <ContactSyncCard />
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
