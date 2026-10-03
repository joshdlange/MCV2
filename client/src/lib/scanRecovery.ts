// DEV visual-v1 only. Never persist photos or send them to a conversion service.
export const MAX_SCAN_INPUT_BYTES = 40 * 1024 * 1024;
export const MAX_SCAN_IMAGE_SIDE = 1600;
export const SCAN_TIMEOUT_MS = 60_000;
export const SCAN_CAMERA_MARKER = "mcv-dev-scan-camera-pending";
export type ScanClientEventCode = "camera_open" | "photo_selected" | "decode_failed" | "crop_ready" | "request_failed" | "camera_interrupted";

export function scanClientEvent(code: ScanClientEventCode, file?: Pick<File, "size" | "name" | "type">) {
  if (!file) return { code };
  const kind: "jpeg" | "png" | "webp" | "heic" | "other" =
    /image\/jpeg/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? "jpeg" :
    /image\/png/i.test(file.type) || /\.png$/i.test(file.name) ? "png" :
    /image\/webp/i.test(file.type) || /\.webp$/i.test(file.name) ? "webp" :
    /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name) ? "heic" : "other";
  return { code, bytes: Math.max(0, Math.min(1e9, Math.floor(file.size))), kind };
}

// Scalar, tab-scoped interruption hint only. No photo, URL, token or user data.
export function setScanCameraPending(storage: Pick<Storage, "setItem"> | undefined): void {
  try { storage?.setItem(SCAN_CAMERA_MARKER, "1"); } catch { /* Private browsing may disallow storage. */ }
}

export function clearScanCameraPending(storage: Pick<Storage, "removeItem"> | undefined): void {
  try { storage?.removeItem(SCAN_CAMERA_MARKER); } catch { /* Optional recovery hint. */ }
}

export function scanCameraInterrupted(visualV1: boolean, storage: Pick<Storage, "getItem"> | undefined): boolean {
  if (!visualV1) return false;
  try { return storage?.getItem(SCAN_CAMERA_MARKER) === "1"; } catch { return false; }
}

export function scanSessionStorage(): Storage | undefined {
  try { return typeof window !== "undefined" ? window.sessionStorage : undefined; } catch { return undefined; }
}

export function scanFileError(file: Pick<File, "size" | "type" | "name">): string | null {
  if (file.size > MAX_SCAN_INPUT_BYTES) return "This photo is larger than 40 MB. Choose a smaller photo.";
  if (!file.size) return "This photo is empty. Choose another photo.";
  if (!file.type.startsWith("image/") &&
    !(file.type === "" && /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i.test(file.name))) {
    return "Choose an image file, such as JPEG, PNG, or WebP.";
  }
  return null;
}

export function boundedScanDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("This image has no usable pixels. Choose another photo.");
  }
  const scale = Math.min(1, MAX_SCAN_IMAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function scanFailureMessage(error: unknown): string {
  if (error instanceof TypeError) return "Could not connect to the scanner. Check your connection and try again.";
  return error instanceof Error ? error.message : "The scan could not finish. Please try again.";
}

function validMatch(value: any): boolean {
  return value && Number.isFinite(value.cardId) && typeof value.name === "string" &&
    typeof value.setName === "string" && typeof value.cardNumber === "string" &&
    Number.isFinite(value.confidence) && Array.isArray(value.matchReasons) &&
    value.matchReasons.every((reason: unknown) => typeof reason === "string");
}

export async function readVisualScanResponse(response: Response): Promise<unknown> {
  let data: any;
  try { data = await response.json(); } catch { /* HTML proxy errors are not user-facing copy. */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Your sign-in could not be verified. Sign in again, then try this photo again.");
    }
    if (response.status === 408 || response.status === 504) throw new Error("The scanner timed out. Try this photo again.");
    if (response.status === 413) throw new Error("The scanner could not accept this photo's size. Try a smaller photo.");
    const message = typeof data?.message === "string" ? data.message : `The scanner returned an error (${response.status}). Please try again.`;
    throw new Error(message);
  }
  if (!data || !Array.isArray(data.matches) || !data.matches.every(validMatch) ||
      !["high", "medium", "low", "none"].includes(data.confidenceLevel) ||
      !data.parsed || typeof data.parsed !== "object" ||
      (data.mode === "visual-v1" && (!Array.isArray(data.families) ||
        !data.families.every((family: any) => family && typeof family.familyKey === "string" &&
          Number.isFinite(family.score) && Array.isArray(family.options) && family.options.every(validMatch))))) {
    throw new Error("The scanner returned an unreadable response. Your photo is still here; try again or search instead.");
  }
  return data;
}

export async function requestVisualScan({
  front, back, getToken, controller, isCurrent, onFetchStarted,
  fetcher = fetch, timeoutMs = SCAN_TIMEOUT_MS,
}: {
  front: File; back?: File;
  getToken: () => Promise<string | undefined>;
  controller: AbortController;
  isCurrent: () => boolean;
  onFetchStarted: () => void;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("The scan took longer than 60 seconds. Your photo is still here; try again or search instead."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let token: string | undefined;
      try { token = await getToken(); } catch {
        throw new Error("Your sign-in could not be verified. Sign in again, then try this photo again.");
      }
      if (!isCurrent() || controller.signal.aborted) throw new Error("Scan cancelled");
      if (!token) throw new Error("Your sign-in could not be verified. Sign in again, then try this photo again.");
      const body = new FormData();
      body.append("image", front);
      if (back) body.append("backImage", back);
      onFetchStarted();
      const response = await fetcher("/api/cards/scan", {
        method: "POST", credentials: "include", headers: { Authorization: `Bearer ${token}` },
        body, signal: controller.signal,
      });
      return await readVisualScanResponse(response);
    })()]);
  } catch (error) {
    throw new Error(scanFailureMessage(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}