import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Camera, Search, Sun, ScanLine, Layers, Check, Plus, List, Pencil, Copy, Flag, ArrowRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CollectionItem } from "@shared/schema";
import "./scan-idle.css";

function OwnedThumbnail({ row }: { row: CollectionItem }) {
  const [failed, setFailed] = useState(false);
  return <span className="scan-idle-thumb">
    {row.card.frontImageUrl && !failed
      ? <img src={row.card.frontImageUrl} alt="" onError={() => setFailed(true)} />
      : <ImageOff aria-label="Card image unavailable" />}
  </span>;
}

export function ScanIdle({ authenticated, count, atLimit, ready, onScan, onSearch, onPlans }: {
  authenticated: boolean;
  count?: number;
  atLimit: boolean;
  ready: boolean;
  onScan: () => void;
  onRapid?: () => void;
  onSearch: () => void;
  onPlans: () => void;
}) {
  const [clean, setClean] = useState(false);
  const [webpFailed, setWebpFailed] = useState(false);
  const [selected, setSelected] = useState<CollectionItem | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detailAction = useMutation({
    mutationFn: async ({ method, url, body }: { method: string; url: string; body?: object }) => apiRequest(method, url, body),
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/collection"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
    },
    onError: (error: Error) => toast({ title: "Couldn't update your collection", description: error.message, variant: "destructive" }),
  });
  // A missing public file can return the SPA HTML with HTTP 200: an actual
  // image decode (not HEAD/status alone) is required before showing HTML text.
  useEffect(() => {
    let active = true;
    let probe: HTMLImageElement | undefined;
    const check = () => {
      probe = new Image();
      probe.onload = () => { if (active && probe?.naturalWidth) setClean(true); };
      probe.src = "/scan-hero-clean.png";
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      active = false;
      if (probe) probe.onload = null;
      window.removeEventListener("focus", check);
    };
  }, []);
  const { data: collection } = useQuery<CollectionItem[]>({
    // Same authenticated owned-collection query as My Collection, never catalog recents.
    queryKey: ["/api/collection"],
    enabled: authenticated,
    staleTime: 30_000,
  });
  const recent = (Array.isArray(collection) ? [...collection] : [])
    .sort((a, b) => new Date(b.acquiredDate).getTime() - new Date(a.acquiredDate).getTime() || b.id - a.id)
    .slice(0, 6);

  return <div className="scan-idle" data-testid="scan-idle">
    <div className="scan-idle-banner" data-testid="scan-idle-banner" data-clean={clean}>
      <img src={clean ? "/scan-hero-clean.png" : webpFailed ? "/scan-hero.png" : "/scan-hero.webp"}
        width={1904} height={640} alt="Scan to Add: photograph your Marvel card"
        onError={() => { if (clean) setClean(false); else setWebpFailed(true); }} />
      {clean && <h2 className="scan-idle-headline">Scan to Add</h2>}
    </div>
    <p className="scan-idle-copy">Snap a photo of your card. We'll find it in seconds.</p>
    <ul className="scan-idle-tips" aria-label="Photo tips">
      <li><Sun aria-hidden="true" />Good light</li>
      <li><ScanLine aria-hidden="true" />Whole card in view</li>
      <li><Layers aria-hidden="true" />Sleeves OK</li>
    </ul>
    <div className="scan-idle-actions">
      <Button data-testid="scan-start" className="scan-idle-primary" disabled={atLimit || !ready} onClick={onScan}>
        <Camera className="mr-2 h-6 w-6" aria-hidden="true" />Scan a card
      </Button>
      {atLimit && <p role="alert" className="text-center text-xs text-amber-700">Monthly scan limit reached. <button className="underline" onClick={onPlans}>View plans</button></p>}
      <Button variant="outline" className="scan-idle-search" onClick={onSearch}><Search className="mr-2 h-4 w-4" aria-hidden="true" />Search instead</Button>
    </div>
    <section className="scan-idle-panel" aria-labelledby="scan-how-title">
      <h3 className="scan-idle-section-title" id="scan-how-title">HOW IT WORKS</h3>
      <div className="scan-idle-steps">
        <div className="scan-idle-step"><Camera aria-hidden="true" /><strong>Snap</strong><p>Take a photo, no crop needed</p></div>
        <div className="scan-idle-step"><Search aria-hidden="true" /><strong>Match</strong><p>We search 90,000+ card images</p></div>
        <div className="scan-idle-step"><Plus aria-hidden="true" /><strong>Add</strong><p>One tap to your vault</p></div>
      </div>
    </section>
    <div className="scan-idle-guides">
      <section className="scan-idle-panel scan-idle-best">
        <h3 className="scan-idle-section-title">Best results</h3>
        <ul className="scan-idle-guide-list">
          {["Good lighting", "Whole card in view", "Front of card", "Sleeves & toploaders OK"].map(text => <li key={text}><Check aria-hidden="true" />{text}</li>)}
        </ul>
      </section>
      <section className="scan-idle-panel">
        <h3 className="scan-idle-section-title">Can't find it?</h3>
        <ul className="scan-idle-guide-list">
          <li><List aria-hidden="true" />Browse by year &amp; set</li>
          <li><Pencil aria-hidden="true" />Type a search</li>
          <li><Copy aria-hidden="true" />Pick the exact version</li>
          <li><Flag aria-hidden="true" />Report a wrong image</li>
        </ul>
      </section>
    </div>
    <section className="scan-idle-panel scan-idle-help">
      <h3 className="scan-idle-section-title">HELP BUILD THE VAULT</h3>
      <p>Card missing a picture? Add yours after you scan, and every photo you submit helps the next collector find it faster.</p>
    </section>
    {recent.length > 0 && <section className="scan-idle-panel scan-idle-recent-group" data-testid="scan-idle-recent-section">
      <h3 className="scan-idle-section-title">RECENTLY ADDED</h3>
      <div className="scan-idle-recent" aria-label="Latest owned cards">
        {recent.map(row => <button key={row.id} type="button" onClick={() => setSelected(row)} aria-label={`View ${row.card.name} #${row.card.cardNumber}`}>
          <OwnedThumbnail row={row} />
          <span className="scan-idle-card-name" title={row.card.name}>{row.card.name}</span>
          <span className="scan-idle-card-number">#{row.card.cardNumber}</span>
        </button>)}
      </div>
      <footer className="scan-idle-footer" data-testid="scan-idle-footer">
        {typeof count === "number" ? <p>{count.toLocaleString()} cards in your collection</p>
          : <div className="scan-idle-count-loading animate-pulse" role="status" aria-label="Collection count unavailable" />}
        <Link href="/my-collection">View collection<ArrowRight aria-hidden="true" /></Link>
      </footer>
    </section>}
    {selected && <CardDetailModal card={selected.card} isOpen onClose={() => setSelected(null)}
      isInCollection collectionItemId={selected.id} collectionQuantity={selected.quantity}
      onRemoveFromCollection={() => {
        if (!detailAction.isPending && window.confirm(`Remove ${selected.card.name} from your collection?`)) {
          detailAction.mutate({ method: "DELETE", url: `/api/collection/${selected.id}` });
        }
      }}
      onAddToWishlist={() => {
        if (!detailAction.isPending) detailAction.mutate({ method: "POST", url: "/api/wishlist", body: { cardId: selected.card.id } });
      }}
      onCardUpdate={card => setSelected(row => row ? { ...row, card } : null)}
    />}
  </div>;
}