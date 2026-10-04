import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Search, ScanLine, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useHardwareBackHandler } from "@/hooks/useBackButton";
import { apiRequest } from "@/lib/queryClient";
import { runDevScanAction, uploadScanFrontPhoto } from "@/lib/scanConfirmation";
import { ScanAddedActions } from "./report-image-dialog";
import { CardCrop } from "@/components/CardCrop";
import type { ScanEventUpdate } from "@/lib/scanTelemetry";
import { ScanResultTile, type ScanArtworkFamily, type ScanTileCard } from "./scan-result-tile";
import "./scan-workspace.css";

// Cosine scores are fractions. Below 0.035 separation between artwork families
// show close-match guidance; this is a UI ambiguity rule, not probability.
export const SCAN_ARTWORK_AMBIGUITY_MARGIN = 0.035;
export interface ScanBrowseHint { year: number; mainSetId: number | null; setId: number; setName: string }
interface PickerSet { id: number; name: string; type: "main_set" | "card_set"; subset_count: number; totalCards?: number }
interface PickerSubset { id: number; name: string; isInsertSubset: boolean; totalCards: number }
interface PickerCard { id: number; name: string; cardNumber: string; frontImageUrl: string | null; variation: string | null }
interface SearchCard extends ScanTileCard { setId: number; mainSetId: number | null; isBase?: boolean; exactNumber: boolean }
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
  return Array.from(grouped.values()).map(family => {
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
  const [step, setStep] = useState<BrowseStep>(browseHint ? "set" : "year");
  const [year, setYear] = useState<number | null>(browseHint?.year ?? null);
  const [set, setSet] = useState<PickerSet | null>(null);
  const [subset, setSubset] = useState<PickerSubset | null>(null);
  const [setId, setSetId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offerCard, setOfferCard] = useState<ScanTileCard | null>(null);
  const [reviewFile, setReviewFile] = useState(photo);
  const saving = useRef(false);
  const mounted = useRef(true);
  const decisionLogged = useRef(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const ambiguous = families.length > 1 && (margin == null || margin < SCAN_ARTWORK_AMBIGUITY_MARGIN);
  const shown = families.slice(0, 5);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (decisionLogged.current || !families.length) return;
    decisionLogged.current = true;
    // Code-only diagnostic: no card titles, photos or user-entered search text.
    // Use the existing allowlisted diagnostic; there is no set preselection.
    void apiRequest("POST", "/api/cards/scan/client-event", { code: ambiguous ? "artwork_ambiguous" : "results_ready", stage: "results", marginThreshold: SCAN_ARTWORK_AMBIGUITY_MARGIN, shownOptions: shown.length }).catch(() => {});
  }, [families.length, ambiguous, shown.length]);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const years = useScanList<number>("/api/cards/scan/browse/years", view === "find" && mode === "browse");
  const sets = useScanList<PickerSet>(`/api/cards/scan/browse/sets?year=${year}`, view === "find" && mode === "browse" && step === "set" && year !== null);
  const subsets = useScanList<PickerSubset>(`/api/cards/scan/browse/subsets?mainSetId=${set?.id}&year=${year}`, view === "find" && mode === "browse" && step === "subset" && !!set);
  const cards = useScanList<PickerCard>(`/api/cards/scan/browse/cards?setId=${setId}&search=${encodeURIComponent(debounced)}`, view === "find" && mode === "browse" && step === "card" && !!setId);
  const search = useScanList<SearchCard>(`/api/cards/scan/search?q=${encodeURIComponent(debounced)}`, view === "find" && mode === "search" && !!debounced);
  const refresh = () => {
    for (const key of ["/api/collection", "/api/stats", "/api/user/stats", "/api/collection/check"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  const discardAndNext = () => {
    setReviewFile(null); setOfferCard(null);
    // Parent reset releases source files and revokes its preview object URL.
    onNext();
  };
  const discardAndReset = () => { setReviewFile(null); setOfferCard(null); onReset(); };
  const photoEffects = {
    add: async () => { throw new Error("Ownership cannot be added from the photo offer."); },
    upload: () => uploadScanFrontPhoto(offerCard!.cardId, reviewFile, async () => user?.getIdToken(), () => mounted.current, () => record({ photoSubmitUsed: true })),
  };
  const offerPolicy = { source: "search" as const, missingImage: true, hasPhoto: !!reviewFile };
  const add = useMutation({
    mutationFn: ({ card, missingImage, fromFind, hasPhoto }: { card: ScanTileCard; missingImage: boolean; fromFind: boolean; hasPhoto: boolean }) =>
      runDevScanAction(
        { source: fromFind ? "search" : "match", missingImage, hasPhoto },
        "add",
        {
          add: async () => (await apiRequest("POST", "/api/cards/scan/collection", { cardId: card.cardId })).json() as Promise<{ created: boolean; ownedRow: { id: number; cardId: number }; undoToken: string | null }>,
          upload: async () => { throw new Error("Add cannot submit a photo. Use the explicit photo offer."); },
        },
      ),
    onSuccess: (result, { card }) => {
      const saved = result.saved!;
      saving.current = false;
      refresh();
      const newlyCreated = saved.created === true && Number.isInteger(saved.ownedRow?.id) && saved.ownedRow.cardId === card.cardId && typeof saved.undoToken === "string";
      toast({
        title: saved.created ? "Added to your collection" : "Already in your collection",
        description: saved.created ? card.name : "Existing ownership and quantity left unchanged.",
        duration: 12_000,
        action: <ScanAddedActions card={{ cardId: card.cardId, name: card.name }} ownedRowId={newlyCreated ? saved.ownedRow.id : undefined} undoToken={newlyCreated ? saved.undoToken : undefined} />,
      });
      if (!mounted.current) return;
      if (result.next === "offer") { setOfferCard(card); setView("offer"); }
      else discardAndNext();
    },
    onError: (error: Error) => { saving.current = false; toast({ title: "Couldn't add card", description: `${error.message} Your photo is still here; try Add again.`, variant: "destructive" }); },
  });
  const submitPhoto = useMutation({
    mutationFn: () => runDevScanAction(offerPolicy, "yes", photoEffects),
    onSuccess: result => { toast({ title: result.photoResult?.autoApproved ? "Photo approved" : "Photo sent for review" }); discardAndNext(); },
    onError: (error: Error) => toast({ title: "Photo was not submitted", description: `${error.message} Your card is still added. Retry or skip.`, variant: "destructive" }),
  });
  async function skipPhoto() {
    await runDevScanAction(offerPolicy, "skip", photoEffects);
    discardAndNext();
  }
  function addCard(card: ScanTileCard, missingImage: boolean) {
    if (saving.current) return;
    saving.current = true;
    record({ pickedCardId: card.cardId, ...(view === "find" ? { usedSearch: true as const } : {}) });
    add.mutate({ card, missingImage, fromFind: view === "find", hasPhoto: !!reviewFile });
  }
  function findCard() {
    record({ usedSearch: true });
    setView("find"); setMode("browse"); setQuery("");
    if (browseHint) {
      setYear(browseHint.year);
      setStep("set");
    } else { setYear(null); setStep("year"); }
    setSet(null); setSubset(null); setSetId(null);
  }
  function back() {
    if (saving.current || submitPhoto.isPending) return;
    if (view === "crop") { setView("offer"); return; }
    if (view === "offer") { void skipPhoto(); return; }
    if (view === "find") {
      setQuery("");
      if (mode === "browse") {
        if (step === "card") { setStep(set?.type === "main_set" ? "subset" : "set"); setSetId(null); return; }
        if (step === "subset") { setStep("set"); setSubset(null); return; }
        if (step === "set") { setStep("year"); setSet(null); return; }
      }
      if (families.length) setView("results"); else discardAndReset();
    } else discardAndReset();
  }
  useHardwareBackHandler(() => { back(); return true; });
  const list = mode === "search" ? search : step === "year" ? years : step === "set" ? sets : step === "subset" ? subsets : cards;
  const pending = add.isPending;
  function contextRow(item: PickerSubset | PickerSet) {
    return <button key={item.id} className="scan-context-row" onClick={() => {
      setQuery("");
      if ("type" in item) { setSet(item); setSubset(null); setStep(item.type === "main_set" ? "subset" : "card"); setSetId(item.type === "card_set" ? item.id : null); }
      else { setSubset(item); setSetId(item.id); setStep("card"); }
    }}><span>{item.name}</span><small>{item.totalCards == null ? "Count unavailable" : `${item.totalCards} cards`}</small><ChevronRight className="h-4 w-4 shrink-0 text-red-700" /></button>;
  }
  return <section data-testid="scan-workspace" data-stage={view === "find" ? `picker-${mode === "search" ? "search" : step}` : view} className="scan-fast h-[calc(100dvh-4rem-var(--safe-area-top,0px))] overflow-hidden" style={{ paddingBottom: "var(--safe-area-bottom,0px)" }}>
    <div className="mx-auto flex h-full min-h-0 max-w-lg flex-col px-3">
      <header className="flex shrink-0 items-center justify-between py-3"><h1 className="scan-heading flex items-center gap-2 text-2xl"><ScanLine className="h-5 w-5 text-red-600" />Scan to add</h1><Button data-testid="scan-reset" variant="ghost" size="sm" disabled={pending || submitPhoto.isPending} onClick={discardAndReset}>New scan</Button></header>
      {view === "results" && <>
        <div className="mb-2 flex shrink-0 items-center gap-3">{previewUrl && <img src={previewUrl} alt="Your full scan" className="h-12 w-10 rounded object-contain" />}<div><h2 className="text-sm font-semibold">Check artwork, set and year</h2><p className="text-xs text-gray-600">Tap the correct set row or Add. Nothing is added until you choose.</p></div></div>
        {ambiguous && <p data-testid="scan-close-match-guidance" role="status" className="mb-2 shrink-0 text-xs text-gray-600">Several cards have similar artwork. Check the set, year and card number before adding. Don’t see yours? Browse or search below.</p>}
        {elapsedMs !== undefined && <p data-testid="scan-dev-elapsed" className="mb-2 shrink-0 text-[10px] text-gray-500">Matches found in {(elapsedMs / 1000).toFixed(2)}s</p>}
        <div data-testid="scan-result-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{shown.map((family, i) => <ScanResultTile key={family.familyKey} family={family} primary={i === 0} pending={pending} onAdd={addCard} />)}</div>
        <footer data-testid="scan-sticky-actions" className="shrink-0 py-3"><Button data-testid="scan-not-here" className="h-11 w-full" variant="outline" disabled={pending} onClick={findCard}><Search className="mr-2 h-4 w-4" />Not here? Browse or search</Button></footer>
      </>}
      {view === "find" && <>
        <div className="mb-2 flex shrink-0 gap-2"><Button size="sm" variant={mode === "browse" ? "default" : "outline"} onClick={() => { setMode("browse"); setQuery(""); }}>Browse cards</Button><Button size="sm" variant={mode === "search" ? "default" : "outline"} onClick={() => { setMode("search"); setQuery(""); }}>Type search</Button></div>
        {mode === "browse" && <>
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <label htmlFor="scan-browse-year" className="text-xs font-semibold">Year</label>
            <select id="scan-browse-year" data-testid="scan-year-select" className="scan-year-select" value={year ?? ""} disabled={years.isLoading} onChange={e => {
              const nextYear = e.target.value ? Number(e.target.value) : null;
              setYear(nextYear); setSet(null); setSubset(null); setSetId(null); setQuery(""); setStep(nextYear ? "set" : "year");
            }}>
              <option value="">Choose year</option>
              {year !== null && !years.data?.includes(year) && <option value={year}>{year}</option>}
              {years.data?.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {browseHint?.year === year && <span className="text-[11px] text-gray-600">Scan’s year guess</span>}
          </div>
          {years.isError && step !== "year" && <button className="mb-2 text-left text-xs text-red-700 underline" onClick={() => void years.refetch()}>Years could not load. Retry</button>}
          <nav aria-label="Browse context" className="scan-breadcrumb shrink-0">
            <button onClick={() => { setStep("year"); setSet(null); setSubset(null); setSetId(null); setQuery(""); }}>Year{year ? ` ${year}` : ""}</button>
            <ChevronRight className="h-3 w-3" />
            <button disabled={!year} aria-current={step === "set" ? "step" : undefined} onClick={() => { setStep("set"); setSubset(null); setSetId(null); setQuery(""); }}>Set{set ? `: ${set.name}` : ""}</button>
            <ChevronRight className="h-3 w-3" />
            <button disabled={!set || set.type !== "main_set"} aria-current={step === "subset" ? "step" : undefined} onClick={() => { setStep("subset"); setSetId(null); setQuery(""); }}>Subset{subset ? `: ${subset.name}` : ""}</button>
          </nav>
          <h2 className="mb-2 shrink-0 text-sm font-semibold">{step === "year" ? "Choose a year above" : step === "set" ? `Choose a set from ${year}` : step === "subset" ? "Choose a subset" : "Choose your card"}</h2>
        </>}
        {(mode === "search" || step !== "year") && <Input data-testid="scan-search-input" className="mb-2 h-11 shrink-0 bg-stone-50" placeholder={mode === "search" ? "Name, number, set, year…" : step === "card" ? "Filter cards by name or number…" : `Filter ${step === "set" ? "sets" : "subsets"} by name…`} value={query} onChange={e => setQuery(e.target.value)} />}
        <div data-testid={mode === "search" ? "scan-search-list" : "scan-browse-list"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {list.isLoading && <div className="scan-grid">{[0,1,2,3].map(n => <div key={n} className="scan-skeleton" />)}</div>}
          {list.isError && <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm">This checklist couldn't load.<Button variant="outline" className="mt-3 w-full" onClick={() => void list.refetch()}>Retry</Button></div>}
          {mode === "search" && !debounced && <div className="rounded-xl border border-dashed border-stone-300 p-5 text-sm text-gray-600">Try a character or printed number. Exact numbers come first; versions stay together.</div>}
          {!list.isLoading && !list.isError && list.data?.length === 0 && (mode === "browse" || debounced) && <div className="rounded-xl border border-dashed p-5 text-sm">No cards in this context. Change the year or set, or try a different search.</div>}
          {mode === "browse" && (step === "set" || step === "subset") && (() => {
            const rows = (step === "set" ? sets.data : subsets.data)?.filter(item => query.toLowerCase().trim().split(/\s+/).every(token => item.name.toLowerCase().includes(token)));
            return <div>{rows?.map(contextRow)}{rows?.length === 0 && !!list.data?.length && <p className="p-4 text-sm">No names match this filter. Try fewer words.</p>}</div>;
          })()}
          {mode === "browse" && step === "card" && <div className="scan-grid">{cards.data?.map(c => <ScanResultTile key={c.id} pending={pending} compact family={{ familyKey: String(c.id), score: 0, representativeCardId: c.id, options: [{ cardId: c.id, name: c.name, cardNumber: c.cardNumber, imageUrl: c.frontImageUrl, subsetName: c.variation, setName: subset?.name ?? set?.name ?? "", mainSetName: set?.name, mainSetId: set?.type === "main_set" ? set.id : null, setId: setId!, year }] }} onAdd={addCard} />)}</div>}
          {mode === "search" && groupSearch(search.data ?? []).map(family => <ScanResultTile key={family.familyKey} family={family} pending={pending} onAdd={addCard} />)}
        </div>
        <Button variant="outline" className="my-3 h-11 shrink-0" disabled={pending} onClick={back}><ArrowLeft className="mr-2 h-4 w-4" />Back {mode === "browse" && step !== "year" ? "to change context" : "to scan"}</Button>
      </>}
      {view === "offer" && offerCard && <div data-testid="scan-photo-offer" className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-y-auto">
        <h2 className="scan-heading text-3xl">Use your photo as this card’s image?</h2><p className="text-sm text-gray-600">Card added. The catalog has no usable image. Yes sends your photo for review; skipping sends nothing.</p>
        {previewUrl && <img src={previewUrl} alt="Retained photo for optional review" className="mx-auto max-h-[25dvh] object-contain" />}
        <Button data-testid="scan-submit-photo" className="scan-primary" disabled={submitPhoto.isPending} onClick={() => submitPhoto.mutate()}>{submitPhoto.isPending ? "Sending for review…" : "Yes, use my photo"}</Button>
        <Button data-testid="scan-review-crop" variant="outline" disabled={submitPhoto.isPending} onClick={() => setView("crop")}>Crop review photo (optional)</Button>
        <Button data-testid="scan-offer-skip" variant="ghost" disabled={submitPhoto.isPending} onClick={() => void skipPhoto()}><Camera className="mr-2 h-4 w-4" />Skip & scan next</Button>
      </div>}
      {view === "crop" && photo && <div className="min-h-0 flex-1 overflow-y-auto"><CardCrop file={photo} format="visual-v1" onCancel={() => setView("offer")} onConfirm={(file, url) => { URL.revokeObjectURL(url); setReviewFile(file); setView("offer"); }} /></div>}
    </div>
  </section>;
}