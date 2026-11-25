import { getAssetImageElement } from '../core/assets';
import { clamp } from '../core/math';
import type { Point2D, SubPath } from '../core/types';
import { extractSubPath, withHeadlessProject } from './booleans';

export interface ImageTraceOptions {
  mode: 'bw' | 'color';
  threshold?: number; // 0..255, default 140
  colors?: number; // 2..8, default 4
  invert?: boolean;
  simplify?: number; // 0.3..8, default 1.8
  ignoreWhite?: boolean;
}

export interface TracedVectorLayer {
  fill: string;
  subpaths: SubPath[];
  fillRule: 'evenodd';
}

export interface QuantizedPaletteSwatch {
  r: number;
  g: number;
  b: number;
  hex: string;
  count: number;
  weight: number;
}

function toHexChannel(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

/**
 * Детерминированная k-means квантизация видимых RGBA-пикселей (общая для Image Trace и ИИ-палитры).
 */
export function quantizeRgbaPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  k: number
): {
  centers: Array<[number, number, number]>;
  swatches: QuantizedPaletteSwatch[];
  clusterMap: Int16Array;
} {
  const totalPixels = width * height;
  const clusterCount = clamp(Math.round(k), 1, 12);
  const clusterMap = new Int16Array(totalPixels).fill(-1);

  if (totalPixels === 0 || rgba.length < totalPixels * 4) {
    return { centers: [], swatches: [], clusterMap };
  }

  const opaqueIndices: number[] = [];
  for (let i = 0; i < totalPixels; i += 1) {
    if (rgba[i * 4 + 3] >= 128) {
      opaqueIndices.push(i);
    }
  }

  if (opaqueIndices.length === 0) {
    return { centers: [], swatches: [], clusterMap };
  }

  const stride = Math.max(1, Math.floor(opaqueIndices.length / 4096));
  const samples: Array<[number, number, number]> = [];
  for (let i = 0; i < opaqueIndices.length; i += stride) {
    const idx = opaqueIndices[i] * 4;
    samples.push([rgba[idx], rgba[idx + 1], rgba[idx + 2]]);
  }

  const actualK = Math.min(clusterCount, samples.length);
  const centers: Array<[number, number, number]> = [[...samples[0]]];

  // Deterministic farthest-point initialization
  while (centers.length < actualK) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      let minDist = Infinity;
      for (const c of centers) {
        const dr = s[0] - c[0];
        const dg = s[1] - c[1];
        const db = s[2] - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < minDist) minDist = d;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    centers.push([...samples[bestIdx]]);
  }

  // Run 8 k-means iterations on deterministic samples
  for (let iter = 0; iter < 8; iter += 1) {
    const sumR = new Float64Array(actualK);
    const sumG = new Float64Array(actualK);
    const sumB = new Float64Array(actualK);
    const counts = new Uint32Array(actualK);

    for (const s of samples) {
      let bestC = 0;
      let bestDist = Infinity;
      for (let c = 0; c < actualK; c += 1) {
        const ctr = centers[c];
        const dr = s[0] - ctr[0];
        const dg = s[1] - ctr[1];
        const db = s[2] - ctr[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          bestC = c;
        }
      }
      sumR[bestC] += s[0];
      sumG[bestC] += s[1];
      sumB[bestC] += s[2];
      counts[bestC] += 1;
    }

    for (let c = 0; c < actualK; c += 1) {
      if (counts[c] > 0) {
        centers[c] = [sumR[c] / counts[c], sumG[c] / counts[c], sumB[c] / counts[c]];
      }
    }
  }

  const fullCounts = new Uint32Array(actualK);
  for (const pixIdx of opaqueIndices) {
    const off = pixIdx * 4;
    const r = rgba[off];
    const g = rgba[off + 1];
    const b = rgba[off + 2];
    let bestC = 0;
    let bestDist = Infinity;
    for (let c = 0; c < actualK; c += 1) {
      const ctr = centers[c];
      const dr = r - ctr[0];
      const dg = g - ctr[1];
      const db = b - ctr[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        bestC = c;
      }
    }
    clusterMap[pixIdx] = bestC;
    fullCounts[bestC] += 1;
  }

  const totalOpaque = opaqueIndices.length;
  const swatches: QuantizedPaletteSwatch[] = centers.map((ctr, idx) => ({
    r: Math.round(ctr[0]),
    g: Math.round(ctr[1]),
    b: Math.round(ctr[2]),
    hex: rgbToHex(ctr[0], ctr[1], ctr[2]),
    count: fullCounts[idx],
    weight: fullCounts[idx] / Math.max(1, totalOpaque),
  }));

  return { centers, swatches, clusterMap };
}

function keyVertex(x: number, y: number): number {
  return (x & 0xffff) | ((y & 0xffff) << 16);
}

interface DirectedEdge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  used: boolean;
}

function traceMaskLoops(mask: Uint8Array, width: number, height: number): Point2D[][] {
  const edges: DirectedEdge[] = [];
  const outgoing = new Map<number, DirectedEdge[]>();

  const pushEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const edge: DirectedEdge = {
      x0,
      y0,
      x1,
      y1,
      dx: x1 - x0,
      dy: y1 - y0,
      used: false,
    };
    edges.push(edge);
    const k = keyVertex(x0, y0);
    const list = outgoing.get(k);
    if (list) list.push(edge);
    else outgoing.set(k, [edge]);
  };

  const filled = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!filled(x, y)) continue;
      // Clockwise around foreground pixels in Y-down space
      if (!filled(x, y - 1)) pushEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) pushEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) pushEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) pushEdge(x, y + 1, x, y);
    }
  }

  const rawLoops: Point2D[][] = [];

  for (const startEdge of edges) {
    if (startEdge.used) continue;
    const loop: Point2D[] = [{ x: startEdge.x0, y: startEdge.y0 }];
    let cur = startEdge;
    cur.used = true;

    let guard = 0;
    const maxSteps = edges.length + 4;
    while ((cur.x1 !== startEdge.x0 || cur.y1 !== startEdge.y0) && guard < maxSteps) {
      guard += 1;
      loop.push({ x: cur.x1, y: cur.y1 });
      const candidates = outgoing.get(keyVertex(cur.x1, cur.y1))?.filter((e) => !e.used) ?? [];
      if (candidates.length === 0) break;

      let chosen = candidates[0];
      if (candidates.length > 1) {
        // Prefer right turn (in Y-down coords: cross product cur x cand < 0) to resolve saddle vertices cleanly
        const rightTurn = candidates.find(
          (cand) => cur.dx * cand.dy - cur.dy * cand.dx < 0
        );
        if (rightTurn) chosen = rightTurn;
      }

      chosen.used = true;
      cur = chosen;
    }

    if (loop.length >= 4) {
      // Collapse collinear axis-aligned points
      const simplified: Point2D[] = [];
      for (let i = 0; i < loop.length; i += 1) {
        const prev = loop[(i - 1 + loop.length) % loop.length];
        const pt = loop[i];
        const next = loop[(i + 1) % loop.length];
        const collinear =
          (prev.x === pt.x && pt.x === next.x) || (prev.y === pt.y && pt.y === next.y);
        if (!collinear) {
          simplified.push(pt);
        }
      }

      if (simplified.length >= 3) {
        let area2 = 0;
        for (let i = 0; i < simplified.length; i += 1) {
          const a = simplified[i];
          const b = simplified[(i + 1) % simplified.length];
          area2 += a.x * b.y - b.x * a.y;
        }
        if (Math.abs(area2) >= 4) {
          rawLoops.push(simplified);
        }
      }
    }
  }

  return rawLoops;
}

function chaikinSmoothClosed(pts: Point2D[]): Point2D[] {
  if (pts.length < 3) return pts;
  const out: Point2D[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  return out;
}

function loopsToSubPaths(
  loops: Point2D[][],
  imgWidth: number,
  imgHeight: number,
  targetWidth: number,
  targetHeight: number,
  simplifyTolerance: number
): SubPath[] {
  if (loops.length === 0) return [];
  const sx = targetWidth / Math.max(1, imgWidth);
  const sy = targetHeight / Math.max(1, imgHeight);
  const halfW = targetWidth / 2;
  const halfH = targetHeight / 2;

  return withHeadlessProject((scope) => {
    const out: SubPath[] = [];
    for (const loop of loops) {
      const scaled = loop.map((p) => ({
        x: p.x * sx - halfW,
        y: p.y * sy - halfH,
      }));
      const smoothed = chaikinSmoothClosed(scaled);
      const path = new scope.Path({
        segments: smoothed.map((p) => new scope.Point(p.x, p.y)),
        closed: true,
        applyMatrix: false,
        insert: false,
      });
      if (path.segments.length > 3 && simplifyTolerance > 0.05) {
        path.simplify(simplifyTolerance);
      }
      const sp = extractSubPath(path);
      if (sp) out.push(sp);
    }
    return out;
  });
}

function maskAreaCount(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  return count;
}

export function traceRgbaToVectorPaths(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  options?: Partial<ImageTraceOptions>
): TracedVectorLayer[] {
  const mode = options?.mode ?? 'bw';
  const threshold = clamp(options?.threshold ?? 140, 1, 254);
  const invert = Boolean(options?.invert);
  const simplifyTolerance = clamp(options?.simplify ?? 1.8, 0.2, 12);
  const ignoreWhite = options?.ignoreWhite !== false;
  const totalPixels = width * height;
  if (totalPixels === 0 || rgba.length < totalPixels * 4) return [];

  if (mode === 'bw') {
    const mask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i += 1) {
      const off = i * 4;
      if (rgba[off + 3] < 128) continue;
      const lum = 0.2126 * rgba[off] + 0.7152 * rgba[off + 1] + 0.0722 * rgba[off + 2];
      const hit = invert ? lum > threshold : lum < threshold;
      if (hit) mask[i] = 1;
    }
    const loops = traceMaskLoops(mask, width, height);
    const subpaths = loopsToSubPaths(
      loops,
      width,
      height,
      targetWidth,
      targetHeight,
      simplifyTolerance
    );
    if (subpaths.length === 0) return [];
    return [
      {
        fill: invert ? '#ffffff' : '#1c1b1a',
        subpaths,
        fillRule: 'evenodd',
      },
    ];
  }

  const k = clamp(Math.round(options?.colors ?? 4), 2, 8);
  const { swatches, clusterMap } = quantizeRgbaPixels(rgba, width, height, k);
  if (swatches.length === 0) return [];

  // Detect near-white cluster touching border if ignoreWhite is enabled
  const touchesBorder = new Uint8Array(swatches.length);
  for (let x = 0; x < width; x += 1) {
    const topC = clusterMap[x];
    const botC = clusterMap[(height - 1) * width + x];
    if (topC >= 0) touchesBorder[topC] = 1;
    if (botC >= 0) touchesBorder[botC] = 1;
  }
  for (let y = 0; y < height; y += 1) {
    const leftC = clusterMap[y * width];
    const rightC = clusterMap[y * width + width - 1];
    if (leftC >= 0) touchesBorder[leftC] = 1;
    if (rightC >= 0) touchesBorder[rightC] = 1;
  }

  const candidates: Array<{ area: number; fill: string; mask: Uint8Array }> = [];
  for (let c = 0; c < swatches.length; c += 1) {
    const sw = swatches[c];
    if (sw.count < 2) continue;
    const isNearWhite = sw.r >= 242 && sw.g >= 242 && sw.b >= 242;
    if (ignoreWhite && isNearWhite && touchesBorder[c]) continue;

    const mask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i += 1) {
      if (clusterMap[i] === c) mask[i] = 1;
    }
    const area = maskAreaCount(mask);
    if (area < 2) continue;
    candidates.push({ area, fill: sw.hex, mask });
  }

  // Draw largest regions first (bottom), small details on top
  candidates.sort((a, b) => b.area - a.area);

  const out: TracedVectorLayer[] = [];
  for (const item of candidates) {
    const loops = traceMaskLoops(item.mask, width, height);
    const subpaths = loopsToSubPaths(
      loops,
      width,
      height,
      targetWidth,
      targetHeight,
      simplifyTolerance
    );
    if (subpaths.length > 0) {
      out.push({
        fill: item.fill,
        subpaths,
        fillRule: 'evenodd',
      });
    }
  }
  return out;
}

export function rasterizeImageAssetToRgba(
  assetId: string,
  maxDim = 256
): { data: Uint8ClampedArray; width: number; height: number } | null {
  const img = getAssetImageElement(assetId);
  if (!img || typeof document === 'undefined') return null;
  const nw = Math.max(1, img.naturalWidth || img.width || 1);
  const nh = Math.max(1, img.naturalHeight || img.height || 1);
  const scale = Math.min(1, maxDim / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  return { data: imgData.data, width: w, height: h };
}
