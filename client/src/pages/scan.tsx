import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  Camera,
  Upload,
  Loader2,
  CheckCircle2,
  Search,
  AlertCircle,
  ScanLine,
  ImageOff,
  Star,
  RefreshCw,
  FolderOpen,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookOpen,
  Lightbulb,
  Zap,
} from "lucide-react";

// ── Interfaces ──────────────────────────────────────────────────────────────

interface ScanMatch {
  cardId: number;
  name: string;
  setName: string;
  subsetName: string | null;
  cardNumber: string;
  year: number | null;
  imageUrl: string | null;
  confidence: number;
  matchReasons: string[];
}

interface ScanResult {
  imageUrl: string | null;
  ocrText: string;
  parsed: { cardNumber: string | null; year: string | null; keywords: string[] };
  matches: ScanMatch[];
  confidenceLevel: "high" | "medium" | "low" | "none";
}

interface PickerSet {
  id: number;
  name: string;
  type: "main_set" | "card_set";
  subset_count: number;
}

interface PickerSubset {
  id: number;
  name: string;
  isInsertSubset: boolean;
  totalCards: number;
}

interface PickerCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  variation: string | null;
  isInsert: boolean;
}

// ── Stage type ───────────────────────────────────────────────────────────────

type Stage =
  | "idle"
  | "scanning"
  | "results"
  | "picker-year"
  | "picker-set"
  | "picker-subset"
  | "picker-card"
  | "confirmed"
  | "success";

// ── Helper components ────────────────────────────────────────────────────────

function ConfidencePill({ level }: { level: ScanResult["confidenceLevel"] }) {
  const map = {
    high: { label: "High confidence", cls: "bg-green-100 text-green-700" },
    medium: { label: "Possible match", cls: "bg-amber-100 text-amber-700" },
    low: { label: "Low confidence", cls: "bg-orange-100 text-orange-700" },
    none: { label: "No match", cls: "bg-gray-100 text-gray-600" },
  };
  const { label, cls } = map[level];
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function CardTile({
  card,
  onSelect,
  selected,
  showConfidence,
}: {
  card: ScanMatch;
  onSelect: (c: ScanMatch) => void;
  selected: boolean;
  showConfidence: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(card)}
      className={`w-full text-left flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
        selected
          ? "border-red-500 bg-red-50 dark:bg-red-950/20"
          : "border-gray-200 dark:border-gray-700 hover:border-red-300 bg-white dark:bg-gray-900"
      }`}
    >
      <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff className="w-4 h-4 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{card.name}</p>
        <p className="text-xs text-gray-500 truncate">{card.setName}</p>
        {card.subsetName && <p className="text-xs text-gray-400 truncate">{card.subsetName}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {card.cardNumber && (
            <span className="text-xs font-mono text-gray-600 dark:text-gray-400">#{card.cardNumber}</span>
          )}
          {card.year && <span className="text-xs text-gray-500">{card.year}</span>}
          {showConfidence && card.matchReasons.length > 0 && (
            <span className="text-xs text-green-600 dark:text-green-400">
              ✓ {card.matchReasons.join(", ")}
            </span>
          )}
        </div>
      </div>
      {selected && <CheckCircle2 className="w-5 h-5 text-red-500 flex-shrink-0" />}
    </button>
  );
}

// Progress breadcrumb shown during picker
function PickerProgress({
  step,
  year,
  setName,
  subsetName,
  onBackToYear,
  onBackToSet,
  onBackToSubset,
}: {
  step: "year" | "set" | "subset" | "card";
  year: number | null;
  setName: string;
  subsetName: string;
  onBackToYear: () => void;
  onBackToSet: () => void;
  onBackToSubset: () => void;
}) {
  const steps = ["Year", "Set", "Subset", "Card"];
  const activeIdx = { year: 0, set: 1, subset: 2, card: 3 }[step];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs">
        {steps.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
            <span
              className={
                i < activeIdx
                  ? "text-red-500 font-medium cursor-pointer hover:underline"
                  : i === activeIdx
                  ? "text-gray-900 dark:text-white font-semibold"
                  : "text-gray-400"
              }
              onClick={() => {
                if (i < activeIdx) {
                  if (i === 0) onBackToYear();
                  else if (i === 1) onBackToSet();
                  else if (i === 2) onBackToSubset();
                }
              }}
            >
              {i === 0 && year && i < activeIdx ? year : s}
            </span>
          </span>
        ))}
      </div>
      {/* Breadcrumb trail */}
      <div className="flex flex-wrap gap-1">
        {year && step !== "year" && (
          <button
            onClick={onBackToYear}
            className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            {year}
          </button>
        )}
        {setName && (step === "subset" || step === "card") && (
          <button
            onClick={onBackToSet}
            className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 transition-colors max-w-[180px] truncate"
          >
            {setName}
          </button>
        )}
        {subsetName && step === "card" && (
          <button
            onClick={onBackToSubset}
            className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 transition-colors max-w-[180px] truncate"
          >
            {subsetName}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScanToAdd() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Core scan state
  const [stage, setStage] = useState<Stage>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedCard, setSelectedCard] = useState<ScanMatch | null>(null);
  const [submitImage, setSubmitImage] = useState(false);

  // Picker state
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const [pickerSet, setPickerSet] = useState<PickerSet | null>(null);
  const [pickerSetName, setPickerSetName] = useState("");
  const [pickerSubset, setPickerSubset] = useState<PickerSubset | null>(null);
  const [pickerSubsetName, setPickerSubsetName] = useState("");
  const [pickerCardSetId, setPickerCardSetId] = useState<number | null>(null);
  const [cardSearch, setCardSearch] = useState("");

  // ── Mutations ──

  const scanMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      const token = await user?.getIdToken();
      const res = await fetch("/api/cards/scan", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Scan failed");
      }
      return res.json() as Promise<ScanResult>;
    },
    onSuccess: (data) => {
      refetchUsage();
      setScanResult(data);
      if (data.confidenceLevel === "none") {
        setStage("picker-year");
      } else {
        setStage("results");
        if (data.confidenceLevel === "high" && data.matches.length > 0) {
          setSelectedCard(data.matches[0]);
        }
      }
    },
    onError: (err: Error) => {
      refetchUsage();
      if (err.message?.includes("free scans this month")) {
        toast({ title: "Monthly scan limit reached", description: "Upgrade to Super Hero for unlimited scans.", variant: "destructive" });
      } else {
        toast({ title: "Scan failed", description: err.message, variant: "destructive" });
      }
      setStage("idle");
    },
  });

  const addToCollectionMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const res = await apiRequest("POST", "/api/collection", {
        cardId,
        condition: "Near Mint",
        acquiredVia: "scan",
      });
      return res.json();
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["/api/collection"] });
      qc.invalidateQueries({ queryKey: ["/api/user/stats"] });

      if (submitImage && scanResult?.imageUrl && selectedCard) {
        try {
          const res = await apiRequest(
            "POST",
            `/api/cards/${selectedCard.cardId}/submit-scan-image`,
            { imageUrl: scanResult.imageUrl }
          );
          if (res.ok) {
            toast({ title: "Image submitted!", description: "Your photo is pending admin review." });
          }
        } catch {
          // non-fatal
        }
      }
      setStage("success");
    },
    onError: (err: Error) => {
      if (err.message?.toLowerCase().includes("limit")) {
        toast({
          title: "Collection limit reached",
          description: "Upgrade to SUPER HERO for unlimited cards.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Couldn't add card", description: err.message, variant: "destructive" });
      }
    },
  });

  // ── Picker queries ──

  const { data: pickerYears = [], isLoading: yearsLoading } = useQuery<number[]>({
    queryKey: ["/api/cards/picker/years"],
    queryFn: async () => (await apiRequest("GET", "/api/cards/picker/years")).json(),
    enabled: stage === "picker-year",
    staleTime: 10 * 60 * 1000,
  });

  const { data: pickerSets = [], isLoading: setsLoading } = useQuery<PickerSet[]>({
    queryKey: ["/api/cards/picker/sets", pickerYear],
    queryFn: async () =>
      (await apiRequest("GET", `/api/cards/picker/sets?year=${pickerYear}`)).json(),
    enabled: stage === "picker-set" && pickerYear !== null,
    staleTime: 5 * 60 * 1000,
  });

  const { data: pickerSubsets = [], isLoading: subsetsLoading } = useQuery<PickerSubset[]>({
    queryKey: ["/api/cards/picker/subsets", pickerSet?.id, pickerYear],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/cards/picker/subsets?mainSetId=${pickerSet!.id}&year=${pickerYear}`
        )
      ).json(),
    enabled: stage === "picker-subset" && pickerSet?.type === "main_set" && pickerYear !== null,
    staleTime: 5 * 60 * 1000,
  });

  const { data: pickerCards = [], isLoading: cardsLoading } = useQuery<PickerCard[]>({
    queryKey: ["/api/cards/picker/cards", pickerCardSetId, cardSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ setId: String(pickerCardSetId) });
      if (cardSearch.trim()) params.set("search", cardSearch.trim());
      return (await apiRequest("GET", `/api/cards/picker/cards?${params}`)).json();
    },
    enabled: stage === "picker-card" && pickerCardSetId !== null,
    staleTime: 2 * 60 * 1000,
  });

  // Collection count for idle hero section
  const { data: userStats } = useQuery<{ totalCards: number }>({
    queryKey: ["/api/stats"],
    queryFn: async () => (await apiRequest("GET", "/api/stats")).json(),
    staleTime: 30 * 1000,
  });

  // Scan usage for free users
  const { data: scanUsage, refetch: refetchUsage } = useQuery<{
    used: number; limit: number | null; unlimited: boolean; remaining?: number;
  }>({
    queryKey: ["/api/cards/scan/usage"],
    queryFn: async () => (await apiRequest("GET", "/api/cards/scan/usage")).json(),
    staleTime: 0,
  });

  const isAtScanLimit = !scanUsage?.unlimited && (scanUsage?.remaining ?? 99) <= 0;

  // Lightweight ownership pre-check — fires when user reaches confirmed stage
  const { data: ownershipCheck } = useQuery<{ owned: boolean; quantity: number }>({
    queryKey: ["/api/collection/check", selectedCard?.cardId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/collection/check/${selectedCard!.cardId}`)).json(),
    enabled: stage === "confirmed" && selectedCard !== null,
    staleTime: 0,
  });
  const alreadyOwned = ownershipCheck?.owned ?? false;
  const ownedQuantity = ownershipCheck?.quantity ?? 0;

  // ── Handlers ──

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    setStage("scanning");
    setScanResult(null);
    setSelectedCard(null);
    setSubmitImage(false);
    scanMutation.mutate(file);
  }

  function handlePickerCardSelect(card: PickerCard) {
    const match: ScanMatch = {
      cardId: card.id,
      name: card.name,
      setName: pickerSubsetName || pickerSetName,
      subsetName: card.variation || null,
      cardNumber: card.cardNumber,
      year: pickerYear,
      imageUrl: card.frontImageUrl,
      confidence: 0,
      matchReasons: [],
    };
    setSelectedCard(match);
    setStage("confirmed");
  }

  function handleSelectYear(year: number) {
    setPickerYear(year);
    setPickerSet(null);
    setPickerSetName("");
    setPickerSubset(null);
    setPickerSubsetName("");
    setPickerCardSetId(null);
    setCardSearch("");
    setStage("picker-set");
  }

  function handleSelectSet(set: PickerSet) {
    setPickerSet(set);
    setPickerSetName(set.name);
    setPickerSubset(null);
    setPickerSubsetName("");
    setCardSearch("");
    if (set.type === "card_set") {
      setPickerCardSetId(set.id);
      setStage("picker-card");
    } else {
      setPickerCardSetId(null);
      setStage("picker-subset");
    }
  }

  function handleSelectSubset(subset: PickerSubset) {
    setPickerSubset(subset);
    setPickerSubsetName(subset.name);
    setPickerCardSetId(subset.id);
    setCardSearch("");
    setStage("picker-card");
  }

  function goBackToYear() {
    setPickerSet(null);
    setPickerSetName("");
    setPickerSubset(null);
    setPickerSubsetName("");
    setPickerCardSetId(null);
    setCardSearch("");
    setStage("picker-year");
  }

  function goBackToSet() {
    setPickerSubset(null);
    setPickerSubsetName("");
    setPickerCardSetId(null);
    setCardSearch("");
    setStage("picker-set");
  }

  function goBackToSubset() {
    setPickerCardSetId(null);
    setCardSearch("");
    setStage("picker-subset");
  }

  function handleReset() {
    setStage("idle");
    setPreviewUrl(null);
    setScanResult(null);
    setSelectedCard(null);
    setSubmitImage(false);
    setPickerYear(null);
    setPickerSet(null);
    setPickerSetName("");
    setPickerSubset(null);
    setPickerSubsetName("");
    setPickerCardSetId(null);
    setCardSearch("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const cardMissingImage = selectedCard && !selectedCard.imageUrl;

  const isPickerStage =
    stage === "picker-year" ||
    stage === "picker-set" ||
    stage === "picker-subset" ||
    stage === "picker-card";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-12">
      <div className="max-w-lg mx-auto px-4">

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* ── IDLE: Full Hero ── */}
        {stage === "idle" && (
          <div className="space-y-5 pt-6">

            {/* Hero header */}
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shadow-sm">
                  <ScanLine className="w-4 h-4 text-white" />
                </div>
                <h1 className="text-3xl font-bebas tracking-wide text-gray-900 dark:text-white">
                  Scan to Add
                </h1>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
                Take a photo of your Marvel card and we'll try to identify it instantly.
              </p>
            </div>

            {/* 3-step process */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 shadow-sm">
              <div className="flex items-start">
                {[
                  { Icon: Camera,   label: "Scan Card",          desc: "Take a photo or upload an image" },
                  { Icon: Sparkles, label: "Identify Card",       desc: "We search the Marvel Card Vault database" },
                  { Icon: BookOpen, label: "Add to Collection",   desc: "Confirm the match and save it" },
                ].map(({ Icon, label, desc }, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center text-center relative px-1">
                    {i > 0 && (
                      <div className="absolute left-0 top-[15px] w-full h-px bg-gradient-to-r from-red-200 to-red-100 dark:from-red-900/40 dark:to-red-900/20 -translate-x-1/2 z-0" />
                    )}
                    <div className="relative z-10 w-8 h-8 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/60 flex items-center justify-center mb-2 shadow-sm">
                      <Icon className="w-3.5 h-3.5 text-red-500" />
                    </div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-tight">{label}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Upload area — card-themed */}
            <div
              className={`group relative ${isAtScanLimit ? "cursor-not-allowed" : "cursor-pointer"}`}
              onClick={() => !isAtScanLimit && fileInputRef.current?.click()}
            >
              {/* Fanned card stack behind */}
              <div className="absolute inset-x-6 bottom-0 top-4 rounded-2xl bg-red-100 dark:bg-red-950/30 border border-red-200/60 dark:border-red-900/40 rotate-3 shadow-sm transition-transform group-hover:rotate-[5deg]" />
              <div className="absolute inset-x-3 bottom-0 top-2 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-100/80 dark:border-red-900/30 rotate-1 shadow-sm transition-transform group-hover:rotate-2" />

              {/* Main card face */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-900 border-2 border-dashed border-gray-200 dark:border-gray-700 group-hover:border-red-400 dark:group-hover:border-red-600 transition-all duration-200 shadow-md group-hover:shadow-red-100 dark:group-hover:shadow-red-950/30 overflow-hidden">
                {/* Top accent bar */}
                <div className="h-1 bg-gradient-to-r from-red-500 via-red-600 to-red-500 opacity-80" />

                <div className="px-6 py-8 flex flex-col items-center gap-4">
                  {/* Camera icon with ring pulse */}
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-red-100 dark:bg-red-900/30 scale-150 opacity-0 group-hover:opacity-100 group-hover:scale-[1.7] transition-all duration-300" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-200 dark:shadow-red-900/40 flex items-center justify-center">
                      <Camera className="w-7 h-7 text-white" />
                    </div>
                  </div>

                  <div className="text-center space-y-1.5">
                    <p className="font-bold text-gray-800 dark:text-white text-base">
                      Snap a photo of your card
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">
                      We'll search thousands of Marvel cards and try to find an exact match.
                    </p>
                  </div>

                  {isAtScanLimit ? (
                    <div className="text-center space-y-3">
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-full">
                        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                          Monthly scan limit reached
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        You've used all {scanUsage?.limit} free scans this month.
                      </p>
                      <Button
                        className="bg-red-600 hover:bg-red-700 text-white gap-2 px-6 py-2 rounded-full"
                        onClick={(e) => { e.stopPropagation(); window.location.href = "/subscribe"; }}
                      >
                        <Zap className="w-4 h-4" />
                        Upgrade for Unlimited Scans
                      </Button>
                    </div>
                  ) : (
                    <Button className="bg-red-600 hover:bg-red-700 text-white gap-2 px-6 py-2 rounded-full shadow-sm shadow-red-200 dark:shadow-red-900/30 transition-transform group-hover:scale-[1.02]">
                      <Camera className="w-4 h-4" />
                      Open Camera / Upload
                    </Button>
                  )}

                  {/* Usage meter for free users */}
                  {!scanUsage?.unlimited && scanUsage?.limit && !isAtScanLimit && (
                    <div className="w-full max-w-xs space-y-1.5">
                      <div className="flex justify-between text-[11px] text-gray-400">
                        <span>{scanUsage.used} of {scanUsage.limit} free scans used this month</span>
                        <span>{scanUsage.remaining} left</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, ((scanUsage.used / scanUsage.limit) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-gray-300 dark:text-gray-600">JPEG · PNG · WebP · Max 10MB</p>
                </div>
              </div>
            </div>

            {/* Two info panels */}
            <div className="grid grid-cols-2 gap-3">
              {/* Best Results */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Best Results</p>
                </div>
                <ul className="space-y-1.5">
                  {[
                    "Good lighting",
                    "Full card visible",
                    "Front of card",
                    "Card # visible",
                  ].map((tip) => (
                    <li key={tip} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Capabilities */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3.5 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Zap className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">What It Can Do</p>
                </div>
                <ul className="space-y-1.5">
                  {[
                    "Auto-identify cards",
                    "Suggest matches",
                    "Manual picker",
                    "Submit photos",
                  ].map((cap) => (
                    <li key={cap} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{cap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Collection context */}
            {userStats && (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
                <p className="text-xs text-gray-400 dark:text-gray-500 px-2 whitespace-nowrap">
                  You currently have{" "}
                  <span className="font-semibold text-gray-600 dark:text-gray-300">
                    {userStats.totalCards.toLocaleString()}
                  </span>{" "}
                  {userStats.totalCards === 1 ? "card" : "cards"} in your collection
                </p>
                <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
              </div>
            )}

          </div>
        )}

        {/* Slim header shown during all non-idle stages */}
        {stage !== "idle" && (
          <div className="pt-5 pb-4 flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-red-600 flex items-center justify-center">
              <ScanLine className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-xl font-bebas tracking-wide text-gray-900 dark:text-white">
              Scan to Add
            </h1>
          </div>
        )}

        {/* ── SCANNING ── */}
        {stage === "scanning" && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-64 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-64 object-contain" />
              </div>
            )}
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-10 h-10 animate-spin text-red-500" />
              <p className="font-medium text-gray-700 dark:text-gray-200">Scanning card…</p>
              <p className="text-sm text-gray-400">Reading card details, this may take a moment</p>
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {stage === "results" && scanResult && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-48 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-48 object-contain" />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-800 dark:text-white">
                  {scanResult.confidenceLevel === "high"
                    ? "We found a possible match"
                    : `${scanResult.matches.length} possible match${scanResult.matches.length !== 1 ? "es" : ""}`}
                </p>
                <ConfidencePill level={scanResult.confidenceLevel} />
              </div>
            </div>

            <div className="space-y-2">
              {scanResult.matches.map((card) => (
                <CardTile
                  key={card.cardId}
                  card={card}
                  onSelect={(c) => {
                    setSelectedCard(c);
                    setStage("confirmed");
                  }}
                  selected={selectedCard?.cardId === card.cardId}
                  showConfidence={scanResult.confidenceLevel !== "high"}
                />
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full text-sm"
              onClick={() => setStage("picker-year")}
            >
              <Search className="w-4 h-4 mr-2" />
              Not listed? Choose card manually
            </Button>
          </div>
        )}

        {/* ── PICKER: YEAR ── */}
        {stage === "picker-year" && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-36 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-36 object-contain" />
              </div>
            )}

            <div>
              <p className="font-semibold text-gray-800 dark:text-white mb-1">Step 1 — Select year</p>
              <p className="text-xs text-gray-400 mb-3">What year was your card released?</p>
            </div>

            {yearsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading years…</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {pickerYears.map((year) => (
                  <button
                    key={year}
                    onClick={() => handleSelectYear(year)}
                    className="py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-semibold text-gray-800 dark:text-white hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all text-sm"
                  >
                    {year}
                  </button>
                ))}
              </div>
            )}

            {scanResult && scanResult.matches.length > 0 && (
              <Button variant="outline" className="w-full text-sm" onClick={() => setStage("results")}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to scan results
              </Button>
            )}
          </div>
        )}

        {/* ── PICKER: SET ── */}
        {stage === "picker-set" && pickerYear && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-36 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-36 object-contain" />
              </div>
            )}

            <PickerProgress
              step="set"
              year={pickerYear}
              setName={pickerSetName}
              subsetName={pickerSubsetName}
              onBackToYear={goBackToYear}
              onBackToSet={goBackToSet}
              onBackToSubset={goBackToSubset}
            />

            <div>
              <p className="font-semibold text-gray-800 dark:text-white mb-1">Step 2 — Select set</p>
              <p className="text-xs text-gray-400 mb-3">Which set is your card from?</p>
            </div>

            {setsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading sets…</span>
              </div>
            ) : pickerSets.length === 0 ? (
              <p className="text-sm text-center text-gray-400 py-6">No sets found for {pickerYear}.</p>
            ) : (
              <div className="space-y-2">
                {pickerSets.map((set) => (
                  <button
                    key={`${set.type}-${set.id}`}
                    onClick={() => handleSelectSet(set)}
                    className="w-full text-left flex items-center justify-between px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
                  >
                    <span className="text-sm font-medium text-gray-800 dark:text-white">{set.name}</span>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PICKER: SUBSET ── */}
        {stage === "picker-subset" && pickerSet && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-36 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-36 object-contain" />
              </div>
            )}

            <PickerProgress
              step="subset"
              year={pickerYear}
              setName={pickerSetName}
              subsetName={pickerSubsetName}
              onBackToYear={goBackToYear}
              onBackToSet={goBackToSet}
              onBackToSubset={goBackToSubset}
            />

            <div>
              <p className="font-semibold text-gray-800 dark:text-white mb-1">Step 3 — Select subset</p>
              <p className="text-xs text-gray-400 mb-3">Choose the specific set or insert type.</p>
            </div>

            {subsetsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading subsets…</span>
              </div>
            ) : pickerSubsets.length === 0 ? (
              <p className="text-sm text-center text-gray-400 py-6">No subsets found.</p>
            ) : (
              <div className="space-y-2">
                {pickerSubsets.map((subset) => (
                  <button
                    key={subset.id}
                    onClick={() => handleSelectSubset(subset)}
                    className="w-full text-left flex items-center justify-between px-4 py-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-white">{subset.name}</span>
                      {subset.totalCards > 0 && (
                        <span className="ml-2 text-xs text-gray-400">{subset.totalCards} cards</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {subset.isInsertSubset && (
                        <Badge variant="outline" className="text-xs">Insert</Badge>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PICKER: CARD ── */}
        {stage === "picker-card" && pickerCardSetId && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-32 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-32 object-contain" />
              </div>
            )}

            <PickerProgress
              step="card"
              year={pickerYear}
              setName={pickerSetName}
              subsetName={pickerSubsetName}
              onBackToYear={goBackToYear}
              onBackToSet={goBackToSet}
              onBackToSubset={goBackToSubset}
            />

            <div>
              <p className="font-semibold text-gray-800 dark:text-white mb-1">Step 4 — Select card</p>
            </div>

            {/* Search within card list */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by name or card #…"
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                className="pl-9 bg-white"
              />
            </div>

            {cardsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading cards…</span>
              </div>
            ) : pickerCards.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">
                  {cardSearch ? "No cards match your search." : "No cards found in this set."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pickerCards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => handlePickerCardSelect(card)}
                    className="w-full text-left flex items-center gap-3 p-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-red-300 bg-white dark:bg-gray-900 transition-all"
                  >
                    <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
                      {card.frontImageUrl ? (
                        <img src={card.frontImageUrl} alt={card.name} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageOff className="w-3 h-3 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{card.name}</p>
                      {card.variation && (
                        <p className="text-xs text-gray-500 truncate">{card.variation}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs font-mono text-gray-500">#{card.cardNumber}</span>
                        {card.isInsert && (
                          <Badge variant="outline" className="text-xs py-0 h-4">Insert</Badge>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                ))}
                {pickerCards.length === 100 && (
                  <p className="text-xs text-center text-gray-400 pt-1">
                    Showing first 100 results — use search to narrow down.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CONFIRMED ── */}
        {stage === "confirmed" && selectedCard && (
          <div className="space-y-4">
            {/* Side-by-side photo comparison */}
            {previewUrl && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Does this match your card?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-center text-gray-500">Your photo</p>
                    <div className="aspect-[2.5/3.5] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border-2 border-gray-200">
                      <img src={previewUrl} alt="Your scan" className="w-full h-full object-contain" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-center text-gray-500">In our database</p>
                    <div className="aspect-[2.5/3.5] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border-2 border-blue-200">
                      {selectedCard.imageUrl ? (
                        <img src={selectedCard.imageUrl} alt={selectedCard.name} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-400">
                          <ImageOff className="w-6 h-6" />
                          <span className="text-xs">No image yet</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-900 rounded-xl border p-4 space-y-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Card details</p>
              <div className="flex gap-4 items-start">
                {!previewUrl && (
                  <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border">
                    {selectedCard.imageUrl ? (
                      <img src={selectedCard.imageUrl} alt={selectedCard.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageOff className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1">
                  <h2 className="font-bold text-gray-900 dark:text-white text-lg leading-tight">
                    {selectedCard.name}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{selectedCard.setName}</p>
                  {selectedCard.subsetName && (
                    <p className="text-xs text-gray-400">{selectedCard.subsetName}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {selectedCard.cardNumber && (
                      <Badge variant="outline" className="text-xs font-mono">#{selectedCard.cardNumber}</Badge>
                    )}
                    {selectedCard.year && (
                      <Badge variant="outline" className="text-xs">{selectedCard.year}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {alreadyOwned && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-amber-700 dark:text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  You already have {ownedQuantity} {ownedQuantity === 1 ? "copy" : "copies"} of this card.
                  Adding will increase your quantity.
                </span>
              </div>
            )}

            {cardMissingImage && scanResult?.imageUrl && (
              <label className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={submitImage}
                  onChange={(e) => setSubmitImage(e.target.checked)}
                  className="mt-0.5 accent-red-600"
                />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    Submit your photo for review
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                    This card doesn't have an image yet. Your photo will be reviewed by an admin before going live.
                  </p>
                </div>
              </label>
            )}

            <div className="space-y-2">
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => addToCollectionMutation.mutate(selectedCard.cardId)}
                disabled={addToCollectionMutation.isPending}
              >
                {addToCollectionMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding…</>
                ) : alreadyOwned ? (
                  <><Star className="w-4 h-4 mr-2" /> Add Another Copy</>
                ) : (
                  <><Star className="w-4 h-4 mr-2" /> Add to My Collection</>
                )}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedCard(null);
                  if (isPickerStage || pickerCardSetId) {
                    setStage("picker-card");
                  } else if (scanResult) {
                    setStage("results");
                  } else {
                    setStage("picker-year");
                  }
                }}
              >
                Not the right card? Go back
              </Button>
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {stage === "success" && selectedCard && (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Added to your collection!</h2>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-medium">{selectedCard.name}</span> is now in your vault.
              </p>
              {submitImage && (
                <p className="text-xs text-blue-500 mt-2">
                  Your photo has been submitted for admin review.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setLocation("/my-collection")}
              >
                <FolderOpen className="w-4 h-4 mr-2" /> View in Collection
              </Button>
              <Button variant="outline" className="w-full" onClick={handleReset}>
                <RefreshCw className="w-4 h-4 mr-2" /> Scan Another Card
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
