import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { requestVisualScan, scanFileError } from "@/lib/scanRecovery";
import { uploadScanFrontPhoto } from "@/lib/scanConfirmation";
import { classifyRapidRecognition, rapidCanUndo, rapidDuplicateIds, RAPID_QUEUE_LIMIT, RAPID_SESSION_LIMIT, type RapidCaptureInput, type RapidItem, type RapidRecognition, type RapidSave } from "@/lib/rapidScan";

export function useRapidScan(getToken: () => Promise<string | undefined>) {
  const [items, setItems] = useState<RapidItem[]>([]);
  const [busy, setBusy] = useState<"add" | "undo" | null>(null);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const rows = useRef<RapidItem[]>([]);
  const alive = useRef(true);
  const pausedRef = useRef(false);
  const recognizing = useRef<{ id: string; controller: AbortController } | null>(null);
  const requests = useRef(new Set<AbortController>());
  const lock = useRef(false);
  const totalAccepted = useRef(0);
  const token = useRef(getToken);
  token.current = getToken;
  const qc = useQueryClient();
  const publish = () => { if (alive.current) setItems([...rows.current]); };
  const patch = (id: string, updates: Partial<RapidItem>) => {
    if (!alive.current) return;
    rows.current = rows.current.map(row => row.id === id ? { ...row, ...updates } : row);
    publish();
  };
  const refresh = () => {
    for (const key of ["/api/collection", "/api/stats", "/api/user/stats", "/api/collection/check", "/api/cards/scan/usage"])
      void qc.invalidateQueries({ queryKey: [key] });
  };

  useEffect(() => {
    alive.current = true;
    const visibility = () => {
      pausedRef.current = document.hidden;
      setPaused(document.hidden);
      if (document.hidden) {
        recognizing.current?.controller.abort();
        requests.current.forEach(controller => controller.abort());
      }
    };
    const hide = () => {
      pausedRef.current = true;
      setPaused(true);
      recognizing.current?.controller.abort();
      requests.current.forEach(controller => controller.abort());
    };
    const show = () => { if (!document.hidden) { pausedRef.current = false; setPaused(false); } };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      alive.current = false;
      recognizing.current?.controller.abort();
      requests.current.forEach(controller => controller.abort());
      requests.current.clear();
      for (const row of rows.current) URL.revokeObjectURL(row.previewUrl);
      rows.current = [];
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);

  // One recognition request at a time; capture stays independent and interactive.
  useEffect(() => {
    if (paused || pausedRef.current || recognizing.current || !alive.current) return;
    const row = rows.current.find(item => item.status === "queued");
    if (!row) return;
    const controller = new AbortController();
    recognizing.current = { id: row.id, controller };
    patch(row.id, { status: "recognizing", error: undefined });
    void (async () => {
      try {
        const result = await requestVisualScan({
          front: row.input.file, controller, getToken: () => token.current(),
          isCurrent: () => alive.current && !controller.signal.aborted && rows.current.some(item => item.id === row.id),
          onFetchStarted: () => {},
        }) as RapidRecognition;
        if (!controller.signal.aborted && alive.current) patch(row.id, classifyRapidRecognition(result));
      } catch (failure) {
        if (alive.current && !rows.current.find(item => item.id === row.id)?.manual) patch(row.id, controller.signal.aborted
          ? { status: "error", error: "Recognition was interrupted. It may have counted as a scan. Retry explicitly or search; it will not be sent again automatically." }
          : { status: "error", error: failure instanceof Error ? failure.message : "Recognition failed. Retry or search." });
      } finally {
        recognizing.current = null;
        refresh();
        publish();
      }
    })();
    // Deliberately no cleanup per render: only removal, background or exit aborts.
  }, [items, paused]);

  function enqueue(input: RapidCaptureInput): boolean {
    if (!alive.current || lock.current) return false;
    const error = scanFileError(input.file);
    if (error) { setNotice(error); return false; }
    if (input.file.size > 5 * 1024 * 1024) { setNotice("This producer photo exceeds the 5MB transient limit. Resize the full frame before queuing it."); return false; }
    if (input.producerItemKey && rows.current.some(item => item.input.producerItemKey === input.producerItemKey)) {
      setNotice("This producer item is already in the batch."); return false;
    }
    if (totalAccepted.current >= RAPID_SESSION_LIMIT) { setNotice("18 captures per session. Review this batch, then start a new session."); return false; }
    if (rows.current.filter(item => item.status === "queued" || item.status === "recognizing").length >= RAPID_QUEUE_LIMIT) {
      setNotice("9 photos are waiting. Let recognition catch up before capturing more."); return false;
    }
    totalAccepted.current++;
    rows.current = [...rows.current, { id: crypto.randomUUID(), input, previewUrl: URL.createObjectURL(input.file), status: "queued", families: [] }];
    setNotice("");
    publish();
    return true;
  }
  function remove(id: string) {
    if (lock.current) return;
    const row = rows.current.find(item => item.id === id);
    if (!row || row.save) return;
    if (recognizing.current?.id === id) recognizing.current.controller.abort();
    URL.revokeObjectURL(row.previewUrl);
    rows.current = rows.current.filter(item => item.id !== id);
    publish();
  }
  function retry(id: string) {
    if (lock.current) return;
    const waiting = rows.current.filter(item => item.status === "queued" || item.status === "recognizing").length;
    if (waiting >= RAPID_QUEUE_LIMIT) { setNotice("The recognition queue is full. Try again after it catches up."); return; }
    patch(id, { status: "queued", error: undefined });
  }
  function select(id: string, card: RapidItem["selected"], missingImage: boolean, manualSearch: boolean) {
    if (lock.current || !card) return;
    const row = rows.current.find(item => item.id === id);
    if (!row || row.save) return;
    // Cancel this item's pending recognition so it cannot overwrite a manual choice.
    if (recognizing.current?.id === id) recognizing.current.controller.abort();
    patch(id, { selected: card, manual: true, manualSearch, missingImage, status: "check", error: undefined, saveError: undefined });
  }
  async function mutation<T>(method: string, path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await apiRequest(method, path, body, controller.signal);
      return await response.json() as T;
    } finally { requests.current.delete(controller); }
  }
  async function addAll() {
    if (lock.current) return;
    lock.current = true;
    setBusy("add");
    const duplicates = rapidDuplicateIds(rows.current);
    const batch = rows.current.filter(item => item.selected && !item.save && !duplicates.has(item.id));
    try {
      for (const item of batch) {
        if (!alive.current || pausedRef.current) break;
        patch(item.id, { saveError: undefined });
        try {
          const save = await mutation<RapidSave>("POST", "/api/cards/scan/collection", { cardId: item.selected!.cardId });
          if (typeof save.created !== "boolean" || !Number.isInteger(save.ownedRow?.id) || save.ownedRow.cardId !== item.selected!.cardId)
            throw new Error("The save response could not be verified. Retry safely; existing ownership will not increase.");
          patch(item.id, { save, saveError: undefined });
        } catch (failure) {
          patch(item.id, { saveError: failure instanceof Error ? failure.message : "Add failed. Retry safely." });
        }
      }
    } finally {
      lock.current = false;
      refresh();
      if (alive.current) setBusy(null);
    }
  }
  async function undoAll() {
    if (lock.current) return;
    lock.current = true;
    setBusy("undo");
    try {
      for (const item of rows.current.filter(rapidCanUndo)) {
        if (!alive.current || pausedRef.current) break;
        try {
          await mutation("DELETE", `/api/cards/scan/collection/${item.save!.ownedRow.id}`, { undoToken: item.save!.undoToken });
          patch(item.id, { undone: true, undoError: undefined });
        } catch (failure) { patch(item.id, { undoError: failure instanceof Error ? failure.message : "Undo failed. Retry." }); }
      }
    } finally {
      lock.current = false;
      refresh();
      if (alive.current) setBusy(null);
    }
  }
  async function submitPhoto(id: string) {
    const item = rows.current.find(row => row.id === id);
    if (!item?.save || item.undone || !item.manualSearch || !item.missingImage || !item.selected || item.photoStatus === "pending" || ["approved", "submitted"].includes(item.photoStatus ?? "")) return;
    const controller = new AbortController();
    requests.current.add(controller);
    patch(id, { photoStatus: "pending", photoError: undefined });
    try {
      const result = await uploadScanFrontPhoto(item.selected.cardId, item.input.file, () => token.current(), () => alive.current && !controller.signal.aborted && rows.current.some(row => row.id === id), undefined, controller.signal);
      patch(id, { photoStatus: result.autoApproved ? "approved" : "submitted" });
    } catch (failure) { patch(id, { photoStatus: "failed", photoError: failure instanceof Error ? failure.message : "Photo submission failed." }); }
    finally { requests.current.delete(controller); }
  }
  return { items, busy, paused, notice, enqueue, remove, retry, select, addAll, undoAll, submitPhoto,
    accepted: totalAccepted.current, queueCount: items.filter(item => item.status === "queued" || item.status === "recognizing").length };
}