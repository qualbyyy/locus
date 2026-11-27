import { clamp } from '../../core/math';
import { localPointToNormalized, normalizeGradientStops } from '../../core/paint';
import type { BBox, GradientStop, Paint, Point2D } from '../../core/types';
import { parseStyleDeclarations, serializeStyleDeclarations } from './cssInline';

const CSS_NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  coral: '#ff7f50',
  crimson: '#dc143c',
  tomato: '#ff6347',
  salmon: '#fa8072',
  indigo: '#4b0082',
  violet: '#ee82ee',
  rebeccapurple: '#663399',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkblue: '#00008b',
  darkgreen: '#006400',
  darkred: '#8b0000',
  lightblue: '#add8e6',
  lightgreen: '#90ee90',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  slategray: '#708090',
  slategrey: '#708090',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  wheat: '#f5deb3',
  tan: '#d2b48c',
  plum: '#dda0dd',
  orchid: '#da70d6',
  turquoise: '#40e0d0',
  chocolate: '#d2691e',
  sienna: '#a0522d',
  peru: '#cd853f',
};

const COLOR_STYLE_PROPS = new Set(['color', 'fill', 'stroke', 'stop-color']);

function hslToRgbCss(raw: string): string | null {
  const match = raw.match(/^hsla?\(\s*([^)]+)\s*\)$/i);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;

  let hue = Number.parseFloat(parts[0]);
  const satRaw = Number.parseFloat(parts[1]);
  const lightRaw = Number.parseFloat(parts[2]);
  if (!Number.isFinite(hue) || !Number.isFinite(satRaw) || !Number.isFinite(lightRaw)) {
    return null;
  }

  hue = ((hue % 360) + 360) % 360;
  const s = clamp(satRaw / 100, 0, 1);
  const l = clamp(lightRaw / 100, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 60) [r1, g1, b1] = [c, x, 0];
  else if (hue < 120) [r1, g1, b1] = [x, c, 0];
  else if (hue < 180) [r1, g1, b1] = [0, c, x];
  else if (hue < 240) [r1, g1, b1] = [0, x, c];
  else if (hue < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  if (parts.length >= 4) {
    const alphaRaw = parts[3].endsWith('%')
      ? Number.parseFloat(parts[3]) / 100
      : Number.parseFloat(parts[3]);
    if (Number.isFinite(alphaRaw)) {
      return `rgba(${r},${g},${b},${clamp(alphaRaw, 0, 1)})`;
    }
  }
  return `rgb(${r},${g},${b})`;
}

function normalizeCssColorValue(value: string, inheritedColor: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower === 'currentcolor') return inheritedColor;
  if (lower === 'transparent') return 'none';
  if (Object.prototype.hasOwnProperty.call(CSS_NAMED_COLORS, lower)) {
    return CSS_NAMED_COLORS[lower];
  }
  if (lower.startsWith('hsl')) {
    return hslToRgbCss(trimmed) ?? trimmed;
  }
  return trimmed;
}

export function normalizeElementColors(el: Element, parentColor: string): void {
  let currentColor = parentColor;

  const rawColorAttr = el.getAttribute('color');
  if (rawColorAttr) {
    const normalized = normalizeCssColorValue(rawColorAttr, parentColor);
    if (normalized !== 'none' && normalized !== 'inherit') {
      currentColor = normalized;
    }
    el.setAttribute('color', normalized);
  }

  const rawStyle = el.getAttribute('style');
  if (rawStyle) {
    const entries = parseStyleDeclarations(rawStyle);
    for (const entry of entries) {
      if (entry[0] === 'color') {
        const normalized = normalizeCssColorValue(entry[1], parentColor);
        if (normalized !== 'none' && normalized !== 'inherit') {
          currentColor = normalized;
        }
        entry[1] = normalized;
      }
    }
    for (const entry of entries) {
      if (entry[0] !== 'color' && COLOR_STYLE_PROPS.has(entry[0])) {
        entry[1] = normalizeCssColorValue(entry[1], currentColor);
      }
    }
    el.setAttribute('style', serializeStyleDeclarations(entries));
  }

  for (const attr of ['fill', 'stroke', 'stop-color']) {
    const val = el.getAttribute(attr);
    if (val) {
      el.setAttribute(attr, normalizeCssColorValue(val, currentColor));
    }
  }

  for (const child of Array.from(el.children)) {
    normalizeElementColors(child, currentColor);
  }
}

function toHexByte(v: number): string {
  return clamp(Math.round(v * 255), 0, 255)
    .toString(16)
    .padStart(2, '0');
}

function extractPaperColor(
  color: paper.Color | null | undefined,
  onGradient?: () => void
): { hex: string; alpha: number } | null {
  if (!color) return null;
  let target: paper.Color | undefined = color;
  if (color.type === 'gradient') {
    onGradient?.();
    target = color.gradient?.stops?.[0]?.color;
    if (!target) return null;
  }
  const alpha = clamp(Number.isFinite(target.alpha) ? target.alpha : 1, 0, 1);
  if (alpha <= 1e-4) return null;
  const hex = `#${toHexByte(target.red ?? 0)}${toHexByte(target.green ?? 0)}${toHexByte(target.blue ?? 0)}`;
  return { hex, alpha };
}

export function extractPaperPaint(
  color: paper.Color | null | undefined,
  worldMatrix: paper.Matrix,
  originOffset: Point2D,
  localBox: BBox,
  onFallback?: () => void
): { paint: Paint; alpha: number } | null {
  if (!color) return null;
  if (
    color.type === 'gradient' &&
    color.gradient &&
    color.origin &&
    color.destination
  ) {
    const rawStops = color.gradient.stops ?? [];
    const stops: GradientStop[] = [];
    for (let i = 0; i < rawStops.length; i += 1) {
      const stop = rawStops[i];
      const stopColor = typeof stop.color === 'string' ? null : stop.color;
      if (!stopColor) continue;
      const alpha = clamp(
        Number.isFinite(stopColor.alpha) ? stopColor.alpha : 1,
        0,
        1
      );
      const hex = `#${toHexByte(stopColor.red ?? 0)}${toHexByte(stopColor.green ?? 0)}${toHexByte(stopColor.blue ?? 0)}`;
      const offset = Number.isFinite(stop.offset)
        ? clamp(stop.offset, 0, 1)
        : i / Math.max(1, rawStops.length - 1);
      stops.push({
        offset,
        color: hex,
        ...(alpha < 0.999 ? { opacity: Number(alpha.toFixed(3)) } : {}),
      });
    }

    if (stops.length >= 2) {
      const worldOrigin = worldMatrix.transform(color.origin);
      const worldDest = worldMatrix.transform(color.destination);
      const start = localPointToNormalized(
        {
          x: worldOrigin.x - originOffset.x,
          y: worldOrigin.y - originOffset.y,
        },
        localBox
      );
      const end = localPointToNormalized(
        {
          x: worldDest.x - originOffset.x,
          y: worldDest.y - originOffset.y,
        },
        localBox
      );
      if (
        Number.isFinite(start.x) &&
        Number.isFinite(start.y) &&
        Number.isFinite(end.x) &&
        Number.isFinite(end.y)
      ) {
        return {
          paint: {
            kind: color.gradient.radial ? 'radial' : 'linear',
            stops: normalizeGradientStops(stops),
            start,
            end,
          },
          alpha: 1,
        };
      }
    }
  }

  const flat = extractPaperColor(color, onFallback);
  return flat ? { paint: flat.hex, alpha: flat.alpha } : null;
}
