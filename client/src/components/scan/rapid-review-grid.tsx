import { useState } from "react";
import { Check, AlertTriangle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rapidDuplicateIds, rapidStatusLabel, rapidTone, rapidSuggestedCard, type RapidItem } from "@/lib/rapidScan";
import { openImageReport } from "./report-image-dialog";
import { scanSubsetLabel } from "./scan-result-tile";

/** Camera-independent review consumer; usable by the future pocket producer. */
export function RapidReviewGrid({ items, disabled, onChoose, onRemove, onRetry, onSubmitPhoto }: {
  items: RapidItem[]; disabled: boolean;
  onChoose: (id: string, search: boolean) => void;
  onRemove: (id: string) => void; onRetry: (id: string) => void;
  onSubmitPhoto: (id: string) => void;
}) {
  const duplicates = rapidDuplicateIds(items);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  if (!items.length) return <div className="rapid-empty"><strong>No captures yet.</strong><br />Capture or pick one card at a time. Review the batch before adding anything.</div>;
  return <div className="rapid-review-grid" data-testid="rapid-review-grid">{items.map((item, index) => {
    const duplicate = duplicates.has(item.id);
    const saved = !!item.save;
    const suggested = rapidSuggestedCard(item);
    const displayed = item.selected ?? suggested;
    return <article key={item.id} className="rapid-review-item" data-testid="rapid-review-item" data-item-id={item.id}>
      <div className="rapid-item-top">
        <img src={item.previewUrl} alt={`Full-frame capture ${index + 1}`} />
        <div className="rapid-item-copy">
          <span className="rapid-kicker">Capture {String(index + 1).padStart(2, "0")}</span><br />
          <span className="rapid-status" data-tone={rapidTone(item)}>{rapidTone(item) === "green" ? <Check size={12} /> : <AlertTriangle size={12} />}{duplicate ? "Duplicate · skipped" : rapidStatusLabel(item)}</span>
          <h3>{!item.selected && suggested ? "Suggested: " : ""}{displayed?.name ?? (item.status === "queued" || item.status === "recognizing" ? "Finding matching artwork…" : "Choose your card")}</h3>
          {displayed ? <><p>#{displayed.cardNumber} · {displayed.year ?? "Year unknown"}</p><p>{displayed.mainSetName || displayed.setName}</p>{item.selected ? <p>{scanSubsetLabel(displayed)}</p> : <p className="mt-1 font-semibold text-amber-800">Set / version not selected</p>}</>
            : <p>{item.status === "check" ? "Artwork alone cannot confirm the set or version." : item.status === "notfound" ? "Try a name or printed number." : "Recognition runs in the background."}</p>}
        </div>
      </div>
      {item.status === "confident" && !item.manual && !saved && <p className="rapid-copy">Provisional match. Check the identity; Add all is your confirmation.</p>}
      {!item.selected && suggested && <p className="rapid-copy">{item.families.length} artwork {item.families.length === 1 ? "suggestion" : "alternatives"} · {item.families.reduce((total, family) => total + family.options.length, 0)} catalog versions to check. A suggestion is not a selection.</p>}
      {duplicate && <p className="rapid-copy">Same catalog card as an earlier capture. Quantity will not increase.</p>}
      {item.save && <p className="rapid-copy">{item.undone ? "Only this new ownership was undone." : item.save.created ? "New ownership saved. No photo was uploaded." : "Existing ownership and quantity left unchanged."}</p>}
      {[item.error, item.saveError, item.undoError, item.photoError].filter(Boolean).map((message, i) => <p role="alert" className="rapid-alert" key={i}>{message}</p>)}
      {!saved && <div className="rapid-item-actions">
        <Button variant="outline" size="sm" disabled={disabled || ["queued", "recognizing"].includes(item.status)} onClick={() => onChoose(item.id, false)}>{item.selected ? "Change choice" : "Choose set / version"}</Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChoose(item.id, true)}><Search className="mr-1 h-3 w-3" />Search</Button>
        {item.status === "error" && <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRetry(item.id)}>Retry scan</Button>}
        <Button variant="ghost" size="sm" disabled={disabled || item.photoStatus === "pending"} aria-label={`Remove capture ${index + 1}`} onClick={() => onRemove(item.id)}><X className="mr-1 h-3 w-3" />Skip</Button>
      </div>}
      {item.selected && <button className="scan-report-link" disabled={disabled} onClick={() => openImageReport({ cardId: item.selected!.cardId, name: item.selected!.name })}>Report wrong image (optional photo)</button>}
      {item.save && !item.undone && item.manualSearch && item.missingImage && item.selected && <div className="mt-3 border-t border-stone-200 pt-3" data-testid="rapid-photo-offer">
        {["submitted", "approved"].includes(item.photoStatus ?? "") ? <p className="text-xs font-semibold text-green-800">{item.photoStatus === "approved" ? "Photo approved" : "Photo sent for review"} · independent of ownership</p>
          : <><p className="text-xs mb-2">Catalog photo missing. Submitting this capture is optional and does not add ownership.</p>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={!!consent[item.id]} disabled={item.photoStatus === "pending"} onChange={event => setConsent(old => ({ ...old, [item.id]: event.target.checked }))} />I confirm this exact card and consent to sending this capture for catalog review.</label>
            <Button className="mt-2 w-full" variant="outline" size="sm" disabled={disabled || !consent[item.id] || item.photoStatus === "pending"} onClick={() => onSubmitPhoto(item.id)}>{item.photoStatus === "pending" ? "Submitting photo…" : item.photoStatus === "failed" ? "Retry photo submission" : "Submit photo for review"}</Button></>}
      </div>}
    </article>;
  })}</div>;
}