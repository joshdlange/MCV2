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
    batchId: string;
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

interface DriveImportSummary {
  eligibleFolders: number;
  uploadedImages: number;
  updatedCardRecords: number;
  replacedDeadPlaceholders: number;
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
}

interface ImportReportResponse {
  running: boolean;
  job: {
    batchId: string;
    jobType: "dry_run" | "import";
    mode: "incremental" | "full_audit";
    status: "running" | "completed" | "failed" | "interrupted";
    stage?: string | null;
    folderListings: number;
    totalSetFolders: number;
    processedSetFolders: number;
    currentSet?: string | null;
    cardFoldersProcessed: number;
    imagesUploaded: number;
    cardsUpdated: number;
    scanErrorsCount: number;
    skippedSetsUnchanged: number;
    latestError?: string | null;
    detail?: {
      summary?: DriveImportSummary;
      incrementalStrategy?: string;
      skippedUnchangedSets?: number;
      scanErrorsCount?: number;
      scanIncomplete?: boolean;
      cursorAdvanced?: boolean;
      failedSets?: number;
    } | null;
    startedAt: string;
    heartbeatAt: string;
    finishedAt?: string | null;
  } | null;
  report: {
    ranAt: string;
    finishedAt?: string;
    status: "running" | "completed" | "failed";
    mode?: "incremental" | "full_audit";
    incrementalStrategy?: "changes_cursor" | "checkpoint_cache" | "baseline_full" | "full_audit";
    skippedUnchangedSets?: number;
    scanErrorsCount?: number;
    scanIncomplete?: boolean;
    fatalError?: string;
    options: { maxFolders: number | null; overwrite: boolean };
    summary: DriveImportSummary;
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
  const [importMode, setImportMode] = useState<"incremental" | "full_audit" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [readiness, setReadiness] = useState<{ ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }> } | null>(null);

  const readinessMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/drive-sync/readiness");
      return res.json();
    },
    onSuccess: (data) => {
      setReadiness(data);
      toast(data.ok
        ? { title: "All systems go", description: "Google Drive, Cloudinary, and the database are all reachable." }
        : { title: "Something's not ready", description: "See the check results below.", variant: "destructive" });
    },
    onError: (err: any) => {
      setReadiness(null);
      toast({ title: "Connection test failed", description: String(err?.message || "Check the server logs."), variant: "destructive" });
    },
  });

  const { data: dryRun, isLoading: dryRunLoading } = useQuery<DryRunSummaryResponse>({
    queryKey: ["/api/admin/drive-sync/last-report?summary=1"],
    refetchInterval: (q) => (q.state.data?.running ? 10000 : false),
  });

  const { data: importData } = useQuery<ImportReportResponse>({
    queryKey: ["/api/admin/drive-sync/import-report"],
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });

  const importRunning = importData?.running === true || importData?.job?.status === "running";
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
    mutationFn: async (mode: "incremental" | "full_audit") => {
      const endpoint = mode === "full_audit"
        ? "/api/admin/drive-sync/full-audit"
        : "/api/admin/drive-sync/import";
      const res = await apiRequest("POST", endpoint, {
        confirm: mode === "full_audit" ? "FULL_AUDIT" : "IMPORT",
      });
      return res.json();
    },
    onSuccess: (_data, mode) => {
      toast({
        title: mode === "full_audit" ? "Full audit started" : "Drive sync started",
        description: "Running safely in the background. Live progress appears below.",
      });
      setImportMode(null);
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
  const job = importData?.job;
  // The rich report lives in process memory. Only combine it with the durable
  // job when both refer to the same batch; another autoscale instance may hold
  // an older report.
  const imp = importData?.report && (!job || importData.report.batchId === job.batchId)
    ? importData.report
    : null;
  const persistedSummary = job?.detail?.summary;
  const displaySummary = imp?.summary ?? persistedSummary;
  const displayedFailures = (displaySummary?.failedCloudinaryUploads ?? 0)
    + (displaySummary?.failedDatabaseUpdates ?? 0);
  const jobHasIssues = Boolean(
    job?.latestError
    || job?.scanErrorsCount
    || job?.detail?.scanIncomplete
    || job?.detail?.failedSets
    || displayedFailures,
  );
  const progressPercent = job?.totalSetFolders
    ? Math.min(100, Math.round((job.processedSetFolders / job.totalSetFolders) * 100))
    : 0;
  const statusLabel = job?.status === "running"
    ? "Running"
    : job?.status === "completed"
      ? (jobHasIssues ? "Completed with issues" : "Completed")
      : job?.status === "interrupted"
        ? "Interrupted — safe to resume"
        : job?.status === "failed"
          ? "Failed"
          : "Idle";
  const stageLabel = (job?.stage || "waiting").replace(/_/g, " ");

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
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Syncing
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
        {/* Durable job status: survives app restarts and autoscale instances */}
        {job && (
          <div className={`rounded-lg border p-3 max-w-2xl ${
            job.status === "running"
              ? "bg-blue-50 border-blue-200"
              : job.status === "completed" && !jobHasIssues
                ? "bg-green-50 border-green-200"
                : "bg-amber-50 border-amber-200"
          }`}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <p className="text-xs font-semibold text-gray-900">
                  {job.mode === "full_audit" ? "Full Archive Audit" : "New & Changed Image Sync"} — {statusLabel}
                </p>
                <p className="text-xs text-gray-600 capitalize">
                  Stage: {stageLabel}{job.currentSet ? ` · Current set: ${job.currentSet}` : ""}
                </p>
              </div>
              {job.status === "running" && (
                <span className="text-xs font-semibold text-blue-700">{progressPercent}%</span>
              )}
            </div>
            {job.status === "running" && job.totalSetFolders > 0 && (
              <div className="h-2 rounded-full bg-blue-100 overflow-hidden mb-2">
                <div
                  className="h-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs">
              <Stat label="Set Folders" value={`${job.processedSetFolders}/${job.totalSetFolders || "?"}`} />
              <Stat label="Drive Listings" value={job.folderListings.toLocaleString()} />
              <Stat label="Card Folders" value={job.cardFoldersProcessed.toLocaleString()} />
              <Stat label="Images Uploaded" value={job.imagesUploaded.toLocaleString()} tone="green" />
              <Stat label="Cards Updated" value={job.cardsUpdated.toLocaleString()} tone="green" />
              <Stat label="Unchanged Sets Skipped" value={job.skippedSetsUnchanged.toLocaleString()} />
              <Stat label="Scan Errors" value={job.scanErrorsCount.toLocaleString()} tone={job.scanErrorsCount ? "amber" : undefined} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Started: {new Date(job.startedAt).toLocaleString()}
              {job.finishedAt ? ` · Finished: ${new Date(job.finishedAt).toLocaleString()}` : ""}
            </p>
            {job.latestError && (
              <p className="text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded p-2 mt-2 break-words">
                Latest issue: {job.latestError}
              </p>
            )}
          </div>
        )}

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
        {(imp || (job && displaySummary)) && (
          <div>
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Latest Sync Results{" "}
              {(imp?.status ?? job?.status) === "running" ? (
                <span className="text-blue-600">(in progress…)</span>
              ) : (imp?.status ?? job?.status) === "failed" ? (
                <span className="text-red-600">(failed{imp?.fatalError ? `: ${imp.fatalError}` : ""})</span>
              ) : job?.status === "interrupted" ? (
                <span className="text-amber-600">(interrupted — run again to resume safely)</span>
              ) : (
                <span className="text-green-600">(completed)</span>
              )}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs max-w-2xl">
              <Stat label="Images Uploaded" value={displaySummary?.uploadedImages ?? 0} tone="green" />
              <Stat label="Cards Updated" value={displaySummary?.updatedCardRecords ?? 0} tone="green" />
              <Stat label="Dead Placeholders Replaced" value={displaySummary?.replacedDeadPlaceholders ?? 0} tone="green" />
              <Stat label="Skipped: Already Imported" value={displaySummary?.skippedAlreadyImported ?? 0} />
              <Stat label="Skipped: Has Image" value={displaySummary?.skippedExistingImages ?? 0} />
              <Stat label="Skipped: Unmatched" value={displaySummary?.skippedUnmatchedFolders ?? 0} />
              <Stat label="Skipped: Wrong Count" value={displaySummary?.skippedWrongImageCount ?? 0} />
              <Stat
                label="Failures"
                value={displayedFailures}
                tone={displayedFailures > 0 ? "red" : undefined}
              />
              <Stat label="Folders Left" value={displaySummary?.foldersRemainingEligible ?? 0} />
            </div>
            {(imp?.incrementalStrategy || job?.detail?.incrementalStrategy) && (
              <p className="text-xs text-gray-500 mt-1.5">
                Strategy: {String(imp?.incrementalStrategy || job?.detail?.incrementalStrategy || "safe scan").replace(/_/g, " ")}
                {(imp?.skippedUnchangedSets || job?.skippedSetsUnchanged)
                  ? ` · ${imp?.skippedUnchangedSets ?? job?.skippedSetsUnchanged} unchanged set(s) skipped`
                  : ""}
                {typeof job?.detail?.changeRecordsProcessed === "number"
                  ? ` · ${job.detail.changeRecordsProcessed} Drive change(s) checked`
                  : ""}
              </p>
            )}
            {imp && imp.failures.length > 0 && (
              <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 max-w-2xl max-h-32 overflow-y-auto">
                {imp.failures.slice(0, 20).map((f, i) => (
                  <p key={i} className="truncate">{f.folderPath} — {f.stage}: {f.error}</p>
                ))}
                {imp.failures.length > 20 && <p>…and {imp.failures.length - 20} more</p>}
              </div>
            )}
          </div>
        )}

        {/* Readiness check results */}
        {readiness && (
          <div className={`rounded-lg border p-3 max-w-2xl ${readiness.ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <p className={`text-xs font-semibold mb-1.5 ${readiness.ok ? "text-green-800" : "text-amber-800"}`}>
              {readiness.ok ? "✓ Ready — everything is connected" : "Not ready — fix the items marked below"}
            </p>
            <div className="space-y-1">
              {readiness.checks.map((c) => (
                <div key={c.name} className="flex items-start gap-1.5 text-xs">
                  {c.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-px" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-px" />
                  )}
                  <span className="font-medium text-gray-800">{c.name}:</span>
                  <span className={c.ok ? "text-gray-600" : "text-red-700"}>{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => readinessMutation.mutate()}
            disabled={readinessMutation.isPending}
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${readinessMutation.isPending ? "animate-spin" : ""}`} />
            {readinessMutation.isPending ? "Testing…" : "Test Connection"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => dryRunMutation.mutate()}
            disabled={dryRunMutation.isPending || dryRunRunning || importRunning}
          >
            <Search className="h-3 w-3 mr-1.5" />
            {dryRunMutation.isPending || dryRunRunning ? "Auditing… (may take a while)" : "Preview Full Audit (read-only)"}
          </Button>
          <Button
            size="sm"
            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => { setConfirmText(""); setImportMode("incremental"); }}
            disabled={importRunning || dryRunMutation.isPending || dryRunRunning}
          >
            <Upload className="h-3 w-3 mr-1.5" />
            {importRunning ? "Sync Running…" : "Sync New & Changed Images"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs text-amber-700 border-amber-300"
            onClick={() => { setConfirmText(""); setImportMode("full_audit"); }}
            disabled={importRunning || dryRunMutation.isPending || dryRunRunning}
          >
            <Search className="h-3 w-3 mr-1.5" />
            Full Archive Audit & Import
          </Button>
        </div>

        {/* Confirmation is stricter for the rare, expensive full archive audit. */}
        <Dialog open={importMode !== null} onOpenChange={(open) => { if (!open) { setImportMode(null); setConfirmText(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                {importMode === "full_audit" ? "Confirm Full Archive Audit" : "Confirm Drive Image Sync"}
              </DialogTitle>
              <DialogDescription className="text-left pt-2 space-y-2">
                <span className="block">
                  {importMode === "full_audit"
                    ? "This deliberately checks the entire Drive archive before importing. Use it for recovery or after a major folder reorganization—not for everyday updates."
                    : "This checks only new, changed, previously incomplete, or retryable Drive work, then imports exact matches."}
                </span>
                <span className="block">
                  Existing card images are never overwritten. Type{" "}
                  <strong>{importMode === "full_audit" ? "FULL_AUDIT" : "IMPORT"}</strong> to confirm.
                </span>
              </DialogDescription>
            </DialogHeader>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${importMode === "full_audit" ? "FULL_AUDIT" : "IMPORT"} to confirm`}
              className="bg-white text-gray-900"
              autoComplete="off"
            />
            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={() => setImportMode(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={
                  !importMode
                  || confirmText !== (importMode === "full_audit" ? "FULL_AUDIT" : "IMPORT")
                  || importMutation.isPending
                }
                onClick={() => importMode && importMutation.mutate(importMode)}
              >
                {importMutation.isPending
                  ? "Starting…"
                  : importMode === "full_audit"
                    ? "Start Full Audit"
                    : "Start Sync"}
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
