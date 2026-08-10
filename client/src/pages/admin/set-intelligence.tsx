import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Radar, ExternalLink, CheckCircle, XCircle, Copy, FlaskConical, AlertTriangle, Plus, Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Candidate {
  id: number;
  detectedSetName: string;
  manufacturer: string | null;
  year: number | null;
  estimatedReleaseDate: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceType: string;
  confidence: number;
  imageUrl: string | null;
  description: string | null;
  possibleDuplicateOf: string | null;
  status: 'pending' | 'approved' | 'ignored' | 'duplicate' | 'needs_review';
  adminNotes: string | null;
  detectedAt: string;
}

interface Stats {
  foundToday: number;
  pendingReview: number;
  approvedThisMonth: number;
  ignoredOrDuplicates: number;
  lastScanAt: string | null;
  lastScanSourceFailures: number;
  lastScanSources: Array<{ source: string; ok: boolean; itemsSeen: number; marvelMatches: number; created: number; skippedDuplicate: number; error?: string }> | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  ignored: "bg-gray-200 text-gray-600",
  duplicate: "bg-purple-100 text-purple-800",
};

function confidenceBadge(c: number) {
  if (c >= 80) return <Badge className="bg-green-100 text-green-800">High {c}</Badge>;
  if (c >= 60) return <Badge className="bg-amber-100 text-amber-800">Medium {c}</Badge>;
  return <Badge className="bg-gray-200 text-gray-600">Low {c}</Badge>;
}

export default function AdminSetIntelligence() {
  const [statusFilter, setStatusFilter] = useState<string>("review");
  const [scanning, setScanning] = useState<null | 'live' | 'dry'>(null);
  const [dryRunReport, setDryRunReport] = useState<any>(null);
  const [approveTarget, setApproveTarget] = useState<Candidate | null>(null);
  const emptyManual = { sourceUrl: "", detectedSetName: "", sourceName: "", manufacturer: "", year: "", estimatedReleaseDate: "", checklistUrl: "", imageUrl: "", description: "", adminNotes: "", usedUrlMetadata: false };
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [manual, setManual] = useState({ ...emptyManual });
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [approveForm, setApproveForm] = useState({ setName: "", releaseDateEstimated: "", keyHighlights: "", adminNotes: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/admin/set-intel/stats'],
    queryFn: () => apiRequest('GET', '/api/admin/set-intel/stats').then(r => r.json()),
  });

  const { data: candidates = [], isLoading } = useQuery<Candidate[]>({
    queryKey: ['/api/admin/set-intel/candidates'],
    queryFn: () => apiRequest('GET', '/api/admin/set-intel/candidates').then(r => r.json()),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/admin/set-intel/candidates'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/set-intel/stats'] });
  };

  const runScan = async (dryRun: boolean) => {
    if (scanning) return;
    setScanning(dryRun ? 'dry' : 'live');
    try {
      const res = await apiRequest('POST', '/api/admin/set-intel/scan', { dryRun });
      const report = await res.json();
      if (dryRun) {
        setDryRunReport(report);
        toast({ title: "Dry run complete (nothing saved)", description: `${report.wouldCreate.length} candidate(s) would be created` });
      } else {
        setDryRunReport(null);
        toast({ title: "Scan complete", description: `${report.candidatesCreated} new candidate(s) created` });
        refresh();
      }
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message, variant: "destructive" });
    } finally {
      setScanning(null);
    }
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      apiRequest('PATCH', `/api/admin/set-intel/candidates/${id}`, updates),
    onSuccess: () => { refresh(); },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) =>
      apiRequest('POST', `/api/admin/set-intel/candidates/${id}/approve`, body),
    onSuccess: () => {
      toast({ title: "Approved", description: "Added to Upcoming Sets. It is now visible to collectors." });
      setApproveTarget(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['/api/admin/upcoming-sets'] });
    },
    onError: () => toast({ title: "Approve failed", variant: "destructive" }),
  });

  const createManualMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/admin/set-intel/candidates', {
        ...manual,
        year: manual.year || undefined,
        estimatedReleaseDate: manual.estimatedReleaseDate || undefined,
      });
      return res.json();
    },
    onSuccess: (created: Candidate) => {
      toast({
        title: "Candidate saved",
        description: created.possibleDuplicateOf
          ? `Marked Needs Review — possible duplicate of ${created.possibleDuplicateOf}`
          : "Saved as pending. Approve it to publish to Upcoming Sets.",
      });
      setQuickAddOpen(false);
      setManual({ ...emptyManual });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save candidate", description: e?.message, variant: "destructive" }),
  });

  const filtered = candidates.filter(c =>
    statusFilter === 'all' ? true :
    statusFilter === 'review' ? (c.status === 'pending' || c.status === 'needs_review') :
    c.status === statusFilter
  );

  const openApprove = (c: Candidate) => {
    setApproveTarget(c);
    setApproveForm({
      setName: c.detectedSetName,
      releaseDateEstimated: c.estimatedReleaseDate ? c.estimatedReleaseDate.slice(0, 10) : "",
      keyHighlights: c.description || "",
      adminNotes: c.adminNotes || "",
    });
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Radar className="w-6 h-6 text-blue-600" /> Upcoming Set Intelligence</h1>
          <p className="text-sm text-muted-foreground">Multi-source detection of upcoming Marvel releases. Nothing is shown to collectors until you approve it.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setQuickAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Candidate Manually
          </Button>
          <Button variant="outline" onClick={() => runScan(true)} disabled={!!scanning}>
            {scanning === 'dry' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
            Dry Run
          </Button>
          <Button onClick={() => runScan(false)} disabled={!!scanning}>
            {scanning === 'live' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Run Scan Now
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Found Today", value: stats?.foundToday ?? '—' },
          { label: "Pending Review", value: stats?.pendingReview ?? '—' },
          { label: "Approved This Month", value: stats?.approvedThisMonth ?? '—' },
          { label: "Ignored / Duplicates", value: stats?.ignoredOrDuplicates ?? '—' },
          { label: "Last Scan", value: stats?.lastScanAt ? new Date(stats.lastScanAt).toLocaleString() : 'Never' },
          { label: "Source Failures (last scan)", value: stats?.lastScanSourceFailures ?? '—' },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold truncate">{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Last scan source results */}
      {stats?.lastScanSources && (
        <Card><CardContent className="p-3">
          <div className="text-sm font-medium mb-2">Last scan source results</div>
          <div className="flex flex-wrap gap-2">
            {stats.lastScanSources.map(s => (
              <Badge key={s.source} variant="outline" className={s.ok ? "border-green-400" : "border-red-400 text-red-700"}>
                {s.ok ? '✓' : '✗'} {s.source}: {s.marvelMatches} Marvel / {s.created} new{s.error ? ` — ${s.error}` : ''}
              </Badge>
            ))}
          </div>
        </CardContent></Card>
      )}

      {/* Dry run report */}
      {dryRunReport && (
        <Card className="border-amber-300"><CardContent className="p-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2"><FlaskConical className="w-4 h-4 text-amber-600" /> Dry run result — nothing was saved</div>
          <div className="flex flex-wrap gap-2">
            {dryRunReport.sources.map((s: any) => (
              <Badge key={s.source} variant="outline" className={s.ok ? "border-green-400" : "border-red-400 text-red-700"}>
                {s.ok ? '✓' : '✗'} {s.source}: {s.marvelMatches} Marvel / {s.created} would create{s.error ? ` — ${s.error}` : ''}
              </Badge>
            ))}
          </div>
          {dryRunReport.wouldCreate.length > 0 ? (
            <ul className="text-sm list-disc pl-5">
              {dryRunReport.wouldCreate.map((w: any, i: number) => (
                <li key={i}>{w.name} <span className="text-muted-foreground">({w.source}, confidence {w.confidence}{w.possibleDuplicateOf ? `, possible duplicate of ${w.possibleDuplicateOf}` : ''})</span></li>
              ))}
            </ul>
          ) : <div className="text-sm text-muted-foreground">No new candidates would be created.</div>}
        </CardContent></Card>
      )}

      {/* Filter + list */}
      <div className="flex items-center gap-2">
        <Label className="text-sm">Show:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="review">Needs Attention</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="needs_review">Needs Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
            <SelectItem value="duplicate">Duplicate</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} candidate(s)</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No candidates here. Run a scan to check the sources.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <Card key={c.id}><CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                {c.imageUrl && <img src={c.imageUrl} alt="" className="w-16 h-16 object-cover rounded" />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.detectedSetName}</span>
                    <Badge className={STATUS_STYLES[c.status]}>{c.status.replace('_', ' ')}</Badge>
                    {confidenceBadge(c.confidence)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {c.sourceName} · {c.manufacturer || 'Unknown brand'}{c.year ? ` · ${c.year}` : ''}
                    {c.estimatedReleaseDate ? ` · Est. ${new Date(c.estimatedReleaseDate).toLocaleDateString()}` : ''}
                    {' · '}Detected {new Date(c.detectedAt).toLocaleDateString()}
                  </div>
                  {c.possibleDuplicateOf && (
                    <div className="text-sm text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Possible duplicate of: {c.possibleDuplicateOf}</div>
                  )}
                  {c.description && <div className="text-sm mt-1 line-clamp-2">{c.description}</div>}
                  {c.adminNotes && <div className="text-xs mt-1 italic text-muted-foreground">Notes: {c.adminNotes}</div>}
                </div>
                <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
                  <Button size="sm" variant="outline" asChild>
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" /> Source</a>
                  </Button>
                  {c.status !== 'approved' && (
                    <>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => openApprove(c)}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: c.id, updates: { status: 'duplicate' } })}>
                        <Copy className="w-3.5 h-3.5 mr-1" /> Duplicate
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: c.id, updates: { status: 'ignored' } })}>
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Ignore
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Manual quick-add dialog */}
      <Dialog open={quickAddOpen} onOpenChange={(o) => { setQuickAddOpen(o); if (!o) setManual({ ...emptyManual }); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Candidate Manually</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">For sources the scanner cannot reach (Topps, Blowout, etc.). Saved as a pending candidate for review — never published directly.</p>
            <div>
              <Label>Source URL *</Label>
              <div className="flex gap-2">
                <Input placeholder="https://..." value={manual.sourceUrl} onChange={e => setManual(m => ({ ...m, sourceUrl: e.target.value }))} />
                <Button
                  variant="outline"
                  disabled={fetchingMeta || !/^https?:\/\//i.test(manual.sourceUrl)}
                  onClick={async () => {
                    setFetchingMeta(true);
                    try {
                      const res = await apiRequest('POST', '/api/admin/set-intel/fetch-metadata', { url: manual.sourceUrl });
                      const meta = await res.json();
                      if (meta.ok) {
                        setManual(m => ({
                          ...m,
                          detectedSetName: m.detectedSetName || meta.title || "",
                          description: m.description || meta.description || "",
                          imageUrl: m.imageUrl || meta.imageUrl || "",
                          usedUrlMetadata: true,
                        }));
                        toast({ title: "Details fetched", description: "Review and edit before saving." });
                      } else {
                        toast({ title: "Could not fetch details", description: `${meta.error || 'Page blocked'}. You can still enter everything manually.` });
                      }
                    } catch {
                      toast({ title: "Could not fetch details", description: "You can still enter everything manually." });
                    } finally {
                      setFetchingMeta(false);
                    }
                  }}
                >
                  {fetchingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label>Set name *</Label>
              <Input value={manual.detectedSetName} onChange={e => setManual(m => ({ ...m, detectedSetName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Manufacturer / brand</Label>
                <Input placeholder="Topps" value={manual.manufacturer} onChange={e => setManual(m => ({ ...m, manufacturer: e.target.value }))} />
              </div>
              <div>
                <Label>Year</Label>
                <Input type="number" placeholder="2026" value={manual.year} onChange={e => setManual(m => ({ ...m, year: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estimated release date</Label>
                <Input type="date" value={manual.estimatedReleaseDate} onChange={e => setManual(m => ({ ...m, estimatedReleaseDate: e.target.value }))} />
              </div>
              <div>
                <Label>Source name</Label>
                <Input placeholder="Topps Shop" value={manual.sourceName} onChange={e => setManual(m => ({ ...m, sourceName: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Checklist URL</Label>
              <Input placeholder="https://..." value={manual.checklistUrl} onChange={e => setManual(m => ({ ...m, checklistUrl: e.target.value }))} />
            </div>
            <div>
              <Label>Image URL</Label>
              <Input placeholder="https://..." value={manual.imageUrl} onChange={e => setManual(m => ({ ...m, imageUrl: e.target.value }))} />
            </div>
            <div>
              <Label>Description / snippet</Label>
              <Textarea rows={3} value={manual.description} onChange={e => setManual(m => ({ ...m, description: e.target.value }))} />
            </div>
            <div>
              <Label>Notes (admin only)</Label>
              <Textarea rows={2} value={manual.adminNotes} onChange={e => setManual(m => ({ ...m, adminNotes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickAddOpen(false)}>Cancel</Button>
              <Button
                disabled={createManualMutation.isPending || !manual.detectedSetName.trim() || !/^https?:\/\//i.test(manual.sourceUrl)}
                onClick={() => createManualMutation.mutate()}
              >
                {createManualMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save as Pending Candidate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve dialog (edit before approval) */}
      <Dialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Approve into Upcoming Sets</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Set name</Label>
              <Input value={approveForm.setName} onChange={e => setApproveForm(f => ({ ...f, setName: e.target.value }))} />
            </div>
            <div>
              <Label>Estimated release date</Label>
              <Input type="date" value={approveForm.releaseDateEstimated} onChange={e => setApproveForm(f => ({ ...f, releaseDateEstimated: e.target.value }))} />
            </div>
            <div>
              <Label>Description / highlights</Label>
              <Textarea rows={3} value={approveForm.keyHighlights} onChange={e => setApproveForm(f => ({ ...f, keyHighlights: e.target.value }))} />
            </div>
            <div>
              <Label>Source notes (admin only)</Label>
              <Textarea rows={2} value={approveForm.adminNotes} onChange={e => setApproveForm(f => ({ ...f, adminNotes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={approveMutation.isPending || !approveForm.setName.trim()}
                onClick={() => approveTarget && approveMutation.mutate({
                  id: approveTarget.id,
                  body: {
                    setName: approveForm.setName,
                    releaseDateEstimated: approveForm.releaseDateEstimated || undefined,
                    keyHighlights: approveForm.keyHighlights || undefined,
                    adminNotes: approveForm.adminNotes || undefined,
                  },
                })}
              >
                {approveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Approve & Publish to Upcoming Sets
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
