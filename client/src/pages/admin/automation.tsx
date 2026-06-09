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
}

function Thanks2uCampaignCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);

  const { data: status, isLoading } = useQuery<Thanks2uStatus>({
    queryKey: ["/api/admin/thanks2u-status"],
    refetchInterval: 10000,
  });

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

  const alreadySent = !!status?.manualSentAt;
  const scheduledDate = new Date("2026-06-10T09:00:00-05:00");

  return (
    <Card className="border-2 border-red-100">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500">
              <Mail className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-base text-gray-900 dark:text-white">THANKS2U Coupon Blast</CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">2 months free · First 100 users · Non-upgraded only</p>
            </div>
          </div>
          {alreadySent ? (
            <Badge className="bg-green-100 text-green-700 border-green-200">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Sent
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
              <Clock className="h-3 w-3 mr-1" /> Scheduled
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-gray-400">Loading status…</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Scheduled For</p>
              <p className="font-semibold text-gray-900 dark:text-white">Jun 10, 2026 · 9:00 AM CT</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Recipients</p>
              <p className="font-semibold text-gray-900 dark:text-white">{status?.recipientCount ?? "—"} users</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Coupon Code</p>
              <p className="font-semibold text-red-600 tracking-widest font-mono">THANKS2U</p>
            </div>
          </div>
        )}

        {alreadySent && (
          <p className="text-sm text-green-700 dark:text-green-400">
            ✅ Manually sent on {new Date(status!.manualSentAt!).toLocaleString()}. Scheduled job has been cancelled.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="/api/admin/thanks2u-preview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Preview Email
          </a>

          {!alreadySent && (
            !confirmed ? (
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => setConfirmed(true)}
              >
                <Send className="h-3 w-3 mr-1.5" /> Send Now Instead
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-medium">Send to {status?.recipientCount} users right now?</span>
                <Button
                  size="sm"
                  className="text-xs bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                >
                  {sendMutation.isPending ? "Sending…" : "Yes, Send Now"}
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmed(false)}>
                  Cancel
                </Button>
              </div>
            )
          )}
        </div>
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