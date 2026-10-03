import { boundedScanDimensions, scanFileError } from "./scanRecovery";

export type HeicScanConverter = (options: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>;

export async function convertHeicScanFile(file: File, converter?: HeicScanConverter): Promise<Blob> {
  if (!/\.(heic|heif)$/i.test(file.name) && !/image\/hei[cf]/i.test(file.type)) return file;
  try {
    // Loaded only by the visual-v1 path; conversion stays on this device.
    const convert = converter ?? (await import("heic2any")).default;
    const result = await convert({ blob: file, toType: "image/jpeg", quality: 0.88 });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob || !blob.size) throw new Error("Empty conversion");
    return blob;
  } catch {
    throw new Error("Could not open this HEIC photo on this device. Try again, choose a JPEG photo, or search instead.");
  }
}

// Read only a small header, not a base64 copy of a phone's entire camera file.
export async function scanImageDimensions(file: Blob): Promise<{ width: number; height: number } | null> {
  const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let orientation = 1;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > bytes.length) break;
      // Camera JPEG EXIF orientation is applied by the decoder before resizing.
      if (marker === 0xe1 && size >= 16 && view.getUint32(offset + 4) === 0x45786966) {
        const tiff = offset + 10;
        const end = offset + 2 + size;
        const little = view.getUint16(tiff) === 0x4949;
        if (tiff + 8 <= end && view.getUint16(tiff + 2, little) === 42) {
          const directory = tiff + view.getUint32(tiff + 4, little);
          if (directory >= tiff && directory + 2 <= end) {
            const count = view.getUint16(directory, little);
            for (let index = 0; index < count; index++) {
              const entry = directory + 2 + index * 12;
              if (entry + 12 > end) break;
              if (view.getUint16(entry, little) === 0x112 &&
                  view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
                orientation = view.getUint16(entry + 8, little);
                break;
              }
            }
          }
        }
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
        const width = view.getUint16(offset + 7), height = view.getUint16(offset + 5);
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
      }
      offset += size + 2;
    }
  }
  // WebP extended header (the common camera/editor export).
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250 && view.getUint32(12) === 0x56503858) {
    const uint24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    return { width: uint24(24) + 1, height: uint24(27) + 1 };
  }
  return null;
}

export function scanCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare this photo. Please try again.")), "image/jpeg", 0.88);
  });
}

export async function prepareScanImage(file: File, rotation: number): Promise<HTMLCanvasElement> {
  const error = scanFileError(file);
  if (error) throw new Error(error);
  const decodedFile = await convertHeicScanFile(file);
  let source: ImageBitmap | HTMLImageElement | null = null;
  let sourceUrl: string | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      const dimensions = await scanImageDimensions(decodedFile);
      // Decode directly to a bounded surface when the header provides dimensions.
      // Only a width is supplied for unknown formats so the aspect ratio stays intact.
      const resize = dimensions ? boundedScanDimensions(dimensions.width, dimensions.height) : null;
      try {
        source = await createImageBitmap(decodedFile, {
          ...(resize ? { resizeWidth: resize.width, resizeHeight: resize.height } : { resizeWidth: 1600 }),
          resizeQuality: "high", imageOrientation: "from-image",
        });
      } catch { /* Native image decode is the fallback on browsers without bitmap support. */ }
    }
    if (!source) {
      sourceUrl = URL.createObjectURL(decodedFile);
      const image = new Image();
      source = image;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(
          /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)
            ? "This browser cannot open HEIC photos yet. Choose a JPEG, PNG, or WebP photo, or search instead."
            : "Could not open this image. Try again, choose a JPEG, PNG, or WebP photo, or search instead.",
        ));
        image.src = sourceUrl!;
      });
      source = image;
    }
    const originalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const originalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const { width, height } = boundedScanDimensions(originalWidth, originalHeight);
    canvas = document.createElement("canvas");
    const sideways = rotation % 180 !== 0;
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser could not prepare the image. Please try again.");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
    return canvas;
  } catch (error) {
    if (canvas) canvas.width = canvas.height = 0;
    throw error;
  } finally {
    if (source && "close" in source) source.close();
    if (source instanceof HTMLImageElement) source.src = "";
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}