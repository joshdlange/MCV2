import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import BulkImageUpdater from "@/components/admin/bulk-image-updater";
import { Image, Zap, CloudUpload, RefreshCw, AlertTriangle, CheckCircle2, Play, FolderSync, Search, Upload } from "lucide-react";
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

interface DryRunSummaryResponse {
  running: boolean;
  report: {
    ranAt: string;
    alreadyImportedImages?: number;
    summary: {
      totalFoldersScanned: number;
      totalCardFoldersFound: number;
      matchedCardFolders: number;
      unmatchedCardFolders: number;
      ambiguousImagePairs: number;
      foldersWithUnexpectedStructure: number;
      cardFoldersNotExactlyTwoImages: number;
      duplicateDriveFileIds: number;
      duplicateCardMatches: number;
    };
  } | null;
}

interface ImportReportResponse {
  running: boolean;
  report: {
    ranAt: string;
    finishedAt?: string;
    status: "running" | "completed" | "failed";
    fatalError?: string;
    options: { maxFolders: number | null; overwrite: boolean };
    summary: {
      eligibleFolders: number;
      uploadedImages: number;
      updatedCardRecords: number;
      skippedExistingImages: number;
      skippedAlreadyImported: number;
      skippedUnmatchedFolders: number;
      skippedWrongImageCount: number;
      skippedStructureOddities: number;
      skippedUnresolvedFrontBack: number;
      failedCloudinaryUploads: number;
      failedDatabaseUpdates: number;
      foldersProcessed: number;
      foldersRemainingEligible: number;
    };
    failures: Array<{ folderPath: string; stage: string; error: string }>;
  } | null;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "green" | "amber" | "red" }) {
  const color =
    tone === "green" ? "text-green-600" : tone === "amber" ? "text-amber-600" : tone === "red" ? "text-red-600" : "text-gray-900 dark:text-white";
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function DriveSyncCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data: dryRun, isLoading: dryRunLoading } = useQuery<DryRunSummaryResponse>({
    queryKey: ["/api/admin/drive-sync/last-report?summary=1"],
    refetchInterval: (q) => (q.state.data?.running ? 10000 : false),
  });

  const { data: importData } = useQuery<ImportReportResponse>({
    queryKey: ["/api/admin/drive-sync/import-report"],
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });

  const importRunning = importData?.running === true;
  const dryRunRunning = dryRun?.running === true;

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/drive-sync/dry-run", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dry run complete", description: "The Drive scan finished. Results updated below. Nothing was uploaded or changed." });
      qc.invalidateQueries({ queryKey: ["/api/admin/drive-sync/last-report?summary=1"] });
    },
    onError: (err: any) => {
      toast({ title: "Dry run failed", description: String(err?.message || "Check the server logs."), variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/drive-sync/import", { confirm: "IMPORT" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import started", description: "Running in the background. Progress updates below." });
      setImportDialogOpen(false);
      setConfirmText("");
      qc.invalidateQueries({ queryKey: ["/api/admin/drive-sync/import-report"] });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      toast({
        title: msg.includes("409") ? "Already running" : "Failed to start import",
        description: msg.includes("409") ? "An import is already in progress." : msg || "Check the server logs.",
        variant: "destructive",
      });
    },
  });

  const s = dryRun?.report?.summary;
  const imp = importData?.report;

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-600">
              <FolderSync className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm text-gray-900 dark:text-white">Drive Image Sync</CardTitle>
              <p className="text-xs text-gray-500">
                Scans the Google Drive card image archive, then imports clean, exact matches to Cloudinary and card records.
              </p>
            </div>
          </div>
          {importRunning ? (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Importing
            </Badge>
          ) : dryRunRunning || dryRunMutation.isPending ? (
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Scanning
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Idle
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-4">
        {/* Latest dry-run scan */}
        <div>
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Latest Drive Scan (read-only)</p>
          {dryRunLoading ? (
            <p className="text-xs text-gray-500">Loading…</p>
          ) : s ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs max-w-2xl">
                <Stat label="Folders Scanned" value={s.totalFoldersScanned} />
                <Stat label="Card Folders" value={s.totalCardFoldersFound} />
                <Stat label="Matched (eligible)" value={s.matchedCardFolders} tone="green" />
                <Stat label="Already Imported" value={dryRun?.report?.alreadyImportedImages ?? 0} tone="green" />
                <Stat label="Unmatched" value={s.unmatchedCardFolders} tone="amber" />
                <Stat label="Wrong Image Count" value={s.cardFoldersNotExactlyTwoImages} tone="amber" />
                <Stat label="Unresolved Front/Back" value={s.ambiguousImagePairs} tone="amber" />
                <Stat label="Structure Oddities" value={s.foldersWithUnexpectedStructure} tone="amber" />
                <Stat label="Duplicate Matches" value={s.duplicateCardMatches} tone="amber" />
              </div>
              <p className="text-xs text-gray-500 mt-1.5">Scanned: {new Date(dryRun!.report!.ranAt).toLocaleString()}</p>
            </>
          ) : (
            <p className="text-xs text-gray-500">No scan yet — run a dry run to see what's in the Drive folder.</p>
          )}
        </div>

        {/* Last import batch */}
        {imp && (
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Last Import Batch{" "}
              {imp.status === "running" ? (
                <span className="text-blue-600">(in progress…)</span>
              ) : imp.status === "failed" ? (
                <span className="text-red-600">(failed{imp.fatalError ? `: ${imp.fatalError}` : ""})</span>
              ) : (
                <span className="text-green-600">(completed)</span>
              )}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs max-w-2xl">
              <Stat label="Images Uploaded" value={imp.summary.uploadedImages} tone="green" />
              <Stat label="Cards Updated" value={imp.summary.updatedCardRecords} tone="green" />
              <Stat label="Skipped: Already Imported" value={imp.summary.skippedAlreadyImported} />
              <Stat label="Skipped: Has Image" value={imp.summary.skippedExistingImages} />
              <Stat label="Skipped: Unmatched" value={imp.summary.skippedUnmatchedFolders} />
              <Stat label="Skipped: Wrong Count" value={imp.summary.skippedWrongImageCount} />
              <Stat
                label="Failures"
                value={imp.summary.failedCloudinaryUploads + imp.summary.failedDatabaseUpdates}
                tone={imp.summary.failedCloudinaryUploads + imp.summary.failedDatabaseUpdates > 0 ? "red" : undefined}
              />
              <Stat label="Folders Left" value={imp.summary.foldersRemainingEligible} />
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Started: {new Date(imp.ranAt).toLocaleString()}
              {imp.finishedAt ? ` · Finished: ${new Date(imp.finishedAt).toLocaleString()}` : ""}
            </p>
            {imp.failures.length > 0 && (
              <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 max-w-2xl max-h-32 overflow-y-auto">
                {imp.failures.slice(0, 20).map((f, i) => (
                  <p key={i} className="truncate">{f.folderPath} — {f.stage}: {f.error}</p>
                ))}
                {imp.failures.length > 20 && <p>…and {imp.failures.length - 20} more</p>}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => dryRunMutation.mutate()}
            disabled={dryRunMutation.isPending || dryRunRunning || importRunning}
          >
            <Search className="h-3 w-3 mr-1.5" />
            {dryRunMutation.isPending || dryRunRunning ? "Scanning… (takes a couple of minutes)" : "Run Dry Run (safe, read-only)"}
          </Button>
          <Button
            size="sm"
            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => { setConfirmText(""); setImportDialogOpen(true); }}
            disabled={importRunning || dryRunMutation.isPending || dryRunRunning}
          >
            <Upload className="h-3 w-3 mr-1.5" />
            {importRunning ? "Import Running…" : "Run Import"}
          </Button>
        </div>

        {/* Confirm dialog: must type IMPORT */}
        <Dialog open={importDialogOpen} onOpenChange={(open) => { setImportDialogOpen(open); if (!open) setConfirmText(""); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" /> Confirm Drive Image Import
              </DialogTitle>
              <DialogDescription className="text-left pt-2 space-y-2">
                <span className="block">
                  This uploads eligible Drive images to Cloudinary and updates matching card image records. It will skip
                  unmatched, wrong-count, ambiguous, already-imported, and existing-image records.
                </span>
                <span className="block">
                  Existing card images are never overwritten. Type <strong>IMPORT</strong> to confirm.
                </span>
              </DialogDescription>
            </DialogHeader>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type IMPORT to confirm"
              className="bg-white text-gray-900"
              autoComplete="off"
            />
            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={() => setImportDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={confirmText !== "IMPORT" || importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? "Starting…" : "Start Import"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

      {/* Drive image sync: dry-run + confirm-gated import */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <FolderSync className="h-5 w-5 text-emerald-600" /> Drive Image Sync
        </h2>
        <DriveSyncCard />
      </div>

      <Separator />

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
