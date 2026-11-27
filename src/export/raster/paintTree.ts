import { getAssetImageElement } from '../../core/assets';
import {
  computeLayerLocalBBox,
  computeSubPathsBBox,
  degToRad,
  getLayerMatrix,
} from '../../core/math';
import {
  normalizeGradientStops,
  resolveGradientEndpoints,
  sanitizeDashArray,
} from '../../core/paint';
import type {
  BBox,
  BlendMode,
  GroupLayer,
  Layer,
  Paint,
  PathLayer,
  SubPath,
  TextLayer,
} from '../../core/types';
import {
  colorWithOpacity,
  resolveEffectivePathGeometry,
} from '../../engine/effects';
import {
  computeTextOnPathLocalBBox,
  computeTextOnPathPlacements,
  resolveHostPathLayer,
} from '../../engine/textOnPath';
import { subPathToCubicSegments } from '../pathData';
import { applyMatrix } from './canvasPool';
import {
  applyEffectsToContext,
  createLayerEffectSurface,
  finishLayerEffectSurface,
  needsOffscreenEffectSurface,
} from './effectsPipeline';

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

function toCanvasCompositeOp(mode?: BlendMode): GlobalCompositeOperation {
  if (!mode || mode === 'normal') return 'source-over';
  return mode as GlobalCompositeOperation;
}

function toCanvasPaint(
  ctx: CanvasRenderingContext2D,
  paint: Paint,
  box: BBox
): string | CanvasGradient {
  if (typeof paint === 'string') return paint;
  const { origin, destination, radius } = resolveGradientEndpoints(paint, box);
  const grad =
    paint.kind === 'radial'
      ? ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, radius)
      : ctx.createLinearGradient(origin.x, origin.y, destination.x, destination.y);
  for (const stop of normalizeGradientStops(paint.stops)) {
    grad.addColorStop(stop.offset, colorWithOpacity(stop.color, stop.opacity ?? 1));
  }
  return grad;
}

export function paintPathLayer(ctx: CanvasRenderingContext2D, layer: PathLayer): void {
  const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
  const hasFill = Boolean(layer.fill);
  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  if (!hasFill && !hasStroke && extrudeFaces.length === 0) return;

  const localBox = computeSubPathsBBox(subpaths);
  const drawGeometry = (targetCtx: CanvasRenderingContext2D) => {
    for (const face of extrudeFaces) {
      buildPath(targetCtx, face.subpaths);
      targetCtx.fillStyle = face.fill;
      targetCtx.fill('nonzero');
    }

    buildPath(targetCtx, subpaths);
    if (hasFill) {
      targetCtx.fillStyle = toCanvasPaint(targetCtx, layer.fill as Paint, localBox);
      targetCtx.fill(layer.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    if (hasStroke) {
      targetCtx.strokeStyle = toCanvasPaint(targetCtx, layer.stroke!.color, localBox);
      targetCtx.lineWidth = layer.stroke!.width;
      targetCtx.lineCap = layer.stroke!.lineCap ?? 'round';
      targetCtx.lineJoin = layer.stroke!.lineJoin ?? 'round';
      const dash = sanitizeDashArray(layer.stroke!.dashArray);
      targetCtx.setLineDash(dash ?? []);
      targetCtx.lineDashOffset = layer.stroke!.dashOffset ?? 0;
      targetCtx.stroke();
    }
  };

  ctx.save();
  applyMatrix(ctx, getLayerMatrix(layer));
  ctx.globalAlpha = ctx.globalAlpha * layer.opacity;
  if (layer.blendMode && layer.blendMode !== 'normal') {
    ctx.globalCompositeOperation = toCanvasCompositeOp(layer.blendMode);
  }

  if (needsOffscreenEffectSurface(layer.effects)) {
    const strokePad = hasStroke ? layer.stroke!.width : 0;
    const paddedBox: BBox =
      strokePad > 0
        ? {
            x: localBox.x - strokePad,
            y: localBox.y - strokePad,
            width: localBox.width + strokePad * 2,
            height: localBox.height + strokePad * 2,
          }
        : localBox;
    const surface = createLayerEffectSurface(paddedBox, layer.effects);
    if (surface) {
      drawGeometry(surface.ctx);
      finishLayerEffectSurface(ctx, surface, layer.effects);
      ctx.restore();
      return;
    }
  }

  applyEffectsToContext(ctx, layer.effects);
  drawGeometry(ctx);
  ctx.restore();
}

export function paintTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  sceneLayers?: Layer[]
): void {
  const hostPath = sceneLayers ? resolveHostPathLayer(sceneLayers, layer.pathId) : null;
  const localBox = hostPath
    ? computeTextOnPathLocalBBox(layer, hostPath, sceneLayers)
    : computeLayerLocalBBox(layer);
  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  const drawText = (targetCtx: CanvasRenderingContext2D) => {
    targetCtx.fillStyle = toCanvasPaint(targetCtx, layer.fill, localBox);
    targetCtx.textBaseline = 'alphabetic';
    targetCtx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;

    if (hasStroke && layer.stroke) {
      targetCtx.strokeStyle = toCanvasPaint(targetCtx, layer.stroke.color, localBox);
      targetCtx.lineWidth = layer.stroke.width;
      targetCtx.lineCap = layer.stroke.lineCap ?? 'round';
      targetCtx.lineJoin = layer.stroke.lineJoin ?? 'round';
      targetCtx.miterLimit = 2;
      targetCtx.setLineDash(sanitizeDashArray(layer.stroke.dashArray) ?? []);
      targetCtx.lineDashOffset = layer.stroke.dashOffset ?? 0;
    }

    if (hostPath) {
      const placements = computeTextOnPathPlacements(
        layer,
        hostPath,
        (ch) => Math.max(layer.fontSize * 0.25, targetCtx.measureText(ch).width),
        sceneLayers
      );
      targetCtx.textAlign = 'center';
      const renderPass = (mode: 'stroke' | 'fill') => {
        for (const p of placements) {
          targetCtx.save();
          targetCtx.translate(p.x, p.y);
          targetCtx.rotate(degToRad(p.angleDeg));
          if (mode === 'stroke') {
            targetCtx.strokeText(p.char, 0, 0);
          } else {
            targetCtx.fillText(p.char, 0, 0);
          }
          targetCtx.restore();
        }
      };
      if (hasStroke) renderPass('stroke');
      renderPass('fill');
      return;
    }

    targetCtx.textAlign = layer.align;
    const lines = (layer.content || '').split('\n');
    const renderFreePass = (mode: 'stroke' | 'fill') => {
      lines.forEach((line, i) => {
        const y = layer.fontSize * 0.85 + i * layer.fontSize * layer.lineHeight;
        if (layer.letterSpacing && Math.abs(layer.letterSpacing) > 1e-4) {
          drawTrackedText(targetCtx, line, 0, y, layer.letterSpacing, layer.align, mode);
        } else if (mode === 'stroke') {
          targetCtx.strokeText(line, 0, y);
        } else {
          targetCtx.fillText(line, 0, y);
        }
      });
    };
    if (hasStroke) renderFreePass('stroke');
    renderFreePass('fill');
  };

  ctx.save();
  applyMatrix(ctx, getLayerMatrix(layer));
  ctx.globalAlpha = ctx.globalAlpha * layer.opacity;
  if (layer.blendMode && layer.blendMode !== 'normal') {
    ctx.globalCompositeOperation = toCanvasCompositeOp(layer.blendMode);
  }

  if (needsOffscreenEffectSurface(layer.effects)) {
    const surface = createLayerEffectSurface(localBox, layer.effects);
    if (surface) {
      drawText(surface.ctx);
      finishLayerEffectSurface(ctx, surface, layer.effects);
      ctx.restore();
      return;
    }
  }

  applyEffectsToContext(ctx, layer.effects);
  drawText(ctx);
  ctx.restore();
}

/** Посимвольный вывод с трекингом (`letterSpacing` в px). */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: 'left' | 'center' | 'right',
  mode: 'fill' | 'stroke' = 'fill'
): void {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, chars.length - 1) * tracking;
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => {
    if (mode === 'stroke') {
      ctx.strokeText(ch, cursor, y);
    } else {
      ctx.fillText(ch, cursor, y);
    }
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
  ctx.globalAlpha = ctx.globalAlpha * layer.opacity;
  if (layer.blendMode && layer.blendMode !== 'normal') {
    ctx.globalCompositeOperation = toCanvasCompositeOp(layer.blendMode);
  }
  if (needsOffscreenEffectSurface(layer.effects)) {
    const surface = createLayerEffectSurface(computeLayerLocalBBox(layer), layer.effects);
    if (surface) {
      surface.ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      finishLayerEffectSurface(ctx, surface, layer.effects);
      ctx.restore();
      return;
    }
  }
  applyEffectsToContext(ctx, layer.effects);
  ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
  ctx.restore();
}

async function resolveImageElement(assetId: string): Promise<HTMLImageElement | null> {
  return getAssetImageElement(assetId) ?? null;
}

export async function paintLayerList(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  paintLayer?: (ctx: CanvasRenderingContext2D, layer: Layer, sceneLayers?: Layer[]) => Promise<void> | void,
  sceneLayers: Layer[] = layers
): Promise<void> {
  const renderFn = paintLayer ?? defaultPaintLayer;
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const maskIds = new Set<string>();
  for (const l of layers) {
    if (l.type === 'path' && l.isClipMask) maskIds.add(l.id);
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') maskIds.add(l.clipMaskId);
  }

  let activeMask: PathLayer | null = null;
  const closeClip = () => {
    if (activeMask) ctx.restore();
    activeMask = null;
  };

  for (const layer of layers) {
    if (maskIds.has(layer.id) || !layer.visible) continue;

    const mask = layer.clipMaskId ? byId.get(layer.clipMaskId) : undefined;
    if (mask && mask.type === 'path' && mask !== activeMask) {
      closeClip();
      ctx.save();
      ctx.save();
      applyMatrix(ctx, getLayerMatrix(mask));
      buildPath(ctx, mask.subpaths);
      ctx.restore();
      ctx.clip(mask.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      activeMask = mask;
    } else if (!mask || mask.type !== 'path') {
      closeClip();
    }
    await renderFn(ctx, layer, sceneLayers);
  }
  closeClip();
}

export async function paintGroupLayer(
  ctx: CanvasRenderingContext2D,
  group: GroupLayer,
  paintLayer?: (ctx: CanvasRenderingContext2D, layer: Layer, sceneLayers?: Layer[]) => Promise<void> | void,
  sceneLayers?: Layer[]
): Promise<void> {
  if (!group.visible || group.children.length === 0) return;
  ctx.save();
  applyMatrix(ctx, getLayerMatrix(group));
  ctx.globalAlpha = ctx.globalAlpha * group.opacity;
  if (group.blendMode && group.blendMode !== 'normal') {
    ctx.globalCompositeOperation = toCanvasCompositeOp(group.blendMode);
  }
  if (needsOffscreenEffectSurface(group.effects)) {
    const surface = createLayerEffectSurface(computeLayerLocalBBox(group), group.effects);
    if (surface) {
      await paintLayerList(surface.ctx, group.children, paintLayer, sceneLayers ?? group.children);
      finishLayerEffectSurface(ctx, surface, group.effects);
      ctx.restore();
      return;
    }
  }
  applyEffectsToContext(ctx, group.effects);
  await paintLayerList(ctx, group.children, paintLayer, sceneLayers ?? group.children);
  ctx.restore();
}

export async function defaultPaintLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  sceneLayers?: Layer[]
): Promise<void> {
  if (layer.type === 'path') paintPathLayer(ctx, layer);
  else if (layer.type === 'text') paintTextLayer(ctx, layer, sceneLayers);
  else if (layer.type === 'group') {
    await paintGroupLayer(ctx, layer, defaultPaintLayer, sceneLayers);
  } else {
    await paintImageLayer(ctx, layer);
  }
}

function paintGroupChildrenSync(
  ctx: CanvasRenderingContext2D,
  group: GroupLayer,
  sceneLayers?: Layer[]
): void {
  const byId = new Map(group.children.map((l) => [l.id, l] as const));
  const maskIds = new Set<string>();
  for (const l of group.children) {
    if (l.type === 'path' && l.isClipMask) maskIds.add(l.id);
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') maskIds.add(l.clipMaskId);
  }
  let activeMask: PathLayer | null = null;
  const closeClip = () => {
    if (activeMask) ctx.restore();
    activeMask = null;
  };
  for (const child of group.children) {
    if (maskIds.has(child.id) || !child.visible) continue;
    const mask = child.clipMaskId ? byId.get(child.clipMaskId) : undefined;
    if (mask && mask.type === 'path' && mask !== activeMask) {
      closeClip();
      ctx.save();
      ctx.save();
      applyMatrix(ctx, getLayerMatrix(mask));
      buildPath(ctx, mask.subpaths);
      ctx.restore();
      ctx.clip(mask.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
      activeMask = mask;
    } else if (!mask || mask.type !== 'path') {
      closeClip();
    }
    if (child.type === 'path') paintPathLayer(ctx, child);
    else if (child.type === 'text') paintTextLayer(ctx, child, sceneLayers ?? group.children);
    else if (child.type === 'group') paintGroupSync(ctx, child, sceneLayers ?? group.children);
    else {
      const img = getAssetImageElement(child.assetId);
      if (img) {
        ctx.save();
        applyMatrix(ctx, getLayerMatrix(child));
        ctx.globalAlpha = ctx.globalAlpha * child.opacity;
        if (child.blendMode && child.blendMode !== 'normal') {
          ctx.globalCompositeOperation = toCanvasCompositeOp(child.blendMode);
        }
        if (needsOffscreenEffectSurface(child.effects)) {
          const surface = createLayerEffectSurface(computeLayerLocalBBox(child), child.effects);
          if (surface) {
            surface.ctx.drawImage(img, -child.width / 2, -child.height / 2, child.width, child.height);
            finishLayerEffectSurface(ctx, surface, child.effects);
            ctx.restore();
            continue;
          }
        }
        applyEffectsToContext(ctx, child.effects);
        ctx.drawImage(img, -child.width / 2, -child.height / 2, child.width, child.height);
        ctx.restore();
      }
    }
  }
  closeClip();
}

export function paintGroupSync(
  ctx: CanvasRenderingContext2D,
  group: GroupLayer,
  sceneLayers?: Layer[]
): void {
  if (!group.visible || group.children.length === 0) return;
  ctx.save();
  applyMatrix(ctx, getLayerMatrix(group));
  ctx.globalAlpha = ctx.globalAlpha * group.opacity;
  if (group.blendMode && group.blendMode !== 'normal') {
    ctx.globalCompositeOperation = toCanvasCompositeOp(group.blendMode);
  }
  if (needsOffscreenEffectSurface(group.effects)) {
    const surface = createLayerEffectSurface(computeLayerLocalBBox(group), group.effects);
    if (surface) {
      paintGroupChildrenSync(surface.ctx, group, sceneLayers ?? group.children);
      finishLayerEffectSurface(ctx, surface, group.effects);
      ctx.restore();
      return;
    }
  }
  applyEffectsToContext(ctx, group.effects);
  paintGroupChildrenSync(ctx, group, sceneLayers ?? group.children);
  ctx.restore();
}
