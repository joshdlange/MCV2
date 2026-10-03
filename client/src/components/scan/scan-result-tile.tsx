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
function isBaseOption(card: ScanTileCard) {
  return !card.subsetName || /^base(?: set)?$/i.test(card.subsetName)
    || !!card.mainSetName && (card.subsetName.toLowerCase() === card.mainSetName.toLowerCase()
      || card.setName.toLowerCase() === card.mainSetName.toLowerCase());
}

/** Highlighting is a ranking hint, never a selection of a set or ownership. */
export function ScanResultTile({ family, pending, onAdd, compact = false, primary = false }: {
  family: ScanArtworkFamily; pending: boolean; compact?: boolean; primary?: boolean;
  onAdd: (card: ScanTileCard, missingImage: boolean) => void;
}) {
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [broken, setBroken] = useState<Record<number, boolean>>({});
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
        const basic = isBaseOption(option) ? "Base" : option.subsetName!;
        const duplicates = options.filter(c => (isBaseOption(c) ? "Base" : c.subsetName) === basic);
        if (duplicates.length < 2) return basic;
        if (duplicates.some(c => c.setName !== option.setName)) return `${basic} · ${option.setName}`;
        if (duplicates.some(c => c.cardNumber !== option.cardNumber)) return `${basic} · #${option.cardNumber}`;
        return `${basic} · catalog ${option.cardId}`;
      };
      return <section className="scan-set-choice" data-testid="scan-set-choice" data-main-set-id={card.mainSetId ?? card.setId} key={key}>
        <div className="scan-identity-row">
          <button className="scan-identity" data-testid="scan-set-row" data-card-id={card.cardId} aria-label={`Add ${label}`} disabled={pending} onClick={() => onAdd(card, missing)}>
            <div className="scan-art">{!missing
              ? <img src={card.imageUrl!} alt={card.name} onError={() => setBroken(old => ({ ...old, [card.cardId]: true }))} />
              : <div className="flex flex-col items-center gap-1 p-1 text-center text-[10px] text-gray-600"><ImageOff className="h-5 w-5" />No photo</div>}</div>
            <div className="scan-identity-copy">
              <h3>{card.name}</h3>
              <p className="scan-card-number">#{card.cardNumber}</p>
              <p className="scan-set-name">{card.mainSetName || card.setName}</p>
              {card.mainSetName && card.setName !== card.mainSetName && <p className="scan-set-name">{card.setName}</p>}
              {options.length === 1 && card.subsetName && !/^base(?: set)?$/i.test(card.subsetName) && !card.setName.toLowerCase().includes(card.subsetName.toLowerCase()) && <p className="scan-set-name">{card.subsetName}</p>}
              <p className="scan-year">{card.year ?? "Year unknown"}</p>
            </div>
          </button>
          <Button data-testid={primary ? "scan-add" : "scan-option-add"} className="scan-primary scan-row-add" aria-label={`Add to collection: ${label}`} disabled={pending} onClick={() => onAdd(card, missing)}>{pending ? "Adding…" : "Add"}</Button>
        </div>
        {options.length > 1 && <div data-testid="scan-version-chips" aria-label="Parallels in this set">
          {options.map(option => <button key={option.cardId} className="scan-chip" data-card-id={option.cardId} aria-pressed={variants[key] === option.cardId} disabled={pending} onClick={() => setVariants(old => ({ ...old, [key]: option.cardId }))}>
            {variants[key] === option.cardId && <Check className="mr-1 inline h-3 w-3" />}{variantLabel(option)}
          </button>)}
        </div>}
        <button data-testid="scan-report-image" className="scan-report-link" disabled={pending} onClick={() => openImageReport({ cardId: card.cardId, name: card.name })}>Report wrong image</button>
      </section>;
    })}
  </article>;
}