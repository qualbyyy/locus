import type { Matrix2D } from '../../core/math';
import type { BBox, Scene } from '../../core/types';

/** Доступен ли реальный 2D-canvas. */
export function isCanvas2dSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return typeof c.getContext('2d')?.fillRect === 'function';
  } catch {
    return false;
  }
}

const MAX_RASTER_SIDE = 8192;
const MAX_RASTER_AREA = 32_000_000;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const safeW = Number.isFinite(width) && width > 0 ? width : 1;
  const safeH = Number.isFinite(height) && height > 0 ? height : 1;
  let targetW = Math.max(1, Math.round(safeW));
  let targetH = Math.max(1, Math.round(safeH));
  if (targetW > MAX_RASTER_SIDE || targetH > MAX_RASTER_SIDE) {
    const k = Math.min(MAX_RASTER_SIDE / targetW, MAX_RASTER_SIDE / targetH);
    targetW = Math.max(1, Math.floor(targetW * k));
    targetH = Math.max(1, Math.floor(targetH * k));
  }
  if (targetW * targetH > MAX_RASTER_AREA) {
    const k = Math.sqrt(MAX_RASTER_AREA / (targetW * targetH));
    targetW = Math.max(1, Math.floor(targetW * k));
    targetH = Math.max(1, Math.floor(targetH * k));
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  return canvas;
}

export function zeroCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export function applyMatrix(ctx: CanvasRenderingContext2D, m: Matrix2D): void {
  ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

/** Целочисленный bbox, вписанный в артборд (клип по границам документа). */
export function clampBBoxToArtboard(
  box: BBox,
  scene: Scene
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(scene.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(scene.height, Math.ceil(box.y + box.height));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpg',
  quality = 0.92
): Promise<Uint8Array> {
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const clampedQ = Math.min(1, Math.max(0.05, quality));
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать изображение'))),
      mime,
      format === 'jpg' ? clampedQ : undefined
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}
