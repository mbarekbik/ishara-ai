import type { ImageLandmark } from "./model";

export interface ImageGeometry {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** object-fit: contain with centered positioning, measured inside the border. */
export function containGeometry(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ImageGeometry | null {
  if (![sourceWidth, sourceHeight, viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { viewportWidth, viewportHeight, width, height, offsetX: (viewportWidth - width) / 2, offsetY: (viewportHeight - height) / 2 };
}

/** Mirroring is presentation-only; do not also CSS-mirror the canvas. */
export function mapImageLandmark(point: Pick<ImageLandmark, "x" | "y">, geometry: ImageGeometry, mirrored = true): { x: number; y: number } {
  const x = geometry.offsetX + point.x * geometry.width;
  return { x: mirrored ? geometry.viewportWidth - x : x, y: geometry.offsetY + point.y * geometry.height };
}

export function canvasBackingSize(width: number, height: number, devicePixelRatio: number): { width: number; height: number; ratio: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { width: Math.max(0, Math.round(width * ratio)), height: Math.max(0, Math.round(height * ratio)), ratio };
}
