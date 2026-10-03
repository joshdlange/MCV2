import { useEffect, useRef, useState } from "react";
import { Camera, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { boundedScanDimensions, scanFileError } from "@/lib/scanRecovery";
import { prepareScanImage, scanCanvasBlob } from "@/lib/scanImage";
import type { RapidCaptureInput } from "@/lib/rapidScan";

/** Full-frame producer. The outline is guidance only, never capture coordinates. */
export function RapidCamera({ onCapture, disabled }: { onCapture: (input: RapidCaptureInput) => boolean; disabled: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const epoch = useRef(0);
  const alive = useRef(true);
  const captureLock = useRef(false);
  const producer = useRef(onCapture);
  producer.current = onCapture;
  const [state, setState] = useState<"opening" | "live" | "stopped" | "fallback">("opening");
  const [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  function stop() {
    epoch.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  async function start() {
    stop();
    const current = epoch.current;
    setState("opening");
    setMessage("");
    let opened: MediaStream | undefined;
    let startingPlayback = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Live camera is unavailable on this device. Use the photo picker instead.");
      opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
      if (!alive.current || current !== epoch.current || document.hidden) { opened.getTracks().forEach(track => track.stop()); return; }
      stream.current = opened;
      const player = video.current;
      if (!player) throw new Error("Camera preview could not open.");
      player.srcObject = opened;
      player.muted = true;
      player.setAttribute("playsinline", "");
      startingPlayback = true;
      await player.play();
      if (!alive.current || current !== epoch.current) return;
      setState("live");
      opened.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (!alive.current || current !== epoch.current) return;
        stop(); setState("fallback"); setMessage("The camera disconnected. Your batch is still here. Choose a photo or retry the camera.");
      }, { once: true }));
    } catch (failure) {
      opened?.getTracks().forEach(track => track.stop());
      if (!alive.current || current !== epoch.current) return;
      stop();
      setState("fallback");
      const denied = failure instanceof DOMException && ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(failure.name);
      setMessage(startingPlayback ? "The browser could not play the camera preview. Tap Retry camera to try from this gesture, or use the photo picker. Your batch stays here."
        : denied ? "Camera permission was denied. Allow camera access in your browser settings, or use the photo picker. Your batch stays here."
        : failure instanceof Error ? `${failure.message} Your batch stays here; use the photo picker or retry.` : "Camera unavailable. Use the photo picker.");
    }
  }
  useEffect(() => {
    alive.current = true;
    void start();
    const suspend = () => {
      stop();
      if (alive.current) { setState("stopped"); setMessage("Camera paused. Tap Resume camera to continue. Your batch is still here."); }
    };
    const hidden = () => { if (document.hidden) suspend(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", suspend);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", suspend);
    };
  }, []);
  async function capture() {
    if (disabled || captureLock.current || state !== "live") return;
    const player = video.current;
    if (!player?.videoWidth || !player.videoHeight || player.readyState < 2) { setMessage("The camera is still preparing a frame. Try again in a moment."); return; }
    captureLock.current = true;
    const current = epoch.current;
    try {
      const canvas = document.createElement("canvas");
      const size = boundedScanDimensions(player.videoWidth, player.videoHeight);
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not capture a frame. Use the picker.");
      context.drawImage(player, 0, 0, canvas.width, canvas.height);
      const blob = await scanCanvasBlob(canvas);
      canvas.width = 0; canvas.height = 0;
      if (!alive.current || current !== epoch.current) return;
      producer.current({ file: new File([blob], "rapid-frame.jpg", { type: "image/jpeg" }), source: "camera" });
      setMessage("");
    } catch (failure) { if (alive.current) setMessage(failure instanceof Error ? failure.message : "Capture failed. Try again."); }
    finally { captureLock.current = false; }
  }
  async function picked(file?: File) {
    if (!file || disabled || captureLock.current) return;
    captureLock.current = true;
    setPreparing(true);
    const current = epoch.current;
    try {
      const invalid = scanFileError(file);
      if (invalid) throw new Error(invalid);
      const canvas = await prepareScanImage(file, 0);
      const blob = await scanCanvasBlob(canvas);
      canvas.width = 0; canvas.height = 0;
      if (!alive.current || current !== epoch.current) return;
      producer.current({ file: new File([blob], "rapid-picker.jpg", { type: "image/jpeg" }), source: "picker" });
    } catch (failure) { if (alive.current) setMessage(failure instanceof Error ? failure.message : "Could not prepare this photo."); }
    finally { captureLock.current = false; if (alive.current) setPreparing(false); }
  }
  return <section aria-label="Live camera capture" data-testid="rapid-camera" data-camera-state={state}>
    <div className="rapid-camera">
      <video ref={video} muted playsInline autoPlay aria-label="Rear camera preview" data-testid="rapid-video" />
      {state === "live" ? <><div className="rapid-outline" /><span className="rapid-camera-note">Full frame captured · outline is a guide</span></>
        : <div className="rapid-camera-message absolute">{state === "opening" ? <><div className="h-2 w-28 mx-auto mb-3 rounded bg-stone-600 animate-pulse" />Opening rear camera…</> : message}</div>}
    </div>
    {message && state === "live" && <p role="alert" className="rapid-alert">{message}</p>}
    <div className="rapid-capture-controls">
      {state === "live" ? <Button data-testid="rapid-capture" className="scan-primary h-12" disabled={disabled || preparing} onClick={() => void capture()}><Camera className="mr-2 h-5 w-5" />Capture card</Button>
        : <Button data-testid="rapid-camera-retry" className="scan-primary h-12" disabled={state === "opening" || preparing} onClick={() => void start()}><RefreshCw className="mr-2 h-4 w-4" />{state === "stopped" ? "Resume camera" : "Retry camera"}</Button>}
      <Button data-testid="rapid-picker" variant="outline" className="h-12" disabled={disabled || preparing} onClick={() => picker.current?.click()}><Upload className="mr-2 h-4 w-4" />{preparing ? "Preparing…" : "Pick photo"}</Button>
    </div>
    <input ref={picker} data-testid="rapid-file-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; void picked(file);
    }} />
  </section>;
}