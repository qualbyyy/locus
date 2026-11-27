import { getLayerMatrix, type LayerTransform } from '../core/math';
import type { Point2D, SubPath } from '../core/types';

export interface CubicSegment {
  start: Point2D;
  cp1: Point2D;
  cp2: Point2D;
  end: Point2D;
}

export interface MappedPoint extends Point2D {
  /** Исходная локальная точка — чтобы отличать линейный участок от кривой. */
  lx: number;
  ly: number;
}

/**
 * Разбивает SubPath на кубические сегменты Безье. Точки уже пропущены через
 * `map` (перевод в мировые / PDF-координаты). Линейные участки (оба усика
 * нулевые) возвращаются как вырожденные кубики с контрольными точками на
 * 1/3 и 2/3 длины — в SVG/PDF они записываются как `L`.
 */
export function subPathToCubicSegments(
  subpath: SubPath,
  map: (pt: Point2D) => MappedPoint
): CubicSegment[] {
  const anchors = subpath.anchors;
  const segments: CubicSegment[] = [];
  const count = anchors.length;
  const segmentCount = subpath.closed ? count : count - 1;
  if (count < 2 || segmentCount <= 0) {
    return segments;
  }

  for (let i = 0; i < segmentCount; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % count];
    const start = map({ x: a.x, y: a.y });
    const end = map({ x: b.x, y: b.y });
    const isLinear = a.handleOut.x === 0 && a.handleOut.y === 0 && b.handleIn.x === 0 && b.handleIn.y === 0;

    if (isLinear) {
      segments.push({
        start,
        end,
        cp1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
        cp2: { x: start.x + ((end.x - start.x) * 2) / 3, y: start.y + ((end.y - start.y) * 2) / 3 },
      } as CubicSegment);
    } else {
      segments.push({
        start,
        end,
        cp1: map({ x: a.x + a.handleOut.x, y: a.y + a.handleOut.y }),
        cp2: map({ x: b.x + b.handleIn.x, y: b.y + b.handleIn.y }),
      } as CubicSegment);
    }
  }

  return segments;
}

/** Признак «обе контрольные точки лежат на отрезке хорды [0, 1]» — для записи `L` вместо `C`. */
export function isLinearCubic(seg: CubicSegment): boolean {
  const dx = seg.end.x - seg.start.x;
  const dy = seg.end.y - seg.start.y;
  const lenSq = dx * dx + dy * dy;
  const len = Math.sqrt(lenSq);
  if (len < 1e-9) {
    return false;
  }
  // нормаль к хорде
  const nx = -dy / len;
  const ny = dx / len;
  const d1 = Math.abs((seg.cp1.x - seg.start.x) * nx + (seg.cp1.y - seg.start.y) * ny);
  const d2 = Math.abs((seg.cp2.x - seg.start.x) * nx + (seg.cp2.y - seg.start.y) * ny);
  if (d1 >= 1e-6 || d2 >= 1e-6) {
    return false;
  }
  // Если контрольная точка выходит за пределы [start, end] на прямой, кривая даёт петлю/выступ — сохраняем `C`.
  const t1 = ((seg.cp1.x - seg.start.x) * dx + (seg.cp1.y - seg.start.y) * dy) / lenSq;
  const t2 = ((seg.cp2.x - seg.start.x) * dx + (seg.cp2.y - seg.start.y) * dy) / lenSq;
  return t1 >= -1e-6 && t1 <= 1 + 1e-6 && t2 >= -1e-6 && t2 <= 1 + 1e-6;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return '0';
  }
  const fixed = n.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** XML-экранирование значения атрибута / текстового узла. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Строка `d` для SVG по всем subpath (точки уже в целевой системе координат). */
export function buildSvgPathData(
  subpaths: SubPath[],
  map: (pt: Point2D) => MappedPoint
): string {
  const parts: string[] = [];

  for (const subpath of subpaths) {
    const segments = subPathToCubicSegments(subpath, map);
    if (segments.length === 0 && subpath.anchors.length > 0) {
      const only = map(subpath.anchors[0]);
      parts.push(`M${formatNumber(only.x)} ${formatNumber(only.y)}`);
      continue;
    }
    if (segments.length === 0) continue;

    const first = segments[0].start;
    const cmds: string[] = [`M${formatNumber(first.x)} ${formatNumber(first.y)}`];

    for (const seg of segments) {
      if (isLinearCubic(seg)) {
        cmds.push(`L${formatNumber(seg.end.x)} ${formatNumber(seg.end.y)}`);
      } else {
        cmds.push(
          `C${formatNumber(seg.cp1.x)} ${formatNumber(seg.cp1.y)} ` +
            `${formatNumber(seg.cp2.x)} ${formatNumber(seg.cp2.y)} ` +
            `${formatNumber(seg.end.x)} ${formatNumber(seg.end.y)}`
        );
      }
    }

    if (subpath.closed) {
      cmds.push('Z');
    }
    parts.push(cmds.join(''));
  }

  return parts.join('');
}

/** `transform="matrix(...)"` для слоя; `null`, если матрица тождественная. */
export function layerMatrixAttr(layer: LayerTransform): string | null {
  const m = getLayerMatrix(layer);
  if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0) {
    return null;
  }
  return `matrix(${formatNumber(m.a)} ${formatNumber(m.b)} ${formatNumber(m.c)} ${formatNumber(m.d)} ${formatNumber(m.tx)} ${formatNumber(m.ty)})`;
}

/**
 * Разбирает цвет (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) в
 * `[r, g, b, a]` (0..255 / 0..1). Возвращает `null` для неразборчивого значения.
 */
export function parseColorToRgba(color: string): [number, number, number, number] | null {
  const trimmed = color.trim();
  const hexMatch = trimmed.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length <= 4) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }

  const fnMatch = trimmed.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (fnMatch) {
    const nums = fnMatch[1]
      .split(/[\s,\/]+/)
      .filter(Boolean)
      .map((part, idx) => {
        if (!part.endsWith('%')) return parseFloat(part);
        const pct = parseFloat(part) / 100;
        return idx < 3 ? pct * 255 : pct;
      });
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) {
      const a = nums.length >= 4 ? Math.min(1, Math.max(0, nums[3])) : 1;
      return [
        Math.min(255, Math.max(0, nums[0])),
        Math.min(255, Math.max(0, nums[1])),
        Math.min(255, Math.max(0, nums[2])),
        a,
      ];
    }
  }

  return null;
}

export function colorToCssRgb(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'none' || trimmed === 'transparent') {
    return 'none';
  }
  const rgba = parseColorToRgba(color);
  if (!rgba) {
    return '#000000';
  }
  const [r, g, b] = rgba;
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
