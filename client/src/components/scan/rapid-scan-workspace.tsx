import { useState } from "react";
import { ArrowLeft, ScanLine, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useHardwareBackHandler } from "@/hooks/useBackButton";
import { useRapidScan } from "@/hooks/use-rapid-scan";
import { RAPID_QUEUE_LIMIT, RAPID_SESSION_LIMIT, rapidCanUndo, rapidDuplicateIds, rapidSuggestedCard, rapidStatusLabel, rapidTone } from "@/lib/rapidScan";
import { RapidCamera } from "./rapid-camera";
import { RapidReviewGrid } from "./rapid-review-grid";
import { RapidChoice } from "./rapid-choice";
import "./scan-workspace.css";
import "./rapid-scan.css";

export function RapidScanWorkspace({ onExit }: { onExit: () => void }) {
  const { user } = useAuth();
  const batch = useRapidScan(async () => user?.getIdToken());
  const [review, setReview] = useState(false);
  const [choice, setChoice] = useState<{ id: string; search: boolean } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const active = batch.items.find(item => item.id === choice?.id);
  const duplicates = rapidDuplicateIds(batch.items);
  const ready = batch.items.filter(item => item.selected && !item.save && !duplicates.has(item.id)).length;
  const unresolved = batch.items.filter(item => !item.selected && !item.save).length;
  const saved = batch.items.filter(item => item.save).length;
  const added = batch.items.filter(item => item.save?.created && !item.undone).length;
  const existing = batch.items.filter(item => item.save?.created === false).length;
  const hasPhotoPending = batch.items.some(item => item.photoStatus === "pending");
  const locked = !!batch.busy || hasPhotoPending;
  const canUndo = batch.items.some(rapidCanUndo);
  function exit() {
    if (locked) return;
    if (active) { setChoice(null); return; }
    if (batch.items.length) setConfirmExit(true); else onExit();
  }
  useHardwareBackHandler(() => { exit(); return true; });
  return <section className="scan-fast rapid-scan" data-testid="rapid-workspace" data-stage={active ? "choice" : review ? "review" : "live"}>
    <div className="rapid-shell">
      <header className="rapid-header"><div><span className="rapid-kicker">Collector workbench · DEV</span><h1 className="scan-heading flex items-center gap-2"><ScanLine className="h-5 w-5 text-red-600" />Rapid Scan</h1></div><Button variant="ghost" size="sm" disabled={locked} onClick={exit}><ArrowLeft className="mr-1 h-4 w-4" />Exit</Button></header>
      {confirmExit && <div className="rapid-alert" role="alert"><strong>End this session?</strong><p className="my-2">Transient photos and unsaved choices will be discarded. Saved ownership stays. Undo new additions before leaving if needed.</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setConfirmExit(false)}>Keep session</Button><Button size="sm" onClick={onExit}>End session</Button></div></div>}
      {active ? <RapidChoice key={active.id} item={active} initialSearch={choice!.search} onBack={() => setChoice(null)} onSelect={(card, missing, fromSearch) => { batch.select(active.id, card, missing, fromSearch); setChoice(null); }} />
        : <>
          <p className="rapid-copy">{review ? "Review the identity of every card. Unresolved items are never added." : "Capture one card, then the next. Recognition catches up behind you. Nothing is added yet."}</p>
          {batch.paused && <p className="rapid-alert">Recognition paused while the page is in the background.</p>}
          {batch.notice && <p role="alert" className="rapid-alert">{batch.notice}</p>}
          {!review && <><RapidCamera onCapture={batch.enqueue} disabled={locked || batch.queueCount >= RAPID_QUEUE_LIMIT || batch.accepted >= RAPID_SESSION_LIMIT} />
            <div className="flex justify-between text-xs text-stone-600"><span>{batch.items.length} in batch · {batch.accepted}/{RAPID_SESSION_LIMIT} captures</span><span>{batch.queueCount}/{RAPID_QUEUE_LIMIT} waiting</span></div>
            <div className="rapid-tray" data-testid="rapid-tray">{batch.items.map((item, i) => {
              const displayed = item.selected ?? rapidSuggestedCard(item);
              return <button key={item.id} className="rapid-thumb" disabled={locked} onClick={() => { setReview(true); if (!item.save && !["queued", "recognizing"].includes(item.status)) setChoice({ id: item.id, search: false }); }}>
                <img src={item.previewUrl} alt={`Capture ${i + 1}`} /><span className="rapid-status" data-tone={rapidTone(item)}>{rapidStatusLabel(item)}</span>
                <span className="rapid-thumb-name">{displayed ? <>{!item.selected && "Suggested: "}{displayed.name} #{displayed.cardNumber}</> : `Capture ${i + 1}`}</span>
                {displayed && <small className="rapid-thumb-set">{displayed.mainSetName || displayed.setName} · {displayed.year ?? "?"}</small>}
              </button>;
            })}</div>
            {!batch.items.length && <div className="rapid-empty">Keep the whole card in view. The guide never crops your photo. Photos stay in memory until you leave; only recognition receives them.</div>}
            <Button data-testid="rapid-review" className="w-full h-12 scan-primary" disabled={!batch.items.length || locked} onClick={() => setReview(true)}><Layers className="mr-2 h-4 w-4" />Review & add all ({batch.items.length})</Button>
          </>}
          {review && <>
            <div className="flex justify-between items-center"><h2 className="font-semibold">Review & add all</h2><Button variant="outline" size="sm" disabled={locked || batch.accepted >= RAPID_SESSION_LIMIT} onClick={() => setReview(false)}>Capture more</Button></div>
            {!!saved && <div data-testid="rapid-success" className="my-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900"><strong>{added} newly added · {existing} already owned</strong><p className="mt-1 text-xs">Each card has its own save result. No photos uploaded by Add all.</p></div>}
            <RapidReviewGrid items={batch.items} disabled={locked} onChoose={(id, search) => setChoice({ id, search })} onRemove={batch.remove} onRetry={batch.retry} onSubmitPhoto={id => void batch.submitPhoto(id)} />
            <footer className="rapid-footer">
              <p>{ready} chosen / provisional · {unresolved} need review · {duplicates.size} duplicate captures skipped</p>
              <Button data-testid="rapid-add-all" className="scan-primary h-12" disabled={locked || !ready} onClick={() => void batch.addAll()}>{batch.busy === "add" ? "Adding one card at a time…" : `Add all ready (${ready})`}</Button>
              {canUndo && <Button data-testid="rapid-undo-all" variant="outline" className="h-11" disabled={locked} onClick={() => void batch.undoAll()}>{batch.busy === "undo" ? "Undoing new additions…" : "Undo new additions"}</Button>}
              <p>Already-owned cards and quantities are never removed or increased. Failed saves can be retried with Add all.</p>
            </footer>
          </>}
        </>}
    </div>
  </section>;
}