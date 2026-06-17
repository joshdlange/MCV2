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
} from "lucide-react";

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

interface SearchCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  set: { name: string; year: number };
}

type Stage =
  | "idle"
  | "scanning"
  | "results"
  | "manual-search"
  | "confirmed"
  | "success";

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
          <img
            src={card.imageUrl}
            alt={card.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff className="w-4 h-4 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
          {card.name}
        </p>
        <p className="text-xs text-gray-500 truncate">{card.setName}</p>
        {card.subsetName && (
          <p className="text-xs text-gray-400 truncate">{card.subsetName}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {card.cardNumber && (
            <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
              #{card.cardNumber}
            </span>
          )}
          {card.year && (
            <span className="text-xs text-gray-500">{card.year}</span>
          )}
          {showConfidence && card.matchReasons.length > 0 && (
            <span className="text-xs text-green-600 dark:text-green-400">
              ✓ {card.matchReasons.join(", ")}
            </span>
          )}
        </div>
      </div>
      {selected && (
        <CheckCircle2 className="w-5 h-5 text-red-500 flex-shrink-0" />
      )}
    </button>
  );
}

export default function ScanToAdd() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedCard, setSelectedCard] = useState<ScanMatch | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [submitImage, setSubmitImage] = useState(false);
  const [alreadyOwned, setAlreadyOwned] = useState(false);

  const scanMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      const token = await user?.getIdToken();
      const res = await fetch("/api/cards/scan", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Scan failed");
      }
      return res.json() as Promise<ScanResult>;
    },
    onSuccess: (data) => {
      setScanResult(data);
      if (data.confidenceLevel === "none") {
        setStage("manual-search");
      } else {
        setStage("results");
        if (data.confidenceLevel === "high" && data.matches.length > 0) {
          setSelectedCard(data.matches[0]);
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
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
      if (err.message?.toLowerCase().includes("already")) {
        setAlreadyOwned(true);
        setStage("confirmed");
      } else if (err.message?.toLowerCase().includes("limit")) {
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

  const { data: searchResults = [], isFetching: searchLoading } = useQuery<SearchCard[]>({
    queryKey: ["/api/cards", { search: searchQuery }],
    queryFn: async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) return [];
      const res = await apiRequest("GET", `/api/cards?search=${encodeURIComponent(searchQuery)}&pageSize=20`);
      const data = await res.json();
      return (data.cards || data) as SearchCard[];
    },
    enabled: searchQuery.length >= 2 && stage === "manual-search",
  });

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
    setAlreadyOwned(false);
    scanMutation.mutate(file);
  }

  function handleManualSelect(card: SearchCard) {
    const match: ScanMatch = {
      cardId: card.id,
      name: card.name,
      setName: card.set?.name || "",
      subsetName: null,
      cardNumber: card.cardNumber,
      year: card.set?.year || null,
      imageUrl: card.frontImageUrl,
      confidence: 0,
      matchReasons: [],
    };
    setSelectedCard(match);
    setStage("confirmed");
  }

  function handleReset() {
    setStage("idle");
    setPreviewUrl(null);
    setScanResult(null);
    setSelectedCard(null);
    setSearchQuery("");
    setSubmitImage(false);
    setAlreadyOwned(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const cardMissingImage = selectedCard && !selectedCard.imageUrl;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <ScanLine className="w-6 h-6 text-red-500" />
            <h1 className="text-2xl font-bebas tracking-wide text-gray-900 dark:text-white">
              Scan to Add
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Take a photo of your card and we'll try to find it in the Marvel Card Vault database.
          </p>
        </div>

        {/* ── IDLE ── */}
        {stage === "idle" && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-red-400 transition-colors bg-white dark:bg-gray-900"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                <Camera className="w-8 h-8 text-red-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-gray-700 dark:text-gray-200">Scan a card</p>
                <p className="text-sm text-gray-400 mt-1">Take a photo or pick from your gallery</p>
              </div>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white gap-2">
                <Camera className="w-4 h-4" /> Open Camera / Upload
              </Button>
            </div>

            <p className="text-center text-xs text-gray-400">
              Supports JPEG, PNG, WebP · Max 10MB
            </p>
          </div>
        )}

        {/* Hidden file input — camera on mobile, file picker on desktop */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />

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
                    : `${scanResult.matches.length} possible matches`}
                </p>
                <ConfidencePill level={scanResult.confidenceLevel} />
              </div>
              <button
                onClick={() => setStage("manual-search")}
                className="text-xs text-red-500 hover:underline"
              >
                Search manually
              </button>
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
              onClick={() => setStage("manual-search")}
            >
              <Search className="w-4 h-4 mr-2" />
              Not the right one? Search manually
            </Button>
          </div>
        )}

        {/* ── MANUAL SEARCH ── */}
        {stage === "manual-search" && (
          <div className="space-y-4">
            {previewUrl && (
              <div className="rounded-xl overflow-hidden border bg-white dark:bg-gray-900 max-h-40 flex items-center justify-center">
                <img src={previewUrl} alt="Scanned card" className="max-h-40 object-contain" />
              </div>
            )}

            <div className="space-y-2">
              <p className="font-semibold text-gray-800 dark:text-white">Search for your card</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Card name, character, set…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-white dark:bg-gray-900"
                  autoFocus
                />
              </div>
            </div>

            {searchLoading && (
              <div className="flex items-center justify-center py-4 gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Searching…</span>
              </div>
            )}

            {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="text-center py-6 text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No cards found. Try a different name or set.</p>
              </div>
            )}

            <div className="space-y-2">
              {searchResults.map((card) => (
                <button
                  key={card.id}
                  onClick={() => handleManualSelect(card)}
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
                    <p className="text-xs text-gray-500 truncate">{card.set?.name}</p>
                    <p className="text-xs font-mono text-gray-400">#{card.cardNumber}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── CONFIRMED ── */}
        {stage === "confirmed" && selectedCard && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border p-4 space-y-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Is this your card?</p>
              <div className="flex gap-4 items-start">
                <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 border">
                  {selectedCard.imageUrl ? (
                    <img
                      src={selectedCard.imageUrl}
                      alt={selectedCard.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageOff className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                </div>
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
                <span>This card is already in your collection.</span>
              </div>
            )}

            {cardMissingImage && scanResult?.imageUrl && !alreadyOwned && (
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
              {!alreadyOwned && (
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => addToCollectionMutation.mutate(selectedCard.cardId)}
                  disabled={addToCollectionMutation.isPending}
                >
                  {addToCollectionMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding…</>
                  ) : (
                    <><Star className="w-4 h-4 mr-2" /> Add to My Collection</>
                  )}
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedCard(null);
                  setAlreadyOwned(false);
                  setStage(scanResult ? "results" : "manual-search");
                }}
              >
                Not the right card?
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

        {/* Always-visible reset link (except idle/success) */}
        {!["idle", "success"].includes(stage) && (
          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline-offset-2 hover:underline"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
