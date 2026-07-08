import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
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
  ArrowLeft,
  BookOpen,
  Plus,
  Search,
  X,
  Check,
  Loader2,
  Target,
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

function AddCardsDialog({
  open,
  onOpenChange,
  binderId,
  binderCardIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  binderId: number;
  binderCardIds: Set<number>;
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
        `/api/cards?search=${encodeURIComponent(debounced)}&pageSize=30`
      );
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
    onError: (err: any) => {
      toast({
        title: "Couldn't add card",
        description: err?.message || undefined,
        variant: "destructive",
      });
    },
  });

  const isInBinder = (cardId: number) => binderCardIds.has(cardId) || justAdded.has(cardId);

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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PcBinderDetail() {
  const params = useParams<{ id: string }>();
  const binderId = parseInt(params.id || "");
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "owned" | "chase">("all");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: binder, isLoading, isError } = useQuery<PcBinderDetail>({
    queryKey: ["/api/pc-binders", String(binderId)],
    // Default fetcher only uses queryKey[0]; hierarchical keys need an explicit queryFn
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pc-binders/${binderId}`);
      return res.json();
    },
    enabled: !isNaN(binderId),
  });

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
            <Badge variant="outline" className="text-xs">{binder.category}</Badge>
            {binder.description && (
              <span className="text-sm text-gray-600 truncate">{binder.description}</span>
            )}
          </div>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="bg-red-600 hover:bg-red-700">
          <Plus className="w-4 h-4 mr-1" />
          Add Cards
        </Button>
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
              <span className="font-bold">{binder.missingCards}</span> chasing
            </span>
            <span className="ml-auto font-bold text-gray-900">{binder.completionPct}% complete</span>
          </div>
          <Progress value={binder.completionPct} className="h-2.5 mt-2" />
        </CardContent>
      </Card>

      {binder.totalCards > 0 && (
        <div className="flex gap-2 mb-4">
          {([
            ["all", `All (${binder.totalCards})`],
            ["owned", `Owned (${binder.ownedCards})`],
            ["chase", `Chasing (${binder.missingCards})`],
          ] as const).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
              className={filter === key ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {label}
            </Button>
          ))}
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
              className="group relative overflow-hidden hover:shadow-lg transition-all duration-200"
              data-testid={`card-binder-card-${card.id}`}
            >
              <CardContent className="p-0">
                <button
                  onClick={() => removeMutation.mutate(card.id)}
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
      />
    </div>
  );
}
