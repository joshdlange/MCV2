import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import BulkImageUpdater from "@/components/admin/bulk-image-updater";
import { Image, Zap, CloudUpload, RefreshCw, AlertTriangle, CheckCircle2, Play } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ImageMigrationStatus {
  running: boolean;
  lastRun?: {
    at: string;
    attempted: number;
    migrated: number;
    failed: number;
    remaining: number;
  } | null;
  skippedThisBoot?: number;
}

function ImageMigrationCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);

  const { data: status, isLoading } = useQuery<ImageMigrationStatus>({
    queryKey: ["/api/admin/image-migration-status"],
    refetchInterval: 15000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/run-image-migration", { maxCards: 50 });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Migration started", description: data.message || "Running in the background." });
      setConfirmed(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/image-migration-status"] });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      toast({
        title: msg.includes("409") ? "Already running" : "Failed to start",
        description: msg.includes("409")
          ? "A migration batch is already in progress."
          : "Check the server logs.",
        variant: "destructive",
      });
      setConfirmed(false);
    },
  });

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-600">
              <CloudUpload className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">COMC → Cloudinary Image Migration</CardTitle>
              <p className="text-xs text-gray-500">
                Copies COMC-hosted card images into Cloudinary. Runs automatically every night at 1:30 AM CT.
              </p>
            </div>
          </div>
          {isLoading ? (
            <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Loading…</Badge>
          ) : status?.running ? (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Running
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Idle
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {status?.lastRun && (
          <>
            <div className="grid grid-cols-4 gap-2 text-xs max-w-lg">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Attempted</p>
                <p className="font-semibold text-gray-900 dark:text-white">{status.lastRun.attempted ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Migrated</p>
                <p className="font-semibold text-green-600">{status.lastRun.migrated ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Failed</p>
                <p className="font-semibold text-amber-600">{status.lastRun.failed ?? 0}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                <p className="text-gray-500 mb-0.5">Still To Do</p>
                <p className="font-semibold text-gray-900 dark:text-white">{status.lastRun.remaining?.toLocaleString() ?? 0}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Last run: {new Date(status.lastRun.at).toLocaleString()}
            </p>
          </>
        )}
        <p className="text-xs text-gray-500">
          The nightly job handles this on its own (up to 450 cards per night). The manual button below runs a
          small extra batch of 50 cards — useful for testing, not needed day-to-day.
        </p>
        {!status?.running && (
          !confirmed ? (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setConfirmed(true)}>
              <Play className="h-3 w-3 mr-1.5" /> Run Small Batch Now (50 cards)
            </Button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-700 font-medium">
                Migrate up to 50 card images to Cloudinary now?
              </span>
              <Button
                size="sm"
                className="text-xs bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
              >
                {runMutation.isPending ? "Starting…" : "Yes, Run Batch"}
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmed(false)}>
                Cancel
              </Button>
            </div>
          )
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
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Image Automation</h1>
          <p className="text-gray-600 dark:text-gray-300">
            Bulk image processing and the nightly image migration. Email tools now live under Notifications;
            older tools moved to Advanced / Legacy Tools.
          </p>
        </div>
        <Badge variant="secondary" className="flex items-center gap-2">
          <Image className="h-3 w-3" />
          Images
        </Badge>
      </div>

      {/* Nightly migration status + manual trigger */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-sky-600" /> Image Migration
        </h2>
        <ImageMigrationCard />
      </div>

      <Separator />

      {/* Bulk image updater (eBay lookups) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          <Zap className="h-5 w-5 text-purple-600" /> Bulk Image Updater
          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Dangerous</Badge>
        </h2>
        <p className="text-xs text-amber-700 mb-3 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          Uses eBay API quota and overwrites card images in production — run small batches.
        </p>
        <BulkImageUpdater />
      </div>
    </div>
  );
}
