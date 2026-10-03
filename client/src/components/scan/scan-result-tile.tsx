import { useState } from "react";
import { ImageOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasUsableScanCardImage } from "@/lib/scanConfirmation";
import { openImageReport } from "./report-image-dialog";

export interface ScanTileCard {
  cardId: number; name: string; setName: string; subsetName: string | null;
  cardNumber: string; year: number | null; imageUrl: string | null;
  mainSetId?: number | null; setId?: number; mainSetName?: string | null;
}
export interface ScanArtworkFamily {
  familyKey: string; score: number; representativeCardId: number; options: ScanTileCard[];
}
/** Remove a repeated parent only at name boundaries; never erase variant identity. */
export function scanSubsetLabel(card: ScanTileCard, value = card.subsetName ?? "") {
  const parent = card.mainSetName || card.setName;
  if (!parent) return value.trim();
  const escaped = parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`^${escaped}(?:\\s*[-–—:·/]\\s*|\\s+|$)`, "i"), "")
    .replace(new RegExp(`(?:\\s*[-–—:·/]\\s*|\\s+)${escaped}$`, "i"), "").trim();
}
function isBaseOption(card: ScanTileCard) {
  const label = scanSubsetLabel(card);
  return !label || /^base(?: set)?$/i.test(label);
}

/** Highlighting is a ranking hint, never a selection of a set or ownership. */
export function ScanResultTile({ family, pending, onAdd, onSelect, compact = false, primary = false }: {
  family: ScanArtworkFamily; pending: boolean; compact?: boolean; primary?: boolean;
  onAdd?: (card: ScanTileCard, missingImage: boolean) => void;
  onSelect?: (card: ScanTileCard, missingImage: boolean) => void;
}) {
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  const action = onSelect ?? onAdd;
  const actionLabel = onSelect ? "Choose" : "Add";
  const groups = new Map<string, ScanTileCard[]>();
  for (const option of family.options) {
    // Parallels share a main-set identity. A year is always part of that
    // identity, even when the same art or catalog set is reused.
    const key = `${option.year}:${option.mainSetId ?? option.setId ?? option.mainSetName ?? option.setName}`;
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }
  if (!groups.size) return null;
  return <article className={`scan-tile${compact ? " scan-checklist-tile" : ""}`} data-testid="scan-artwork-option" data-highlighted={primary}>
    {primary && <div className="scan-best">Best artwork match · check the set</div>}
    {groups.size > 1 && <h3 className="scan-family-heading">This artwork appears in {groups.size} sets</h3>}
    {Array.from(groups, ([key, options]) => {
      const card = options.find(option => option.cardId === variants[key])
        ?? options.find(isBaseOption)
        ?? options[0];
      const missing = !hasUsableScanCardImage(card.imageUrl) || !!broken[card.cardId];
      const label = `${card.name}, #${card.cardNumber}, ${card.mainSetName || card.setName}, ${card.year ?? "year unknown"}`;
      const variantLabel = (option: ScanTileCard) => {
        const basic = isBaseOption(option) ? "Base" : scanSubsetLabel(option);
        const duplicates = options.filter(c => (isBaseOption(c) ? "Base" : scanSubsetLabel(c)) === basic);
        if (duplicates.length < 2) return basic;
        if (duplicates.some(c => c.setName !== option.setName)) return `${basic} · ${scanSubsetLabel(option, option.setName) || "Base"}`;
        if (duplicates.some(c => c.cardNumber !== option.cardNumber)) return `${basic} · #${option.cardNumber}`;
        return `${basic} · catalog ${option.cardId}`;
      };
      return <section className="scan-set-choice" data-testid="scan-set-choice" data-main-set-id={card.mainSetId ?? card.setId} key={key}>
        <div className="scan-identity-row">
          <button className="scan-identity" data-testid="scan-set-row" data-card-id={card.cardId} aria-label={`${actionLabel} ${label}`} disabled={pending || !action} onClick={() => action?.(card, missing)}>
            <div className="scan-art">{!missing
              ? <img src={card.imageUrl!} alt={card.name} onError={() => setBroken(old => ({ ...old, [card.cardId]: true }))} />
              : <div className="flex flex-col items-center gap-1 p-1 text-center text-[10px] text-gray-600"><ImageOff className="h-5 w-5" />No photo</div>}</div>
            <div className="scan-identity-copy">
              <h3>{card.name}</h3>
              <p className="scan-card-number">#{card.cardNumber}</p>
              <p className="scan-set-name">{card.mainSetName || card.setName}</p>
              {card.mainSetName && card.setName !== card.mainSetName && scanSubsetLabel(card, card.setName) && <p className="scan-set-name">{scanSubsetLabel(card, card.setName)}</p>}
              {options.length === 1 && !isBaseOption(card) && scanSubsetLabel(card, card.setName) !== scanSubsetLabel(card) && <p className="scan-set-name">{scanSubsetLabel(card)}</p>}
              <p className="scan-year">{card.year ?? "Year unknown"}</p>
            </div>
          </button>
          <Button data-testid={onSelect ? "scan-option-select" : primary ? "scan-add" : "scan-option-add"} className="scan-primary scan-row-add" aria-label={`${onSelect ? "Choose card" : "Add to collection"}: ${label}`} disabled={pending || !action} onClick={() => action?.(card, missing)}>{pending ? (onSelect ? "Please wait…" : "Adding…") : actionLabel}</Button>
        </div>
        {options.length > 1 && <div data-testid="scan-version-chips" aria-label="Parallels in this set">
          {(expanded[key] ? options : options.slice(0, 3)).map(option => <button key={option.cardId} className="scan-chip" data-card-id={option.cardId} aria-pressed={card.cardId === option.cardId} disabled={pending} onClick={() => setVariants(old => ({ ...old, [key]: option.cardId }))}>
            {card.cardId === option.cardId && <Check className="mr-1 inline h-3 w-3" />}{variantLabel(option)}
          </button>)}
          {options.length > 3 && <button className="scan-versions-toggle" aria-expanded={!!expanded[key]} disabled={pending} onClick={() => setExpanded(old => ({ ...old, [key]: !old[key] }))}>{expanded[key] ? "Fewer versions" : `+${options.length - 3} more versions`}</button>}
          {!expanded[key] && options.slice(3).some(option => option.cardId === card.cardId) && <span className="scan-chip" aria-label="Selected version">{variantLabel(card)}</span>}
        </div>}
        <button data-testid="scan-report-image" className="scan-report-link" disabled={pending} onClick={() => openImageReport({ cardId: card.cardId, name: card.name })}>Report wrong image</button>
      </section>;
    })}
  </article>;
}