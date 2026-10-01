import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { optimizedImageUrl } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert } from "lucide-react";
import { isClockwiseConvex, orderCardCorners, type CornerPoint } from "@shared/cardCorners";

// DEV-ONLY: intake of the owner's labelled Phase C0 test photos (single cards and 9-pocket pages).
// Routed only in development builds (App.tsx); the API is development + admin gated.
type Item = {
  id: string; kind: "single" | "binder"; createdAt: string; cardId?: number; tags?: string[]; note?: string;
  cells?: (number | null)[]; pageCorners?: CornerPoint[];
};
type CardInfo = { id: number; name: string; cardNumber: string | null; setName: string; year: number | null; variation: string | null; imageUrl: string | null; archivedAt: string | null };
const QUERY_KEY = ["/api/admin/phase-c0"];
const CELL_NAMES = ["top-left", "top-middle", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-middle", "bottom-right"];

function useCard(id: string) {
  return useQuery<CardInfo>({
    queryKey: [`/api/admin/phase-c0/card/${id}`],
    enabled: /^\d+$/.test(id),
    retry: false,
  });
}

function CardLabel({ id }: { id: string }) {
  const card = useCard(id);
  if (!/^\d+$/.test(id)) return null;
  if (card.isLoading) return <Loader2 className="h-4 w-4 animate-spin inline" />;
  if (card.error || !card.data) return <span className="text-xs text-red-600">Not in the production catalog snapshot</span>;
  const c = card.data;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-700">
      {c.imageUrl && <img src={c.imageUrl} alt="" className="h-12 w-auto rounded border" />}
      <span>{c.name} #{c.cardNumber ?? "?"} · {c.year ?? ""} {c.setName}{c.variation ? ` · ${c.variation}` : ""}{c.archivedAt ? " · ARCHIVED" : ""}</span>
    </span>
  );
}

function CardSearch({ onPick, target }: { onPick: (id: number) => void; target: string }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setQuery(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const results = useQuery<CardInfo[]>({
    queryKey: [`/api/admin/phase-c0/search?q=${encodeURIComponent(query)}`],
    enabled: query.length >= 2,
  });
  return (
    <div className="space-y-2">
      <label className="block text-sm">Search the production catalog (frozen snapshot) by name, number or set (e.g. "wolverine 1995 ultra 146")
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="Name, number, set" className="mt-1" />
      </label>
      <p className="text-xs text-gray-500">Tap a card to fill {target}.</p>
      {results.isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
      {results.data && !results.data.length && <p className="text-xs text-gray-500">No matches.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-[420px] overflow-y-auto">
        {results.data?.map(c => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)}
            className="text-left border rounded p-1 hover:border-blue-500 focus:border-blue-600 focus:outline-none">
            {c.imageUrl ? <img src={optimizedImageUrl(c.imageUrl, 120)} alt="" loading="lazy" className="w-full aspect-[5/7] object-contain bg-gray-50" />
              : <div className="w-full aspect-[5/7] bg-gray-100 text-[10px] text-gray-500 flex items-center justify-center">No image</div>}
            <div className="text-[11px] leading-tight mt-1">
              <div className="font-medium">{c.name} #{c.cardNumber ?? "?"}</div>
              <div className="text-gray-600">{c.year ?? ""} {c.setName}{c.variation ? ` · ${c.variation}` : ""}</div>
              <div className="text-gray-400">ID {c.id}{c.archivedAt ? " · archived" : ""}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Bilinear point inside the page quadrilateral (TL, TR, BR, BL) at fractions (u, v).
const at = (q: CornerPoint[], u: number, v: number): CornerPoint => {
  const top = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u];
  const bottom = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u];
  return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
};

function PageCornerMarker({ item, onDone }: { item: Item; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [src, setSrc] = useState<string | null>(null);
  const [points, setPoints] = useState<CornerPoint[]>(item.pageCorners ?? []);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true, url: string | undefined;
    apiRequest("GET", `/api/admin/phase-c0/image/${item.id}`).then(r => r.blob()).then(b => {
      if (active) { url = URL.createObjectURL(b); setSrc(url); }
    }).catch(() => active && setStatus("Image unavailable"));
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [item.id]);
  const valid = points.length === 4 && isClockwiseConvex(points);
  const save = async () => {
    setStatus("Saving…");
    try {
      await apiRequest("PUT", `/api/admin/phase-c0/${item.id}`, { pageCorners: points });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onDone();
    } catch { setStatus("Save failed. Try again."); }
  };
  return (
    <div className="space-y-2 border rounded p-3">
      <p className="text-sm text-gray-700">
        Click the <strong>page's top-left</strong> corner first (page upright, as you labelled the cells), then the other 3 page corners in any order.
        Use the outer edge of the 9 pockets. The 3×3 grid appears once all 4 are marked: check each cell holds one pocket.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" disabled={!valid} onClick={save}>Save page corners</Button>
        <Button size="sm" variant="outline" disabled={!points.length} onClick={() => setPoints(points.slice(0, -1))}>Undo</Button>
        <Button size="sm" variant="outline" disabled={!points.length} onClick={() => setPoints([])}>Clear</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {points.length === 4 && !valid && <span className="text-sm text-red-600 self-center" role="alert">Not a page shape. Clear and try again.</span>}
        {status && <span className="text-sm text-gray-600 self-center" role="status">{status}</span>}
      </div>
      {!src ? <Loader2 className="h-6 w-6 animate-spin" /> : (
        <div className="relative inline-block max-w-full">
          <img src={src} alt="Binder page" draggable={false} className="block max-w-full max-h-[75vh] cursor-crosshair select-none"
            onClick={e => {
              if (points.length >= 4) return;
              const r = e.currentTarget.getBoundingClientRect();
              const next: CornerPoint[] = [...points, [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]];
              setPoints(next.length === 4 ? orderCardCorners(next) : next);
            }} />
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
            {valid && [1 / 3, 2 / 3].flatMap(f => [
              <line key={`u${f}`} x1={at(points, f, 0)[0]} y1={at(points, f, 0)[1]} x2={at(points, f, 1)[0]} y2={at(points, f, 1)[1]} stroke="#16a34a" strokeWidth="0.003" />,
              <line key={`v${f}`} x1={at(points, 0, f)[0]} y1={at(points, 0, f)[1]} x2={at(points, 1, f)[0]} y2={at(points, 1, f)[1]} stroke="#16a34a" strokeWidth="0.003" />,
            ])}
            {points.length > 1 && <polygon points={points.map(p => p.join(",")).join(" ")} fill="none" stroke="#2563eb" strokeWidth="0.004" />}
          </svg>
          {points.map((p, i) => (
            <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600 text-white text-[10px] w-5 h-5 flex items-center justify-center pointer-events-none"
              style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}>{i + 1}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PhaseC0Photos() {
  const { currentUser } = useAppStore();
  const queryClient = useQueryClient();
  const enabled = import.meta.env.DEV && !!currentUser?.isAdmin;
  const list = useQuery<{ tags: string[]; items: Item[] }>({ queryKey: QUERY_KEY, enabled, staleTime: 0 });
  const [kind, setKind] = useState<"single" | "binder">("single");
  const [file, setFile] = useState<File | null>(null);
  const [cardId, setCardId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [cells, setCells] = useState<string[]>(Array(9).fill(""));
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState<Item | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState(0);

  if (!enabled) return <div className="p-6"><Card><CardContent className="py-12 text-center text-gray-700"><ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-3" />{!import.meta.env.DEV ? "Only available in development" : "Admin access required"}</CardContent></Card></div>;
  const items = list.data?.items ?? [];
  const singles = items.filter(i => i.kind === "single").length, pages = items.filter(i => i.kind === "binder");

  const canSave = !!file && !saving && (kind === "single" ? /^\d+$/.test(cardId) : cells.every(c => c === "" || /^\d+$/.test(c)));
  const save = async () => {
    if (!file) return;
    setSaving(true);
    setStatus("Uploading…");
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("photo", file);
      form.append("note", note);
      if (kind === "single") { form.append("cardId", cardId); form.append("tags", JSON.stringify(tags)); }
      else form.append("cells", JSON.stringify(cells.map(c => c || null)));
      // Multipart upload (apiRequest sends JSON), authenticated like the scan page.
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/phase-c0", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Upload failed");
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setStatus(kind === "binder" ? "Saved. Now mark the page corners in the list below." : `Saved photo of card ${cardId}.`);
      setFile(null); setInputKey(k => k + 1); setCardId(""); setTags([]); setCells(Array(9).fill("")); setNote("");
      if (kind === "binder") setMarking(body);
    } catch (e) { setStatus(e instanceof Error ? e.message : "Upload failed"); }
    finally { setSaving(false); }
  };
  const remove = async (item: Item) => {
    try {
      await apiRequest("DELETE", `/api/admin/phase-c0/${item.id}`);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch { setStatus("Could not remove photo."); }
  };

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <h1 className="text-lg font-semibold">Phase C0 test photos: {singles} single cards, {pages.length} binder pages</h1>
      <p className="text-sm text-gray-700">
        Photos are saved untouched to the dev data folder (development only, never committed). Use JPEG photos. Card IDs are <strong>production</strong> IDs (frozen production catalog snapshot).
      </p>

      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex gap-2">
          <Button size="sm" variant={kind === "single" ? "default" : "outline"} onClick={() => setKind("single")}>Single card</Button>
          <Button size="sm" variant={kind === "binder" ? "default" : "outline"} onClick={() => setKind("binder")}>9-pocket binder page</Button>
        </div>
        <input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
          onChange={e => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
        {kind === "single" ? (
          <>
            <CardSearch target="the card ID" onPick={id => setCardId(String(id))} />
            <label className="block text-sm">Correct card ID
              <Input inputMode="numeric" value={cardId} onChange={e => setCardId(e.target.value.trim())} className="mt-1 max-w-xs" />
            </label>
            <CardLabel id={cardId} />
            <fieldset className="text-sm">
              <legend className="mb-1">Conditions in this photo</legend>
              <div className="flex flex-wrap gap-3">
                {(list.data?.tags ?? []).map(t => (
                  <label key={t} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={tags.includes(t)} onChange={e => setTags(e.target.checked ? [...tags, t] : tags.filter(x => x !== t))} />{t}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <div className="space-y-1">
            <p className="text-sm">Card ID for each pocket, with the page upright. Leave a pocket blank if it is empty.
              Select a pocket (blue outline), then tap a search result to fill it.</p>
            <div className="grid grid-cols-3 gap-2 max-w-2xl">
              {cells.map((value, i) => (
                <div key={i} className="space-y-1">
                  <Input aria-label={`${CELL_NAMES[i]} pocket card ID`} placeholder={`${CELL_NAMES[i]} (blank = empty)`} inputMode="numeric"
                    value={value} onFocus={() => setActiveCell(i)}
                    className={activeCell === i ? "ring-2 ring-blue-500" : ""}
                    onChange={e => setCells(cells.map((c, j) => j === i ? e.target.value.trim() : c))} />
                  <CardLabel id={value} />
                </div>
              ))}
            </div>
            <CardSearch target={`the ${CELL_NAMES[activeCell]} pocket`} onPick={id => {
              setCells(cells.map((c, j) => j === activeCell ? String(id) : c));
              setActiveCell(Math.min(8, activeCell + 1));
            }} />
          </div>
        )}
        <label className="block text-sm">Note (optional)
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={300} className="mt-1" />
        </label>
        <div className="flex items-center gap-3">
          <Button disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save photo"}</Button>
          {status && <span className="text-sm text-gray-700" role="status">{status}</span>}
        </div>
      </CardContent></Card>

      {marking && <PageCornerMarker item={marking} onDone={() => setMarking(null)} />}

      <div className="space-y-2">
        {list.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {[...items].reverse().map(item => (
          <div key={item.id} className="flex flex-wrap items-center gap-3 border rounded p-2 text-sm">
            <span className="font-medium">{item.kind === "single" ? `Card ${item.cardId}` : "Binder page"}</span>
            {item.kind === "single" && <span className="text-gray-600">{item.tags?.join(", ") || "no tags"}</span>}
            {item.kind === "binder" && (
              <span className="text-gray-600">
                {item.cells?.filter(c => c !== null).length ?? 0}/9 filled · {item.pageCorners ? "corners marked" : <strong className="text-red-600">page corners needed</strong>}
              </span>
            )}
            {item.note && <span className="text-gray-500">“{item.note}”</span>}
            <span className="ml-auto flex gap-2">
              {item.kind === "binder" && <Button size="sm" variant="outline" onClick={() => setMarking(item)}>{item.pageCorners ? "Re-mark corners" : "Mark page corners"}</Button>}
              {confirmRemove === item.id
                ? <Button size="sm" variant="destructive" onClick={() => { setConfirmRemove(null); remove(item); }}>Confirm remove</Button>
                : <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(item.id)}>Remove</Button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
