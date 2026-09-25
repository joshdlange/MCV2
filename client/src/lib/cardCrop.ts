export type CropRect = { x: number; y: number; width: number; height: number };
export type CardOrientation = "portrait" | "landscape";

export function cropForCard(width: number, height: number, scale = 0.9, orientation: CardOrientation = "portrait"): CropRect {
  if (width <= 0 || height <= 0 || scale <= 0 || scale > 1) {
    throw new Error("Invalid crop dimensions");
  }
  const ratio = orientation === "portrait" ? 2 / 3 : 3 / 2;
  const cropWidth = Math.min(width, height * ratio) * scale;
  const cropHeight = cropWidth / ratio;
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

export function moveCrop(crop: CropRect, dx: number, dy: number, width: number, height: number): CropRect {
  return {
    ...crop,
    x: Math.max(0, Math.min(width - crop.width, crop.x + dx)),
    y: Math.max(0, Math.min(height - crop.height, crop.y + dy)),
  };
}

export function resizeCrop(crop: CropRect, width: number, height: number, scale: number, orientation: CardOrientation = "portrait"): CropRect {
  const sized = cropForCard(width, height, scale, orientation);
  return moveCrop(sized, crop.x + crop.width / 2 - sized.width / 2 - sized.x,
    crop.y + crop.height / 2 - sized.height / 2 - sized.y, width, height);
}