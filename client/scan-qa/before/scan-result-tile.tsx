import { useState } from "react";
import { ImageOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasUsableScanCardImage } from "@/lib/scanConfirmation";
import { openImageReport } from "./report-image-dialog";

export interface ScanTileCard {
  cardId: number; name: string; setName: string; subsetName: string | null;
  cardNumber: string; year: number | null; imageUrl: string | null;
}
export interface ScanArtworkFamily {
  familyKey: string; score: number; representativeCardId: number; options: ScanTileCard[];
}

/** One artwork, inline exact versions and one collection action. Reusable in grids. */
export function ScanResultTile({ family, pending, onAdd, compact = false, primary = false }: {
  family: ScanArtworkFamily; pending: boolean; compact?: boolean; primary?: boolean;
  onAdd: (card: ScanTileCard, missingImage: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState(family.representativeCardId);
  const [brokenId, setBrokenId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(!compact);
  const card = family.options.find(c => c.cardId === selectedId) ?? family.options[0];
  if (!card) return null;
  const missing = !hasUsableScanCardImage(card.imageUrl) || brokenId === card.cardId;
  const representative = family.options.find(option => option.cardId === family.representativeCardId) ?? family.options[0];
  const inlineOptions = [representative, ...family.options.filter(option => option.cardId !== representative.cardId)];
  const versionLabel = (option: ScanTileCard) => {
    const basic = option.subsetName || "Base";
    const same = family.options.filter(c => (c.subsetName || "Base") === basic);
    if (same.length < 2) return basic;
    if (same.some(c => c.year !== option.year)) return `${basic} · ${option.year}`;
    if (same.some(c => c.setName !== option.setName)) return `${basic} · ${option.setName}`;
    if (same.some(c => c.cardNumber !== option.cardNumber)) return `${basic} · #${option.cardNumber}`;
    return `${basic} · catalog ${option.cardId}`;
  };
  return <article className="scan-tile flex flex-col gap-2" data-testid="scan-artwork-option" data-selected={primary}>
    <div className="scan-art">{!missing ? <img src={card.imageUrl!} alt={card.name} onError={() => setBrokenId(card.cardId)} /> : <div className="flex flex-col items-center gap-2 text-xs text-gray-500"><ImageOff className="h-6 w-6" />No catalog photo</div>}</div>
    <div><h3 className="line-clamp-2 text-sm font-semibold leading-tight">{card.name}</h3><p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-600" title={card.setName}>{card.setName}</p><p className="mt-1 text-xs font-mono">#{card.cardNumber} · {card.year ?? "—"}</p></div>
    {compact && family.options.length > 1 && <button className="text-left text-xs font-medium text-red-700" onClick={() => setExpanded(!expanded)}>{expanded ? "Hide versions" : `+${family.options.length - 1} versions`}</button>}
    {expanded && <div data-testid="scan-version-chips" className="flex flex-wrap gap-1">
      {inlineOptions.map(option => <button key={option.cardId} className="scan-chip" data-card-id={option.cardId} title={`${option.setName} · ${option.year} · #${option.cardNumber} · ${option.subsetName || "Base"}`} aria-pressed={card.cardId === option.cardId} disabled={pending} onClick={() => setSelectedId(option.cardId)}>{card.cardId === option.cardId && <Check className="mr-1 inline h-3 w-3" />}{versionLabel(option)}</button>)}
    </div>}
    <Button data-testid={primary ? "scan-add" : "scan-option-add"} className="scan-primary mt-auto w-full" disabled={pending} onClick={() => onAdd(card, missing)}>{pending ? "Adding…" : "Add to collection"}</Button>
    <Button data-testid="scan-report-image" variant="ghost" size="sm" disabled={pending} onClick={() => openImageReport({ cardId: card.cardId, name: card.name })}>Report wrong image</Button>
  </article>;
}