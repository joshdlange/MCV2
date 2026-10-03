import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import type { RapidItem } from "@/lib/rapidScan";
import { ScanResultTile, type ScanTileCard } from "./scan-result-tile";

export function RapidChoice({ item, initialSearch, onSelect, onBack }: {
  item: RapidItem; initialSearch: boolean;
  onSelect: (card: ScanTileCard, missing: boolean, fromSearch: boolean) => void; onBack: () => void;
}) {
  const [searching, setSearching] = useState(initialSearch || !item.families.length);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const results = useQuery<ScanTileCard[]>({
    queryKey: ["/api/cards/scan/search", debounced],
    queryFn: async ({ signal }) => (await apiRequest("GET", `/api/cards/scan/search?q=${encodeURIComponent(debounced)}`, undefined, signal)).json(),
    enabled: searching && !!debounced, retry: false, gcTime: 0,
  });
  return <section data-testid="rapid-choice">
    <header className="rapid-choice"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />Back to batch</Button><h2 className="mt-3">Choose the exact set and version</h2><p className="rapid-copy">This selects a card for review. It does not add ownership or upload a photo.</p>
      <div className="flex gap-2"><Button variant={!searching ? "default" : "outline"} disabled={!item.families.length} onClick={() => setSearching(false)}>Artwork matches</Button><Button variant={searching ? "default" : "outline"} onClick={() => setSearching(true)}><Search className="mr-1 h-4 w-4" />Search catalog</Button></div>
    </header>
    {!searching && item.families.map((family, i) => <ScanResultTile key={family.familyKey} family={family} primary={i === 0} pending={false} onSelect={(card, missing) => onSelect(card, missing, false)} />)}
    {searching && <><Input data-testid="rapid-search-input" placeholder="Name, number, set, year…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search catalog" />
      {results.isFetching && <div className="rapid-skeleton animate-pulse" role="status" aria-label="Searching catalog" />}
      {results.isError && <div className="rapid-alert" role="alert">Catalog search could not load.<Button variant="outline" size="sm" className="ml-2" onClick={() => void results.refetch()}>Retry search</Button></div>}
      {!debounced && <p className="rapid-empty mt-3">Try the character name or the printed number. Check set, year and version before choosing.</p>}
      {!!debounced && !results.isFetching && !results.isError && results.data?.length === 0 && <p className="rapid-empty mt-3">No results. Try fewer words or another card number.</p>}
      {results.data?.map(card => <ScanResultTile key={card.cardId} pending={false} family={{ familyKey: String(card.cardId), score: 0, representativeCardId: card.cardId, options: [card] }} onSelect={(selected, missing) => onSelect(selected, missing, true)} />)}
    </>}
  </section>;
}