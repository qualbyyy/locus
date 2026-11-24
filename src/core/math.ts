import type {
  AnchorPoint,
  BaseLayer,
  BBox,
  Layer,
  PathLayer,
  Point2D,
  SubPath,
  TextLayer,
} from './types';

export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export type LayerTransform = Pick<
  BaseLayer,
  'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'
>;

const ZERO_EPS = 1e-8;
const NORMALIZE_EPS = 1e-4;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeScale(scale: number): number {
  if (Math.abs(scale) < ZERO_EPS) {
    return scale < 0 ? -ZERO_EPS : ZERO_EPS;
  }
  return scale;
}

export function getLayerMatrix(layer: LayerTransform): Matrix2D {
  const rad = degToRad(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: layer.scaleX * cos,
    b: layer.scaleX * sin,
    c: -layer.scaleY * sin,
    d: layer.scaleY * cos,
    tx: layer.x,
    ty: layer.y,
  };
}

export function applyMatrixToPoint(m: Matrix2D, pt: Point2D): Point2D {
  return {
    x: m.a * pt.x + m.c * pt.y + m.tx,
    y: m.b * pt.x + m.d * pt.y + m.ty,
  };
}

export function invertMatrix(m: Matrix2D): Matrix2D {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) {
    return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  }
  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

export function localToWorld(layer: LayerTransform, localPt: Point2D): Point2D {
  const rad = degToRad(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = localPt.x * layer.scaleX;
  const sy = localPt.y * layer.scaleY;
  return {
    x: layer.x + sx * cos - sy * sin,
    y: layer.y + sx * sin + sy * cos,
  };
}

export function worldToLocal(layer: LayerTransform, worldPt: Point2D): Point2D {
  const dx = worldPt.x - layer.x;
  const dy = worldPt.y - layer.y;
  const rad = degToRad(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  return {
    x: rx / safeScale(layer.scaleX),
    y: ry / safeScale(layer.scaleY),
  };
}

export function localVectorToWorld(
  layer: Pick<LayerTransform, 'rotation' | 'scaleX' | 'scaleY'>,
  localVec: Point2D
): Point2D {
  const rad = degToRad(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = localVec.x * layer.scaleX;
  const sy = localVec.y * layer.scaleY;
  return {
    x: sx * cos - sy * sin,
    y: sx * sin + sy * cos,
  };
}

export function worldVectorToLocal(
  layer: Pick<LayerTransform, 'rotation' | 'scaleX' | 'scaleY'>,
  worldVec: Point2D
): Point2D {
  const rad = degToRad(layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = worldVec.x * cos + worldVec.y * sin;
  const ry = -worldVec.x * sin + worldVec.y * cos;
  return {
    x: rx / safeScale(layer.scaleX),
    y: ry / safeScale(layer.scaleY),
  };
}

export function snapVector45(vec: Point2D): Point2D {
  const len = Math.hypot(vec.x, vec.y);
  if (len < ZERO_EPS) {
    return { x: 0, y: 0 };
  }
  const angle = Math.atan2(vec.y, vec.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  return {
    x: Math.cos(snapped) * len,
    y: Math.sin(snapped) * len,
  };
}

export function evaluateCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const w0 = uu * u;
  const w1 = 3 * uu * t;
  const w2 = 3 * u * tt;
  const w3 = tt * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

function evalCubic1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
}

export function cubicBezierBounds1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number
): { min: number; max: number } {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);

  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;

  const candidates: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      candidates.push(-c / b);
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrtD = Math.sqrt(disc);
      candidates.push((-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a));
    }
  }

  for (const t of candidates) {
    if (t > 0 && t < 1) {
      const val = evalCubic1D(p0, p1, p2, p3, t);
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  return { min, max };
}

function isZeroHandle(pt: Point2D): boolean {
  return Math.abs(pt.x) <= ZERO_EPS && Math.abs(pt.y) <= ZERO_EPS;
}

function computeSubPathsBBoxWithTransform(
  subpaths: SubPath[],
  transform?: LayerTransform
): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoint = false;

  const toSpace = transform
    ? (pt: Point2D) => localToWorld(transform, pt)
    : (pt: Point2D) => pt;

  const includePoint = (pt: Point2D) => {
    hasPoint = true;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  };

  for (const sp of subpaths) {
    const { anchors, closed } = sp;
    if (anchors.length === 0) continue;

    for (const anchor of anchors) {
      includePoint(toSpace({ x: anchor.x, y: anchor.y }));
    }

    const segCount = closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a0 = anchors[i];
      const a1 = anchors[(i + 1) % anchors.length];
      if (isZeroHandle(a0.handleOut) && isZeroHandle(a1.handleIn)) {
        continue;
      }

      const p0 = toSpace({ x: a0.x, y: a0.y });
      const p1 = toSpace({
        x: a0.x + a0.handleOut.x,
        y: a0.y + a0.handleOut.y,
      });
      const p2 = toSpace({
        x: a1.x + a1.handleIn.x,
        y: a1.y + a1.handleIn.y,
      });
      const p3 = toSpace({ x: a1.x, y: a1.y });

      const bx = cubicBezierBounds1D(p0.x, p1.x, p2.x, p3.x);
      const by = cubicBezierBounds1D(p0.y, p1.y, p2.y, p3.y);

      if (bx.min < minX) minX = bx.min;
      if (bx.max > maxX) maxX = bx.max;
      if (by.min < minY) minY = by.min;
      if (by.max > maxY) maxY = by.max;
    }
  }

  if (!hasPoint) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeSubPathsBBox(subpaths: SubPath[]): BBox {
  return computeSubPathsBBoxWithTransform(subpaths);
}

export function cloneSubPaths(subpaths: SubPath[]): SubPath[] {
  return subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({
      x: a.x,
      y: a.y,
      handleIn: { x: a.handleIn.x, y: a.handleIn.y },
      handleOut: { x: a.handleOut.x, y: a.handleOut.y },
      smooth: a.smooth,
    })),
  }));
}

export function centerSubPathsAtOrigin(subpaths: SubPath[]): {
  subpaths: SubPath[];
  offset: Point2D;
} {
  const hasAnyAnchor = subpaths.some((sp) => sp.anchors.length > 0);
  if (!hasAnyAnchor) {
    return { subpaths: cloneSubPaths(subpaths), offset: { x: 0, y: 0 } };
  }

  const bbox = computeSubPathsBBox(subpaths);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  if (Math.abs(cx) <= NORMALIZE_EPS && Math.abs(cy) <= NORMALIZE_EPS) {
    return { subpaths: cloneSubPaths(subpaths), offset: { x: 0, y: 0 } };
  }

  const shifted = subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({
      x: a.x - cx,
      y: a.y - cy,
      handleIn: { x: a.handleIn.x, y: a.handleIn.y },
      handleOut: { x: a.handleOut.x, y: a.handleOut.y },
      smooth: a.smooth,
    })),
  }));

  return {
    subpaths: shifted,
    offset: { x: cx, y: cy },
  };
}

export function normalizePathLayer(layer: PathLayer): PathLayer {
  const hasAnyAnchor = layer.subpaths.some((sp) => sp.anchors.length > 0);
  if (!hasAnyAnchor) {
    return layer;
  }

  const bbox = computeSubPathsBBox(layer.subpaths);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  if (Math.abs(cx) <= NORMALIZE_EPS && Math.abs(cy) <= NORMALIZE_EPS) {
    return layer;
  }

  const cWorld = localToWorld(layer, { x: cx, y: cy });
  const shifted = layer.subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({
      x: a.x - cx,
      y: a.y - cy,
      handleIn: { x: a.handleIn.x, y: a.handleIn.y },
      handleOut: { x: a.handleOut.x, y: a.handleOut.y },
      smooth: a.smooth,
    })),
  }));

  return {
    ...layer,
    x: cWorld.x,
    y: cWorld.y,
    subpaths: shifted,
  };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) {
    return measureCtx;
  }
  if (
    typeof document === 'undefined' ||
    (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))
  ) {
    measureCtx = null;
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function estimateTextLocalBBox(layer: TextLayer): BBox {
  const lines = (layer.content || '').split('\n');
  const ctx = getMeasureContext();
  const tracking = layer.letterSpacing ?? 0;
  let width: number;

  if (ctx) {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
    let maxW = layer.fontSize * 0.6;
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const measured = Math.max(
        layer.fontSize * 0.6,
        ctx.measureText(line).width + trackingExtra
      );
      if (measured > maxW) {
        maxW = measured;
      }
    }
    width = maxW;
  } else {
    let maxW = layer.fontSize * 0.6;
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const est = line.length * layer.fontSize * 0.56 + trackingExtra;
      if (est > maxW) {
        maxW = est;
      }
    }
    width = maxW;
  }

  const lineStep = layer.fontSize * layer.lineHeight;
  const height = Math.max(lineStep, lines.length * lineStep);

  let x = 0;
  if (layer.align === 'center') {
    x = -width / 2;
  } else if (layer.align === 'right') {
    x = -width;
  }

  return { x, y: 0, width, height };
}

export function computeLayerLocalBBox(layer: Layer): BBox {
  if (layer.type === 'path') {
    return computeSubPathsBBox(layer.subpaths);
  }
  if (layer.type === 'image') {
    return {
      x: -layer.width / 2,
      y: -layer.height / 2,
      width: layer.width,
      height: layer.height,
    };
  }
  return estimateTextLocalBBox(layer);
}

function bboxFromTransformedRect(layer: LayerTransform, localBox: BBox): BBox {
  const corners: Point2D[] = [
    { x: localBox.x, y: localBox.y },
    { x: localBox.x + localBox.width, y: localBox.y },
    { x: localBox.x + localBox.width, y: localBox.y + localBox.height },
    { x: localBox.x, y: localBox.y + localBox.height },
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    const w = localToWorld(layer, corner);
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeLayerWorldBBox(layer: Layer): BBox {
  if (layer.type === 'path') {
    const hasAnchors = layer.subpaths.some((sp) => sp.anchors.length > 0);
    if (!hasAnchors) {
      return { x: layer.x, y: layer.y, width: 0, height: 0 };
    }
    return computeSubPathsBBoxWithTransform(layer.subpaths, layer);
  }
  return bboxFromTransformedRect(layer, computeLayerLocalBBox(layer));
}

export function computeCombinedWorldBBox(layers: Layer[]): BBox {
  if (layers.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of layers) {
    const b = computeLayerWorldBBox(layer);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function splitCubicBezier(
  a0: AnchorPoint,
  a1: AnchorPoint,
  t: number
): {
  a0HandleOut: Point2D;
  midAnchor: AnchorPoint;
  a1HandleIn: Point2D;
} {
  const clampedT = clamp(t, 1e-4, 1 - 1e-4);

  if (
    Math.hypot(a0.handleOut.x, a0.handleOut.y) <= 1e-4 &&
    Math.hypot(a1.handleIn.x, a1.handleIn.y) <= 1e-4
  ) {
    const mid = lerpPoint(
      { x: a0.x, y: a0.y },
      { x: a1.x, y: a1.y },
      clampedT
    );
    return {
      a0HandleOut: { x: 0, y: 0 },
      midAnchor: {
        x: mid.x,
        y: mid.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        smooth: false,
      },
      a1HandleIn: { x: 0, y: 0 },
    };
  }

  const p0 = { x: a0.x, y: a0.y };
  const p1 = { x: a0.x + a0.handleOut.x, y: a0.y + a0.handleOut.y };
  const p3 = { x: a1.x, y: a1.y };
  const p2 = { x: a1.x + a1.handleIn.x, y: a1.y + a1.handleIn.y };

  const q0 = lerpPoint(p0, p1, clampedT);
  const q1 = lerpPoint(p1, p2, clampedT);
  const q2 = lerpPoint(p2, p3, clampedT);

  const r0 = lerpPoint(q0, q1, clampedT);
  const r1 = lerpPoint(q1, q2, clampedT);
  const s = lerpPoint(r0, r1, clampedT);

  return {
    a0HandleOut: { x: q0.x - p0.x, y: q0.y - p0.y },
    midAnchor: {
      x: s.x,
      y: s.y,
      handleIn: { x: r0.x - s.x, y: r0.y - s.y },
      handleOut: { x: r1.x - s.x, y: r1.y - s.y },
      smooth: true,
    },
    a1HandleIn: { x: q2.x - p3.x, y: q2.y - p3.y },
  };
}
