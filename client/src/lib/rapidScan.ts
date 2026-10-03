import type { ScanArtworkFamily, ScanTileCard } from "@/components/scan/scan-result-tile";

export const RAPID_SESSION_LIMIT = 18;
export const RAPID_QUEUE_LIMIT = 9;
// UI caution thresholds, not a calibrated probability or a recognition-model change.
export const RAPID_CONFIDENT_SCORE = 0.85;
export const RAPID_CONFIDENT_MARGIN = 0.07;

/** Capture producer boundary. A future pocket producer hands off one transient
 * image per item; review, recognition and ownership never depend on a camera. */
export interface RapidCaptureInput {
  file: File;
  source: "camera" | "picker" | "pocket";
  producerItemKey?: string;
}
export interface RapidRecognition {
  mode?: string;
  families: ScanArtworkFamily[];
  topScore?: number | null;
  margin?: number | null;
}
export type RapidStatus = "queued" | "recognizing" | "confident" | "check" | "notfound" | "error";
export interface RapidSave {
  created: boolean;
  ownedRow: { id: number; cardId: number };
  undoToken: string | null;
}
export interface RapidItem {
  id: string;
  input: RapidCaptureInput;
  previewUrl: string;
  status: RapidStatus;
  families: ScanArtworkFamily[];
  selected?: ScanTileCard;
  manual?: boolean;
  manualSearch?: boolean;
  missingImage?: boolean;
  error?: string;
  save?: RapidSave;
  saveError?: string;
  undone?: boolean;
  undoError?: string;
  photoStatus?: "pending" | "submitted" | "approved" | "failed";
  photoError?: string;
}
export function rapidSetKey(card: ScanTileCard) {
  return `${card.year}:${card.mainSetId ?? card.setId ?? card.mainSetName ?? card.setName}`;
}
export function classifyRapidRecognition(result: RapidRecognition): Pick<RapidItem, "status" | "selected" | "families"> {
  if (result.mode !== "visual-v1") throw new Error("Rapid Scan requires visual recognition. Use single-photo scanning instead.");
  const families = result.families.filter(f => f.options.length);
  const top = families[0];
  if (!top) return { status: "notfound", families };
  const score = result.topScore ?? top.score;
  const margin = result.margin;
  const sameArtSets = new Set(top.options.map(rapidSetKey));
  // Never infer a set from a shared-artwork family; parallels also need choice.
  const confident = Number.isFinite(score) && score >= RAPID_CONFIDENT_SCORE &&
    margin != null && Number.isFinite(margin) && margin >= RAPID_CONFIDENT_MARGIN &&
    sameArtSets.size === 1 && top.options.length === 1;
  return { families, status: confident ? "confident" : "check", ...(confident ? { selected: top.options[0] } : {}) };
}
export function rapidDuplicateIds(items: RapidItem[]) {
  const seen = new Set<number>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (!item.selected) continue;
    if (seen.has(item.selected.cardId)) duplicates.add(item.id);
    seen.add(item.selected.cardId);
  }
  return duplicates;
}
export function rapidCanUndo(item: RapidItem) {
  const saved = item.save;
  return !item.undone && saved?.created === true && Number.isInteger(saved.ownedRow?.id) &&
    saved.ownedRow.id > 0 && saved.ownedRow.cardId === item.selected?.cardId &&
    typeof saved.undoToken === "string" && saved.undoToken.length > 0;
}
export function rapidStatusLabel(item: RapidItem): string {
  if (item.undone) return "Undone";
  if (item.save) return item.save.created ? "Added" : "Already owned";
  if (item.saveError) return "Add failed";
  if (item.selected && item.manual) return "Chosen";
  return ({ queued: "Queued", recognizing: "Finding…", confident: "Strong match", check: "Check set / version", notfound: "Not found", error: "Scan error" })[item.status];
}
export function rapidSuggestedCard(item: RapidItem) {
  const family = item.families[0];
  return family?.options.find(card => card.cardId === family.representativeCardId) ?? family?.options[0];
}
export function rapidTone(item: RapidItem) {
  if (item.saveError || item.status === "error" || item.status === "notfound") return "red";
  if (item.selected || item.save) return "green";
  return "amber";
}