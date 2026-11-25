import { clamp, degToRad, radToDeg } from './math';
import type {
  BBox,
  BlendMode,
  GradientPaint,
  GradientStop,
  Paint,
  Point2D,
  StrokeStyle,
} from './types';

export const BLEND_MODE_OPTIONS: ReadonlyArray<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: 'Обычный' },
  { value: 'multiply', label: 'Умножение' },
  { value: 'screen', label: 'Экран' },
  { value: 'overlay', label: 'Перекрытие' },
  { value: 'darken', label: 'Затемнение' },
  { value: 'lighten', label: 'Осветление' },
  { value: 'color-dodge', label: 'Осветление основы' },
  { value: 'color-burn', label: 'Затемнение основы' },
  { value: 'hard-light', label: 'Жёсткий свет' },
  { value: 'soft-light', label: 'Мягкий свет' },
  { value: 'difference', label: 'Разница' },
  { value: 'exclusion', label: 'Исключение' },
  { value: 'hue', label: 'Цветовой тон' },
  { value: 'saturation', label: 'Насыщенность' },
  { value: 'color', label: 'Цветность' },
  { value: 'luminosity', label: 'Яркость' },
];

const BLEND_MODE_SET = new Set<string>(BLEND_MODE_OPTIONS.map((opt) => opt.value));

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODE_SET.has(value);
}

export function isGradientPaint(
  paint: Paint | null | undefined
): paint is GradientPaint {
  return (
    typeof paint === 'object' &&
    paint !== null &&
    (paint.kind === 'linear' || paint.kind === 'radial') &&
    Array.isArray(paint.stops)
  );
}

export function normalizeGradientStops(stops: GradientStop[]): GradientStop[] {
  const cleaned = stops
    .filter((s) => s && typeof s.color === 'string' && Number.isFinite(s.offset))
    .map((s) => ({
      offset: clamp(s.offset, 0, 1),
      color: s.color,
      ...(s.opacity !== undefined && Number.isFinite(s.opacity) && s.opacity < 1
        ? { opacity: clamp(s.opacity, 0, 1) }
        : {}),
    }))
    .sort((a, b) => a.offset - b.offset);

  if (cleaned.length === 0) {
    return [
      { offset: 0, color: '#da7756' },
      { offset: 1, color: '#2563eb' },
    ];
  }
  if (cleaned.length === 1) {
    const only = cleaned[0];
    return [
      { ...only, offset: 0 },
      { ...only, offset: 1 },
    ];
  }
  return cleaned;
}

export function clonePaint<T extends Paint | null>(paint: T): T {
  if (!paint || typeof paint === 'string') return paint;
  return {
    kind: paint.kind,
    stops: paint.stops.map((s) => ({
      offset: s.offset,
      color: s.color,
      ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
    })),
    start: { x: paint.start.x, y: paint.start.y },
    end: { x: paint.end.x, y: paint.end.y },
  } as T;
}

export function sanitizeDashArray(arr: number[] | undefined): number[] | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const cleaned = arr.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function cloneStroke(stroke: StrokeStyle | null): StrokeStyle | null {
  if (!stroke) return null;
  const dashArray = sanitizeDashArray(stroke.dashArray);
  return {
    color: clonePaint(stroke.color),
    width: stroke.width,
    ...(stroke.lineCap ? { lineCap: stroke.lineCap } : {}),
    ...(stroke.lineJoin ? { lineJoin: stroke.lineJoin } : {}),
    ...(dashArray ? { dashArray } : {}),
    ...(stroke.dashOffset !== undefined && Number.isFinite(stroke.dashOffset)
      ? { dashOffset: stroke.dashOffset }
      : {}),
  };
}

export function getPrimaryColor(
  paint: Paint | null | undefined,
  fallback = '#da7756'
): string {
  if (!paint) return fallback;
  if (typeof paint === 'string') return paint;
  return paint.stops[0]?.color ?? fallback;
}

function defaultSecondStopColor(baseHex: string): string {
  const clean = baseHex.trim().toLowerCase();
  if (clean === '#1c1b1a' || clean === '#000000') return '#da7756';
  if (clean === '#2563eb') return '#7c3aed';
  return '#2563eb';
}

export function createDefaultLinearGradient(baseHex = '#da7756'): GradientPaint {
  const c0 = baseHex || '#da7756';
  return {
    kind: 'linear',
    stops: [
      { offset: 0, color: c0 },
      { offset: 1, color: defaultSecondStopColor(c0) },
    ],
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
  };
}

export function createDefaultRadialGradient(baseHex = '#da7756'): GradientPaint {
  const c0 = baseHex || '#da7756';
  return {
    kind: 'radial',
    stops: [
      { offset: 0, color: c0 },
      { offset: 1, color: defaultSecondStopColor(c0) },
    ],
    start: { x: 0.5, y: 0.5 },
    end: { x: 1, y: 0.5 },
  };
}

export function getGradientAngleDeg(grad: GradientPaint): number {
  const dx = grad.end.x - grad.start.x;
  const dy = grad.end.y - grad.start.y;
  const deg = radToDeg(Math.atan2(dy, dx));
  return ((deg % 360) + 360) % 360;
}

export function setGradientAngleDeg(
  grad: GradientPaint,
  angleDeg: number
): GradientPaint {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  if (grad.kind === 'radial') {
    const radius = Math.max(
      0.1,
      Math.hypot(grad.end.x - grad.start.x, grad.end.y - grad.start.y)
    );
    return {
      ...clonePaint(grad),
      end: {
        x: grad.start.x + cos * radius,
        y: grad.start.y + sin * radius,
      },
    };
  }

  const cx = (grad.start.x + grad.end.x) / 2;
  const cy = (grad.start.y + grad.end.y) / 2;
  const halfLen = Math.max(
    0.1,
    Math.hypot(grad.end.x - grad.start.x, grad.end.y - grad.start.y) / 2
  );
  return {
    ...clonePaint(grad),
    start: { x: cx - cos * halfLen, y: cy - sin * halfLen },
    end: { x: cx + cos * halfLen, y: cy + sin * halfLen },
  };
}

export function resolveGradientEndpoints(
  grad: GradientPaint,
  box: BBox
): { origin: Point2D; destination: Point2D; radius: number } {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const origin = {
    x: box.x + grad.start.x * w,
    y: box.y + grad.start.y * h,
  };
  const destination = {
    x: box.x + grad.end.x * w,
    y: box.y + grad.end.y * h,
  };
  const radius = Math.max(
    0.001,
    Math.hypot(destination.x - origin.x, destination.y - origin.y)
  );
  return { origin, destination, radius };
}

export function localPointToNormalized(pt: Point2D, box: BBox): Point2D {
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  return {
    x: clamp((pt.x - box.x) / w, -1.5, 2.5),
    y: clamp((pt.y - box.y) / h, -1.5, 2.5),
  };
}

function stopCssColor(stop: GradientStop): string {
  const opacity = stop.opacity;
  if (opacity === undefined || opacity >= 0.999) {
    return stop.color;
  }
  const m = stop.color.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return stop.color;
  const hex = m[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1).toFixed(3)})`;
}

export function gradientToCss(grad: GradientPaint): string {
  const stops = normalizeGradientStops(grad.stops);
  const stopList = stops
    .map((s) => `${stopCssColor(s)} ${Math.round(s.offset * 1000) / 10}%`)
    .join(', ');
  return `linear-gradient(90deg, ${stopList})`;
}

export function paintEquals(
  a: Paint | null | undefined,
  b: Paint | null | undefined
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  if (typeof a === 'string' || typeof b === 'string') return false;
  if (a.kind !== b.kind) return false;
  if (
    Math.abs(a.start.x - b.start.x) > 1e-4 ||
    Math.abs(a.start.y - b.start.y) > 1e-4 ||
    Math.abs(a.end.x - b.end.x) > 1e-4 ||
    Math.abs(a.end.y - b.end.y) > 1e-4
  ) {
    return false;
  }
  const stopsA = normalizeGradientStops(a.stops);
  const stopsB = normalizeGradientStops(b.stops);
  if (stopsA.length !== stopsB.length) return false;
  for (let i = 0; i < stopsA.length; i += 1) {
    const sa = stopsA[i];
    const sb = stopsB[i];
    if (
      Math.abs(sa.offset - sb.offset) > 1e-4 ||
      sa.color.trim().toLowerCase() !== sb.color.trim().toLowerCase() ||
      Math.abs((sa.opacity ?? 1) - (sb.opacity ?? 1)) > 1e-4
    ) {
      return false;
    }
  }
  return true;
}
