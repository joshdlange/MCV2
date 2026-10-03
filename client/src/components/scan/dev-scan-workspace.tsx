import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Search, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useHardwareBackHandler } from "@/hooks/useBackButton";
import { apiRequest } from "@/lib/queryClient";
import { uploadScanFrontPhoto } from "@/lib/scanConfirmation";
import { CardCrop } from "@/components/CardCrop";
import { SetThumbnail } from "@/components/cards/set-thumbnail";
import type { CardSet } from "@shared/schema";
import type { ScanEventUpdate } from "@/lib/scanTelemetry";
import { ScanResultTile, type ScanArtworkFamily, type ScanTileCard } from "./scan-result-tile";
import "./scan-workspace.css";

// Cosine scores are fractions. Below 0.035 separation between artwork families
// show up to three alternatives; this is a UI ambiguity rule, not probability.
export const SCAN_ARTWORK_AMBIGUITY_MARGIN = 0.035;
export interface ScanBrowseHint { year: number; mainSetId: number | null; setId: number; setName: string }
interface PickerSet { id: number; name: string; type: "main_set" | "card_set"; subset_count: number }
interface PickerSubset { id: number; name: string; isInsertSubset: boolean; totalCards: number }
interface PickerCard { id: number; name: string; cardNumber: string; frontImageUrl: string | null; variation: string | null }
interface SearchCard extends ScanTileCard { setId: number; mainSetId: number | null; mainSetName?: string; isBase?: boolean; exactNumber: boolean }
type View = "results" | "find" | "offer" | "crop";
type BrowseStep = "year" | "set" | "subset" | "card";

function useScanList<T>(path: string, enabled: boolean) {
  return useQuery<T[]>({ queryKey: [path], queryFn: async () => (await apiRequest("GET", path)).json(), enabled, staleTime: 60_000 });
}
function groupSearch(rows: SearchCard[]): ScanArtworkFamily[] {
  const grouped = new Map<string, ScanArtworkFamily>();
  for (const card of rows) {
    const key = `${card.year}:${card.mainSetId ?? card.setId}:${card.cardNumber}:${card.name.toLowerCase()}`;
    const found = grouped.get(key);
    if (found) found.options.push(card);
    else grouped.set(key, { familyKey: key, score: 0, representativeCardId: card.cardId, options: [card] });
  }
  return [...grouped.values()].map(family => {
    const base = family.options.find(c => (c as SearchCard).isBase === true)
      ?? family.options.find(c => (c as SearchCard).isBase === undefined && (!c.subsetName || /^base$/i.test(c.subsetName)));
    if (base) {
      family.options = [base, ...family.options.filter(c => c.cardId !== base.cardId)];
      family.representativeCardId = base.cardId;
    }
    return family;
  });
}

export function DevScanWorkspace({ families, margin, browseHint, previewUrl, photo, elapsedMs, initialSearch, record, onNext, onReset }: {
  families: ScanArtworkFamily[]; margin?: number | null; browseHint?: ScanBrowseHint | null;
  previewUrl: string | null; photo: File | null; elapsedMs?: number; initialSearch: boolean;
  record: (update: ScanEventUpdate) => void; onNext: () => void; onReset: () => void;
}) {
  const [view, setView] = useState<View>(initialSearch ? "find" : "results");
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [step, setStep] = useState<BrowseStep>("year");
  const [year, setYear] = useState<number | null>(null);
  const [set, setSet] = useState<PickerSet | null>(null);
  const [subset, setSubset] = useState<PickerSubset | null>(null);
  const [setId, setSetId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offerCard, setOfferCard] = useState<ScanTileCard | null>(null);
  const [reviewFile, setReviewFile] = useState(photo);
  const [favorites, setFavorites] = useState<number[]>([]);
  const saving = useRef(false);
  const mounted = useRef(true);
  const decisionLogged = useRef(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const ambiguous = families.length > 1 && (margin == null || margin < SCAN_ARTWORK_AMBIGUITY_MARGIN);
  // Two readable artworks side by side are preferable to three tiny phone cards.
  const shown = families.slice(0, ambiguous ? 2 : 1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (decisionLogged.current || !families.length) return;
    decisionLogged.current = true;
    // Code-only diagnostic: no card titles, photos or user-entered search text.
    void apiRequest("POST", "/api/cards/scan/client-event", { code: ambiguous ? "artwork_ambiguous" : "artwork_preselected", stage: "results", marginThreshold: SCAN_ARTWORK_AMBIGUITY_MARGIN, shownOptions: shown.length }).catch(() => {});
  }, [families.length, ambiguous, shown.length]);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const years = useScanList<number>("/api/cards/picker/years", view === "find" && mode === "browse" && step === "year");
  const sets = useScanList<PickerSet>(`/api/cards/picker/sets?year=${year}`, view === "find" && mode === "browse" && step === "set" && year !== null);
  const subsets = useScanList<PickerSubset>(`/api/cards/picker/subsets?mainSetId=${set?.id}&year=${year}`, view === "find" && mode === "browse" && step === "subset" && !!set);
  const cards = useScanList<PickerCard>(`/api/cards/picker/cards?setId=${setId}&search=${encodeURIComponent(debounced)}`, view === "find" && mode === "browse" && step === "card" && !!setId);
  const search = useScanList<SearchCard>(`/api/cards/scan/search?q=${encodeURIComponent(debounced)}`, view === "find" && mode === "search" && !!debounced);
  const refresh = () => {
    for (const key of ["/api/collection", "/api/stats", "/api/user/stats", "/api/collection/check"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  const add = useMutation({
    mutationFn: async ({ card }: { card: ScanTileCard; missingImage: boolean; fromFind: boolean }) =>
      (await apiRequest("POST", "/api/cards/scan/collection", { cardId: card.cardId })).json() as Promise<{ created: boolean; ownedRow: { id: number; cardId: number }; undoToken: string | null }>,
    onSuccess: (saved, { card, missingImage, fromFind }) => {
      saving.current = false;
      refresh();
      const newlyCreated = saved.created === true && Number.isInteger(saved.ownedRow?.id) && saved.ownedRow.cardId === card.cardId && typeof saved.undoToken === "string";
      const notice = toast({
        title: saved.created ? "Added to your collection" : "Already in your collection",
        description: saved.created ? card.name : "Existing ownership and quantity left unchanged.",
        duration: 12_000,
        action: newlyCreated ? <ToastAction altText="Undo this newly added card" data-testid="scan-undo" onClick={async () => {
          try {
            await apiRequest("DELETE", `/api/cards/scan/collection/${saved.ownedRow.id}`, { undoToken: saved.undoToken });
            refresh(); notice.dismiss(); toast({ title: "Addition undone", description: "Only the new owned row was removed." });
          } catch (error) { toast({ title: "Undo left your collection unchanged", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
        }}>Undo</ToastAction> : undefined,
      });
      if (!mounted.current) return;
      if (fromFind && missingImage && photo) { setOfferCard(card); setView("offer"); }
      else onNext();
    },
    onError: (error: Error) => { saving.current = false; toast({ title: "Couldn't add card", description: `${error.message} Your photo is still here; try Add again.`, variant: "destructive" }); },
  });
  const submitPhoto = useMutation({
    mutationFn: () => uploadScanFrontPhoto(offerCard!.cardId, reviewFile, async () => user?.getIdToken(), () => mounted.current, () => record({ photoSubmitUsed: true })),
    onSuccess: result => { toast({ title: result.autoApproved ? "Photo approved" : "Photo sent for review" }); onNext(); },
    onError: (error: Error) => toast({ title: "Photo was not submitted", description: `${error.message} Your card is still added. Retry or skip.`, variant: "destructive" }),
  });
  function addCard(card: ScanTileCard, missingImage: boolean) {
    if (saving.current) return;
    saving.current = true;
    record({ pickedCardId: card.cardId, ...(view === "find" ? { usedSearch: true as const } : {}) });
    add.mutate({ card, missingImage, fromFind: view === "find" });
  }
  function findCard() {
    record({ usedSearch: true });
    setView("find"); setMode("browse"); setQuery("");
    if (browseHint) {
      setYear(browseHint.year);
      setSet({ id: browseHint.mainSetId ?? browseHint.setId, name: browseHint.setName, type: browseHint.mainSetId ? "main_set" : "card_set", subset_count: 0 });
      setSetId(browseHint.setId); setSubset(null); setStep("card");
    } else setStep("year");
  }
  function back() {
    if (saving.current || submitPhoto.isPending) return;
    if (view === "crop") { setView("offer"); return; }
    if (view === "offer") { onNext(); return; }
    if (view === "find") {
      setQuery("");
      if (mode === "browse") {
        if (step === "card") { setStep(set?.type === "main_set" ? "subset" : "set"); setSetId(null); return; }
        if (step === "subset") { setStep("set"); setSubset(null); return; }
        if (step === "set") { setStep("year"); setSet(null); return; }
      }
      if (families.length) setView("results"); else onReset();
    } else onReset();
  }
  useHardwareBackHandler(() => { back(); return true; });
  const list = mode === "search" ? search : step === "year" ? years : step === "set" ? sets : step === "subset" ? subsets : cards;
  const pending = add.isPending;
  function subsetTile(item: PickerSubset | PickerSet) {
    const cardSet = { id: item.id, name: item.name, year: year!, slug: "", description: null, imageUrl: null, totalCards: "totalCards" in item ? item.totalCards : 0, mainSetId: set?.id ?? null, isActive: true, isCanonical: false, isInsertSubset: "isInsertSubset" in item ? item.isInsertSubset : false, canonicalSource: null, archivedAt: null, createdAt: new Date() } as CardSet;
    return <SetThumbnail key={item.id} set={cardSet} isFavorite={favorites.includes(item.id)} onFavorite={() => setFavorites(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id])} showAdminControls={false} onClick={() => {
      setQuery("");
      if ("type" in item) { setSet(item); setSubset(null); setStep(item.type === "main_set" ? "subset" : "card"); setSetId(item.type === "card_set" ? item.id : null); }
      else { setSubset(item); setSetId(item.id); setStep("card"); }
    }} />;
  }
  return <section data-testid="scan-workspace" data-stage={view === "find" ? `picker-${mode === "search" ? "search" : step}` : view} className="scan-fast h-[calc(100dvh-4rem-var(--safe-area-top,0px))] overflow-hidden" style={{ paddingBottom: "var(--safe-area-bottom,0px)" }}>
    <div className="mx-auto flex h-full min-h-0 max-w-lg flex-col px-3">
      <header className="flex shrink-0 items-center justify-between py-3"><h1 className="scan-heading flex items-center gap-2 text-2xl"><ScanLine className="h-5 w-5 text-red-600" />Scan to add</h1><Button data-testid="scan-reset" variant="ghost" size="sm" disabled={pending || submitPhoto.isPending} onClick={onReset}>New scan</Button></header>
      {view === "results" && <>
        <div className="mb-2 flex shrink-0 items-center gap-3">{previewUrl && <img src={previewUrl} alt="Your full scan" className="h-12 w-10 rounded object-contain" />}<div><h2 className="text-sm font-semibold">{ambiguous ? "A close match. Which artwork is yours?" : "Ready to add"}</h2><p className="text-xs text-gray-600">{ambiguous ? "Compare the artwork, then tap Add." : "Top artwork and visual version selected. Change a version below."}</p></div></div>
        {elapsedMs !== undefined && <p data-testid="scan-dev-elapsed" className="mb-2 text-[10px] text-gray-500">Dev scan elapsed: {(elapsedMs / 1000).toFixed(2)}s · {ambiguous ? "Close artwork scores" : "Top match selected"}</p>}
        <div data-testid="scan-result-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className={ambiguous ? "scan-grid" : ""}>{shown.map((family, i) => <ScanResultTile key={family.familyKey} family={family} primary={i === 0} pending={pending} onAdd={addCard} />)}</div></div>
        <footer data-testid="scan-sticky-actions" className="shrink-0 py-3"><Button data-testid="scan-not-here" className="h-11 w-full" variant="outline" disabled={pending} onClick={findCard}><Search className="mr-2 h-4 w-4" />Not here? Browse or search</Button></footer>
      </>}
      {view === "find" && <>
        <div className="mb-2 flex shrink-0 gap-2"><Button size="sm" variant={mode === "browse" ? "default" : "outline"} onClick={() => { setMode("browse"); setQuery(""); }}>Browse cards</Button><Button size="sm" variant={mode === "search" ? "default" : "outline"} onClick={() => { setMode("search"); setQuery(""); }}>Type search</Button></div>
        {mode === "browse" && <nav aria-label="Browse context" className="mb-2 flex shrink-0 flex-wrap gap-1 text-xs">
          {(["year", "set", "subset", "card"] as BrowseStep[]).map((s, i) => <button key={s} disabled={i > ["year","set","subset","card"].indexOf(step)} className={`rounded px-2 py-2 ${step === s ? "bg-red-100 font-semibold text-red-800" : "bg-stone-200"}`} onClick={() => { setStep(s); setQuery(""); if (s === "year") { setSet(null); setSubset(null); setSetId(null); } if (s === "set") { setSubset(null); setSetId(null); } }}>{i + 1} · {s === "year" && year ? year : s === "set" && set ? set.name : s === "subset" && subset ? subset.name : s[0].toUpperCase()+s.slice(1)}</button>)}
        </nav>}
        {mode === "browse" && step === "card" && browseHint && <p className="mb-2 text-[11px] text-gray-600">Suggested set from the scan. Change Year, Set or Subset above.</p>}
        {(mode === "search" || step === "card") && <Input data-testid="scan-search-input" className="mb-2 h-11 shrink-0 bg-stone-50" placeholder={mode === "search" ? "Name, set or exact card number…" : "Filter this checklist…"} value={query} onChange={e => setQuery(e.target.value)} />}
        <div data-testid={mode === "search" ? "scan-search-list" : "scan-browse-list"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {list.isLoading && <div className="scan-grid">{[0,1,2,3].map(n => <div key={n} className="scan-skeleton" />)}</div>}
          {list.isError && <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm">This checklist couldn't load.<Button variant="outline" className="mt-3 w-full" onClick={() => void list.refetch()}>Retry</Button></div>}
          {mode === "search" && !debounced && <div className="rounded-xl border border-dashed border-stone-300 p-5 text-sm text-gray-600">Try a character or printed number. Exact numbers come first; versions stay together.</div>}
          {!list.isLoading && !list.isError && list.data?.length === 0 && (mode === "browse" || debounced) && <div className="rounded-xl border border-dashed p-5 text-sm">No cards in this context. Change the year or set, or try a different search.</div>}
          {mode === "browse" && step === "year" && <div className="scan-grid">{years.data?.map(y => <Button key={y} variant="outline" className="h-14" onClick={() => { setYear(y); setSet(null); setStep("set"); }}>{y}</Button>)}</div>}
          {mode === "browse" && step === "set" && <div className="scan-grid">{sets.data?.map(subsetTile)}</div>}
          {mode === "browse" && step === "subset" && <div className="scan-grid">{subsets.data?.map(subsetTile)}</div>}
          {mode === "browse" && step === "card" && <div className="scan-grid">{cards.data?.map(c => <ScanResultTile key={c.id} pending={pending} compact family={{ familyKey: String(c.id), score: 0, representativeCardId: c.id, options: [{ cardId: c.id, name: c.name, cardNumber: c.cardNumber, imageUrl: c.frontImageUrl, subsetName: c.variation, setName: subset?.name ?? set?.name ?? "", year }] }} onAdd={addCard} />)}</div>}
          {mode === "search" && groupSearch(search.data ?? []).map((family, index, groups) => <div key={family.familyKey} className="mb-3">{(index === 0 || (groups[index-1].options[0] as SearchCard).mainSetId !== (family.options[0] as SearchCard).mainSetId || groups[index-1].options[0].year !== family.options[0].year) && <h3 className="mb-2 border-b border-stone-300 pb-1 text-xs font-semibold">{family.options[0].year} · {(family.options[0] as SearchCard).mainSetName ?? family.options[0].setName}</h3>}<ScanResultTile family={family} compact pending={pending} onAdd={addCard} /></div>)}
        </div>
        <Button variant="outline" className="my-3 h-11 shrink-0" disabled={pending} onClick={back}><ArrowLeft className="mr-2 h-4 w-4" />Back {mode === "browse" && step !== "year" ? "to change context" : "to scan"}</Button>
      </>}
      {view === "offer" && offerCard && <div data-testid="scan-photo-offer" className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-y-auto">
        <h2 className="scan-heading text-3xl">Card added. Photo missing.</h2><p className="text-sm text-gray-600">Want to help fill the catalog? Your scan photo is still here. Offering it for review is optional.</p>
        {previewUrl && <img src={previewUrl} alt="Retained photo for optional review" className="mx-auto max-h-[25dvh] object-contain" />}
        <Button data-testid="scan-submit-photo" className="scan-primary" disabled={submitPhoto.isPending} onClick={() => submitPhoto.mutate()}>{submitPhoto.isPending ? "Sending for review…" : "Offer photo for review"}</Button>
        <Button data-testid="scan-review-crop" variant="outline" disabled={submitPhoto.isPending} onClick={() => setView("crop")}>Crop review photo (optional)</Button>
        <Button data-testid="scan-offer-skip" variant="ghost" disabled={submitPhoto.isPending} onClick={onNext}><Camera className="mr-2 h-4 w-4" />Skip & scan next</Button>
      </div>}
      {view === "crop" && photo && <div className="min-h-0 flex-1 overflow-y-auto"><CardCrop file={photo} format="visual-v1" onCancel={() => setView("offer")} onConfirm={(file, url) => { URL.revokeObjectURL(url); setReviewFile(file); setView("offer"); }} /></div>}
    </div>
  </section>;
}