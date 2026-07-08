import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useSearch, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { PcBinderShareModal } from "@/components/collection/pc-binder-share-modal";
import type { CardWithSet, CollectionItem, InsertUserCollection, InsertUserWishlist, WishlistItem } from "@shared/schema";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Search,
  Share2,
  X,
  Check,
  Loader2,
  Target,
  Layers,
} from "lucide-react";

interface BinderCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  rarity: string;
  isInsert: boolean;
  setId: number;
  setName: string | null;
  addedAt: string;
  owned: boolean;
}

interface PcBinderDetail {
  id: number;
  name: string;
  description: string | null;
  category: string;
  createdAt: string;
  cards: BinderCard[];
  totalCards: number;
  ownedCards: number;
  missingCards: number;
  completionPct: number;
}

interface SearchCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  set: { id: number; name: string; year: number } | null;
}

interface BulkResult {
  matched: number;
  added: number;
  remaining: number;
  capped: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  Character: "bg-red-100 text-red-800 border-red-200",
  Artist: "bg-purple-100 text-purple-800 border-purple-200",
  Theme: "bg-blue-100 text-blue-800 border-blue-200",
  "Chase List": "bg-amber-100 text-amber-800 border-amber-200",
  Other: "bg-gray-100 text-gray-700 border-gray-200",
};

// Binder names are capped at 60 chars server-side
const MAX_BINDER_NAME_LEN = 60;

function truncateForSuffix(base: string, suffix: string): string {
  const max = MAX_BINDER_NAME_LEN - suffix.length;
  return base.length > max ? base.slice(0, max).trimEnd() : base;
}

// "Sabretooth PC" -> "Sabretooth PC Vol. 2"; "Sabretooth PC Vol. 2" -> "... Vol. 3"
// Requires whitespace before "vol" so names like "Marvol 2" aren't mangled.
function nextVolumeName(name: string): string {
  const m = name.match(/^(.*\S)\s+vol\.?\s*(\d+)\s*$/i);
  if (m && m[1].trim().length > 0) {
    const suffix = ` Vol. ${parseInt(m[2], 10) + 1}`;
    return truncateForSuffix(m[1].trim(), suffix) + suffix;
  }
  const suffix = " Vol. 2";
  return truncateForSuffix(name.trim(), suffix) + suffix;
}

// Info handed to the parent when an add hits the 500-card cap, so it can
// offer creating the next volume binder with the leftover cards.
interface BinderFullInfo {
  search?: string;
  cardId?: number;
  leftover: number;
}

function AddCardsDialog({
  open,
  onOpenChange,
  binderId,
  binderCardIds,
  onBinderFull,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  binderId: number;
  binderCardIds: Set<number>;
  onBinderFull: (info: BinderFullInfo) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [justAdded, setJustAdded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: results, isFetching } = useQuery<{ items: SearchCard[]; totalCount: number }>({
    queryKey: ["/api/cards", { search: debounced, forPcBinder: true }],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/cards?search=${encodeURIComponent(debounced)}&pageSize=100`
      );
      return res.json();
    },
    enabled: open && debounced.length >= 2,
  });

  // Dry-run of the bulk endpoint: how many cards match this term BY NAME
  // (excluding ones already in the binder). This is the number "Add All"
  // will actually add — never use /api/cards totalCount, which also
  // matches set names.
  const { data: bulkPreview } = useQuery<BulkResult>({
    queryKey: ["/api/pc-binders", String(binderId), "bulk-preview", debounced],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/pc-binders/${binderId}/cards/bulk`, {
        search: debounced,
        dryRun: true,
      });
      return res.json();
    },
    enabled: open && debounced.length >= 2,
  });

  const addMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const res = await apiRequest("POST", `/api/pc-binders/${binderId}/cards`, { cardId });
      return { cardId, ...(await res.json()) };
    },
    onSuccess: (data) => {
      setJustAdded((prev) => new Set(prev).add(data.cardId));
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
    },
    onError: (err: any, cardId: number) => {
      if (String(err?.message || "").includes("BINDER_FULL")) {
        onBinderFull({ cardId, leftover: 1 });
        return;
      }
      toast({
        title: "Couldn't add card",
        description: err?.message || undefined,
        variant: "destructive",
      });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/pc-binders/${binderId}/cards/bulk`, {
        search: debounced,
      });
      return res.json() as Promise<BulkResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId), "bulk-preview"] });
      if (data.added === 0) {
        toast({
          title: "No cards added",
          description: data.capped
            ? "This binder is already at its 500 card limit."
            : "All matching cards are already in this binder.",
        });
      } else {
        toast({
          title: `Added ${data.added} card${data.added === 1 ? "" : "s"}!`,
          description: data.capped
            ? `Binders hold up to 500 cards — ${data.matched - data.added} matching cards didn't fit.`
            : undefined,
        });
      }
      const leftover = data.matched - data.added;
      if (data.capped && leftover > 0) {
        onBinderFull({ search: debounced, leftover });
      }
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't add cards",
        description: err?.message || undefined,
        variant: "destructive",
      });
    },
  });

  const isInBinder = (cardId: number) => binderCardIds.has(cardId) || justAdded.has(cardId);
  const matched = bulkPreview?.matched ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setSearch("");
          setDebounced("");
          setJustAdded(new Set());
        }
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-red-600" />
            Add Cards to Binder
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any card — owned or not…"
            className="pl-9 bg-white text-gray-900"
            autoFocus
            data-testid="input-pc-binder-card-search"
          />
        </div>

        {debounced.length >= 2 && matched > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {matched.toLocaleString()} card{matched === 1 ? "" : "s"} named "{debounced}"
              </p>
              <p className="text-xs text-gray-600">
                {bulkPreview?.capped
                  ? `Binder has room for ${bulkPreview.remaining} more (500 max)`
                  : "not yet in this binder"}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                // Binder already full — skip the no-op request and offer Vol. 2
                if (bulkPreview && bulkPreview.remaining === 0) {
                  onBinderFull({ search: debounced, leftover: matched });
                } else {
                  bulkMutation.mutate();
                }
              }}
              disabled={bulkMutation.isPending}
              className="bg-red-600 hover:bg-red-700 shrink-0"
              data-testid="button-add-all"
            >
              {bulkMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Layers className="w-4 h-4 mr-1" />
              )}
              Add All
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-[200px] -mx-2 px-2">
          {debounced.length < 2 ? (
            <p className="text-sm text-gray-500 text-center py-10">
              Type at least 2 characters to search the card database.
            </p>
          ) : isFetching && !results ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : !results?.items?.length ? (
            <p className="text-sm text-gray-500 text-center py-10">No cards found.</p>
          ) : (
            <div className="space-y-1.5 py-1">
              {results.items.map((card) => {
                const added = isInBinder(card.id);
                return (
                  <div
                    key={card.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2"
                  >
                    <div className="w-9 h-12 rounded bg-gray-100 overflow-hidden shrink-0">
                      {card.frontImageUrl ? (
                        <img
                          src={card.frontImageUrl}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{card.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {card.set?.name} #{card.cardNumber}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={added ? "outline" : "default"}
                      disabled={added || addMutation.isPending}
                      onClick={() => addMutation.mutate(card.id)}
                      className={added ? "text-green-600 border-green-300" : "bg-red-600 hover:bg-red-700"}
                      data-testid={`button-add-card-${card.id}`}
                    >
                      {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </div>
                );
              })}
              {results.totalCount > results.items.length && (
                <p className="text-xs text-gray-500 text-center py-2">
                  Showing first {results.items.length} of {results.totalCount.toLocaleString()} search
                  results — use Add All above to grab every "{debounced}" card at once.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The "start the next volume?" prompt shown when a binder hits its 500-card cap
interface VolumePrompt {
  search?: string;
  cardId?: number;
  leftover: number;
  // Binder IDs whose cards must NOT be repeated in the new volume
  chain: number[];
  fullBinderName: string;
  nextName: string;
}

export default function PcBinderDetail() {
  const params = useParams<{ id: string }>();
  const binderId = parseInt(params.id || "");
  const searchString = useSearch();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "owned" | "missing">(() => {
    const f = new URLSearchParams(searchString).get("filter");
    return f === "owned" || f === "missing" ? f : "all";
  });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardWithSet | null>(null);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [loadingCardId, setLoadingCardId] = useState<number | null>(null);
  const [volumePrompt, setVolumePrompt] = useState<VolumePrompt | null>(null);

  const { data: binder, isLoading, isError } = useQuery<PcBinderDetail>({
    queryKey: ["/api/pc-binders", String(binderId)],
    // Default fetcher only uses queryKey[0]; hierarchical keys need an explicit queryFn
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pc-binders/${binderId}`);
      return res.json();
    },
    enabled: !isNaN(binderId),
  });

  const { data: wishlist } = useQuery<WishlistItem[]>({
    queryKey: ["/api/wishlist"],
  });

  const { data: collection } = useQuery<CollectionItem[]>({
    queryKey: ["/api/collection"],
  });

  const isCardInWishlist = (cardId: number) =>
    wishlist?.some((item) => item.card?.id === cardId || (item as any).cardId === cardId) || false;

  const isCardInCollection = (cardId: number) =>
    collection?.some((item) => item.card?.id === cardId || (item as any).cardId === cardId) || false;

  const removeMutation = useMutation({
    mutationFn: async (cardId: number) => {
      await apiRequest("DELETE", `/api/pc-binders/${binderId}/cards/${cardId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      toast({
        title: "Removed from binder",
        description: "Your main collection wasn't changed.",
      });
    },
    onError: () => {
      toast({ title: "Couldn't remove card", variant: "destructive" });
    },
  });

  const addToCollectionMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const insertData: InsertUserCollection = {
        userId: 1,
        cardId,
        condition: "Near Mint",
        quantity: 1,
        personalValue: "0",
        isForSale: false,
        isFavorite: false,
      };
      return apiRequest("POST", "/api/collection", insertData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      toast({
        title: "Added to Collection",
        description: "Card successfully added to your collection",
      });
    },
    onError: () => {
      toast({ title: "Couldn't add to collection", variant: "destructive" });
    },
  });

  const removeFromCollectionMutation = useMutation({
    mutationFn: (cardId: number) => {
      const collectionItem = collection?.find(
        (item) => item.card?.id === cardId || (item as any).cardId === cardId
      );
      if (collectionItem) {
        return apiRequest("DELETE", `/api/collection/${collectionItem.id}`);
      }
      throw new Error("Card not found in collection");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(binderId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      toast({ title: "Removed from collection" });
    },
    onError: () => {
      toast({ title: "Couldn't remove from collection", variant: "destructive" });
    },
  });

  const removeFromWishlistMutation = useMutation({
    mutationFn: (cardId: number) => {
      const wishlistItem = wishlist?.find(
        (item) => item.card?.id === cardId || (item as any).cardId === cardId
      );
      if (wishlistItem) {
        return apiRequest("DELETE", `/api/wishlist/${wishlistItem.id}`);
      }
      throw new Error("Card not found in wishlist");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({ title: "Removed from wishlist" });
    },
    onError: () => {
      toast({ title: "Couldn't remove from wishlist", variant: "destructive" });
    },
  });

  const addToWishlistMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const insertData: InsertUserWishlist = {
        userId: 1,
        cardId,
        priority: 1,
        maxPrice: null,
      };
      return apiRequest("POST", "/api/wishlist", insertData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
      toast({
        title: "Added to Wishlist",
        description: "Card successfully added to your wishlist",
      });
    },
    onError: () => {
      toast({ title: "Couldn't add to wishlist", variant: "destructive" });
    },
  });

  // Create the next volume binder ("<Name> Vol. 2") and move the leftover
  // cards into it — excludeBinderIds guarantees no card is repeated across
  // volumes. Chains to Vol. 3+ if the leftovers still don't fit.
  const createVolumeMutation = useMutation({
    mutationFn: async (prompt: VolumePrompt) => {
      const res = await apiRequest("POST", "/api/pc-binders", {
        name: prompt.nextName,
        description: binder?.description || null,
        category: binder?.category || "Other",
      });
      const newBinder = await res.json();
      let bulkResult: BulkResult | null = null;
      if (prompt.cardId != null) {
        await apiRequest("POST", `/api/pc-binders/${newBinder.id}/cards`, { cardId: prompt.cardId });
      } else if (prompt.search) {
        const bulkRes = await apiRequest("POST", `/api/pc-binders/${newBinder.id}/cards/bulk`, {
          search: prompt.search,
          excludeBinderIds: prompt.chain,
        });
        bulkResult = (await bulkRes.json()) as BulkResult;
      }
      return { newBinder, bulkResult, prompt };
    },
    onSuccess: ({ newBinder, bulkResult, prompt }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders", String(newBinder.id)] });
      const addedCount = bulkResult ? bulkResult.added : 1;
      toast({
        title: `Created "${newBinder.name}"`,
        description: `${addedCount.toLocaleString()} card${addedCount === 1 ? "" : "s"} added.`,
      });
      navigate(`/pc-binders/${newBinder.id}`);
      const leftover = bulkResult ? bulkResult.matched - bulkResult.added : 0;
      if (bulkResult && bulkResult.capped && leftover > 0) {
        // Still more cards than fit — offer Vol. 3 (and so on)
        setVolumePrompt({
          search: prompt.search,
          leftover,
          chain: [...prompt.chain, newBinder.id],
          fullBinderName: newBinder.name,
          nextName: nextVolumeName(newBinder.name),
        });
      } else {
        setVolumePrompt(null);
      }
    },
    onError: (err: any) => {
      setVolumePrompt(null);
      toast({
        title: "Couldn't create the next binder",
        description: err?.message || undefined,
        variant: "destructive",
      });
    },
  });

  // Open the full card detail modal (same one used across the app). The
  // binder API returns a slim card shape, so fetch the full card first.
  const handleCardClick = async (cardId: number) => {
    if (loadingCardId) return;
    setLoadingCardId(cardId);
    try {
      const res = await apiRequest("GET", `/api/cards/${cardId}`);
      const fullCard: CardWithSet = await res.json();
      setSelectedCard(fullCard);
      setIsCardModalOpen(true);
    } catch {
      toast({ title: "Couldn't load card details", variant: "destructive" });
    } finally {
      setLoadingCardId(null);
    }
  };

  if (isNaN(binderId) || isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">This PC Binder could not be found.</p>
        <Link href="/pc-binders">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to PC Binders
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading || !binder) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const visibleCards =
    filter === "all"
      ? binder.cards
      : binder.cards.filter((c) => (filter === "owned" ? c.owned : !c.owned));

  const selectedBinderCard = selectedCard
    ? binder.cards.find((c) => c.id === selectedCard.id)
    : undefined;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/pc-binders" className="inline-flex items-center text-sm text-gray-600 hover:text-red-600 mb-3">
        <ArrowLeft className="w-4 h-4 mr-1" />
        PC Binders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-red-600 shrink-0" />
            <span className="truncate">{binder.name}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="outline"
              className={`text-xs ${CATEGORY_COLORS[binder.category] || CATEGORY_COLORS.Other}`}
            >
              {binder.category}
            </Badge>
            {binder.description && (
              <span className="text-sm text-gray-600 truncate">{binder.description}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowShareModal(true)}
            data-testid="button-share-binder"
          >
            <Share2 className="w-4 h-4 mr-1" />
            Share
          </Button>
          <Button onClick={() => setShowAddDialog(true)} className="bg-red-600 hover:bg-red-700">
            <Plus className="w-4 h-4 mr-1" />
            Add Cards
          </Button>
        </div>
      </div>

      <Card className="mt-4 mb-5">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-gray-700">
              <span className="font-bold text-gray-900">{binder.totalCards}</span> cards
            </span>
            <span className="text-green-700">
              <span className="font-bold">{binder.ownedCards}</span> owned
            </span>
            <span className="text-amber-700">
              <span className="font-bold">{binder.missingCards}</span> missing
            </span>
            <span className="ml-auto font-bold text-gray-900">{binder.completionPct}% complete</span>
          </div>
          <Progress value={binder.completionPct} className="h-2.5 mt-2" />
        </CardContent>
      </Card>

      {binder.totalCards > 0 && (
        <div className="flex gap-2 mb-4">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            className={filter === "all" ? "bg-red-600 hover:bg-red-700" : ""}
          >
            All ({binder.totalCards})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFilter("owned")}
            className={
              filter === "owned"
                ? "text-white bg-green-600 border-green-600 hover:bg-green-700 hover:text-white"
                : "text-green-700 border-green-300 hover:bg-green-50"
            }
          >
            Owned ({binder.ownedCards})
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFilter("missing")}
            className={
              filter === "missing"
                ? "text-white bg-[#f73f32] border-[#f73f32] hover:bg-red-700 hover:text-white"
                : "text-red-600 border-red-300 hover:bg-red-50"
            }
          >
            Missing ({binder.missingCards})
          </Button>
        </div>
      )}

      {binder.totalCards === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <Target className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <h2 className="text-lg font-semibold text-gray-900 mb-1">This binder is empty</h2>
            <p className="text-sm text-gray-600 mb-4 max-w-sm mx-auto">
              Add any cards from the database — ones you own show as collected, and ones you're
              still hunting show as chase cards.
            </p>
            <Button onClick={() => setShowAddDialog(true)} className="bg-red-600 hover:bg-red-700">
              <Plus className="w-4 h-4 mr-1" />
              Add Cards
            </Button>
          </CardContent>
        </Card>
      ) : visibleCards.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-10">
          {filter === "owned" ? "You don't own any of these cards yet." : "You own every card in this binder — fully complete!"}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visibleCards.map((card) => (
            <Card
              key={card.id}
              className="group relative overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer"
              onClick={() => handleCardClick(card.id)}
              data-testid={`card-binder-card-${card.id}`}
            >
              <CardContent className="p-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMutation.mutate(card.id);
                  }}
                  disabled={removeMutation.isPending}
                  className="absolute top-2 right-2 z-10 p-1 rounded-full bg-white/85 text-gray-500 hover:text-red-600 hover:bg-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  title="Remove from binder (doesn't affect your collection)"
                  data-testid={`button-remove-card-${card.id}`}
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="relative aspect-[2.5/3.5] bg-gray-100 overflow-hidden">
                  {card.frontImageUrl ? (
                    <img
                      src={card.frontImageUrl}
                      alt={card.name}
                      loading="lazy"
                      className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-105 ${
                        card.owned ? "" : "grayscale opacity-60"
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-full h-full flex items-center justify-center ${
                        card.owned
                          ? "bg-gradient-to-br from-red-100 to-red-200"
                          : "bg-gradient-to-br from-gray-200 to-gray-300"
                      }`}
                    >
                      <span className={`font-bold text-xs text-center px-2 ${card.owned ? "text-red-600" : "text-gray-500"}`}>
                        {card.name}
                      </span>
                    </div>
                  )}
                  {loadingCardId === card.id && (
                    <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2">
                    {card.owned ? (
                      <Badge className="bg-green-600 text-white text-xs shadow">Owned</Badge>
                    ) : (
                      <Badge className="bg-amber-500 text-white text-xs shadow">Chasing</Badge>
                    )}
                  </div>
                </div>

                <div className="p-2.5">
                  <h3 className="font-semibold text-xs text-gray-900 line-clamp-2 leading-tight">
                    {card.name}
                  </h3>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    {card.setName} #{card.cardNumber}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddCardsDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        binderId={binderId}
        binderCardIds={new Set(binder.cards.map((c) => c.id))}
        onBinderFull={(info) => {
          setShowAddDialog(false);
          setVolumePrompt({
            ...info,
            chain: [binderId],
            fullBinderName: binder.name,
            nextName: nextVolumeName(binder.name),
          });
        }}
      />

      <AlertDialog
        open={!!volumePrompt}
        onOpenChange={(open) => {
          if (!open && !createVolumeMutation.isPending) setVolumePrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This binder is full</AlertDialogTitle>
            <AlertDialogDescription>
              {volumePrompt?.cardId != null
                ? `"${volumePrompt?.fullBinderName}" holds up to 500 cards. Start "${volumePrompt?.nextName}" and add this card there instead?`
                : `"${volumePrompt?.fullBinderName}" holds up to 500 cards — ${volumePrompt?.leftover.toLocaleString()} matching card${volumePrompt?.leftover === 1 ? "" : "s"} didn't fit. Start "${volumePrompt?.nextName}" with the rest? No cards will be repeated between volumes.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createVolumeMutation.isPending} data-testid="button-decline-next-volume">
              Not now
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={createVolumeMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (volumePrompt) createVolumeMutation.mutate(volumePrompt);
              }}
              data-testid="button-create-next-volume"
            >
              {createVolumeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Create "{volumePrompt?.nextName}"
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PcBinderShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        binderId={binderId}
        binderName={binder.name}
      />

      <CardDetailModal
        card={selectedCard}
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        isInCollection={
          selectedCard
            ? collection
              ? isCardInCollection(selectedCard.id)
              : selectedBinderCard?.owned ?? false
            : false
        }
        isInWishlist={selectedCard ? isCardInWishlist(selectedCard.id) : false}
        onAddToCollection={() => {
          if (selectedCard) addToCollectionMutation.mutate(selectedCard.id);
        }}
        onAddToWishlist={() => {
          if (selectedCard) addToWishlistMutation.mutate(selectedCard.id);
        }}
        onRemoveFromCollection={() => {
          if (selectedCard) removeFromCollectionMutation.mutate(selectedCard.id);
        }}
        onRemoveFromWishlist={() => {
          if (selectedCard) removeFromWishlistMutation.mutate(selectedCard.id);
        }}
      />
    </div>
  );
}
