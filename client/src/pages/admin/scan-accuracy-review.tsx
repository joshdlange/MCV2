import { useCallback, useEffect, useRef, useState } from "react";
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
  archivedAt?: string | null;
  isArchived?: boolean;
  canonicalCardId?: number | null;
  equivalentCardIds?: number[];
  equivalenceStatus?: string | null;
  equivalence?: { status?: string; canonicalCardId?: number | null; equivalentCardIds?: number[] } | null;
  canonicalActiveId?: number | null;
  equivalentIds?: number[];
  possibleMatches?: number[];
  equivalenceBasis?: string | null;
  imageIssues?: ImageIssue[];
};
type ImageIssue = { id?: number | string; cardId?: number; type: string; note?: string | null; createdAt?: string };
type Classification = {
  side: "front" | "back" | "uncertain";
  sideEvidence?: string;
  ocrTag: "empty" | "weak" | "contradictory" | "useful";
  ocrEvidence?: string;
  unresolvedReason?: string | null;
  metadataParsing?: { status: "unreviewed" | "supported" | "contradictory"; reason: string };
  note?: string;
  reviewerId?: number | null;
  classifiedAt?: string | null;
};
type Decision = {
  status: "confirmed" | "unresolved" | "skipped";
  cardId: number | null;
  note: string | null;
  blockedBySearch?: boolean;
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
  imageIssues?: ImageIssue[];
  searchBlocked?: { blocked: boolean; note?: string };
  legacyEvidence?: { suspectedSearchBlocked?: boolean; reviewerReportedImageIssue?: boolean };
  classification?: Classification;
  eligibility?: Record<string, unknown>;
  reviewEvidence?: {
    ocr?: unknown;
    vision?: unknown;
    cardNumber?: unknown;
    historicalCandidateRankingContaminated?: boolean;
    note?: string;
  };
  imageOnlyCase?: boolean;
  evaluationCohort?: { cohort: string; reason: string | null };
  ocr: unknown;
  vision: unknown;
  confidence?: unknown;
  decision: Decision | null;
};
type ReviewData = {
  datasetHash: string;
  items: Scan[];
  progress: { total: number; reviewed: number; confirmed: number; unresolved: number; skipped?: number; remaining: number; percent: number };
  benchmark: Record<string, unknown> | null;
  dataQuality?: Record<string, unknown> | null;
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

const ISSUE_TYPES = [
  ["wrong-card-image", "Wrong card image"], ["wrong-parallel-image", "Wrong parallel image"],
  ["front-back-swapped", "Front/back swapped"], ["poor-crop", "Poor crop"],
  ["missing-image", "Missing image"], ["low-quality", "Low quality"], ["other", "Other"],
] as const;
const UNRESOLVED_REASONS = [
  "cannot identify exact card", "search tool could not find card", "only back image available",
  "bad/missing catalog image", "duplicate/archived catalog ambiguity",
  "insufficient image quality", "other",
] as const;

function CandidateRow({ candidate, selected, onSelect, label, issues, onFlag, onClear, flagPending, flagError }: {
  candidate: Candidate; selected: boolean; onSelect: () => void; label?: string;
  issues?: ImageIssue[];
  onFlag?: (type: string, note: string) => void;
  onClear?: () => void;
  flagPending?: boolean;
  flagError?: string;
}) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const archived = candidate.isArchived || !!candidate.archivedAt;
  const canonicalId = candidate.canonicalActiveId ?? candidate.equivalence?.canonicalCardId ?? candidate.canonicalCardId;
  const equivalents = candidate.equivalentIds ?? candidate.equivalence?.equivalentCardIds ?? candidate.equivalentCardIds;
  const equivalenceStatus = candidate.equivalence?.status ?? candidate.equivalenceStatus;
  const candidateIssues = issues?.filter(issue => issue.cardId === candidate.cardId) ?? candidate.imageIssues ?? [];
  return (
    <div className={`w-full rounded-lg border p-3 ${selected ? "border-red-500 bg-red-50 ring-1 ring-red-500" : "border-gray-200"}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className="w-full flex gap-3 text-left transition-colors hover:opacity-80">
        <ReviewImage url={candidate.imageUrl} alt={`Reference: ${candidate.name}`} className="w-28 h-40 shrink-0 rounded object-contain bg-gray-100" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="font-semibold text-gray-900">{candidate.name}</span>
            {label && <Badge variant="secondary">{label}</Badge>}
            {archived && <Badge variant="outline" className="border-orange-400 text-orange-800">Archived</Badge>}
            {selected && <Badge className="bg-red-600">Selected, not saved</Badge>}
          </div>
          <p className="text-xs text-gray-600">{candidate.year ?? "Year unavailable"} · {candidate.mainSetName || "Main set unavailable"} · {candidate.subsetName || "Subset unavailable"} · #{candidate.cardNumber || "unavailable"}</p>
          <p className="text-xs text-gray-500">Card ID {candidate.cardId} · Confidence: {candidate.confidence ?? "Unavailable"} · Similarity: {candidate.similarity ?? "Unavailable"}</p>
          {candidate.confidenceLevel && <p className="text-xs text-gray-500">Confidence level: {candidate.confidenceLevel}</p>}
          {candidate.matchReasons != null && <p className="text-xs text-gray-500">Match reasons: {detail(candidate.matchReasons)}</p>}
          {!!(equivalents?.length || candidate.possibleMatches?.length || (archived && canonicalId)) && <p className="text-xs text-amber-800">
            {equivalenceStatus === "verified" ? "Verified equivalent" : "Possible equivalent — matching catalog metadata only; not visually verified"}
            {canonicalId ? ` · suggested active ID ${canonicalId}` : " · active equivalent unverified"}
            {equivalents?.length ? ` · matching IDs ${equivalents.join(", ")}` : ""}
            {candidate.possibleMatches?.length ? ` · other possible IDs ${candidate.possibleMatches.join(", ")}` : ""}
            {candidate.equivalenceBasis ? ` · basis: ${candidate.equivalenceBasis.replaceAll("-", " ")}` : ""}
          </p>}
          {archived && !canonicalId && <p className="text-xs text-orange-800">Active equivalent not found or unverified</p>}
        </div>
      </button>
      {candidateIssues.length > 0 && <div className="mt-2 flex items-center gap-2">
        <p className="text-xs text-orange-800">Catalog image issue flagged: {candidateIssues.map(issue => `${issue.type.replaceAll("-", " ")}${issue.note ? ` — ${issue.note}` : ""}`).join(", ")}</p>
        {onClear && <Button variant="ghost" size="sm" disabled={flagPending} onClick={onClear}>Clear image issue</Button>}
      </div>}
      {onFlag && <div className="mt-2 border-t pt-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setFlagOpen(!flagOpen)}>Flag image issue (independent of card label)</Button>
        {flagOpen && <div className="mt-2 space-y-2 rounded bg-amber-50 p-2">
          <label className="block text-xs font-medium" htmlFor={`issue-type-${candidate.cardId}`}>Issue type</label>
          <select id={`issue-type-${candidate.cardId}`} value={issueType} onChange={e => setIssueType(e.target.value)} className="w-full rounded border bg-white p-2 text-sm">
            <option value="">Choose issue type</option>
            {ISSUE_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
          <Input aria-label={`Image issue note for card ${candidate.cardId}`} maxLength={500} value={issueNote} onChange={e => setIssueNote(e.target.value)} placeholder="Optional image issue note" />
          <Button type="button" size="sm" disabled={!issueType || flagPending} onClick={() => onFlag(issueType, issueNote.trim())}>{flagPending ? "Saving flag…" : "Save image issue only"}</Button>
          {flagError && <p role="alert" className="text-xs text-red-700">Image issue save failed: {flagError}</p>}
        </div>}
      </div>
      }
    </div>
  );
}

type CatalogResults = { cards: Candidate[]; total: number; limit?: number; offset?: number; hasMore?: boolean };
function ScanReview({ scan, datasetHash, onSaved, onUpdated, onPending, actionRef }: {
  scan: Scan; datasetHash: string; onSaved: (data: ReviewData) => void; onUpdated: (data: ReviewData) => void;
  onPending: (pending: boolean) => void;
  actionRef: React.MutableRefObject<((action: string) => void) | null>;
}) {
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [note, setNote] = useState(scan.decision?.note ?? "");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ year: "", mainSet: "", subset: "", cardNumber: "", status: "all" });
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [flagCardId, setFlagCardId] = useState<number | null>(null);
  const [flagMessage, setFlagMessage] = useState("");
  const [blockedNote, setBlockedNote] = useState("");
  const [side, setSide] = useState(scan.classification?.sideEvidence === "admin-classification" ? scan.classification.side : "");
  const [ocrTag, setOcrTag] = useState(scan.classification?.ocrEvidence === "admin-classification" ? scan.classification.ocrTag : "");
  const [parsingStatus, setParsingStatus] = useState(scan.classification?.metadataParsing?.status ?? "unreviewed");
  const [parsingReason, setParsingReason] = useState(scan.classification?.metadataParsing?.reason ?? "");
  const [classificationNote, setClassificationNote] = useState(scan.classification?.note ?? "");
  const [reason, setReason] = useState(scan.classification?.unresolvedReason ?? "");
  const [classificationMessage, setClassificationMessage] = useState("");
  const [zoom, setZoom] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(0), [debounced, filters]);
  const query = new URLSearchParams({ q: debounced, status: filters.status, limit: "30", page: String(page + 1) });
  for (const field of ["year", "mainSet", "subset", "cardNumber"] as const) {
    if (filters[field].trim()) query.set(field, filters[field].trim());
  }
  const hasSearch = !!(debounced || filters.year || filters.mainSet || filters.subset || filters.cardNumber || filters.status !== "all");
  const validYear = !filters.year || /^\d{4}$/.test(filters.year);
  const catalog = useQuery<CatalogResults>({
    queryKey: ["/api/admin/scan-review/catalog", query.toString()],
    queryFn: async () => (await apiRequest("GET", `/api/admin/scan-review/catalog?${query}`)).json(),
    enabled: hasSearch && validYear,
  });
  const outOfYearCount = filters.year ? (catalog.data?.cards ?? []).filter(card => String(card.year) !== filters.year).length : 0;
  const displayedCards = (catalog.data?.cards ?? []).filter(card => !filters.year || String(card.year) === filters.year);
  const flag = useMutation({
    mutationFn: async ({ cardId, type, note, remove }: { cardId: number; type?: string; note?: string; remove?: boolean }) =>
      (await apiRequest(remove ? "DELETE" : "PUT", `/api/admin/scan-review/${scan.scanId}/image-issues/${cardId}`,
        remove ? { datasetHash } : { datasetHash, type, note })).json() as Promise<ReviewData>,
    onMutate: ({ cardId }) => { setFlagCardId(cardId); setFlagMessage(""); },
    onSuccess: (result, variables) => { onUpdated(result); setFlagMessage(`Catalog image issue ${variables.remove ? "cleared" : "saved"} separately; card identity unchanged.`); },
  });
  const blocked = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", `/api/admin/scan-review/${scan.scanId}/search-blocked`, { datasetHash, blocked: !scan.searchBlocked?.blocked, note: blockedNote.trim() })).json() as Promise<ReviewData>,
    onSuccess: result => onUpdated(result),
  });
  const classification = useMutation({
    mutationFn: async (fields: Record<string, unknown>) =>
      (await apiRequest("PUT", `/api/admin/scan-review/${scan.scanId}/classification`, { datasetHash, ...fields })).json() as Promise<ReviewData>,
    onSuccess: result => { onUpdated(result); setClassificationMessage("Classification saved independently of card identity."); },
  });
  const save = useMutation({
    mutationFn: async ({ status, cardId }: { status: "confirmed" | "unresolved" | "skipped"; cardId?: number }) => {
      const labeled = await (await apiRequest("PUT", `/api/admin/scan-review/${encodeURIComponent(scan.scanId)}`, {
        datasetHash, status, ...(status === "confirmed" ? { cardId } : {}), note: note.trim(),
      })).json() as ReviewData;
      if (status !== "unresolved" || !reason) return labeled;
      // The optional reason has its own persisted record; never mix it into the identity decision.
      try {
        return (await apiRequest("PUT", `/api/admin/scan-review/${scan.scanId}/classification`,
          { datasetHash, unresolvedReason: reason })).json() as Promise<ReviewData>;
      } catch (error) {
        onUpdated(labeled);
        throw new Error(`Unresolved decision saved, but reason was not saved: ${error instanceof Error ? error.message : String(error)}. Save the reason separately below.`);
      }
    },
    onSuccess: data => {
      onSaved(data);
      setSelected(null);
    },
  });
  useEffect(() => {
    onPending(save.isPending || flag.isPending || blocked.isPending || classification.isPending);
    return () => onPending(false);
  }, [save.isPending, flag.isPending, blocked.isPending, classification.isPending, onPending]);
  const top = scan.candidates.find(c => c.cardId === scan.topCardId);
  const candidates = scan.candidates.slice(0, 5);
  actionRef.current = action => {
    if (save.isPending || flag.isPending || blocked.isPending || classification.isPending || zoom) return;
    if (action === "search") { searchRef.current?.focus(); return; }
    if (action === "unresolved") { save.mutate({ status: "unresolved" }); return; }
    const position = Number(action) - 1;
    if (position >= 0 && position < candidates.length) save.mutate({ status: "confirmed", cardId: candidates[position].cardId });
  };
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
        <Card><CardHeader><CardTitle className="text-base">Historical extraction — evidence only</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-amber-800">Saved OCR/vision guesses may be wrong. They do not constrain catalog search or the correct card label.</p>
            {scan.legacyEvidence?.suspectedSearchBlocked && <p className="text-xs text-amber-800">Historical note suggests search difficulty; not a verified search-blocked flag.</p>}
            {scan.legacyEvidence?.reviewerReportedImageIssue && <p className="text-xs text-amber-800">Historical note mentions a wrong image; not a verified image-issue type. Review and flag it separately if appropriate.</p>}
            <div><strong>Overall confidence:</strong> {detail(scan.confidence)}</div>
            <div><strong>Historical OCR</strong><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">{detail(scan.ocr)}</pre></div>
            <div><strong>Historical vision</strong><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs">{detail(scan.vision)}</pre></div>
            {scan.reviewEvidence && <div className="rounded border border-blue-200 bg-blue-50 p-3">
              <strong>Sanitized extraction (separate from historical snapshot)</strong>
              {scan.reviewEvidence.ocr !== undefined && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">OCR: {detail(scan.reviewEvidence.ocr)}</pre>}
              {scan.reviewEvidence.vision !== undefined && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">Vision: {detail(scan.reviewEvidence.vision)}</pre>}
              {scan.reviewEvidence.cardNumber !== undefined && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">Card-number evidence: {detail(scan.reviewEvidence.cardNumber)}</pre>}
              {scan.reviewEvidence.historicalCandidateRankingContaminated && <p className="mt-2 text-amber-900">Historical candidate rankings may contain null-token contamination; preserved for audit, not used as ground truth.</p>}
              {scan.reviewEvidence.note && <p className="mt-1 text-blue-900">{scan.reviewEvidence.note}</p>}
            </div>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Scan classification · separate from correct-card label</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-gray-600">Classify the actual photo and text evidence explicitly. A default “uncertain” or derived OCR tag is not an admin classification. Empty OCR is a valid image-only case.</p>
            <div className="rounded bg-gray-50 p-2 text-xs">
              Current side: <strong>{scan.classification?.side ?? "Not classified"}</strong>
              {" · "}{scan.classification?.sideEvidence ?? "No evidence recorded"}
              <br />Current OCR tag: <strong>{scan.classification?.ocrTag ?? "Not classified"}</strong>
              {" · "}{scan.classification?.ocrEvidence ?? "No evidence recorded"}
            </div>
            {scan.imageOnlyCase && <p className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
              Image-only case: OCR is empty, not a failure or a forced metadata fallback. Front visual eligibility still depends on identity, photo side and catalog quality.
            </p>}
            <label className="block text-xs font-medium">Actual photo side
              <select aria-label="Actual photo side" value={side} onChange={e => setSide(e.target.value as typeof side)}
                className="w-full rounded border bg-white p-2 text-sm">
                <option value="">No new side classification</option>
                <option value="front">Front</option><option value="back">Back</option><option value="uncertain">Uncertain</option>
              </select>
            </label>
            <label className="block text-xs font-medium">OCR evidence quality
              <select aria-label="OCR evidence quality" value={ocrTag} onChange={e => setOcrTag(e.target.value as typeof ocrTag)}
                className="w-full rounded border bg-white p-2 text-sm">
                <option value="">No new OCR classification</option>
                <option value="empty">Empty (valid image-only)</option><option value="weak">Weak</option>
                <option value="contradictory">Contradictory</option><option value="useful">Useful</option>
              </select>
            </label>
            <label className="block text-xs font-medium">Metadata parsing evidence
              <select aria-label="Metadata parsing evidence" value={parsingStatus} onChange={e => setParsingStatus(e.target.value as typeof parsingStatus)}
                className="w-full rounded border bg-white p-2 text-sm">
                <option value="unreviewed">Unreviewed</option><option value="supported">Supported by scan/catalog</option>
                <option value="contradictory">Contradictory / misparsed</option>
              </select>
            </label>
            {parsingStatus !== "unreviewed" && <Input aria-label="Metadata parsing reason" maxLength={500} value={parsingReason}
              onChange={e => setParsingReason(e.target.value)} placeholder="Required evidence: what was supported or contradicted?" />}
            <Input aria-label="Classification note" maxLength={500} value={classificationNote}
              onChange={e => setClassificationNote(e.target.value)} placeholder="Optional classification note" />
            <Button variant="outline" disabled={classification.isPending || (!side && !ocrTag && parsingStatus === "unreviewed" && !classificationNote.trim()) ||
              (parsingStatus !== "unreviewed" && !parsingReason.trim())}
              onClick={() => {
                setClassificationMessage("");
                classification.mutate({
                  ...(side ? { side } : {}), ...(ocrTag ? { ocrTag } : {}),
                  ...(parsingStatus !== "unreviewed" || scan.classification?.metadataParsing?.status !== "unreviewed" && scan.classification?.metadataParsing?.status !== undefined
                    ? { metadataParsing: { status: parsingStatus, reason: parsingStatus === "unreviewed" ? "" : parsingReason.trim() } } : {}),
                  ...(classificationNote.trim() ? { note: classificationNote.trim() } : {}),
                });
              }}>{classification.isPending ? "Saving classification…" : "Save classification only"}</Button>
            {classificationMessage && <p role="status" className="text-xs text-green-700">{classificationMessage}</p>}
            {classification.isError && <p role="alert" className="text-xs text-red-700">Classification save failed: {classification.error.message}</p>}
            <div className="rounded border bg-gray-50 p-2 text-xs">
              <strong>Server-assessed benchmark eligibility (not an accuracy score)</strong>
              {scan.eligibility ? <div className="mt-1 space-y-1">
                {([
                  ["frontImageRetrieval", "A · Front image retrieval"],
                  ["backOcr", "B · Back/OCR"],
                  ["metadataParsing", "C · Metadata parsing"],
                  ["excludedDueToToolCatalogIssue", "D · Excluded: review tool/catalog"],
                ] as const).map(([key, label]) => <p key={key}>{label}: <strong>
                  {typeof scan.eligibility?.[key] === "boolean" ? scan.eligibility[key] ? "Yes" : "No" : "Unavailable"}
                </strong></p>)}
                {Array.isArray(scan.eligibility.reasons) && scan.eligibility.reasons.length > 0 &&
                  <p>Assessment reasons: {scan.eligibility.reasons.join(", ")}</p>}
              </div> : <p className="mt-1 text-gray-600">Eligibility unavailable until assessed by the server. Nothing is inferred from OCR or a guessed side.</p>}
            </div>
            {scan.evaluationCohort && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
              <strong>Regression / holdout provenance</strong>
              <p className="mt-1">Cohort: {scan.evaluationCohort.cohort}{scan.evaluationCohort.reason ? ` · ${scan.evaluationCohort.reason}` : ""}</p>
              <p>Engineering regression examples are not untouched holdout scans. No holdout is claimed from reviewed examples.</p>
            </div>}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">Historical suggested matches — evidence only</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">Historical top match: {top ? `${top.name} (ID ${top.cardId})` : scan.topCardId ? `Card ID ${scan.topCardId} — details unavailable` : "Unavailable"}. Saved rankings may contain old OCR errors. Select a candidate to review it; selection alone does not save.</p>
            {candidates.length ? candidates.map((candidate, i) =>
              <CandidateRow key={candidate.cardId} candidate={candidate} label={candidate.cardId === scan.topCardId ? "Top suggestion" : `Candidate ${i + 1}`}
                selected={selected?.cardId === candidate.cardId} onSelect={() => setSelected(candidate)}
                issues={scan.imageIssues} onFlag={(type, note) => flag.mutate({ cardId: candidate.cardId, type, note })}
                onClear={() => flag.mutate({ cardId: candidate.cardId, remove: true })}
                flagPending={flag.isPending && flagCardId === candidate.cardId}
                flagError={flag.isError && flagCardId === candidate.cardId ? flag.error.message : undefined} />
            ) : <p className="text-sm text-amber-700">No candidates available. Search the catalog or mark unresolved.</p>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Search catalog for correct card</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Combined terms: 2026 Cyclops, Topps Chrome Invisible Woman…" className="pl-9" aria-label="Search catalog" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["year", "mainSet", "subset", "cardNumber"] as const).map(field => (
                <label key={field} className="text-xs text-gray-600">{({ year: "Year", mainSet: "Main set", subset: "Subset", cardNumber: "Card number" })[field]}
                  <Input value={filters[field]} onChange={e => setFilters(previous => ({ ...previous, [field]: e.target.value }))}
                    {...(field === "year" ? { inputMode: "numeric" as const, maxLength: 4 } : {})}
                    aria-label={`Catalog ${({ year: "year", mainSet: "main set", subset: "subset", cardNumber: "card number" })[field]}`} />
                </label>
              ))}
            </div>
            <label className="block text-xs text-gray-600">Record status
              <select aria-label="Catalog record status" className="w-full rounded border bg-white p-2 text-sm" value={filters.status}
                onChange={e => setFilters(previous => ({ ...previous, status: e.target.value }))}>
                <option value="all">Active + archived</option><option value="active">Active only</option><option value="archived">Archived only</option>
              </select>
            </label>
            {!validYear && <p className="text-xs text-amber-800">Enter a four-digit year to apply the year filter.</p>}
            <p className="text-xs text-gray-500">Text and filters combine across name, year, set, subset and card number. Archived records are searchable. Results ordered by relevance.</p>
            {catalog.isFetching && <p className="text-sm text-gray-500">Searching…</p>}
            {catalog.isError && <p role="alert" className="text-sm text-red-700">Catalog search failed: {(catalog.error as Error).message}</p>}
            {outOfYearCount > 0 && <p role="alert" className="text-sm text-red-700">
              Search returned {outOfYearCount} out-of-year record(s); hidden. Year {filters.year} is strict. Server count/range may be unreliable until this is fixed.
            </p>}
            {hasSearch && catalog.data && <p role="status" className="text-sm font-medium text-gray-700">
              {catalog.data.total} results · showing {catalog.data.total ? page * 30 + 1 : 0}–{Math.min((page * 30) + catalog.data.cards.length, catalog.data.total)}
              {" · "}{catalog.data.hasMore ?? (page * 30 + catalog.data.cards.length < catalog.data.total) ? "more available" : "no more results"}
            </p>}
            {hasSearch && !catalog.isFetching && catalog.data?.cards.length === 0 && <p className="text-sm text-gray-500">No cards found. Try another spelling, remove a filter, or include archived records.</p>}
            {displayedCards.map(candidate => (
              <CandidateRow key={candidate.cardId} candidate={candidate} label="Catalog" selected={selected?.cardId === candidate.cardId}
                onSelect={() => setSelected(candidate)} issues={scan.imageIssues}
                onFlag={(type, note) => flag.mutate({ cardId: candidate.cardId, type, note })}
                onClear={() => flag.mutate({ cardId: candidate.cardId, remove: true })}
                flagPending={flag.isPending && flagCardId === candidate.cardId}
                flagError={flag.isError && flagCardId === candidate.cardId ? flag.error.message : undefined} />
            ))}
            {hasSearch && catalog.data && <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || catalog.isFetching} onClick={() => setPage(n => n - 1)}>Previous results</Button>
              <Button variant="outline" size="sm" disabled={catalog.isFetching || !(catalog.data.hasMore ?? ((page + 1) * 30 < catalog.data.total))} onClick={() => setPage(n => n + 1)}>Next results</Button>
            </div>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Review decision</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {scan.decision ? <div className="text-sm rounded bg-green-50 border border-green-200 p-3 text-green-900">
              Saved: {scan.decision.status === "confirmed" ? `Confirmed card ID ${scan.decision.cardId}` : scan.decision.status === "skipped" ? "Skipped for now" : "Unresolved"} · Reviewer {scan.decision.reviewerId} · {scan.decision.reviewedAt ? new Date(scan.decision.reviewedAt).toLocaleString() : "Timestamp unavailable"}
              {scan.decision.note && <p className="mt-1">Note: {scan.decision.note}</p>}
              {scan.decision.status === "confirmed" && scan.selectedCard && (
                <div className="mt-3 rounded bg-white p-2 text-gray-900">
                  <p className="text-xs font-semibold mb-2">Saved correct card</p>
                  <CandidateRow candidate={scan.selectedCard} selected={false} onSelect={() => setSelected(scan.selectedCard!)}
                    issues={scan.imageIssues} onFlag={(type, note) => flag.mutate({ cardId: scan.selectedCard!.cardId, type, note })}
                    onClear={() => flag.mutate({ cardId: scan.selectedCard!.cardId, remove: true })}
                    flagPending={flag.isPending && flagCardId === scan.selectedCard.cardId}
                    flagError={flag.isError && flagCardId === scan.selectedCard.cardId ? flag.error.message : undefined} />
                </div>
              )}
            </div> : <p className="text-sm text-amber-700">Not reviewed yet.</p>}
            {selected && !scan.candidates.some(candidate => candidate.cardId === selected.cardId) && !catalog.data?.cards.some(candidate => candidate.cardId === selected.cardId) &&
              <CandidateRow candidate={selected} label="Selected from catalog" selected onSelect={() => {}}
                issues={scan.imageIssues} onFlag={(type, note) => flag.mutate({ cardId: selected.cardId, type, note })}
                onClear={() => flag.mutate({ cardId: selected.cardId, remove: true })}
                flagPending={flag.isPending && flagCardId === selected.cardId}
                flagError={flag.isError && flagCardId === selected.cardId ? flag.error.message : undefined} />}
            <label htmlFor="review-note" className="text-sm font-medium">Optional note / reason</label>
            <Input id="review-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Short reason (saved with your decision)" />
            <label className="block text-xs font-medium">Optional unresolved reason (separate from card identity)
              <select aria-label="Unresolved reason" value={reason} onChange={e => setReason(e.target.value)}
                className="w-full rounded border bg-white p-2 text-sm">
                <option value="">No reason selected</option>
                {UNRESOLVED_REASONS.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            {scan.decision?.status === "unresolved" && <Button variant="outline" size="sm" disabled={classification.isPending}
              onClick={() => classification.mutate({ unresolvedReason: reason || null })}>
              {classification.isPending ? "Saving reason…" : "Save / clear unresolved reason only"}
            </Button>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!top || save.isPending} onClick={() => save.mutate({ status: "confirmed", cardId: scan.topCardId! })}>Confirm top match</Button>
              <Button variant="outline" disabled={!selected || save.isPending} onClick={() => selected && save.mutate({ status: "confirmed", cardId: selected.cardId })}>Confirm selected card{selected ? ` (ID ${selected.cardId})` : ""}</Button>
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "unresolved" })}>Mark unresolved</Button>
              <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ status: "skipped" })}>Skip for now</Button>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-xs text-amber-900">Blocked by search is a separate review-tool issue, not a card identity label. Mark this if you cannot find the correct catalog record.</p>
              <Input value={blockedNote} onChange={e => setBlockedNote(e.target.value)} maxLength={500} aria-label="Search blocker note" placeholder="Optional search blocker note" />
              <Button variant="outline" size="sm" disabled={blocked.isPending} onClick={() => blocked.mutate()}>
                {blocked.isPending ? "Saving…" : scan.searchBlocked?.blocked ? "Clear blocked by search" : "Mark blocked by search"}
              </Button>
              {scan.searchBlocked?.blocked && <p className="text-xs text-amber-900">Blocked by search is saved. {scan.searchBlocked.note}</p>}
              {blocked.isError && <p role="alert" className="text-xs text-red-700">Search blocker save failed: {blocked.error.message}</p>}
            </div>
            {flagMessage && <p role="status" className="text-sm text-amber-800">{flagMessage}</p>}
            {save.isPending && <p role="status" className="text-sm text-blue-700 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving decision…</p>}
            {save.isSuccess && !save.isPending && <p role="status" className="text-sm text-green-700">Decision saved to the server.</p>}
            {save.isError && <p role="alert" className="text-sm text-red-700">Save failed: {save.error.message}</p>}
            <p className="text-xs text-gray-500">Shortcuts: 1–5 confirm candidate at that position, U unresolved, S focus search, ←/→ change scan. Shortcuts pause while typing or a dialog is open. Choosing a card alone never saves.</p>
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
  const [activeScanId, setActiveScanId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("unreviewed");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const actionRef = useRef<((action: string) => void) | null>(null);
  const onPending = useCallback((pending: boolean) => setSaving(pending), []);
  const review = useQuery<ReviewData>({
    queryKey: ["/api/admin/scan-review"],
    enabled: import.meta.env.DEV && !!currentUser?.isAdmin,
    staleTime: 0,
  });
  const data = review.data;
  const items = data?.items ?? [];
  const filtered = items.filter(item => statusFilter === "all" ||
    (statusFilter === "unreviewed" ? !item.decision : item.decision?.status === statusFilter));
  const currentIndex = filtered.findIndex(item => item.scanId === activeScanId);
  const effectiveIndex = currentIndex >= 0 ? currentIndex : 0;
  const current = filtered[effectiveIndex];
  const navigate = (direction: number) => {
    if (saving) return;
    const target = filtered[effectiveIndex + direction];
    if (target) { setActiveScanId(target.scanId); setSavedMessage(""); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || saving || !current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable='true'],[role='combobox'],[role='dialog']") ||
        document.querySelector("[role='dialog'][data-state='open']")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
      } else if (/^[1-5]$/.test(event.key) || event.key.toLowerCase() === "u" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        actionRef.current?.(event.key.toLowerCase() === "u" ? "unresolved" : event.key.toLowerCase() === "s" ? "search" : event.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const update = (updated: ReviewData) => queryClient.setQueryData<ReviewData>(["/api/admin/scan-review"], updated);
  const saveDecision = (updated: ReviewData) => {
    update(updated);
    setSavedMessage(`Saved scan ${current.scanId}.`);
    const oldIndex = items.findIndex(item => item.scanId === current.scanId);
    const next = [...updated.items.slice(oldIndex + 1), ...updated.items.slice(0, oldIndex + 1)].find(item => !item.decision);
    if (next) {
      setStatusFilter("unreviewed");
      setActiveScanId(next.scanId);
    } else {
      setStatusFilter("all");
      setActiveScanId(current.scanId);
    }
  };
  if (!import.meta.env.DEV || !currentUser?.isAdmin) return <div className="p-6"><Card><CardContent className="py-12 text-center text-gray-700"><ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-3" />{!import.meta.env.DEV ? "Scan review is only available in development" : "Admin access required"}</CardContent></Card></div>;
  const report = data?.dataQuality;
  const unresolvedReasons = data?.items.filter(item => item.decision?.status === "unresolved")
    .reduce<Record<string, number>>((counts, item) => {
      const name = item.classification?.unresolvedReason ?? "No reason recorded";
      counts[name] = (counts[name] ?? 0) + 1;
      return counts;
    }, {}) ?? {};
  const results = data?.benchmark?.results && typeof data.benchmark.results === "object"
    ? data.benchmark.results as Record<string, unknown> : null;
  return <div className="p-4 md:p-6 space-y-5 bg-slate-50 text-gray-900">
    <div className="flex flex-wrap justify-between gap-3 items-start">
      <div><Link href="/admin/data-quality" className="text-sm text-red-700 hover:underline">← Data Quality</Link>
        <h1 className="text-2xl font-bebas tracking-wide text-gray-900">Scan Accuracy Review</h1>
        <p className="text-sm text-gray-600">Development-only saved scan review. Identity labels, search blockers, and catalog-image issues are separate. No catalog or indexing changes.</p>
      </div>
      <Button variant="outline" onClick={() => void review.refetch()} disabled={review.isFetching}><RefreshCw className={`h-4 w-4 mr-2 ${review.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {review.isLoading && <p role="status" className="flex gap-2 text-gray-600"><Loader2 className="animate-spin h-5 w-5" />Loading saved scans…</p>}
    {review.isError && <Card><CardContent className="py-5 text-red-700" role="alert">Could not load saved scans: {review.error.message} <Button variant="outline" className="ml-3" onClick={() => void review.refetch()}>Retry</Button></CardContent></Card>}
    {data && <>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2" aria-label="Review progress">
        {(["total", "reviewed", "confirmed", "unresolved", "skipped", "remaining", "percent"] as const).map(key =>
          <Card key={key}><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-gray-900">{data.progress[key] ?? 0}{key === "percent" ? "%" : ""}</p><p className="text-xs capitalize text-gray-500">{key === "percent" ? "Complete" : key}</p></CardContent></Card>
        )}
      </div>
      {savedMessage && <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">{savedMessage} Showing next unreviewed scan, if any.</div>}
      <Card><CardHeader><CardTitle className="text-base">Pre-benchmark data quality</CardTitle></CardHeader><CardContent>
        {report ? <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {([
            ["total", "Total scans"], ["confirmed", "Confirmed"], ["unresolved", "Unresolved"], ["skipped", "Skipped"],
            ["scansBlockedBySearch", "Search-blocked or suspected"], ["confirmedCardsWithEquivalentIds", "Confirmed with equivalent IDs"],
            ["confirmedCardsWithFlaggedCatalogImageIssues", "Confirmed with flagged/reported image issues"],
            ["confirmedCardsMissingUsableReferenceImages", "Confirmed missing usable references"],
            ["confirmedLabelsSuitableForVisualBenchmark", "Suitable visual labels"],
          ] as const).map(([key, label]) => <div key={key} className="rounded bg-gray-50 p-2">
            <strong className="block text-lg">{detail(report[key])}</strong><span className="text-gray-600">{label}</span>
          </div>)}
        </div> : <p className="text-sm text-gray-600">Data quality report unavailable; do not infer benchmark readiness.</p>}
        {report && <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            {([["reviewedFront", "Front"], ["reviewedBack", "Back"], ["reviewedUncertain", "Uncertain / not explicitly classified"]] as const)
              .map(([key, label]) => <div className="rounded border border-blue-200 bg-blue-50 p-2" key={key}>
                <strong className="block text-xl">{detail(report[key])}</strong>{label}
              </div>)}
          </div>
          <p className="text-xs text-gray-600">Side counts include source-labeled defaults (e.g. uncertain without admin classification); review each scan’s evidence source. Back scans are not scored as failed front artwork matches.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {([
              ["frontImageRetrievalEligible", "A · Front visual retrieval"],
              ["backOcrEligible", "B · Back/OCR"],
              ["metadataParsingEligible", "C · Metadata parsing"],
              ["excludedDueToToolCatalogIssue", "D · Excluded: review tool/catalog"],
            ] as const).map(([key, label]) => <div key={key} className="rounded border p-2"><strong className="block text-lg">{detail(report[key])}</strong>{label}</div>)}
          </div>
          <p className="text-xs text-gray-600">Confirmed empty-OCR image-only cases: {detail(report.confirmedOcrEmpty)}. Empty OCR does not invalidate image-first cases.</p>
          <div className="rounded border p-3"><strong>Unresolved reasons (optional reviewer classification)</strong>
            {Object.entries(unresolvedReasons).length ? <ul className="mt-1 text-xs text-gray-600">
              {Object.entries(unresolvedReasons).map(([name, count]) => <li key={name}>{name}: {count}</li>)}
            </ul> : <p className="text-xs text-gray-600">No unresolved decisions.</p>}
            <p className="mt-1 text-xs text-amber-800">Search-blocked or suspected: {detail(report.scansBlockedBySearch)} (including legacy note suspicions: {detail(report.legacySuspectedSearchBlocked)}). Legacy notes are not verified flags; neither indicates a retrieval failure.</p>
          </div>
          <p className="text-xs text-gray-600">Development regression examples: {Array.isArray(report.regressionDevelopmentScans) ? report.regressionDevelopmentScans.join(", ") : "Unavailable"} · untouched holdout assigned: {detail(report.holdoutAssigned)}. Do not report tuned examples as holdout accuracy.</p>
        </div>}
        {typeof report?.suitabilityCriteria === "string" && <p className="mt-3 text-xs text-gray-600">{report.suitabilityCriteria}</p>}
        {typeof report?.provenance === "string" && <p className="mt-1 text-xs text-gray-600">{report.provenance}</p>}
      </CardContent></Card>
      <Card><CardContent className="pt-4 space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div><strong>Retrieval benchmark — not authorized</strong><p className="text-xs text-amber-800">Disabled pending explicit approval. Do not run recognition accuracy or resume indexing during review cleanup.</p></div>
          <Button disabled title="Benchmark is not authorized">Run benchmark (disabled)</Button>
        </div>
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
          <label htmlFor="status-filter" className="text-sm font-medium">Show</label>
          <select id="status-filter" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setActiveScanId(null); setSavedMessage(""); }}
            className="rounded-md border border-gray-300 bg-white text-gray-900 p-2 text-sm">
            <option value="unreviewed">Unreviewed</option><option value="confirmed">Confirmed</option>
            <option value="unresolved">Unresolved</option><option value="skipped">Skipped</option><option value="all">All 60 scans</option>
          </select>
          <Button variant="outline" size="sm" disabled={effectiveIndex <= 0 || saving || !current} onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
          <label htmlFor="scan-picker" className="text-sm font-medium">Scan {filtered.length ? effectiveIndex + 1 : 0} of {filtered.length} shown ({items.length} total)</label>
          <select id="scan-picker" value={current?.scanId ?? ""} onChange={e => { setActiveScanId(Number(e.target.value)); setSavedMessage(""); }}
            disabled={!current || saving} className="rounded-md border border-gray-300 bg-white text-gray-900 p-2 text-sm max-w-[260px]">
            {filtered.map(item => <option value={item.scanId} key={item.scanId}>{items.findIndex(all => all.scanId === item.scanId) + 1}. {item.filename} — {item.decision?.status ?? "unreviewed"}</option>)}
          </select>
          <Button variant="outline" size="sm" disabled={effectiveIndex >= filtered.length - 1 || saving || !current} onClick={() => navigate(1)}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>
        {current ? <ScanReview key={current.scanId} scan={current} datasetHash={data.datasetHash}
          onSaved={saveDecision} onUpdated={update} onPending={onPending} actionRef={actionRef} /> :
          <p className="rounded border bg-white p-5 text-gray-600">No scans in this filter. Choose All to reach every saved scan, including skipped ones.</p>}
      </> : <p className="text-sm text-amber-700">No saved scans available in this development dataset.</p>}
    </>}
  </div>;
}