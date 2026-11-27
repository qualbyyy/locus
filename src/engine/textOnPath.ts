import { findLayerById, getLayerWorldMatrix, getParentWorldMatrix } from '../core/layerTree';
import {
  IDENTITY_MATRIX,
  clamp,
  computeSubPathsBBox,
  degToRad,
  getLayerMatrix,
  invertMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import type {
  AnchorPoint,
  BBox,
  Layer,
  PathLayer,
  Point2D,
  SubPath,
  TextLayer,
} from '../core/types';
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
  const pathWorld = layers
    ? getLayerWorldMatrix(layers, pathLayer.id)
    : getLayerMatrix(pathLayer);
  const textParentWorld = layers
    ? getParentWorldMatrix(layers, textLayer.id)
    : IDENTITY_MATRIX;
  const relParent = multiplyMatrices(invertMatrix(textParentWorld), pathWorld);
  // Компенсируем собственную матрицу textLayer, чтобы дальнейший applyLayerMatrixToItem(textLayer) оставлял кривую на месте без орбиты.
  return multiplyMatrices(invertMatrix(getLayerMatrix(textLayer)), relParent);
}

export function pickPrimaryHostSubPath(subpaths: SubPath[]): SubPath | null {
  let best: SubPath | null = null;
  let bestScore = -1;
  for (const sp of subpaths) {
    if (sp.anchors.length < 2) continue;
    const b = computeSubPathsBBox([sp]);
    const score = b.width + b.height;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

export function buildTransformedPaperPath(
  scope: paper.PaperScope,
  pathLayer: PathLayer,
  matrix: Matrix2D,
  flip: boolean
): paper.Path | null {
  const { subpaths } = resolveEffectivePathGeometry(pathLayer);
  const sp = pickPrimaryHostSubPath(subpaths);
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
    // Bake transform directly into segments so getPointAt / getTangentAt / length reflect real geometry.
    built.applyMatrix = true;
    built.transform(pm);
  }
  if (flip) {
    built.reverse();
  }
  return built;
}

export function computeOptimalArcPathOffset(
  pathLayer: PathLayer,
  arc: 'top' | 'bottom',
  layers?: Layer[]
): number {
  const sp = pickPrimaryHostSubPath(resolveEffectivePathGeometry(pathLayer).subpaths);
  if (!sp || !sp.closed) {
    return 0;
  }

  return withHeadlessProject((scope) => {
    const matrix = layers
      ? getLayerWorldMatrix(layers, pathLayer.id)
      : getLayerMatrix(pathLayer);
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      matrix,
      arc === 'bottom'
    );
    if (!path || path.length <= 1e-4) {
      return arc === 'top' ? 50 : 0;
    }

    const len = path.length;
    const samples = 72;
    let bestOffset = 0;
    let bestY = arc === 'top' ? Infinity : -Infinity;

    for (let i = 0; i < samples; i += 1) {
      const off = (i / samples) * len;
      const pt = path.getPointAt(off);
      if (!pt) continue;
      if (arc === 'top' ? pt.y < bestY : pt.y > bestY) {
        bestY = pt.y;
        bestOffset = off;
      }
    }

    const centerRatio = bestOffset / len;
    const pct = ((centerRatio - 0.5 + 1) % 1) * 100;
    return Number(pct.toFixed(1));
  });
}

export function resolveTextPathTracking(
  length: number,
  widths: number[],
  baseTracking: number,
  isClosed: boolean,
  stretch?: boolean
): number {
  if (!stretch || widths.length === 0) {
    return baseTracking;
  }
  const totalGlyphW = widths.reduce((sum, w) => sum + w, 0);
  if (totalGlyphW >= length) {
    return baseTracking;
  }
  if (isClosed) {
    return Math.max(baseTracking, (length - totalGlyphW) / widths.length);
  }
  if (widths.length > 1) {
    return Math.max(baseTracking, (length - totalGlyphW) / (widths.length - 1));
  }
  return baseTracking;
}

export function buildOffsetPathSubPath(
  textLayer: TextLayer,
  pathLayer: PathLayer,
  layers?: Layer[],
  centerSeam = false
): SubPath | null {
  const baselineOffset = clamp(textLayer.pathBaselineOffset ?? 0, -200, 200);
  const relMatrix = resolvePathMatrixRelativeToText(pathLayer, textLayer, layers);

  return withHeadlessProject((scope) => {
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      relMatrix,
      Boolean(textLayer.pathFlip)
    );
    if (!path) return null;

    let resultPath: paper.Path = path;
    if (Math.abs(baselineOffset) > 0.1 && path.length > 1e-4) {
      const length = path.length;
      const sampleCount = clamp(Math.ceil(length / 10), 24, 180);
      const stepCount = path.closed ? sampleCount : sampleCount - 1;
      const sampledPts: paper.Point[] = [];

      for (let i = 0; i <= (path.closed ? stepCount - 1 : stepCount); i += 1) {
        const d = path.closed
          ? (i / stepCount) * length
          : (i / Math.max(1, stepCount)) * length;
        const pt = path.getPointAt(clamp(d, 0, length));
        const tan = path.getTangentAt(clamp(d, 0, length));
        if (!pt || !tan) continue;
        sampledPts.push(
          new scope.Point(pt.x + tan.y * baselineOffset, pt.y - tan.x * baselineOffset)
        );
      }

      if (sampledPts.length < 2) return null;

      resultPath = new scope.Path({
        segments: sampledPts,
        closed: path.closed,
        applyMatrix: false,
        insert: false,
      });
      resultPath.smooth({ type: 'continuous' });
      resultPath.simplify(0.35);
    }

    if (centerSeam && resultPath.closed && resultPath.length > 1e-4) {
      const len = resultPath.length;
      const basePct = clamp(textLayer.pathOffset ?? 0, 0, 100);
      const targetCenterRatio = ((50 + basePct) % 100) / 100;
      const oppositeOffset = ((targetCenterRatio + 0.5) % 1) * len;
      const loc = resultPath.getLocationAt(clamp(oppositeOffset, 0.01, len - 0.01));
      if (loc) {
        const opened = resultPath.splitAt(loc);
        if (opened) {
          resultPath = opened;
        }
      }
    }

    const anchors: AnchorPoint[] = resultPath.segments.map((seg) => ({
      x: seg.point.x,
      y: seg.point.y,
      handleIn: { x: seg.handleIn.x, y: seg.handleIn.y },
      handleOut: { x: seg.handleOut.x, y: seg.handleOut.y },
      smooth: seg.isSmooth(),
    }));
    return anchors.length >= 2 ? { closed: resultPath.closed, anchors } : null;
  });
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
  const baseTracking = textLayer.letterSpacing ?? 0;
  const widths = chars.map(measure);
  const baselineOffset = clamp(textLayer.pathBaselineOffset ?? 0, -200, 200);
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

    const tracking = resolveTextPathTracking(
      length,
      widths,
      baseTracking,
      path.closed,
      textLayer.pathStretch
    );
    const totalW =
      widths.reduce((sum, w) => sum + w, 0) + Math.max(0, chars.length - 1) * tracking;

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
          x: pt.x + tan.y * baselineOffset,
          y: pt.y - tan.x * baselineOffset,
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
  const strokePad = textLayer.stroke && textLayer.stroke.width > 0 ? textLayer.stroke.width / 2 : 0;
  const pad = Math.max(4, textLayer.fontSize * 0.85) + strokePad;

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

  const fallbackPad = pad + Math.abs(textLayer.pathBaselineOffset ?? 0);
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
      x: b.x - fallbackPad,
      y: b.y - fallbackPad,
      width: Math.max(1, b.width + fallbackPad * 2),
      height: Math.max(1, b.height + fallbackPad * 2),
    };
  });
}

export interface TextPathGeometryInfo {
  curvePt: Point2D;
  baselinePt: Point2D;
  normalPt: Point2D;
  tangent: Point2D;
  normal: Point2D;
  caretBottom: Point2D;
  caretTop: Point2D;
  pathLength: number;
  isClosed: boolean;
}

export function computeTextOnPathCaretAndAnchors(
  textLayer: TextLayer,
  pathLayer: PathLayer,
  layers?: Layer[],
  caretIndex?: number
): TextPathGeometryInfo | null {
  const singleLine = (textLayer.content || '').replace(/\r?\n/g, ' ');
  const chars = Array.from(singleLine);
  const measure = createTextCharMeasurer(textLayer);
  const widths = chars.map(measure);
  const baseTracking = textLayer.letterSpacing ?? 0;
  const baselineOffset = clamp(textLayer.pathBaselineOffset ?? 0, -200, 200);
  const relMatrix = resolvePathMatrixRelativeToText(pathLayer, textLayer, layers);

  return withHeadlessProject((scope) => {
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      relMatrix,
      Boolean(textLayer.pathFlip)
    );
    if (!path || path.length <= 1e-4) return null;

    const length = path.length;
    const tracking = resolveTextPathTracking(
      length,
      widths,
      baseTracking,
      path.closed,
      textLayer.pathStretch
    );
    const totalW =
      widths.reduce((sum, w) => sum + w, 0) + Math.max(0, chars.length - 1) * tracking;
    const baseOffset = (clamp(textLayer.pathOffset ?? 0, 0, 100) / 100) * length;
    const alignShift =
      textLayer.align === 'center'
        ? (length - totalW) / 2
        : textLayer.align === 'right'
          ? length - totalW
          : 0;
    const startCursor = baseOffset + alignShift;

    const rawAnchorDist =
      textLayer.align === 'center'
        ? startCursor + totalW / 2
        : textLayer.align === 'right'
          ? startCursor + totalW
          : startCursor;
    const anchorDist = path.closed
      ? ((rawAnchorDist % length) + length) % length
      : clamp(rawAnchorDist, 0, length);

    const aPt = path.getPointAt(clamp(anchorDist, 0, length));
    const aTan = path.getTangentAt(clamp(anchorDist, 0, length));
    if (!aPt || !aTan) return null;

    const normal = { x: aTan.y, y: -aTan.x };
    const curvePt = { x: aPt.x, y: aPt.y };
    const baselinePt = {
      x: curvePt.x + normal.x * baselineOffset,
      y: curvePt.y + normal.y * baselineOffset,
    };
    const handleMargin = Math.max(18, textLayer.fontSize * 0.75);
    const normalPt = {
      x: baselinePt.x + normal.x * handleMargin,
      y: baselinePt.y + normal.y * handleMargin,
    };

    const idx = clamp(caretIndex ?? chars.length, 0, chars.length);
    let caretCursor = startCursor;
    for (let i = 0; i < idx; i += 1) {
      caretCursor += widths[i] + tracking;
    }
    if (idx > 0 && idx < chars.length) {
      caretCursor -= tracking / 2;
    }
    const caretDist = path.closed
      ? ((caretCursor % length) + length) % length
      : clamp(caretCursor, 0, length);
    const cPt = path.getPointAt(clamp(caretDist, 0, length)) ?? aPt;
    const cTan = path.getTangentAt(clamp(caretDist, 0, length)) ?? aTan;
    const cNorm = { x: cTan.y, y: -cTan.x };
    const caretBottom = {
      x: cPt.x + cNorm.x * baselineOffset,
      y: cPt.y + cNorm.y * baselineOffset,
    };
    const caretHeight = textLayer.fontSize * 0.92;
    const caretTop = {
      x: caretBottom.x + cNorm.x * caretHeight,
      y: caretBottom.y + cNorm.y * caretHeight,
    };

    return {
      curvePt,
      baselinePt,
      normalPt,
      tangent: { x: aTan.x, y: aTan.y },
      normal,
      caretBottom,
      caretTop,
      pathLength: length,
      isClosed: path.closed,
    };
  });
}

export function projectPointToTextPathOffset(
  textLayer: TextLayer,
  pathLayer: PathLayer,
  localPoint: Point2D,
  layers?: Layer[]
): { pathOffset: number; align: TextLayer['align']; signedNormalDist: number } | null {
  const singleLine = (textLayer.content || '').replace(/\r?\n/g, ' ');
  const chars = Array.from(singleLine);
  const measure = createTextCharMeasurer(textLayer);
  const widths = chars.map(measure);
  const baseTracking = textLayer.letterSpacing ?? 0;
  const relMatrix = resolvePathMatrixRelativeToText(pathLayer, textLayer, layers);

  return withHeadlessProject((scope) => {
    const path = buildTransformedPaperPath(
      scope,
      pathLayer,
      relMatrix,
      Boolean(textLayer.pathFlip)
    );
    if (!path || path.length <= 1e-4) return null;

    const len = path.length;
    const loc = path.getNearestLocation(new scope.Point(localPoint.x, localPoint.y));
    if (!loc) return null;

    const tan = path.getTangentAt(clamp(loc.offset, 0, len));
    const norm = tan ? { x: tan.y, y: -tan.x } : { x: 0, y: -1 };
    const signedNormalDist =
      (localPoint.x - loc.point.x) * norm.x + (localPoint.y - loc.point.y) * norm.y;

    const tracking = resolveTextPathTracking(
      len,
      widths,
      baseTracking,
      path.closed,
      textLayer.pathStretch
    );
    const totalW =
      widths.reduce((sum, w) => sum + w, 0) + Math.max(0, chars.length - 1) * tracking;

    if (path.closed) {
      const ratio = loc.offset / len;
      const pct =
        textLayer.align === 'center'
          ? ((ratio - 0.5 + 1) % 1) * 100
          : ratio * 100;
      return {
        pathOffset: Number(clamp(pct, 0, 100).toFixed(2)),
        align: textLayer.align,
        signedNormalDist,
      };
    }

    const startOffset = clamp((loc.offset - totalW / 2) / len, 0, 1) * 100;
    return {
      pathOffset: Number(clamp(startOffset, 0, 100).toFixed(2)),
      align: 'left',
      signedNormalDist,
    };
  });
}

export { IDENTITY_MATRIX };
