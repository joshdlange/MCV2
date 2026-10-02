import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCw } from "lucide-react";
import { cardCropRatio, cropForCard, moveCrop, resizeCrop, type CardOrientation, type CardCropFormat, type CropRect } from "@/lib/cardCrop";

type OrientedImage = { canvas: HTMLCanvasElement; url: string };

export function CardCrop({
  file,
  onConfirm,
  onCancel,
  side = "front",
  format = "legacy",
}: {
  file: File;
  onConfirm: (cropped: File, preview: string) => void;
  onCancel: () => void;
  side?: "front" | "back";
  format?: CardCropFormat;
}) {
  const [image, setImage] = useState<OrientedImage | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [rotation, setRotation] = useState(0);
  const [orientation, setOrientation] = useState<CardOrientation>("portrait");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const displayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; crop: CropRect } | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setImage(null);
    setCrop(null);
    const sourceUrl = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => {
      if (!active) return;
      if (!source.naturalWidth || !source.naturalHeight) {
        setError("This image has no usable pixels. Please choose another photo.");
        return;
      }
      // Orient the pixels before positioning the crop. The same canvas is used to
      // render the final upload, so the preview rectangle cannot include the background.
      const sideways = rotation % 180 !== 0;
      const maxSide = Math.max(source.naturalWidth, source.naturalHeight);
      const factor = Math.min(1, 2400 / maxSide);
      const w = Math.round(source.naturalWidth * factor);
      const h = Math.round(source.naturalHeight * factor);
      const canvas = document.createElement("canvas");
      canvas.width = sideways ? h : w;
      canvas.height = sideways ? w : h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Your browser could not prepare the image. Please try another photo.");
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      setImage({ canvas, url: canvas.toDataURL("image/jpeg", 0.88) });
      setCrop(cropForCard(canvas.width, canvas.height, 0.9, orientation, format));
      setError("");
    };
    source.onerror = () => {
      if (active) setError("Could not open this image. Please choose a JPEG, PNG, or WebP photo.");
    };
    source.src = sourceUrl;
    return () => {
      active = false;
      URL.revokeObjectURL(sourceUrl);
    };
  }, [file, rotation, format]);

  function changeOrientation(next: CardOrientation) {
    setOrientation(next);
    if (image) setCrop(cropForCard(image.canvas.width, image.canvas.height, 0.9, next, format));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || !image || !displayRef.current) return;
    const bounds = displayRef.current.getBoundingClientRect();
    setCrop(moveCrop(dragRef.current.crop,
      (event.clientX - dragRef.current.x) * image.canvas.width / bounds.width,
      (event.clientY - dragRef.current.y) * image.canvas.height / bounds.height,
      image.canvas.width, image.canvas.height));
  }

  function confirm() {
    if (!image || !crop || processing) return;
    setProcessing(true);
    const output = document.createElement("canvas");
    // Avoid upscaling a small image; output uses the same ratio as the frame.
    output.width = Math.max(2, Math.round(crop.width));
    output.height = Math.max(2, Math.round(output.width / cardCropRatio(orientation, format)));
    const ctx = output.getContext("2d");
    if (!ctx) {
      setError("Could not crop this image. Please try again.");
      setProcessing(false);
      return;
    }
    ctx.drawImage(image.canvas, crop.x, crop.y, crop.width, crop.height,
      0, 0, output.width, output.height);
    output.toBlob((blob) => {
      if (!activeRef.current) return;
      setProcessing(false);
      if (!blob) {
        setError("Could not save the cropped image. Please try again.");
        return;
      }
      onConfirm(new File([blob], "card-scan.jpg", { type: "image/jpeg" }), URL.createObjectURL(blob));
    }, "image/jpeg", 0.88);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Crop your card {side}</h2>
        <p className="text-sm text-gray-500">Drag the frame over the {side} of one card. Keep visible background outside the frame. Rotate if needed.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!image && !error && <Loader2 className="animate-spin text-red-500 mx-auto" />}
      {image && crop && (
        <>
          <div
            ref={displayRef}
            className="relative mx-auto max-w-full select-none touch-none overflow-hidden"
            style={{ width: "fit-content" }}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <img src={image.url} alt="Photo to crop" className="block max-w-full max-h-[55vh] w-auto h-auto" draggable={false} />
            <div
              aria-label="Drag to position card crop"
              role="slider"
              tabIndex={0}
              aria-valuetext={`Crop at ${Math.round(crop.x / image.canvas.width * 100)}% from left, ${Math.round(crop.y / image.canvas.height * 100)}% from top`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(crop.x / Math.max(1, image.canvas.width - crop.width) * 100)}
              onKeyDown={(event) => {
                const steps: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
                };
                const direction = steps[event.key];
                if (!direction) return;
                event.preventDefault();
                const step = event.shiftKey ? 0.05 : 0.01;
                setCrop(moveCrop(crop, direction[0] * image.canvas.width * step,
                  direction[1] * image.canvas.height * step, image.canvas.width, image.canvas.height));
              }}
              className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move"
              style={{
                left: `${crop.x / image.canvas.width * 100}%`,
                top: `${crop.y / image.canvas.height * 100}%`,
                width: `${crop.width / image.canvas.width * 100}%`,
                height: `${crop.height / image.canvas.height * 100}%`,
              }}
              onPointerDown={(e) => {
                e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, crop };
              }}
            >
              <div className="absolute inset-0 border border-dashed border-white/60 pointer-events-none" />
            </div>
          </div>
          <label className="block text-sm text-gray-600 dark:text-gray-300">
            Frame size
            <input
              type="range" min="30" max="100" step="1"
              value={Math.round(crop.width / Math.min(image.canvas.width, image.canvas.height * cardCropRatio(orientation, format)) * 100)}
              onChange={(e) => setCrop(resizeCrop(crop, image.canvas.width, image.canvas.height, Number(e.target.value) / 100, orientation, format))}
              className="w-full accent-red-600"
            />
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" type="button" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw className="w-4 h-4 mr-1" /> Rotate
        </Button>
        <Button variant="outline" type="button" onClick={() => changeOrientation(orientation === "portrait" ? "landscape" : "portrait")}>
          {orientation === "portrait"
            ? `Landscape ${format === "visual-v1" ? "7:5" : "3:2"}`
            : `Portrait ${format === "visual-v1" ? "5:7" : "2:3"}`}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="button" className="flex-1 min-w-32 bg-red-600 hover:bg-red-700" onClick={confirm} disabled={!image || processing}>
          {processing ? "Cropping…" : `Use ${side} crop`}
        </Button>
      </div>
    </div>
  );
}