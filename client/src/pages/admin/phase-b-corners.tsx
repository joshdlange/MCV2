import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
import { isClockwiseConvex, orderCardCorners } from "@shared/cardCorners";

// DEV-ONLY: manual card-corner marking for the frozen Phase B photos.
// Routed only in development builds (App.tsx); the API is development + admin gated.
type Point = [number, number];
type Item = { scanId: number; corners: Point[] | null };
const QUERY_KEY = ["/api/admin/phase-b-corners"];

export default function PhaseBCorners() {
  const { currentUser } = useAppStore();
  const queryClient = useQueryClient();
  const enabled = import.meta.env.DEV && !!currentUser?.isAdmin;
  const list = useQuery<Item[]>({ queryKey: QUERY_KEY, enabled, staleTime: 0 });
  const items = list.data ?? [];
  const [index, setIndex] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const current = items[index];

  useEffect(() => {
    if (!current) return;
    setPoints(current.corners ?? []);
    setStatus("");
    let active = true;
    let objectUrl: string | undefined;
    setSrc(null);
    apiRequest("GET", `/api/admin/phase-b-corners/image/${current.scanId}`).then(res => res.blob()).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(() => active && setStatus("Image unavailable"));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current?.scanId]);

  if (!enabled) return <div className="p-6"><Card><CardContent className="py-12 text-center text-gray-700"><ShieldAlert className="h-10 w-10 mx-auto text-red-500 mb-3" />{!import.meta.env.DEV ? "Only available in development" : "Admin access required"}</CardContent></Card></div>;
  if (list.isLoading) return <div className="p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!items.length) return <div className="p-6 text-gray-700">No Phase B cases yet. The photo export has not run.</div>;

  const done = items.filter(item => item.corners).length;
  const click = (event: React.MouseEvent<HTMLImageElement>) => {
    if (points.length >= 4) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    const next: Point[] = [...points, [x, y]];
    setPoints(next.length === 4 ? orderCardCorners(next) : next);
  };
  const save = async () => {
    setStatus("Saving…");
    try {
      await apiRequest("PUT", `/api/admin/phase-b-corners/${current.scanId}`, { corners: points });
      queryClient.setQueryData<Item[]>(QUERY_KEY, items.map(item => item.scanId === current.scanId ? { ...item, corners: points } : item));
      setStatus(`Saved scan ${current.scanId}.`);
      const next = items.findIndex((item, i) => i > index && !item.corners);
      if (next >= 0) setIndex(next);
    } catch { setStatus("Save failed. Try again."); }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold mr-auto">Phase B corners: scan {current.scanId} ({index + 1}/{items.length}, {done} marked)</h1>
        <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" disabled={index === items.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <p className="text-sm text-gray-700">
        Click the card's <strong>printed top-left</strong> corner first (where the top-left is when the artwork is upright),
        then the other 3 corners in any order.
        {points.length === 0 ? " Next: printed top-left." : points.length < 4 ? ` ${4 - points.length} corner${points.length === 3 ? "" : "s"} left.` : " All 4 marked."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={points.length !== 4 || !isClockwiseConvex(points)} onClick={save}>Save and next</Button>
        <Button size="sm" variant="outline" disabled={!points.length} onClick={() => setPoints(points.slice(0, -1))}>Undo</Button>
        <Button size="sm" variant="outline" disabled={!points.length} onClick={() => setPoints([])}>Clear</Button>
        {points.length === 4 && !isClockwiseConvex(points) && <span className="text-sm text-red-600 self-center" role="alert">Corners don't form a card shape. Clear and try again.</span>}
        {status && <span className="text-sm text-gray-600 self-center" role="status">{status}</span>}
      </div>
      {!src ? <Loader2 className="h-6 w-6 animate-spin" /> : (
        <div className="relative inline-block max-w-full">
          <img src={src} alt={`Scan ${current.scanId}`} onClick={click}
            className="block max-w-full max-h-[75vh] cursor-crosshair select-none" draggable={false} />
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
            {points.length > 1 && <polygon points={points.map(p => p.join(",")).join(" ")}
              fill="rgba(37,99,235,0.15)" stroke="#2563eb" strokeWidth="0.004" />}
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
