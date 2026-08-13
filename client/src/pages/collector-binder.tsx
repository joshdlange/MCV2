import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { auth } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { formatCardName } from "@/lib/formatTitle";
import { ArrowLeft, BookOpen, EyeOff, Loader2, Sparkles } from "lucide-react";

interface BinderCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  isInsert: boolean;
  setName: string | null;
}

interface CollectorBinderData {
  ownerName: string;
  ownerUsername: string | null;
  isOwnProfile: boolean;
  binder: { id: number; name: string; description: string | null; category: string };
  cards: BinderCard[];
  ownedCardIds: number[];
  stats: { totalCards: number; ownedCount: number };
}

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

export default function CollectorBinder() {
  const params = useParams<{ username: string; id: string }>();
  const { username, id } = params;
  const [view, setView] = useState<"all" | "owned" | "chasing">("all");

  const { data, isLoading, error } = useQuery<CollectorBinderData>({
    queryKey: ["/api/collectors", username, "pc-binders", id],
    queryFn: async () => {
      const user = auth.currentUser;
      const headers: Record<string, string> = {};
      if (user) headers["Authorization"] = `Bearer ${await user.getIdToken()}`;
      const res = await fetch(`/api/collectors/${username}/pc-binders/${id}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.message || "Failed to load binder"), { status: res.status });
      }
      return res.json();
    },
    enabled: !!username && !!id,
    retry: false,
  });

  const ownedSet = useMemo(() => new Set(data?.ownedCardIds ?? []), [data]);
  const visibleCards = useMemo(() => {
    if (!data) return [];
    if (view === "all") return data.cards;
    return data.cards.filter((c) => (view === "owned" ? ownedSet.has(c.id) : !ownedSet.has(c.id)));
  }, [data, view, ownedSet]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    const isPrivate = (error as any)?.status === 403;
    return (
      <div className="max-w-lg mx-auto text-center py-20 px-4">
        {isPrivate ? <EyeOff className="w-12 h-12 text-gray-300 mx-auto mb-4" /> : <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />}
        <h1 className="text-xl font-bold text-gray-800 mb-2">
          {isPrivate ? "This collection is private" : "Binder not found"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {isPrivate
            ? "This collector keeps their Personal Collections private."
            : "This binder doesn't exist or may have been removed."}
        </p>
        {username && (
          <Link href={`/collectors/${username}`} className="inline-flex items-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700">
            <ArrowLeft className="w-4 h-4" /> Back to profile
          </Link>
        )}
      </div>
    );
  }

  const { binder, stats, ownerName } = data;
  const chasingCount = stats.totalCards - stats.ownedCount;
  const completionPct = stats.totalCards > 0 ? Math.round((stats.ownedCount / stats.totalCards) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link
        href={`/collectors/${username}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 mb-4"
        data-testid="link-back-to-profile"
      >
        <ArrowLeft className="w-4 h-4" /> {ownerName}'s profile
      </Link>

      <div className="text-center mb-6">
        <p className="text-red-500 text-xs font-semibold tracking-wider uppercase mb-1">
          {ownerName}'s PC Binder
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight mb-1" data-testid="text-binder-name">
          {binder.name}
        </h1>
        <span className="inline-block text-[11px] font-semibold tracking-wide uppercase text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-3 py-0.5 capitalize">
          {binder.category}
        </span>
        {binder.description && (
          <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">{binder.description}</p>
        )}
        <div className="flex items-center justify-center gap-2 mt-3 text-sm">
          <span className="text-green-600 font-bold">{stats.ownedCount}</span>
          <span className="text-gray-400">of</span>
          <span className="text-gray-800 font-bold">{stats.totalCards}</span>
          <span className="text-gray-400">collected · {completionPct}%</span>
        </div>
      </div>

      {data.cards.length === 0 ? (
        <Card className="border border-gray-200">
          <CardContent className="text-center py-16">
            <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">This binder is empty for now.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-center gap-2 mb-4">
            {([
              ["all", `All (${stats.totalCards})`],
              ["owned", `Owned (${stats.ownedCount})`],
              ["chasing", `Chasing (${chasingCount})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                data-testid={`button-view-${key}`}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border
                  ${view === key
                    ? 'bg-red-600 text-white border-red-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {visibleCards.map((card) => {
              const owned = ownedSet.has(card.id);
              const imageUrl = card.frontImageUrl && card.frontImageUrl !== PLACEHOLDER_IMAGE ? card.frontImageUrl : null;
              return (
                <div key={card.id} data-testid={`binder-card-${card.id}`}>
                  <div
                    className={`relative rounded-lg overflow-hidden bg-gray-100 border ${owned ? 'border-green-300 shadow-sm' : 'border-gray-200'}`}
                    style={{ aspectRatio: '2.5 / 3.5' }}
                  >
                    {imageUrl ? (
                      <img src={imageUrl} alt={card.name} loading="lazy" className={`w-full h-full object-cover ${!owned ? 'grayscale opacity-50' : ''}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-2 text-center">
                        <span className="text-[10px] text-gray-400 leading-tight line-clamp-3">{card.name}</span>
                      </div>
                    )}
                    {owned && card.isInsert && (
                      <div className="absolute top-1 right-1 bg-purple-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center">
                        <Sparkles className="w-3 h-3" />
                      </div>
                    )}
                    <div className="absolute bottom-1 left-1">
                      {owned ? (
                        <span className="bg-green-600/90 text-white text-[9px] px-1.5 py-0.5 rounded font-bold">OWNED</span>
                      ) : (
                        <span className="bg-amber-500/90 text-black text-[9px] px-1.5 py-0.5 rounded font-bold">CHASING</span>
                      )}
                    </div>
                  </div>
                  <p className="text-gray-500 text-[10px] mt-1 text-center truncate px-0.5">
                    {formatCardName(card.name)}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
