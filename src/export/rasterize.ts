import { getAssetImageElement } from '../core/assets';
import {
  computeCombinedWorldBBox,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  getLayerMatrix,
  type Matrix2D,
} from '../core/math';
import type {
  BBox,
  Layer,
  LayerEffects,
  PathLayer,
  Scene,
  SubPath,
  TextLayer,
} from '../core/types';
import {
  colorWithOpacity,
  getEffectsPadding,
  hasRasterEffects,
  resolveEffectivePathGeometry,
} from '../engine/effects';
import { subPathToCubicSegments } from './pathData';

export interface RasterizeOptions {
  /** Масштаб растра (1 = 1 px артборда → 1 px). */
  scale?: number;
}

export interface RasterExportOptions {
  format: 'png' | 'jpg';
  scale: number;
  quality: number; // 0.1..1
  transparent: boolean;
  backgroundColor: string;
  scope: 'artboard' | 'selection';
  selectedIds?: string[];
}

export interface CompositeRasterOptions {
  scale?: number;
  transparent?: boolean;
  backgroundColor?: string;
  layerIds?: string[];
  padding?: number;
}

/** Доступен ли реальный 2D-canvas (в jsdom — нет). */
export function isCanvas2dSupported(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false;
  }
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return typeof c.getContext('2d')?.fillRect === 'function';
  } catch {
    return false;
  }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function applyMatrix(ctx: CanvasRenderingContext2D, m: Matrix2D): void {
  ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

/** Строит текущий path (без fill/stroke) по всем subpath в локальных координатах. */
function buildPath(ctx: CanvasRenderingContext2D, subpaths: SubPath[]): void {
  ctx.beginPath();
  for (const sub of subpaths) {
    const segs = subPathToCubicSegments(sub, (p) => ({ x: p.x, y: p.y, lx: p.x, ly: p.y }));
    if (segs.length === 0) continue;
    ctx.moveTo(segs[0].start.x, segs[0].start.y);
    for (const s of segs) {
      ctx.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.end.x, s.end.y);
    }
    if (sub.closed) ctx.closePath();
  }
}

function buildFilterString(effects?: LayerEffects): string {
  if (!effects) return 'none';
  const parts: string[] = [];
  if (effects.outerGlow && effects.outerGlow.blur > 0) {
    const glowColor = colorWithOpacity(effects.outerGlow.color, effects.outerGlow.opacity);
    parts.push(`drop-shadow(0px 0px ${effects.outerGlow.blur}px ${glowColor})`);
  }
  if (effects.dropShadow) {
    const shColor = colorWithOpacity(effects.dropShadow.color, effects.dropShadow.opacity);
    parts.push(
      `drop-shadow(${effects.dropShadow.offsetX}px ${effects.dropShadow.offsetY}px ${effects.dropShadow.blur}px ${shColor})`
    );
  }
  if (effects.blur && effects.blur > 0.1) {
    parts.push(`blur(${effects.blur}px)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function applyEffectsToContext(ctx: CanvasRenderingContext2D, effects?: LayerEffects): void {
  if (!effects || !hasRasterEffects(effects)) return;
  const filterStr = buildFilterString(effects);
  if ('filter' in ctx && filterStr !== 'none') {
    ctx.filter = filterStr;
  } else if (effects.dropShadow) {
    ctx.shadowColor = colorWithOpacity(effects.dropShadow.color, effects.dropShadow.opacity);
    ctx.shadowOffsetX = effects.dropShadow.offsetX;
    ctx.shadowOffsetY = effects.dropShadow.offsetY;
    ctx.shadowBlur = effects.dropShadow.blur;
  }
}

export function paintPathLayer(ctx: CanvasRenderingContext2D, layer: PathLayer): void {
  const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
  const hasFill = Boolean(layer.fill);
  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  if (!hasFill && !hasStroke && extrudeFaces.length === 0) return;

  ctx.save();
  applyMatrix(ctx, getLayerMatrix(layer));
  ctx.globalAlpha = layer.opacity;
  applyEffectsToContext(ctx, layer.effects);

  for (const face of extrudeFaces) {
    buildPath(ctx, face.subpaths);
    ctx.fillStyle = face.fill;
    ctx.fill('nonzero');
  }

  buildPath(ctx, subpaths);
  if (hasFill) {
    ctx.fillStyle = layer.fill as string;
    ctx.fill(layer.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  }
  if (hasStroke) {
    ctx.strokeStyle = layer.stroke!.color;
    ctx.lineWidth = layer.stroke!.width;
    ctx.lineCap = layer.stroke!.lineCap ?? 'round';
    ctx.lineJoin = layer.stroke!.lineJoin ?? 'round';
    ctx.stroke();
  }
  ctx.restore();
}

export function paintTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer): void {
  ctx.save();
  applyMatrix(ctx, getLayerMatrix(layer));
  ctx.globalAlpha = layer.opacity;
  applyEffectsToContext(ctx, layer.effects);
  ctx.fillStyle = layer.fill;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
  ctx.textAlign = layer.align;
  const lines = (layer.content || '').split('\n');
  lines.forEach((line, i) => {
    const y = layer.fontSize * 0.85 + i * layer.fontSize * layer.lineHeight;
    if (layer.letterSpacing && Math.abs(layer.letterSpacing) > 1e-4) {
      drawTrackedText(ctx, line, 0, y, layer.letterSpacing, layer.align);
    } else {
      ctx.fillText(line, 0, y);
    }
  });
  ctx.restore();
}

/** Посимвольный вывод с трекингом (`letterSpacing` в px). */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right'
): void {
  const widths = Array.from(text).map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, text.length - 1) * tracking;
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  Array.from(text).forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += widths[i] + tracking;
  });
}

export async function paintImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer & { type: 'image' }
): Promise<void> {
  const img = await resolveImageElement(layer.assetId);
  if (!img) return;
  ctx.save();
  applyMatrix(ctx, getLayerMatrix(layer));
  ctx.globalAlpha = layer.opacity;
  applyEffectsToContext(ctx, layer.effects);
  ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
  ctx.restore();
}

async function resolveImageElement(assetId: string): Promise<HTMLImageElement | null> {
  return getAssetImageElement(assetId) ?? null;
}

export interface RasterizedLayer {
  canvas: HTMLCanvasElement;
  /** Смещение растра относительно артборда (px). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Целочисленный bbox, вписанный в артборд (клип по границам документа). */
export function clampBBoxToArtboard(box: BBox, scene: Scene): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(scene.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(scene.height, Math.ceil(box.y + box.height));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Растеризует один слой (без клип-масок) на offscreen canvas размером с его bbox.
 * Возвращает `null`, если bbox пуст или за пределами артборда.
 */
export async function rasterizeLayer(
  layer: Layer,
  scene: Scene,
  bboxOf: (l: Layer) => BBox,
  scale = 1
): Promise<RasterizedLayer | null> {
  const box = clampBBoxToArtboard(bboxOf(layer), scene);
  if (box.width <= 0 || box.height <= 0) return null;

  const canvas = createCanvas(box.width * scale, box.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.translate(-box.left, -box.top);

  if (layer.type === 'path') paintPathLayer(ctx, layer);
  else if (layer.type === 'text') paintTextLayer(ctx, layer);
  else await paintImageLayer(ctx, layer);

  return { canvas, left: box.left, top: box.top, width: box.width, height: box.height };
}

async function defaultPaintLayer(ctx: CanvasRenderingContext2D, layer: Layer): Promise<void> {
  if (layer.type === 'path') paintPathLayer(ctx, layer);
  else if (layer.type === 'text') paintTextLayer(ctx, layer);
  else await paintImageLayer(ctx, layer);
}

/**
 * Композитный рендер всего документа или выделенных слоёв: фон, порядок слоёв, клип-маски.
 */
export async function rasterizeComposite(
  scene: Scene,
  scaleOrOptions: number | CompositeRasterOptions = 1,
  paintLayer: (ctx: CanvasRenderingContext2D, layer: Layer) => Promise<void> | void = defaultPaintLayer
): Promise<HTMLCanvasElement> {
  const opts: CompositeRasterOptions =
    typeof scaleOrOptions === 'number' ? { scale: scaleOrOptions } : scaleOrOptions;
  const scale = Math.max(0.05, opts.scale ?? 1);
  const selectedSet =
    opts.layerIds && opts.layerIds.length > 0 ? new Set(opts.layerIds) : null;

  let originX = 0;
  let originY = 0;
  let width = scene.width;
  let height = scene.height;

  const targetLayers = selectedSet
    ? scene.layers.filter((l) => selectedSet.has(l.id) && l.visible)
    : scene.layers;

  if (selectedSet && targetLayers.length > 0) {
    const bbox = computeCombinedWorldBBox(targetLayers);
    const maxEffectPad = targetLayers.reduce(
      (max, l) => Math.max(max, getEffectsPadding(l.effects)),
      0
    );
    const pad = (opts.padding ?? 0) + maxEffectPad;
    originX = bbox.x - pad;
    originY = bbox.y - pad;
    width = Math.max(1, bbox.width + pad * 2);
    height = Math.max(1, bbox.height + pad * 2);
  }

  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(scale, scale);
  if (!opts.transparent) {
    ctx.fillStyle = opts.backgroundColor ?? scene.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (originX !== 0 || originY !== 0) {
    ctx.translate(-originX, -originY);
  }

  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const maskIds = new Set<string>();
  for (const l of scene.layers) {
    if (l.type === 'path' && l.isClipMask) maskIds.add(l.id);
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') maskIds.add(l.clipMaskId);
  }

  let activeMask: PathLayer | null = null;
  const closeClip = () => {
    if (activeMask) ctx.restore();
    activeMask = null;
  };

  for (const layer of scene.layers) {
    if (maskIds.has(layer.id) || !layer.visible) continue;
    if (selectedSet && !selectedSet.has(layer.id)) continue;

    const mask = layer.clipMaskId ? byId.get(layer.clipMaskId) : undefined;
    if (mask && mask.type === 'path' && mask !== activeMask) {
      closeClip();
      ctx.save();
      applyMatrix(ctx, getLayerMatrix(mask));
      buildPath(ctx, mask.subpaths);
      ctx.restore();
      ctx.clip(mask.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      activeMask = mask;
    } else if (!mask) {
      closeClip();
    }
    await paintLayer(ctx, layer);
  }
  closeClip();

  return canvas;
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

export async function rasterizeSceneToBytes(
  scene: Scene,
  options: RasterExportOptions
): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}> {
  const isJpg = options.format === 'jpg';
  const transparent = isJpg ? false : options.transparent;
  const canvas = await rasterizeComposite(scene, {
    scale: options.scale,
    transparent,
    backgroundColor: options.backgroundColor || scene.background || '#ffffff',
    layerIds:
      options.scope === 'selection' && options.selectedIds?.length
        ? options.selectedIds
        : undefined,
  });
  const bytes = await canvasToBytes(canvas, options.format, options.quality);
  return {
    bytes,
    width: canvas.width,
    height: canvas.height,
    canvas,
  };
}

/**
 * Синхронный рендер одного слоя в его локальных координатах с эффектами (для Paper.js Raster при blur).
 */
export function rasterizeLayerLocalWithEffects(
  layer: Layer,
  maxDim = 2048
): { canvas: HTMLCanvasElement; centerX: number; centerY: number; scale: number } | null {
  if (!isCanvas2dSupported()) return null;

  let localBox: BBox;
  if (layer.type === 'path') {
    const geom = resolveEffectivePathGeometry(layer);
    localBox = computeSubPathsBBox(geom.subpaths);
    const strokePad = layer.stroke ? layer.stroke.width : 0;
    if (strokePad > 0) {
      localBox = {
        x: localBox.x - strokePad,
        y: localBox.y - strokePad,
        width: localBox.width + strokePad * 2,
        height: localBox.height + strokePad * 2,
      };
    }
  } else {
    localBox = computeLayerLocalBBox(layer);
  }

  const pad = getEffectsPadding(layer.effects);
  const w = Math.max(1, localBox.width + pad * 2);
  const h = Math.max(1, localBox.height + pad * 2);
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const originX = localBox.x - pad;
  const originY = localBox.y - pad;
  ctx.scale(scale, scale);

  const localLayer = {
    ...layer,
    x: -originX,
    y: -originY,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  };

  if (localLayer.type === 'path') {
    paintPathLayer(ctx, localLayer);
  } else if (localLayer.type === 'text') {
    paintTextLayer(ctx, localLayer);
  } else {
    const img = getAssetImageElement(localLayer.assetId);
    if (!img) return null;
    ctx.save();
    ctx.translate(localLayer.x, localLayer.y);
    applyEffectsToContext(ctx, localLayer.effects);
    ctx.drawImage(img, -localLayer.width / 2, -localLayer.height / 2, localLayer.width, localLayer.height);
    ctx.restore();
  }

  return {
    canvas,
    centerX: originX + w / 2,
    centerY: originY + h / 2,
    scale,
  };
}
