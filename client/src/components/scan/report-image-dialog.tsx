import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { IMAGE_REPORT_REASONS, reportCardImage, validateReportPhoto, type ImageReportReason } from "@/lib/imageReview";

type ReportCard = { cardId: number; name: string };
const REPORT_EVENT = "dev-scan-report-image";

/** Only card metadata crosses the workspace boundary, never its scan photo. */
export function openImageReport(card: ReportCard) {
  window.dispatchEvent(new CustomEvent<ReportCard>(REPORT_EVENT, { detail: { cardId: card.cardId, name: card.name } }));
}

/** Lives above routes, independently of both the workspace and toast lifetime. */
export function ReportImageHost() {
  const [card, setCard] = useState<ReportCard | null>(null);
  useEffect(() => {
    // Never replace an unfinished report just because a route emits another.
    const open = (event: Event) => setCard(current => current ?? (event as CustomEvent<ReportCard>).detail);
    window.addEventListener(REPORT_EVENT, open);
    return () => window.removeEventListener(REPORT_EVENT, open);
  }, []);
  return card ? <ReportImageDialog key={card.cardId} card={card} onClose={() => setCard(null)} /> : null;
}

function ReportImageDialog({ card, onClose }: { card: ReportCard; onClose: () => void }) {
  const [reason, setReason] = useState<ImageReportReason | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const report = useMutation({
    mutationFn: () => reportCardImage(card.cardId, reason!, file, async () => user?.getIdToken()),
    onSuccess: () => {
      onClose();
      toast({ title: "Image report sent", description: "An admin will review it. Your collection is unchanged." });
    },
    onError: (failure: Error) => setError(failure.message),
  });
  return <Dialog open onOpenChange={open => { if (!open && !report.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto" data-testid="report-image-dialog">
      <DialogHeader><DialogTitle>Report wrong image</DialogTitle><DialogDescription>{card.name} · This report does not add a card to your collection.</DialogDescription></DialogHeader>
      <fieldset disabled={report.isPending} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">What is wrong with the catalog image?</legend>
        <div className="flex flex-wrap gap-2">{IMAGE_REPORT_REASONS.map(item => <Button key={item.value} type="button" size="sm" variant={reason === item.value ? "default" : "outline"} aria-pressed={reason === item.value} onClick={() => setReason(item.value)}>{item.label}</Button>)}</div>
        <p className="text-xs text-muted-foreground">A photo is optional. Only a photo you explicitly attach here will be sent. JPEG, PNG or WebP, up to 5MB.</p>
        <Input ref={input} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" data-testid="report-image-file" onChange={event => {
          const chosen = event.target.files?.[0];
          if (!chosen) return;
          try { validateReportPhoto(chosen); setFile(chosen); setError(""); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "Choose another photo."); }
          event.target.value = "";
        }} />
        <Button type="button" variant="outline" onClick={() => input.current?.click()}>Attach a photo (optional)</Button>
        {file && <div className="flex items-center gap-2 text-xs"><span className="min-w-0 break-all">{file.name}</span><Button size="sm" variant="ghost" onClick={() => setFile(null)}>Remove</Button></div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2"><Button className="flex-1" disabled={!reason || report.isPending} onClick={() => { setError(""); report.mutate(); }}>{report.isPending ? "Sending report…" : "Send report"}</Button><Button variant="outline" disabled={report.isPending} onClick={onClose}>Cancel</Button></div>
    </DialogContent>
  </Dialog>;
}

/** Separate component: toast handlers cannot capture the workspace photo. */
export function ScanAddedActions({ card, ownedRowId, undoToken }: { card: ReportCard; ownedRowId?: number; undoToken?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [undone, setUndone] = useState(false);
  const undo = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/cards/scan/collection/${ownedRowId}`, { undoToken }),
    onSuccess: () => {
      setUndone(true);
      for (const key of ["/api/collection", "/api/stats", "/api/user/stats", "/api/collection/check"]) void qc.invalidateQueries({ queryKey: [key] });
      toast({ title: "Addition undone", description: "Only the new owned row was removed." });
    },
    onError: (failure: Error) => toast({ title: "Undo left your collection unchanged", description: failure.message, variant: "destructive" }),
  });
  return <div className="flex flex-wrap gap-2">
    {ownedRowId && undoToken && !undone && <ToastAction altText="Undo this newly added card" data-testid="scan-undo" disabled={undo.isPending} onClick={() => undo.mutate()}>Undo</ToastAction>}
    <Button variant="outline" size="sm" data-testid="scan-added-report-image" onClick={() => openImageReport(card)}>Report wrong image</Button>
  </div>;
}