import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, ShieldAlert, ZoomIn } from "lucide-react";

type Candidate = {
  cardId: number;
  name: string;
  year: string | number | null;
  mainSetName: string | null;
  subsetName: string | null;
  cardNumber: string | null;
  imageUrl: string | null;
  confidence?: number | null;
  confidenceLevel?: string | null;
  matchReasons?: unknown;
  similarity?: number | null;
};
type Decision = {
  status: "confirmed" | "unresolved";
  cardId: number | null;
  note: string | null;
  reviewerId: number | string;
  reviewedAt: string;
};
type Scan = {
  scanId: number;
  imageHash: string;
  filename: string;
  imageUrl: string;
  topCardId: number | null;
  candidates: Candidate[];
  selectedCard?: Candidate | null;
  ocr: unknown;
  vision: unknown;
  confidence?: unknown;
  decision: Decision | null;
};
type ReviewData = {
  datasetHash: string;
  items: Scan[];
  progress: { total: number; reviewed: number; confirmed: number; unresolved: number; remaining: number; percent: number };
  benchmark: Record<string, unknown> | null;
};

// Private scan photos (and any private candidate URLs) need Firebase authorization.
// Never put a private endpoint directly in an img src.
function ReviewImage({ url, alt, className }: { url: string | null | undefined; alt: string; className: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!url) { setSrc(null); setError(""); return; }
    if (!url.startsWith("/")) {
      setSrc(url);
      setError("");
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    setSrc(null);
    setError("");
    apiRequest("GET", url).then(res => res.blob()).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Image unavailable"); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  if (!url) return <div className={`${className} flex items-center justify-center bg-gray-100 text-xs text-gray-500 text-center p-2`}>Reference image unavailable</div>;
  if (error) return <div className={`${className} flex items-center justify-center bg-red-50 text-xs text-red-700 text-center p-2`}>Image unavailable: {error}</div>;
  if (!src) return <div className={`${className} flex items-center justify-center bg-gray-100 text-gray-500`}><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return <img src={src} alt={alt} className={className} onError={() => setError("Could not display image")} />;
}

function detail(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function accuracy(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "Unavailable";
}

function CandidateRow({ candidate, selected, onSelect, label }: {
  candidate: Candidate; selected: boolean; onSelect: () => void; label?: string;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={`w-full rounded-lg border p-3 flex gap-3 text-left transition-colors ${selected ? "border-red-500 bg-red-50 ring-1 ring-red-500" : "border-gray-200 hover:bg-gray-50"}`}>
      <ReviewImage url={candidate.imageUrl} alt={`Reference: ${candidate.name}`} className="w-20 h-28 shrink-0 rounded object-contain bg-gray-100" />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="font-semibold text-gray-900">{candidate.name}</span>
          {label && <Badge variant="secondary">{label}</Badge>}
          {selected && <Badge className="bg-red-600">Selected, not saved</Badge>}
        </div>
        <p className="text-xs text-gray-600">{candidate.year ?? "Year unavailable"} · {candidate.mainSetName || "Main set unavailable"} · {candidate.subsetName || "Subset unavailable"} · #{candidate.cardNumber || "unavailable"}</p>
        <p className="text-xs text-gray-500">Card ID {candidate.cardId} · Confidence: {candidate.confidence ?? "Unavailable"} · Similarity: {candidate.similarity ?? "Unavailable"}</p>
        {candidate.confidenceLevel && <p className="text-xs text-gray-500">Confidence level: {candidate.confidenceLevel}</p>}
        {candidate.matchReasons != null && <p className="text-xs text-gray-500">Match reasons: {detail(candidate.matchReasons)}</p>}
      </div>
    </button>
  );
}

function ScanReview({ scan, datasetHash, onSaved }: { scan: Scan; datasetHash: string; onSaved: (data: ReviewData) => void }) {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [note, setNote] = useState(scan.decision?.note ?? "");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const catalog = useQuery<{ cards: Candidate[] }>({
    queryKey: ["/api/admin/scan-review/catalog", debounced],
    queryFn: async () => (await apiRequest("GET", `/api/admin/scan-review/catalog?q=${encodeURIComponent(debounced)}`)).json(),
    enabled: debounced.length >= 2,
  });
  const save = useMutation({
    mutationFn: async ({ status, cardId }: { status: "confirmed" | "unresolved"; cardId?: number }) =>
      (await apiRequest("PUT", `/api/admin/scan-review/${encodeURIComponent(scan.scanId)}`, {
        datasetHash, status, ...(status === "confirmed" ? { cardId } : {}), note: note.trim(),
      })).json() as Promise<ReviewData>,
    onSuccess: data => {
      onSaved(data);
      setSelected(null);
    },
  });
  const top = scan.candidates.find(c => c.cardId === scan.topCardId);
  const candidates = scan.candidates.slice(0, 5);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,0.85fr)_minmax(360px,1.15fr)] gap-5">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Actual saved scan</CardTitle></CardHeader>
          <CardContent>
            <button type="button" onClick={() => setZoom(true)} className="w-full group relative" aria-label="Zoom actual scan">
              <ReviewImage url={scan.imageUrl} alt={`Saved scan ${scan.filename}`} className="w-full max-h-[620px] min-h-64 rounded object-contain bg-gray-100" />
              <span className="absolute right-2 bottom-2 bg-black/75 text-white text-xs rounded px-2 py-1 flex items-center gap-1"><ZoomIn className="h-3 w-3" /> Zoom</span>
            </button>
            <p className="text-xs text-gray-500 mt-3 break-all">Scan ID: {scan.scanId} · File: {scan.filename}</p>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Extracted evidence</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><strong>Overall confidence:</strong> {detail(scan.confidence)}</div>
            <div><strong>OCR</strong><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">{detail(scan.ocr)}</pre></div>
            <div><strong>Vision</strong><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">{detail(scan.vision)}</pre></div>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">Suggested matches</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">Top match: {top ? `${top.name} (ID ${top.cardId})` : scan.topCardId ? `Card ID ${scan.topCardId} — details unavailable` : "Unavailable"}. Select a candidate to review it; selection alone does not save.</p>
            {candidates.length ? candidates.map((candidate, i) =>
              <CandidateRow key={candidate.cardId} candidate={candidate} label={candidate.cardId === scan.topCardId ? "Top suggestion" : `Candidate ${i + 1}`}
                selected={selected?.cardId === candidate.cardId} onSelect={() => setSelected(candidate)} />
            ) : <p className="text-sm text-amber-700">No candidates available. Search the catalog or mark unresolved.</p>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Search catalog for correct card</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search card name, set or number (2+ characters)" className="pl-9" aria-label="Search catalog" />
            </div>
            {catalog.isFetching && <p className="text-sm text-gray-500">Searching…</p>}
            {catalog.isError && <p role="alert" className="text-sm text-red-700">Catalog search failed: {(catalog.error as Error).message}</p>}
            {debounced.length >= 2 && !catalog.isFetching && catalog.data?.cards.length === 0 && <p className="text-sm text-gray-500">No cards found.</p>}
            {catalog.data?.cards.map(candidate => (
              <CandidateRow key={candidate.cardId} candidate={candidate} label="Catalog" selected={selected?.cardId === candidate.cardId} onSelect={() => setSelected(candidate)} />
            ))}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Review decision</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {scan.decision ? <div className="text-sm rounded bg-green-50 border border-green-200 p-3 text-green-900">
              Saved: {scan.decision.status === "confirmed" ? `Confirmed card ID ${scan.decision.cardId}` : "Unresolved"} · Reviewer {scan.decision.reviewerId} · {scan.decision.reviewedAt ? new Date(scan.decision.reviewedAt).toLocaleString() : "Timestamp unavailable"}
              {scan.decision.note && <p className="mt-1">Note: {scan.decision.note}</p>}
              {scan.decision.status === "confirmed" && scan.selectedCard && (
                <div className="mt-3 rounded bg-white p-2 text-gray-900">
                  <p className="text-xs font-semibold mb-2">Saved correct card</p>
                  <CandidateRow candidate={scan.selectedCard} selected={false} onSelect={() => setSelected(scan.selectedCard!)} />
                </div>
              )}
            </div> : <p className="text-sm text-amber-700">Not reviewed yet.</p>}
            <label htmlFor="review-note" className="text-sm font-medium">Optional note / reason</label>
            <Input id="review-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Short reason (saved with your decision)" />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!top || save.isPending} onClick={() => save.mutate({ status: "confirmed", cardId: scan.topCardId! })}>Confirm top match</Button>
              <Button variant="outline" disabled={!selected || save.isPending} onClick={() => selected && save.mutate({ status: "confirmed", cardId: selected.cardId })}>Confirm selected card{selected ? ` (ID ${selected.cardId})` : ""}</Button>
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "unresolved" })}>Mark unresolved</Button>
            </div>
            {save.isPending && <p role="status" className="text-sm text-blue-700 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving decision…</p>}
            {save.isSuccess && !save.isPending && <p role="status" className="text-sm text-green-700">Decision saved to the server.</p>}
            {save.isError && <p role="alert" className="text-sm text-red-700">Save failed: {save.error.message}. Your decision was not saved; retry.</p>}
          </CardContent>
        </Card>
      </div>
      <Dialog open={zoom} onOpenChange={setZoom}><DialogContent className="max-w-5xl bg-white text-gray-900">
        <DialogHeader><DialogTitle>Actual scan — {scan.filename}</DialogTitle></DialogHeader>
        <ReviewImage url={scan.imageUrl} alt={`Enlarged scan ${scan.filename}`} className="w-full max-h-[80vh] object-contain bg-gray-100" />
      </DialogContent></Dialog>
    </div>
  );
}

export default function AdminScanAccuracyReview() {
  const { currentUser } = useAppStore();
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [benchmarkMessage, setBenchmarkMessage] = useState("");
  const review = useQuery<ReviewData>({
    queryKey: ["/api/admin/scan-review"],
    enabled: import.meta.env.DEV && !!currentUser?.isAdmin,
    refetchInterval: query => {
      const status = String(query.state.data?.benchmark?.status ?? "").toLowerCase();
      return ["queued", "running", "pending", "processing"].includes(status) ? 3000 : false;
    },
    staleTime: 0,
  });
  const benchmark = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/scan-review/benchmark")).json(),
    onSuccess: result => {
      setBenchmarkMessage(`Benchmark requested: ${detail(result)}`);
      void review.refetch();
    },
  });
  if (!import.meta.env.DEV || !currentUser?.isAdmin) return <div className="p-6"><Card><CardContent className="py-12 text-center text-gray-700"><ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-3" />{!import.meta.env.DEV ? "Scan review is only available in development" : "Admin access required"}</CardContent></Card></div>;
  const data = review.data;
  const items = data?.items ?? [];
  const current = items[Math.min(index, items.length - 1)];
  const confirmed = data?.progress.confirmed ?? 0;
  const results = data?.benchmark?.results && typeof data.benchmark.results === "object"
    ? data.benchmark.results as Record<string, unknown> : null;
  return <div className="p-4 md:p-6 space-y-5 bg-slate-50 text-gray-900">
    <div className="flex flex-wrap justify-between gap-3 items-start">
      <div><Link href="/admin/data-quality" className="text-sm text-red-700 hover:underline">← Data Quality</Link>
        <h1 className="text-2xl font-bebas tracking-wide text-gray-900">Scan Accuracy Review</h1>
        <p className="text-sm text-gray-600">Development-only saved scan review. Decisions are written on explicit confirmation or unresolved; no catalog or indexing changes.</p>
      </div>
      <Button variant="outline" onClick={() => void review.refetch()} disabled={review.isFetching}><RefreshCw className={`h-4 w-4 mr-2 ${review.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {review.isLoading && <p role="status" className="flex gap-2 text-gray-600"><Loader2 className="animate-spin h-5 w-5" />Loading saved scans…</p>}
    {review.isError && <Card><CardContent className="py-5 text-red-700" role="alert">Could not load saved scans: {review.error.message} <Button variant="outline" className="ml-3" onClick={() => void review.refetch()}>Retry</Button></CardContent></Card>}
    {data && <>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {(["total", "reviewed", "confirmed", "unresolved", "remaining", "percent"] as const).map(key =>
          <Card key={key}><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-gray-900">{data.progress[key]}{key === "percent" ? "%" : ""}</p><p className="text-xs capitalize text-gray-500">{key === "percent" ? "Complete" : key}</p></CardContent></Card>
        )}
      </div>
      <Card><CardContent className="pt-4 space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div><strong>Retrieval benchmark</strong><p className="text-xs text-gray-600">Requires at least 50 confirmed labels ({confirmed}/50). Uses saved decisions directly; indexing remains paused.</p></div>
          <Button disabled={confirmed < 50 || benchmark.isPending || ["running", "queued", "pending", "processing"].includes(String(data.benchmark?.status ?? "").toLowerCase())}
            onClick={() => benchmark.mutate()}>{benchmark.isPending ? "Starting…" : data.benchmark?.status === "running" ? "Benchmark running…" : "Run benchmark"}</Button>
        </div>
        {benchmark.isError && <p role="alert" className="text-sm text-red-700">Benchmark failed: {benchmark.error.message}</p>}
        {benchmarkMessage && <p role="status" className="text-xs text-blue-700 break-words">{benchmarkMessage}</p>}
        {data.benchmark ? <div className="rounded bg-gray-50 p-3 text-xs text-gray-700">
          <p className="font-semibold">Status: {detail(data.benchmark.status)}</p>
          {results && "indexedLabelCoverage" in results ? (
              <>
                <p>Indexed ground-truth labels: {detail(results.indexedLabelCoverage)} / {detail(results.confirmedLabels)}
                  {" "}({detail(results.unindexedLabels)} unindexed).</p>
                <p>All-label accuracy (includes unindexed and failed retrievals): Top-1 {accuracy(results.top1Accuracy)} · Top-3 {accuracy(results.top3Accuracy)} · Top-10 {accuracy(results.top10Accuracy)}</p>
              </>
            ) : <p>Index coverage: unavailable until benchmark completes; do not assume full coverage.</p>}
          <pre className="mt-2 whitespace-pre-wrap break-words">{detail(data.benchmark)}</pre>
        </div> : <p className="text-xs text-gray-500">No benchmark result yet. Index coverage unavailable.</p>}
      </CardContent></Card>
      {items.length ? <>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" size="sm" disabled={index <= 0} onClick={() => setIndex(i => i - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
          <label htmlFor="scan-picker" className="text-sm font-medium">Scan {index + 1} of {items.length}</label>
          <select id="scan-picker" value={index} onChange={e => setIndex(Number(e.target.value))} className="rounded-md border border-gray-300 bg-white text-gray-900 p-2 text-sm max-w-[260px]">
            {items.map((item, i) => <option value={i} key={item.scanId}>{i + 1}. {item.filename} — {item.decision?.status ?? "remaining"}</option>)}
          </select>
          <Button variant="outline" size="sm" disabled={index >= items.length - 1} onClick={() => setIndex(i => i + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
        <ScanReview key={current.scanId} scan={current} datasetHash={data.datasetHash}
          onSaved={updated => queryClient.setQueryData<ReviewData>(["/api/admin/scan-review"], updated)} />
      </> : <p className="text-sm text-amber-700">No saved scans available in this development dataset.</p>}
    </>}
  </div>;
}