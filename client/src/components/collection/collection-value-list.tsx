import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ImageOff, TrendingUp, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCollectionValue } from "@/hooks/use-collection-value";
import { formatMarketValue, type ValueCard, type ValueFilters } from "@/lib/collectionValue";
import { apiRequest } from "@/lib/queryClient";
import type { CardWithSet } from "@shared/schema";
import { convertGoogleDriveUrl } from "@/lib/utils";
import { formatCardName, formatSetName } from "@/lib/formatTitle";
import "./collection-value.css";

function ValueThumbnail({ card, size = "compact" }: { card: ValueCard; size?: "compact" | "grid" | "grail" }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={size === "compact" ? "h-20 w-14 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-100 flex items-center justify-center" : `value-image value-image-${size}`}>
      {card.frontImageUrl && !failed ? (
        <img src={convertGoogleDriveUrl(card.frontImageUrl)} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : <ImageOff className="h-5 w-5 text-gray-400" aria-label="No card image" />}
    </div>
  );
}

export function CollectionValueList({
  username, preview = false, title, onSeeAll, seeAllHref = "/collection/value",
  showSummary = false, filters = {}, controlledOrder,
}: {
  username?: string;
  preview?: boolean;
  title?: string;
  onSeeAll?: () => void;
  seeAllHref?: string;
  showSummary?: boolean;
  filters?: ValueFilters;
  controlledOrder?: "desc" | "asc";
}) {
  const [selected, setSelected] = useState<ValueCard | null>(null);
  const detail = useQuery<CardWithSet>({
    queryKey: ["/api/cards", selected?.id],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/cards/${selected!.id}`, undefined, signal)).json(),
    enabled: !!selected,
    staleTime: 60_000,
    retry: false,
  });
  const query = useCollectionValue({ ...filters, order: controlledOrder ?? "desc", hideUnder5: false }, username, preview);
  const summary = query.data?.pages[0]?.summary;
  const cards = query.data?.pages.flatMap(page => page.cards) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  // My Collection owns its sorting/filtering controls; it is not a Top Cards showcase.
  const isShowcase = !preview && !controlledOrder && !filters.search?.trim() &&
    filters.setId === undefined && !filters.favorite && filters.isInsert === undefined;
  const featured = isShowcase ? cards[0] : undefined;
  const gridCards = featured ? cards.slice(1) : cards;
  return (
    <section className="value-gallery min-w-0 space-y-4 text-gray-900" aria-label={title ?? "Cards by market value"}>
      {title && <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-base"><TrendingUp className="h-4 w-4 text-red-600" />{title}</h2>
        {preview && (onSeeAll ? <button className="shrink-0 text-sm text-red-600 hover:underline" onClick={onSeeAll}>See all →</button> : <Link href={seeAllHref} className="shrink-0 text-sm text-red-600 hover:underline">See all →</Link>)}
      </div>}
      {showSummary && summary && <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" data-testid="value-summary">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total collection value</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-green-700">{formatMarketValue(summary.totalValue)}</p>
        <p className="mt-2 text-sm text-gray-600">{summary.pricedCards.toLocaleString()} priced cards · {summary.pricedCopies.toLocaleString()} copies</p>
        <p className="mt-1 text-xs text-gray-500">Includes every priced copy in your collection.</p>
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">Prices updated {summary.pricesUpdatedAt ? new Date(summary.pricesUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
      </div>}
      {query.isLoading ? <div role="status" aria-label="Loading card values" className="space-y-4">
        {isShowcase && <div className="h-80 animate-pulse rounded-2xl bg-stone-200" />}
        <div className={preview ? "grid grid-cols-5 gap-2" : "value-grid"}>
          {Array.from({ length: preview ? 5 : 6 }, (_, i) => <div key={i} className="animate-pulse"><div className={preview ? "h-20 rounded bg-gray-200" : "aspect-[5/7] rounded-lg bg-stone-200"} /><div className="mt-2 h-3 rounded bg-gray-100" /></div>)}
        </div>
      </div> : query.isError && !query.data ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center" role="alert">
        <p className="font-semibold">Couldn't load card values</p><p className="mt-1 text-sm text-gray-600">Please try again. No new price checks are needed.</p>
        <Button variant="outline" className="mt-3 bg-white text-gray-900" onClick={() => void query.refetch()}>Retry</Button>
      </div> : cards.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-9 text-center">
        <TrendingUp className="mx-auto mb-3 h-8 w-8 text-red-400" />
        <h3 className="font-semibold">{summary?.pricedCards === 0 ? "No priced cards yet" : "No cards match these filters"}</h3>
        <p className="mt-2 text-sm text-gray-500">{summary?.pricedCards === 0 ? "Cards appear here once they have a cached market price. Open a card to check its price." : "Try adjusting your collection filters."}</p>
      </div> : preview ? <div className="grid grid-cols-5 gap-2" data-testid="value-preview">
        {cards.map(card => <button key={card.collectionItemId} type="button" onClick={() => setSelected(card)}
          aria-label={`${formatCardName(card.name)} #${card.cardNumber}, ${formatMarketValue(card.marketValue)}`}
          title={`${formatCardName(card.name)} #${card.cardNumber} · ${formatSetName(card.set.name)} · ${card.set.year}`}
          className="min-w-0 rounded-lg text-center hover:bg-gray-50 focus-visible:outline-red-600"
          data-testid={`value-card-${card.id}`}>
          <div className="flex justify-center"><ValueThumbnail card={card} /></div>
          <p className="mt-1.5 truncate text-[11px] font-bold tabular-nums text-green-700">{formatMarketValue(card.marketValue)}</p>
          <p className="truncate text-[10px] text-gray-500">{formatCardName(card.name)}</p>
        </button>)}
      </div> : <div className="space-y-5">
        {featured && <button type="button" className="value-grail" onClick={() => setSelected(featured)}
          data-testid={`value-card-${featured.id}`} aria-label={`Holy grail: ${formatCardName(featured.name)} #${featured.cardNumber}, ${formatMarketValue(featured.marketValue)}`}>
          <div className="value-grail-art" data-testid="value-grail">
            <ValueThumbnail card={featured} size="grail" />
            <Trophy className="value-grail-trophy" aria-label="Highest valued card" />
          </div>
          <div className="min-w-0">
            <p className="value-grail-eyebrow text-[11px] font-semibold uppercase tracking-[0.2em]">The holy grail</p>
            <p className="mt-2 font-bebas text-3xl leading-tight tracking-wide break-words">{formatCardName(featured.name)} <span className="value-grail-number">#{featured.cardNumber}</span></p>
            <p className="value-grail-meta mt-1 text-sm">{formatSetName(featured.set.name)} · {featured.set.year}</p>
            <p className="value-grail-price mt-4 text-3xl font-bold tabular-nums">{formatMarketValue(featured.marketValue)}</p>
            {featured.quantity > 1 && <p className="value-grail-meta mt-1 text-xs">×{featured.quantity} · {formatMarketValue(featured.lineTotal)} total</p>}
            <p className="value-grail-note mt-4 text-xs">Highest valued card · View card details →</p>
          </div>
        </button>}
        <div className="value-grid" data-testid="value-grid">
        {gridCards.map(card => <button key={card.collectionItemId} type="button" onClick={() => setSelected(card)} className="value-tile" data-testid={`value-card-${card.id}`}>
          <ValueThumbnail card={card} size="grid" />
          <div className="mt-3 min-w-0">
            <p className="break-words text-sm font-semibold leading-snug">{formatCardName(card.name)} <span className="font-normal text-gray-500">#{card.cardNumber}</span></p>
            <p className="mt-1 break-words text-xs text-gray-500">{formatSetName(card.set.name)} · {card.set.year}</p>
            <p className="mt-2 font-bold tabular-nums text-green-700">{formatMarketValue(card.marketValue)}</p>
            {card.quantity > 1 && <p className="text-xs tabular-nums text-gray-600">×{card.quantity} · {formatMarketValue(card.lineTotal)} total</p>}
          </div>
        </button>)}
        </div>
      </div>}
      {!preview && summary && <div className="space-y-3 text-center">
        <p className="text-xs text-gray-500">{cards.length} of {total.toLocaleString()} priced cards</p>
        {query.hasNextPage && <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="bg-white text-gray-900">{query.isFetchingNextPage ? "Loading more…" : "Load more"}</Button>}
        {query.isError && query.data && <div role="alert"><p className="text-sm text-red-700">Couldn't load the latest values.</p><Button variant="outline" className="mt-2 bg-white text-gray-900" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>Retry</Button></div>}
        <p className="text-sm text-gray-500">{summary.unpricedCards.toLocaleString()} cards don't have a price yet</p>
      </div>}
      {selected && (detail.data ? <CardDetailModal card={detail.data} isOpen onClose={() => setSelected(null)} /> :
        <Dialog open onOpenChange={open => { if (!open) setSelected(null); }}>
          <DialogContent className="w-[95vw] max-w-lg bg-gray-50 text-gray-900">
            <DialogHeader><DialogTitle>{formatCardName(selected.name)}</DialogTitle></DialogHeader>
            {detail.isError ? <div role="alert" className="py-4 text-center">
              <p className="font-semibold">Couldn't load card details</p>
              <p className="mt-1 text-sm text-gray-500">Please try again.</p>
              <Button variant="outline" className="mt-4 bg-white text-gray-900" onClick={() => void detail.refetch()}>Retry</Button>
            </div> : <div role="status" aria-label="Loading card details" className="animate-pulse space-y-4 py-4">
              <div className="mx-auto h-64 w-44 rounded-lg bg-gray-200" />
              <div className="h-4 rounded bg-gray-200" /><div className="h-3 w-3/4 rounded bg-gray-100" />
            </div>}
          </DialogContent>
        </Dialog>)}
    </section>
  );
}
