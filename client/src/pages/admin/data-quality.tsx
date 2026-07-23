import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  ShieldAlert, Download, RefreshCw, ChevronDown, ChevronRight, Loader2, AlertTriangle, CheckCircle2, Search,
} from "lucide-react";

type Classification =
  | "OK_PARALLEL" | "NEEDS_CARD_NUMBER_FIX" | "NEEDS_SUBSET_SPLIT"
  | "TRUE_DUPLICATE_RECORD" | "NEEDS_MANUAL_REVIEW" | "KNOWN_EXCEPTION";

interface DupCard {
  cardId: number;
  cardName: string;
  cardNumber: string;
  variation: string | null;
  frontImageUrl: string | null;
  proposedCardNumber?: string;
}

interface ProposedFix {
  cardId: number;
  currentCardNumber: string;
  currentCardName: string;
  proposedCardNumber?: string;
  proposedAction: "update_card_number" | "merge_into_survivor" | "manual_review";
  survivorCardId?: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  riskLevel: "low" | "medium" | "high";
}

interface DupGroup {
  groupKey: string;
  mainSet: string;
  subset: string;
  setId: number;
  cardNumber: string;
  copies: number;
  classification: Classification;
  confidence: "high" | "medium" | "low";
  reason: string;
  riskLevel: "low" | "medium" | "high";
  cards: DupCard[];
  proposedFixes: ProposedFix[];
}

interface AnalysisResult {
  summary: {
    totalGroups: number;
    totalCards: number;
    byClassification: Record<Classification, number>;
  };
  groups: DupGroup[];
}

interface ImpactCounts {
  collectionRecords: number;
  collectionUsers: number;
  wishlistRecords: number;
  pcBinderRecords: number;
  pendingImageRecords: number;
  marketplaceListings: number;
  priceCacheRecords: number;
  xpEventRecords: number;
}

const CLASSIFICATION_META: Record<Classification, { label: string; className: string }> = {
  OK_PARALLEL: { label: "OK — Parallel", className: "bg-green-100 text-green-800 border-green-200" },
  NEEDS_CARD_NUMBER_FIX: { label: "Card # Fix", className: "bg-blue-100 text-blue-800 border-blue-200" },
  NEEDS_SUBSET_SPLIT: { label: "Subset Split", className: "bg-orange-100 text-orange-800 border-orange-200" },
  TRUE_DUPLICATE_RECORD: { label: "True Duplicate", className: "bg-red-100 text-red-800 border-red-200" },
  NEEDS_MANUAL_REVIEW: { label: "Manual Review", className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  KNOWN_EXCEPTION: { label: "Known Exception", className: "bg-gray-100 text-gray-700 border-gray-200" },
};

const RISK_META = {
  high: "bg-red-100 text-red-800 border-red-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-green-100 text-green-800 border-green-200",
} as const;

function ImpactTable({ impact }: { impact: ImpactCounts }) {
  const rows: [string, number][] = [
    ["User collection records", impact.collectionRecords],
    ["Users affected", impact.collectionUsers],
    ["Wishlist records", impact.wishlistRecords],
    ["PC Binder records", impact.pcBinderRecords],
    ["Pending image submissions", impact.pendingImageRecords],
    ["Marketplace listings", impact.marketplaceListings],
    ["Price cache records", impact.priceCacheRecords],
    ["XP events", impact.xpEventRecords],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
      {rows.map(([label, n]) => (
        <div key={label} className="flex justify-between border-b border-gray-100 py-1">
          <span className="text-gray-600">{label}</span>
          <span className={`font-medium ${n > 0 ? "text-gray-900" : "text-gray-400"}`}>{n}</span>
        </div>
      ))}
    </div>
  );
}

function GroupRow({ group }: { group: DupGroup }) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<ImpactCounts | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [confirmDialog, setConfirmDialog] = useState<"fix" | "merge" | null>(null);
  const { toast } = useToast();

  const meta = CLASSIFICATION_META[group.classification];
  const numberFixes = group.proposedFixes.filter((f) => f.proposedAction === "update_card_number" && f.proposedCardNumber);
  const mergeFixes = group.proposedFixes.filter((f) => f.proposedAction === "merge_into_survivor");
  const survivorId = mergeFixes[0]?.survivorCardId;

  const impactMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/data-quality/impact", {
        cardIds: group.cards.map((c) => c.cardId),
      });
      return res.json();
    },
    onSuccess: (data) => setImpact(data),
    onError: () => toast({ title: "Failed to load impact counts", variant: "destructive" }),
  });

  const fixMutation = useMutation({
    mutationFn: async (confirm: boolean) => {
      const res = await apiRequest("POST", "/api/admin/data-quality/fix-card-numbers", {
        fixes: numberFixes.map((f) => ({
          cardId: f.cardId,
          expectedCurrentNumber: f.currentCardNumber,
          newCardNumber: f.proposedCardNumber!,
        })),
        confirm,
      });
      return res.json();
    },
    onSuccess: (data, confirm) => {
      if (confirm) {
        toast({ title: `Applied ${data.applied} card number fix${data.applied === 1 ? "" : "es"}` });
        setConfirmDialog(null);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/data-quality/duplicates"] });
      } else {
        setDryRunResult({ type: "fix", ...data });
        toast({ title: `Dry run: ${data.preview.length} fix(es) valid, ${data.skipped.length} skipped. No data changed.` });
      }
    },
    onError: (e: Error) => toast({ title: "Fix failed", description: e.message, variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: async (confirm: boolean) => {
      const res = await apiRequest("POST", "/api/admin/data-quality/merge-duplicates", {
        survivorCardId: survivorId,
        duplicateCardIds: mergeFixes.map((f) => f.cardId),
        confirm,
      });
      return res.json();
    },
    onSuccess: (data, confirm) => {
      if (confirm) {
        toast({ title: `Merged ${data.merged} duplicate(s) into card ${survivorId}. Duplicates were archived, not deleted.` });
        setConfirmDialog(null);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/data-quality/duplicates"] });
      } else {
        setDryRunResult({ type: "merge", ...data });
        setImpact(data.impact);
        toast({ title: "Dry run complete. Review impact below — no data changed." });
      }
    },
    onError: (e: Error) => toast({ title: "Merge failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="border border-gray-200">
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50"
        onClick={() => setOpen(!open)}
        data-testid={`group-row-${group.groupKey}`}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {group.mainSet} → {group.subset} — #{group.cardNumber}
          </p>
          <p className="text-xs text-gray-500 truncate">{group.reason}</p>
        </div>
        <Badge variant="outline" className={RISK_META[group.riskLevel]}>{group.riskLevel} risk</Badge>
        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
        <Badge variant="secondary">{group.copies} cards</Badge>
      </button>

      {open && (
        <CardContent className="pt-0 pb-4 space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Card ID</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Current #</th>
                  <th className="text-left px-3 py-2">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {group.cards.map((c) => {
                  const fix = group.proposedFixes.find((f) => f.cardId === c.cardId);
                  return (
                    <tr key={c.cardId} className="border-t">
                      <td className="px-3 py-1.5 text-gray-600">{c.cardId}{survivorId === c.cardId && <Badge className="ml-2 bg-green-600">survivor</Badge>}</td>
                      <td className="px-3 py-1.5 text-gray-900">{c.cardName}</td>
                      <td className="px-3 py-1.5 text-gray-600">{c.cardNumber}</td>
                      <td className="px-3 py-1.5">
                        {fix?.proposedCardNumber ? (
                          <span className="font-medium text-blue-700">#{fix.proposedCardNumber}</span>
                        ) : fix?.proposedAction === "merge_into_survivor" ? (
                          <span className="text-red-700">merge → {fix.survivorCardId}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => impactMutation.mutate()}
              disabled={impactMutation.isPending}
              data-testid={`button-impact-${group.groupKey}`}
            >
              {impactMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Check impact
            </Button>
            {numberFixes.length > 0 && (
              <>
                <Button
                  size="sm" variant="outline" className="border-blue-300 text-blue-700"
                  onClick={() => fixMutation.mutate(false)}
                  disabled={fixMutation.isPending}
                  data-testid={`button-dryrun-fix-${group.groupKey}`}
                >
                  Dry-run number fixes ({numberFixes.length})
                </Button>
                <Button
                  size="sm" className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => setConfirmDialog("fix")}
                  disabled={fixMutation.isPending}
                  data-testid={`button-apply-fix-${group.groupKey}`}
                >
                  Apply number fixes…
                </Button>
              </>
            )}
            {mergeFixes.length > 0 && survivorId && (
              <>
                <Button
                  size="sm" variant="outline" className="border-red-300 text-red-700"
                  onClick={() => mergeMutation.mutate(false)}
                  disabled={mergeMutation.isPending}
                  data-testid={`button-dryrun-merge-${group.groupKey}`}
                >
                  Dry-run merge ({mergeFixes.length})
                </Button>
                <Button
                  size="sm" variant="destructive"
                  onClick={() => { if (!impact) impactMutation.mutate(); setConfirmDialog("merge"); }}
                  disabled={mergeMutation.isPending}
                  data-testid={`button-apply-merge-${group.groupKey}`}
                >
                  Merge duplicates…
                </Button>
              </>
            )}
          </div>

          {impact && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-medium text-gray-700 mb-2">Records referencing these cards:</p>
              <ImpactTable impact={impact} />
            </div>
          )}

          {dryRunResult && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm space-y-1">
              <p className="font-medium text-blue-900 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Dry run — nothing was changed
              </p>
              {dryRunResult.type === "fix" && (
                <>
                  <p className="text-blue-800">{dryRunResult.preview.length} fix(es) would be applied.</p>
                  {dryRunResult.skipped?.length > 0 && (
                    <ul className="text-xs text-blue-700 list-disc pl-5">
                      {dryRunResult.skipped.map((s: any) => (
                        <li key={s.cardId}>Card {s.cardId}: {s.reason}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {dryRunResult.type === "merge" && (
                <p className="text-blue-800">
                  Would merge {dryRunResult.details?.duplicates?.length} duplicate(s) into card {dryRunResult.details?.survivor?.id} ("{dryRunResult.details?.survivor?.name}") and archive them.
                </p>
              )}
            </div>
          )}

          <Dialog open={confirmDialog !== null} onOpenChange={(o) => !o && setConfirmDialog(null)}>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-gray-900">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  {confirmDialog === "fix" ? "Apply card number fixes?" : "Merge duplicate cards?"}
                </DialogTitle>
                <DialogDescription>
                  {confirmDialog === "fix"
                    ? `This will update the card number on ${numberFixes.length} card(s) in "${group.subset}". Every change is written to the audit log with old and new values.`
                    : `This will move all user collections, wishlists, and binder entries from ${mergeFixes.length} duplicate card(s) onto card ${survivorId}, then archive the duplicates (soft delete — reversible). Every change is audit-logged.`}
                </DialogDescription>
              </DialogHeader>
              {confirmDialog === "merge" && impact && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-700 mb-2">Affected references (will be reassigned):</p>
                  <ImpactTable impact={impact} />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
                <Button
                  variant={confirmDialog === "merge" ? "destructive" : "default"}
                  disabled={fixMutation.isPending || mergeMutation.isPending}
                  onClick={() => (confirmDialog === "fix" ? fixMutation.mutate(true) : mergeMutation.mutate(true))}
                  data-testid="button-confirm-apply"
                >
                  {(fixMutation.isPending || mergeMutation.isPending) && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Yes, apply for real
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminDataQuality() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [classification, setClassification] = useState<string>("all");
  const [mainSetFilter, setMainSetFilter] = useState("");
  const [subsetFilter, setSubsetFilter] = useState("");
  const [minCopies, setMinCopies] = useState("");
  const [shown, setShown] = useState(50);

  const { data, isLoading, isFetching, refetch } = useQuery<AnalysisResult>({
    queryKey: ["/api/admin/data-quality/duplicates"],
    enabled: !!user?.isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.groups.filter((g) => {
      if (classification !== "all" && g.classification !== classification) return false;
      if (mainSetFilter && !g.mainSet.toLowerCase().includes(mainSetFilter.toLowerCase())) return false;
      if (subsetFilter && !g.subset.toLowerCase().includes(subsetFilter.toLowerCase())) return false;
      if (minCopies && g.copies < parseInt(minCopies)) return false;
      return true;
    });
  }, [data, classification, mainSetFilter, subsetFilter, minCopies]);

  if (!user?.isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-3" />
            <p className="text-gray-700 font-medium">Admin access required</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const exportCsv = () => {
    const qs = classification !== "all" ? `?classification=${classification}` : "";
    window.open(`/api/admin/data-quality/duplicates/export${qs}`, "_blank");
    toast({ title: "Export started" });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">Data Quality — Duplicate Card Numbers</h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm max-w-2xl">
            Read-only audit of cards sharing the same number within a subset. All fixes are dry-run first and
            require explicit confirmation. Merged duplicates are archived, never deleted.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Re-run analysis
          </Button>
          <Button variant="outline" onClick={exportCsv} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-16 text-center text-gray-500">
            <Loader2 className="h-8 w-8 mx-auto animate-spin mb-3" />
            Analyzing duplicate card numbers across the database…
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Card className="col-span-2 md:col-span-2 lg:col-span-2">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold text-gray-900">{data.summary.totalGroups.toLocaleString()}</p>
                <p className="text-xs text-gray-500">duplicate groups · {data.summary.totalCards.toLocaleString()} cards</p>
              </CardContent>
            </Card>
            {(Object.keys(CLASSIFICATION_META) as Classification[]).map((k) => (
              <Card
                key={k}
                className={`cursor-pointer transition-shadow hover:shadow-md ${classification === k ? "ring-2 ring-red-500" : ""}`}
                onClick={() => setClassification(classification === k ? "all" : k)}
                data-testid={`summary-${k}`}
              >
                <CardContent className="pt-4 pb-3">
                  <p className="text-2xl font-bold text-gray-900">{(data.summary.byClassification[k] || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-500">{CLASSIFICATION_META[k].label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filters</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select value={classification} onValueChange={setClassification}>
                <SelectTrigger className="bg-white text-gray-900" data-testid="filter-classification">
                  <SelectValue placeholder="Classification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classifications</SelectItem>
                  {(Object.keys(CLASSIFICATION_META) as Classification[]).map((k) => (
                    <SelectItem key={k} value={k}>{CLASSIFICATION_META[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Filter by main set…"
                value={mainSetFilter}
                onChange={(e) => setMainSetFilter(e.target.value)}
                className="bg-white text-gray-900"
                data-testid="filter-main-set"
              />
              <Input
                placeholder="Filter by subset…"
                value={subsetFilter}
                onChange={(e) => setSubsetFilter(e.target.value)}
                className="bg-white text-gray-900"
                data-testid="filter-subset"
              />
              <Input
                placeholder="Min copies (e.g. 5)"
                type="number"
                value={minCopies}
                onChange={(e) => setMinCopies(e.target.value)}
                className="bg-white text-gray-900"
                data-testid="filter-min-copies"
              />
            </CardContent>
          </Card>

          <p className="text-sm text-gray-600">
            Showing {Math.min(shown, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} groups (sorted highest risk first)
          </p>

          <div className="space-y-2">
            {filtered.slice(0, shown).map((g) => (
              <GroupRow key={g.groupKey} group={g} />
            ))}
          </div>

          {filtered.length > shown && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setShown(shown + 50)} data-testid="button-show-more">
                Show 50 more
              </Button>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">Failed to load analysis.</CardContent>
        </Card>
      )}
    </div>
  );
}
