import { findLayerById, getLayerWorldMatrix, getParentWorldMatrix } from '../core/layerTree';
import {
  IDENTITY_MATRIX,
  clamp,
  degToRad,
  getLayerMatrix,
  invertMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import type { BBox, Layer, PathLayer, TextLayer } from '../core/types';
import { buildWorldSubPath, withHeadlessProject } from './booleans';
import { resolveEffectivePathGeometry } from './effects';

export interface PathGlyphPlacement {
  char: string;
  x: number;
  y: number;
  angleDeg: number;
  advance: number;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (
    typeof document === 'undefined' ||
    (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))
  ) {
    measureCtx = null;
    return null;
  }
  try {
    measureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

export function createTextCharMeasurer(layer: TextLayer): (ch: string) => number {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
    return (ch: string) => Math.max(layer.fontSize * 0.25, ctx.measureText(ch).width);
  }
  return (ch: string) =>
    ch === ' ' ? layer.fontSize * 0.3 : layer.fontSize * 0.56;
}

export function resolveHostPathLayer(
  layers: Layer[],
  pathId?: string
): PathLayer | null {
  if (!pathId) return null;
  const found = findLayerById(layers, pathId);
  if (!found || found.type !== 'path') return null;
  const hasCurve = found.subpaths.some((sp) => sp.anchors.length >= 2);
  return hasCurve ? found : null;
}

export function resolvePathMatrixRelativeToText(
  pathLayer: PathLayer,
  textLayer: TextLayer,
  layers?: Layer[]
): Matrix2D {
  if (!layers) {
    return getLayerMatrix(pathLayer);
  }
  const pathWorld = getLayerWorldMatrix(layers, pathLayer.id);
  const textParentWorld = getParentWorldMatrix(layers, textLayer.id);
  const rel = multiplyMatrices(invertMatrix(textParentWorld), pathWorld);
  // Also factor inverse of textLayer's own matrix if textLayer isn't identity,
  // or keep placements in textLayer's own local frame when sync applies textLayer's transform.
  // Actually placements are computed in textLayer's own local frame if we want textLayer.x/y/rot/scale
  // to offset from path, so divide by textLayer's own transform only if non-identity?
  // No! Wait: when attachTextToPath sets textLayer.x/y=0, rot=0, scale=1, textLayer.local === textLayer.parentLocal.
  // If user subsequently drags/rotates/scales textLayer directly, applying getLayerMatrix(textLayer) shifts it cleanly
  // IF placements are computed in relative scope (parent frame). Wait: if pathWorld != parent, rel puts curve in parent frame!
  return rel;
}

function buildTransformedPaperPath(
  scope: paper.PaperScope,
  pathLayer: PathLayer,
  matrix: Matrix2D,
  flip: boolean
): paper.Path | null {
  const { subpaths } = resolveEffectivePathGeometry(pathLayer);
  const sp = subpaths.find((item) => item.anchors.length >= 2);
  if (!sp) return null;

  const built = buildWorldSubPath(
    scope,
    { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    sp,
    false
  );
  if (!built) return null;

  const pm = new scope.Matrix(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.tx,
    matrix.ty
  );
  if (
    Math.abs(matrix.a - 1) > 1e-6 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    Math.abs(matrix.d - 1) > 1e-6 ||
    Math.abs(matrix.tx) > 1e-6 ||
    Math.abs(matrix.ty) > 1e-6
  ) {
    built.transform(pm);
  }
  if (flip) {
    built.reverse();
  }
  return built;
}

export function computeTextOnPathPlacements(
  textLayer: TextLayer,
  pathLayer: PathLayer,
  measureChar?: (ch: string) => number,
  layers?: Layer[]
): PathGlyphPlacement[] {
  const singleLine = (textLayer.content || '').replace(/\r?\n/g, ' ');
  const chars = Array.from(singleLine);
  if (chars.length === 0) return [];

  const measure = measureChar ?? createTextCharMeasurer(textLayer);
  const tracking = textLayer.letterSpacing ?? 0;
  const widths = chars.map(measure);
  const totalW =
    widths.reduce((sum, w) => sum + w, 0) + Math.max(0, chars.length - 1) * tracking;

  const relMatrix = resolvePathMatrixRelativeToText(pathLayer, textLayer, layers);

  return withHeadlessProject((scope) => {
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      relMatrix,
      Boolean(textLayer.pathFlip)
    );
    if (!path) return [];

    const length = path.length;
    if (length <= 1e-4) return [];

    const offsetRatio = clamp(textLayer.pathOffset ?? 0, 0, 100) / 100;
    const baseOffset = offsetRatio * length;
    const alignShift =
      textLayer.align === 'center'
        ? (length - totalW) / 2
        : textLayer.align === 'right'
          ? length - totalW
          : 0;

    let cursor = baseOffset + alignShift;
    const placements: PathGlyphPlacement[] = [];

    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      const w = widths[i];
      const mid = cursor + w / 2;

      let sampledAt = mid;
      if (path.closed) {
        sampledAt = ((mid % length) + length) % length;
      } else if (mid < 0 || mid > length) {
        cursor += w + tracking;
        continue;
      }

      const pt = path.getPointAt(clamp(sampledAt, 0, length));
      const tan = path.getTangentAt(clamp(sampledAt, 0, length));
      if (pt && tan) {
        const angleDeg = (Math.atan2(tan.y, tan.x) * 180) / Math.PI;
        placements.push({
          char: ch,
          x: pt.x,
          y: pt.y,
          angleDeg,
          advance: w,
        });
      }

      cursor += w + tracking;
    }

    return placements;
  });
}

export function computeTextOnPathLocalBBox(
  textLayer: TextLayer,
  pathLayer: PathLayer,
  layers?: Layer[]
): BBox {
  const placements = computeTextOnPathPlacements(textLayer, pathLayer, undefined, layers);
  const pad = Math.max(4, textLayer.fontSize * 0.85);

  if (placements.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of placements) {
      const rad = degToRad(p.angleDeg);
      const r = Math.hypot(p.advance / 2, pad);
      const extX = Math.max(Math.abs(Math.cos(rad)) * (p.advance / 2) + pad, r * 0.75);
      const extY = Math.max(Math.abs(Math.sin(rad)) * (p.advance / 2) + pad, r * 0.75);
      if (p.x - extX < minX) minX = p.x - extX;
      if (p.y - extY < minY) minY = p.y - extY;
      if (p.x + extX > maxX) maxX = p.x + extX;
      if (p.y + extY > maxY) maxY = p.y + extY;
    }
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  const relMatrix = resolvePathMatrixRelativeToText(pathLayer, textLayer, layers);
  return withHeadlessProject((scope) => {
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      relMatrix,
      Boolean(textLayer.pathFlip)
    );
    if (!path) {
      return { x: 0, y: 0, width: Math.max(20, textLayer.fontSize), height: textLayer.fontSize };
    }
    const b = path.bounds;
    return {
      x: b.x - pad,
      y: b.y - pad,
      width: Math.max(1, b.width + pad * 2),
      height: Math.max(1, b.height + pad * 2),
    };
  });
}

export { IDENTITY_MATRIX };
