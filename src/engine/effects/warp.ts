import { clamp, computeSubPathsBBox, splitCubicBezier } from '../../core/math';
import type {
  AnchorPoint,
  DistortEffect,
  Point2D,
  SubPath,
  WarpEffect,
} from '../../core/types';

function cloneAnchor(a: AnchorPoint): AnchorPoint {
  return {
    x: a.x,
    y: a.y,
    handleIn: { x: a.handleIn.x, y: a.handleIn.y },
    handleOut: { x: a.handleOut.x, y: a.handleOut.y },
    smooth: a.smooth,
  };
}

function splitCubicEqual(a0: AnchorPoint, a1: AnchorPoint, parts: number): AnchorPoint[] {
  if (parts <= 1) return [cloneAnchor(a0), cloneAnchor(a1)];
  const result: AnchorPoint[] = [];
  let cur0 = cloneAnchor(a0);
  const cur1 = cloneAnchor(a1);

  for (let i = 0; i < parts - 1; i += 1) {
    const t = 1 / (parts - i);
    const { a0HandleOut, midAnchor, a1HandleIn } = splitCubicBezier(cur0, cur1, t);
    cur0.handleOut = a0HandleOut;
    result.push(cur0);
    cur0 = midAnchor;
    cur1.handleIn = a1HandleIn;
  }
  result.push(cur0);
  result.push(cur1);
  return result;
}

/** Разбивает длинные сегменты на более мелкие Безье для плавной деформации. */
export function subdivideSubPaths(
  subpaths: SubPath[],
  maxSegLen = 14,
  maxAnchorsPerSubpath = 240
): SubPath[] {
  return subpaths.map((sp) => {
    const anchors = sp.anchors;
    if (anchors.length < 2) {
      return { closed: sp.closed, anchors: anchors.map(cloneAnchor) };
    }

    const segCount = sp.closed ? anchors.length : anchors.length - 1;
    const lengths: number[] = [];
    let totalLen = 0;
    for (let i = 0; i < segCount; i += 1) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const len =
        Math.hypot(a.handleOut.x, a.handleOut.y) +
        Math.hypot(b.x + b.handleIn.x - (a.x + a.handleOut.x), b.y + b.handleIn.y - (a.y + a.handleOut.y)) +
        Math.hypot(b.handleIn.x, b.handleIn.y);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const est = Math.max(chord, len * 0.75);
      lengths.push(est);
      totalLen += est;
    }

    const effectiveMaxLen = Math.max(
      maxSegLen,
      totalLen / Math.max(1, maxAnchorsPerSubpath - anchors.length)
    );

    const out: AnchorPoint[] = [];
    for (let i = 0; i < segCount; i += 1) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const parts = clamp(Math.ceil(lengths[i] / effectiveMaxLen), 1, 32);
      const seq = splitCubicEqual(a, b, parts);

      if (i === 0) {
        out.push(seq[0]);
      } else {
        out[out.length - 1].handleOut = seq[0].handleOut;
        out[out.length - 1].smooth = false;
      }

      for (let j = 1; j < seq.length - 1; j += 1) {
        out.push(seq[j]);
      }

      const last = seq[seq.length - 1];
      if (i === segCount - 1 && sp.closed) {
        out[0].handleIn = last.handleIn;
        out[0].smooth = false;
      } else {
        out.push(last);
      }
    }

    return { closed: sp.closed, anchors: out };
  });
}

function mapWarpUV(u: number, v: number, warp: WarpEffect): [number, number] {
  const bend = clamp(warp.bend, -100, 100) / 100;
  const dh = clamp(warp.distortH, -100, 100) / 100;
  const dv = clamp(warp.distortV, -100, 100) / 100;

  let nu = u;
  let nv = v;

  if (Math.abs(dh) > 1e-4) {
    nv *= 1 + dh * nu * 0.5;
  }
  if (Math.abs(dv) > 1e-4) {
    nu *= 1 + dv * nv * 0.5;
  }

  if (Math.abs(bend) <= 1e-4) {
    return [nu, nv];
  }

  switch (warp.style) {
    case 'flag': {
      nv += bend * 0.5 * Math.sin(nu * Math.PI);
      break;
    }
    case 'wave': {
      nv += bend * 0.38 * Math.sin(nu * Math.PI * 1.5);
      nu += bend * 0.1 * Math.cos(nv * Math.PI);
      break;
    }
    case 'arc': {
      const s = bend >= 0 ? 1 : -1;
      const absB = Math.abs(bend);
      const maxTheta = absB * Math.PI * 0.45;
      const theta = nu * maxTheta;
      const radius = 1 / Math.max(0.08, absB * 0.72);
      const r = radius - s * nv * 0.45;
      const normX = Math.max(0.15, radius * Math.sin(maxTheta));
      nu = (r * Math.sin(theta)) / normX;
      nv = s * (radius - Math.cos(theta) * r) + (1 - absB * 0.25) * nv * 0.45;
      break;
    }
    case 'arch': {
      nv -= bend * 0.5 * (1 - nu * nu);
      break;
    }
    case 'bulge': {
      const f = 1 + bend * 0.55 * (1 - nu * nu);
      const g = 1 + bend * 0.25 * (1 - nv * nv);
      nv *= f;
      nu *= g;
      break;
    }
    case 'fisheye': {
      const r = Math.hypot(nu, nv);
      const k = 1 + bend * 0.65 * Math.max(0, 1 - r * 0.65);
      nu *= k;
      nv *= k;
      break;
    }
    case 'twist': {
      const r = Math.hypot(nu, nv);
      const angle = bend * Math.PI * 0.85 * Math.max(0, 1 - r * 0.5);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rx = nu * cos - nv * sin;
      const ry = nu * sin + nv * cos;
      nu = rx;
      nv = ry;
      break;
    }
    case 'squeeze': {
      nv *= 1 - bend * 0.5 * (1 - nu * nu);
      nu *= 1 + bend * 0.4 * (1 - nv * nv);
      break;
    }
    case 'rise': {
      nv -= bend * 0.45 * Math.sin(nu * Math.PI * 0.5);
      break;
    }
  }

  return [nu, nv];
}

export function applyWarpToSubPaths(
  subpaths: SubPath[],
  warp: WarpEffect
): SubPath[] {
  if (
    Math.abs(warp.bend) <= 1e-4 &&
    Math.abs(warp.distortH) <= 1e-4 &&
    Math.abs(warp.distortV) <= 1e-4
  ) {
    return subpaths;
  }

  const dense = subdivideSubPaths(subpaths, 14, 220);
  const bbox = computeSubPathsBBox(dense);
  const halfW = Math.max(1, bbox.width / 2);
  const halfH = Math.max(1, bbox.height / 2);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  const mapPt = (pt: Point2D): Point2D => {
    const u = (pt.x - cx) / halfW;
    const v = (pt.y - cy) / halfH;
    const [nu, nv] = mapWarpUV(u, v, warp);
    return {
      x: cx + nu * halfW,
      y: cy + nv * halfH,
    };
  };

  return dense.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => {
      const p = mapPt(a);
      const hi = mapPt({ x: a.x + a.handleIn.x, y: a.y + a.handleIn.y });
      const ho = mapPt({ x: a.x + a.handleOut.x, y: a.y + a.handleOut.y });
      return {
        x: p.x,
        y: p.y,
        handleIn: { x: hi.x - p.x, y: hi.y - p.y },
        handleOut: { x: ho.x - p.x, y: ho.y - p.y },
        smooth: a.smooth,
      };
    }),
  }));
}

function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function applyZigzag(subpaths: SubPath[], size: number, ridges: number, smooth: boolean): SubPath[] {
  const safeRidges = clamp(Math.round(ridges), 1, 30);
  const parts = safeRidges * 2;
  return subpaths.map((sp) => {
    const anchors = sp.anchors;
    if (anchors.length < 2) return { closed: sp.closed, anchors: anchors.map(cloneAnchor) };
    const segCount = sp.closed ? anchors.length : anchors.length - 1;
    const out: AnchorPoint[] = [];

    for (let i = 0; i < segCount; i += 1) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const seq = splitCubicEqual(a, b, parts);
      for (let j = 0; j < seq.length - 1; j += 1) {
        const cur = seq[j];
        const next = seq[j + 1];
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        const len = Math.max(1e-4, Math.hypot(dx, dy));
        const nx = -dy / len;
        const ny = dx / len;
        const dir = j === 0 ? 0 : j % 2 === 1 ? 1 : -1;
        const px = cur.x + nx * size * dir;
        const py = cur.y + ny * size * dir;
        const hLen = smooth ? len * 0.35 : 0;
        const tx = (dx / len) * hLen;
        const ty = (dy / len) * hLen;
        out.push({
          x: px,
          y: py,
          handleIn: smooth ? { x: -tx, y: -ty } : { x: 0, y: 0 },
          handleOut: smooth ? { x: tx, y: ty } : { x: 0, y: 0 },
          smooth,
        });
      }
      if (i === segCount - 1 && !sp.closed) {
        out.push(cloneAnchor(b));
      }
    }

    return { closed: sp.closed, anchors: out };
  });
}

function applyRoughen(subpaths: SubPath[], size: number, detail: number, seed: number): SubPath[] {
  const rand = seededRandom(seed);
  const maxLen = clamp(60 / Math.max(1, detail), 4, 48);
  const dense = subdivideSubPaths(subpaths, maxLen, 260);
  return dense.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => {
      const angle = rand() * Math.PI * 2;
      const mag = (rand() * 2 - 1) * size;
      return {
        x: a.x + Math.cos(angle) * mag,
        y: a.y + Math.sin(angle) * mag,
        handleIn: { x: a.handleIn.x * 0.4, y: a.handleIn.y * 0.4 },
        handleOut: { x: a.handleOut.x * 0.4, y: a.handleOut.y * 0.4 },
        smooth: false,
      };
    }),
  }));
}

function applyRoundCorners(subpaths: SubPath[], radius: number): SubPath[] {
  if (radius <= 0.1) return subpaths;
  const k = 0.55228;
  return subpaths.map((sp) => {
    const anchors = sp.anchors;
    const n = anchors.length;
    if (n < 3) return { closed: sp.closed, anchors: anchors.map(cloneAnchor) };

    const out: AnchorPoint[] = [];
    for (let i = 0; i < n; i += 1) {
      const cur = anchors[i];
      if (!sp.closed && (i === 0 || i === n - 1)) {
        out.push(cloneAnchor(cur));
        continue;
      }

      const prev = anchors[(i - 1 + n) % n];
      const next = anchors[(i + 1) % n];
      const isSharp =
        Math.hypot(cur.handleIn.x, cur.handleIn.y) < 1e-2 &&
        Math.hypot(cur.handleOut.x, cur.handleOut.y) < 1e-2;

      if (!isSharp) {
        out.push(cloneAnchor(cur));
        continue;
      }

      const vInX = prev.x - cur.x;
      const vInY = prev.y - cur.y;
      const vOutX = next.x - cur.x;
      const vOutY = next.y - cur.y;
      const lenIn = Math.hypot(vInX, vInY);
      const lenOut = Math.hypot(vOutX, vOutY);

      if (lenIn < 1e-3 || lenOut < 1e-3) {
        out.push(cloneAnchor(cur));
        continue;
      }

      const d = Math.min(radius, lenIn * 0.45, lenOut * 0.45);
      const uxIn = vInX / lenIn;
      const uyIn = vInY / lenIn;
      const uxOut = vOutX / lenOut;
      const uyOut = vOutY / lenOut;

      const p1 = { x: cur.x + uxIn * d, y: cur.y + uyIn * d };
      const p2 = { x: cur.x + uxOut * d, y: cur.y + uyOut * d };

      out.push({
        x: p1.x,
        y: p1.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: (cur.x - p1.x) * k, y: (cur.y - p1.y) * k },
        smooth: false,
      });
      out.push({
        x: p2.x,
        y: p2.y,
        handleIn: { x: (cur.x - p2.x) * k, y: (cur.y - p2.y) * k },
        handleOut: { x: 0, y: 0 },
        smooth: false,
      });
    }
    return { closed: sp.closed, anchors: out };
  });
}

export function applyDistortToSubPaths(
  subpaths: SubPath[],
  distort: DistortEffect
): SubPath[] {
  if (distort.kind === 'zigzag') {
    return applyZigzag(subpaths, distort.size, distort.ridges, distort.smooth);
  }
  if (distort.kind === 'roughen') {
    return applyRoughen(subpaths, distort.size, distort.detail, distort.seed);
  }
  return applyRoundCorners(subpaths, distort.radius);
}
