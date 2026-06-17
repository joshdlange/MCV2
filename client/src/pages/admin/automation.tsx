import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BulkImageUpdater from "@/components/admin/bulk-image-updater";
import SchedulerManager from "@/components/admin/scheduler-manager";
import { PriceChartingImporter } from "@/components/admin/pricecharting-importer";
import { Settings, Image, Zap, Download, Mail, ExternalLink, Send, Clock, CheckCircle2 } from "lucide-react";
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

      {/* THANKS2U Email Campaign */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Mail className="h-5 w-5 text-red-500" /> Email Campaigns
        </h2>
        <Thanks2uCampaignCard />
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