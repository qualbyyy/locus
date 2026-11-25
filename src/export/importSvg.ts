import paper from 'paper/dist/paper-core';
import { inferImageMimeType, registerAssetFromBytes } from '../core/assets';
import { createLayerId } from '../core/commands/helpers';
import { BUILTIN_FONTS, getProjectFonts } from '../core/fonts';
import {
  applyMatrixToPoint,
  centerSubPathsAtOrigin,
  clamp,
  computeCombinedWorldBBox,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  type Matrix2D,
} from '../core/math';
import {
  isBlendMode,
  localPointToNormalized,
  normalizeGradientStops,
  sanitizeDashArray,
} from '../core/paint';
import type {
  AnchorPoint,
  BBox,
  BlendMode,
  FontFamily,
  GradientStop,
  ImageLayer,
  Layer,
  Paint,
  PathLayer,
  Point2D,
  StrokeStyle,
  SubPath,
  TextLayer,
} from '../core/types';

export interface ImportSvgOptions {
  fileName?: string;
  targetArtboard?: { width: number; height: number };
  fitToArtboard?: boolean;
  centerInArtboard?: boolean;
}

export interface ImportedSvgResult {
  layers: Layer[];
  sourceWidth: number;
  sourceHeight: number;
  warnings: string[];
}

interface SvgImageMeta {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImportedItemMeta {
  svgTag?: string;
  svgName?: string;
  nonScalingStroke?: boolean;
  letterSpacing?: number;
  lineDeltaY?: number;
  firstTspanOffsetX?: number;
  firstTspanOffsetY?: number;
  blendMode?: BlendMode;
  svgImage?: SvgImageMeta;
}

interface PendingImage {
  meta: SvgImageMeta;
  matrix: Matrix2D;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blendMode?: BlendMode;
  visible: boolean;
  name: string;
  clipMaskId?: string;
}

interface PendingImageToken {
  __pendingImageIndex: number;
}

type CollectedEntry = Layer | PendingImageToken;

function isPendingImageToken(entry: CollectedEntry): entry is PendingImageToken {
  return '__pendingImageIndex' in entry;
}

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

function isCollinearOpposite(
  inX: number,
  inY: number,
  outX: number,
  outY: number
): boolean {
  const lenIn = Math.hypot(inX, inY);
  const lenOut = Math.hypot(outX, outY);
  if (lenIn <= 1e-3 || lenOut <= 1e-3) {
    return false;
  }
  const dot = (inX * outX + inY * outY) / (lenIn * lenOut);
  return dot < -0.995;
}

function parseSvgNumericLength(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.endsWith('%')) return null;
  const match = trimmed.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?$/i);
  if (!match) return null;
  const val = Number.parseFloat(match[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = (match[2] || 'px').toLowerCase();
  const unitScale: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
  };
  return val * (unitScale[unit] ?? 1);
}

function parseViewBox(raw: string | null): { width: number; height: number } | null {
  if (!raw) return null;
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));
  if (
    parts.length === 4 &&
    parts.every((n) => Number.isFinite(n)) &&
    parts[2] > 0 &&
    parts[3] > 0
  ) {
    return { width: parts[2], height: parts[3] };
  }
  return null;
}

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
  if (CSS_NAMED_COLORS[lower]) return CSS_NAMED_COLORS[lower];
  if (lower.startsWith('hsl')) {
    return hslToRgbCss(trimmed) ?? trimmed;
  }
  return trimmed;
}

function parseStyleDeclarations(styleText: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const chunk of styleText.split(';')) {
    const colonIdx = chunk.indexOf(':');
    if (colonIdx <= 0) continue;
    const prop = chunk.slice(0, colonIdx).trim().toLowerCase();
    const val = chunk.slice(colonIdx + 1).trim();
    if (prop && val) {
      result.push([prop, val]);
    }
  }
  return result;
}

function serializeStyleDeclarations(entries: Array<[string, string]>): string {
  return entries.map(([prop, val]) => `${prop}: ${val}`).join('; ');
}

function inlineSvgStyles(svgEl: SVGSVGElement): void {
  const styleNodes = Array.from(svgEl.querySelectorAll('style'));
  if (styleNodes.length === 0) return;

  const rawCss = styleNodes
    .map((node) => node.textContent ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[^{]+(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|;)/g, '');

  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const elementPrepends = new Map<Element, string[]>();
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(rawCss)) !== null) {
    const selectorsRaw = match[1].trim();
    const decls = match[2].trim();
    if (!selectorsRaw || !decls) continue;

    for (const sel of selectorsRaw.split(',')) {
      const selector = sel.trim();
      if (!selector) continue;
      try {
        const matched = svgEl.querySelectorAll(selector);
        for (const el of matched) {
          const list = elementPrepends.get(el) ?? [];
          list.push(decls);
          elementPrepends.set(el, list);
        }
      } catch {
        // Игнорируем неподдерживаемые CSS-селекторы.
      }
    }
  }

  for (const [el, declsList] of elementPrepends) {
    const existing = el.getAttribute('style')?.trim() ?? '';
    const merged = existing
      ? `${declsList.join('; ')}; ${existing}`
      : declsList.join('; ');
    el.setAttribute('style', merged);
  }

  for (const node of styleNodes) {
    node.remove();
  }
}

function normalizeElementColors(el: Element, parentColor: string): void {
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

function extractInlineStyleProp(el: Element, propName: string): string | null {
  const styleAttr = el.getAttribute('style');
  if (!styleAttr) return null;
  let found: string | null = null;
  for (const [prop, val] of parseStyleDeclarations(styleAttr)) {
    if (prop === propName) {
      found = val;
    }
  }
  return found;
}

function readSvgTextMeta(node: Element): Partial<ImportedItemMeta> {
  const lsRaw =
    extractInlineStyleProp(node, 'letter-spacing') ??
    node.getAttribute('letter-spacing');
  const parsedLs = lsRaw ? Number.parseFloat(lsRaw) : NaN;

  const tspans = Array.from(node.querySelectorAll('tspan'));
  const firstTspan = tspans[0];
  const hasOwnX = node.getAttribute('x') !== null;
  const hasOwnY = node.getAttribute('y') !== null;

  const firstTspanOffsetX =
    !hasOwnX && firstTspan
      ? Number.parseFloat(firstTspan.getAttribute('x') ?? '0') || 0
      : 0;
  const firstTspanOffsetY =
    !hasOwnY && firstTspan
      ? Number.parseFloat(firstTspan.getAttribute('y') ?? '0') || 0
      : 0;

  let lineDeltaY: number | undefined;
  if (tspans.length >= 2) {
    const y0 = Number.parseFloat(tspans[0].getAttribute('y') ?? '');
    const y1 = Number.parseFloat(tspans[1].getAttribute('y') ?? '');
    if (Number.isFinite(y0) && Number.isFinite(y1) && y1 - y0 > 0) {
      lineDeltaY = y1 - y0;
    } else {
      const dy1 = Number.parseFloat(tspans[1].getAttribute('dy') ?? '');
      if (Number.isFinite(dy1) && dy1 > 0) {
        lineDeltaY = dy1;
      }
    }
  }

  return {
    letterSpacing: Number.isFinite(parsedLs) ? parsedLs : undefined,
    lineDeltaY,
    firstTspanOffsetX: firstTspanOffsetX || undefined,
    firstTspanOffsetY: firstTspanOffsetY || undefined,
  };
}

function readSvgImageMeta(node: Element): SvgImageMeta | undefined {
  const href =
    node.getAttribute('href') ??
    node.getAttribute('xlink:href') ??
    node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    '';
  if (!href) return undefined;

  return {
    href: href.trim(),
    x: Number.parseFloat(node.getAttribute('x') ?? '0') || 0,
    y: Number.parseFloat(node.getAttribute('y') ?? '0') || 0,
    width: Number.parseFloat(node.getAttribute('width') ?? '0') || 0,
    height: Number.parseFloat(node.getAttribute('height') ?? '0') || 0,
  };
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

function extractPaperPaint(
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
      const stopColor =
        typeof stop.color === 'string'
          ? null
          : stop.color;
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

function readNodeBlendMode(node: SVGElement): BlendMode | undefined {
  const inlineProp = node.style?.mixBlendMode?.trim().toLowerCase();
  if (isBlendMode(inlineProp) && inlineProp !== 'normal') {
    return inlineProp;
  }
  const styleAttr = node.getAttribute('style');
  if (styleAttr) {
    const m = styleAttr.match(/mix-blend-mode\s*:\s*([^;]+)/i);
    const val = m?.[1]?.trim().toLowerCase();
    if (isBlendMode(val) && val !== 'normal') {
      return val;
    }
  }
  const attr = node.getAttribute('mix-blend-mode')?.trim().toLowerCase();
  if (isBlendMode(attr) && attr !== 'normal') {
    return attr;
  }
  return undefined;
}

function extractWorldSubPath(
  path: paper.Path,
  matrix: paper.Matrix
): SubPath | null {
  if (path.segments.length < 2) return null;
  const anchors: AnchorPoint[] = path.segments.map((seg) => {
    const p = matrix.transform(seg.point);
    const absIn = matrix.transform(seg.point.add(seg.handleIn));
    const absOut = matrix.transform(seg.point.add(seg.handleOut));
    const inX = absIn.x - p.x;
    const inY = absIn.y - p.y;
    const outX = absOut.x - p.x;
    const outY = absOut.y - p.y;
    return {
      x: p.x,
      y: p.y,
      handleIn: { x: inX, y: inY },
      handleOut: { x: outX, y: outY },
      smooth: isCollinearOpposite(inX, inY, outX, outY),
    };
  });

  return {
    closed: path.closed,
    anchors,
  };
}

function extractWorldSubPathsFromItem(
  scope: paper.PaperScope,
  item: paper.Item,
  parentMatrix: paper.Matrix
): SubPath[] {
  if (item instanceof scope.Shape) {
    const path = item.toPath(false);
    const mat = parentMatrix.appended(path.matrix);
    const sp = extractWorldSubPath(path, mat);
    return sp ? [sp] : [];
  }

  if (item instanceof scope.Path) {
    const mat = parentMatrix.appended(item.matrix);
    const sp = extractWorldSubPath(item, mat);
    return sp ? [sp] : [];
  }

  if (item instanceof scope.CompoundPath) {
    const compoundMat = parentMatrix.appended(item.matrix);
    const out: SubPath[] = [];
    for (const child of item.children) {
      if (child instanceof scope.Path) {
        const sp = extractWorldSubPath(child, compoundMat.appended(child.matrix));
        if (sp) out.push(sp);
      }
    }
    return out;
  }

  return [];
}

function isValidSubPaths(subpaths: SubPath[]): boolean {
  if (subpaths.length === 0) return false;
  const bbox = computeSubPathsBBox(subpaths);
  return bbox.width > 1e-4 || bbox.height > 1e-4;
}

function mapLineCap(raw: string | undefined): StrokeStyle['lineCap'] {
  if (raw === 'butt' || raw === 'round' || raw === 'square') return raw;
  return 'round';
}

function mapLineJoin(raw: string | undefined): StrokeStyle['lineJoin'] {
  if (raw === 'miter' || raw === 'round' || raw === 'bevel') return raw;
  return 'round';
}

function resolveFontFamily(raw: string | undefined): FontFamily {
  if (!raw) return 'Inter';
  const candidates = raw
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);

  const customFonts = getProjectFonts();
  for (const cand of candidates) {
    const customMatch = customFonts.find((f) => f.family.toLowerCase() === cand);
    if (customMatch) return customMatch.family;
    const match = BUILTIN_FONTS.find((f) => f.family.toLowerCase() === cand);
    if (match) return match.family;
  }
  return 'Inter';
}

function resolveFontWeight(raw: string | number | undefined): 400 | 700 {
  if (typeof raw === 'number') {
    return raw >= 600 ? 700 : 400;
  }
  const str = String(raw ?? '').trim().toLowerCase();
  if (str === 'bold' || str === 'bolder') return 700;
  const num = Number.parseFloat(str);
  return Number.isFinite(num) && num >= 600 ? 700 : 400;
}

function decodeDataImageUrl(href: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = href.match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;[^,]*)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';

  try {
    if (isBase64) {
      const binary = atob(payload.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, mimeType };
    }
    const decoded = decodeURIComponent(payload);
    return { bytes: new TextEncoder().encode(decoded), mimeType };
  } catch {
    return null;
  }
}

function scaleAndCenterLayers(
  layers: Layer[],
  targetArtboard: { width: number; height: number },
  fitToArtboard: boolean,
  centerInArtboard: boolean
): Layer[] {
  if (layers.length === 0) return layers;

  const visibleLayers = layers.filter((layer) => layer.visible);
  const bbox = computeCombinedWorldBBox(visibleLayers.length > 0 ? visibleLayers : layers);
  if (bbox.width <= 1e-4 && bbox.height <= 1e-4) {
    return layers;
  }

  let fitScale = 1;
  if (
    fitToArtboard &&
    (bbox.width > targetArtboard.width * 0.85 || bbox.height > targetArtboard.height * 0.85)
  ) {
    fitScale = Math.min(
      (targetArtboard.width * 0.85) / Math.max(1e-4, bbox.width),
      (targetArtboard.height * 0.85) / Math.max(1e-4, bbox.height)
    );
  }

  if (Math.abs(fitScale - 1) <= 1e-4 && !centerInArtboard) {
    return layers;
  }

  const srcCx = bbox.x + bbox.width / 2;
  const srcCy = bbox.y + bbox.height / 2;
  const dstCx = centerInArtboard ? targetArtboard.width / 2 : srcCx;
  const dstCy = centerInArtboard ? targetArtboard.height / 2 : srcCy;

  return layers.map((layer) => {
    const nextX = dstCx + (layer.x - srcCx) * fitScale;
    const nextY = dstCy + (layer.y - srcCy) * fitScale;

    if (Math.abs(fitScale - 1) <= 1e-4) {
      return { ...layer, x: nextX, y: nextY };
    }

    if (layer.type === 'path') {
      return {
        ...layer,
        x: nextX,
        y: nextY,
        subpaths: layer.subpaths.map((sp) => ({
          closed: sp.closed,
          anchors: sp.anchors.map((a) => ({
            x: a.x * fitScale,
            y: a.y * fitScale,
            handleIn: { x: a.handleIn.x * fitScale, y: a.handleIn.y * fitScale },
            handleOut: { x: a.handleOut.x * fitScale, y: a.handleOut.y * fitScale },
            smooth: a.smooth,
          })),
        })),
        stroke: layer.stroke
          ? {
              ...layer.stroke,
              width: Math.max(0.25, Number((layer.stroke.width * fitScale).toFixed(2))),
              ...(layer.stroke.dashArray
                ? {
                    dashArray: layer.stroke.dashArray.map((d) =>
                      Math.max(0.25, Number((d * fitScale).toFixed(2)))
                    ),
                  }
                : {}),
              ...(typeof layer.stroke.dashOffset === 'number'
                ? {
                    dashOffset: Number((layer.stroke.dashOffset * fitScale).toFixed(2)),
                  }
                : {}),
            }
          : null,
      };
    }

    if (layer.type === 'text') {
      return {
        ...layer,
        x: nextX,
        y: nextY,
        fontSize: clamp(Number((layer.fontSize * fitScale).toFixed(2)), 4, 2000),
        letterSpacing:
          typeof layer.letterSpacing === 'number'
            ? Number((layer.letterSpacing * fitScale).toFixed(2))
            : undefined,
      };
    }

    return {
      ...layer,
      x: nextX,
      y: nextY,
      scaleX: layer.scaleX * fitScale,
      scaleY: layer.scaleY * fitScale,
    };
  });
}

interface DecomposedMatrix {
  rotation?: number;
  scaling?: { x: number; y: number };
}

function decomposePaperMatrix(matrix: paper.Matrix): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const dec = matrix.decompose() as DecomposedMatrix | null | undefined;
  return {
    rotation:
      typeof dec?.rotation === 'number' && Number.isFinite(dec.rotation)
        ? dec.rotation
        : 0,
    scaleX: dec?.scaling?.x || 1,
    scaleY: dec?.scaling?.y || 1,
  };
}

export async function parseSvgToLayers(
  svgText: string,
  options: ImportSvgOptions = {}
): Promise<ImportedSvgResult> {
  const trimmed = svgText.trim();
  if (!trimmed) {
    throw new Error('SVG-файл пуст');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  const rootEl = doc.documentElement;
  const svgEl =
    rootEl && rootEl.tagName.toLowerCase() === 'svg'
      ? (rootEl as unknown as SVGSVGElement)
      : (doc.querySelector('svg') as SVGSVGElement | null);

  if (parseError || !svgEl) {
    throw new Error('Некорректный SVG-файл: не найден корневой элемент <svg>');
  }

  const parsedWidth = parseSvgNumericLength(svgEl.getAttribute('width'));
  const parsedHeight = parseSvgNumericLength(svgEl.getAttribute('height'));
  const viewBox = parseViewBox(svgEl.getAttribute('viewBox'));

  if (viewBox) {
    if (!parsedWidth) {
      svgEl.setAttribute('width', String(viewBox.width));
    }
    if (!parsedHeight) {
      svgEl.setAttribute('height', String(viewBox.height));
    }
  }

  let sourceWidth = parsedWidth ?? viewBox?.width ?? 0;
  let sourceHeight = parsedHeight ?? viewBox?.height ?? 0;

  for (const script of Array.from(svgEl.querySelectorAll('script'))) {
    script.remove();
  }
  inlineSvgStyles(svgEl);
  normalizeElementColors(svgEl, '#000000');

  const warningsSet = new Set<string>();
  const addWarning = (msg: string) => warningsSet.add(msg);

  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  const project = new scope.Project(undefined as unknown as HTMLCanvasElement);

  const collected: CollectedEntry[] = [];
  const pendingImages: PendingImage[] = [];
  let pathCounter = 0;
  let textCounter = 0;
  let imageCounter = 0;
  let maskCounter = 0;

  try {
    const importOptions: Record<string, unknown> = {
      expandShapes: true,
      insert: false,
      applyMatrix: false,
      onImport(node: SVGElement, item: paper.Item) {
        if (!item) return item;
        const svgTag = node.tagName.toLowerCase();
        const svgName =
          node.getAttribute('inkscape:label') ||
          node.getAttribute('data-name') ||
          node.getAttribute('id') ||
          undefined;
        const meta: ImportedItemMeta = {
          svgTag,
          svgName: svgName?.trim() || undefined,
          nonScalingStroke: node.getAttribute('vector-effect') === 'non-scaling-stroke',
          blendMode: readNodeBlendMode(node),
        };
        if (svgTag === 'text') {
          Object.assign(meta, readSvgTextMeta(node));
        } else if (svgTag === 'image') {
          meta.svgImage = readSvgImageMeta(node);
        }
        item.data = { ...(item.data ?? {}), ...meta };
        return item;
      },
    };
    const imported = (
      project as unknown as {
        importSVG(svg: SVGElement | string, options: Record<string, unknown>): paper.Item;
      }
    ).importSVG(svgEl, importOptions);

    const buildPathLayer = (
      item: paper.Item,
      parentMatrix: paper.Matrix,
      effectiveOpacity: number,
      effectiveBlendMode: BlendMode | undefined,
      effectiveVisible: boolean,
      clipMaskId: string | undefined,
      asMask: boolean,
      inheritedName?: string
    ): PathLayer | null => {
      const worldSubpaths = extractWorldSubPathsFromItem(scope, item, parentMatrix);
      if (!isValidSubPaths(worldSubpaths)) {
        return null;
      }

      const meta = (item.data ?? {}) as ImportedItemMeta;
      const worldMatrix = parentMatrix.appended(item.matrix);

      if (asMask) {
        maskCounter += 1;
        const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
        return {
          id: createLayerId('path'),
          name: meta.svgName || `Маска ${maskCounter}`,
          type: 'path',
          visible: effectiveVisible,
          locked: false,
          x: offset.x,
          y: offset.y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          subpaths,
          fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
          fill: null,
          stroke: null,
          isClipMask: true,
          ...(clipMaskId ? { clipMaskId } : {}),
        };
      }

      pathCounter += 1;
      const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
      const localBox = computeSubPathsBBox(subpaths);

      const fillInfo =
        meta.svgTag === 'line'
          ? null
          : extractPaperPaint(item.fillColor, worldMatrix, offset, localBox, () =>
              addWarning('Градиенты упрощены до плоской заливки')
            );
      const strokeInfo = extractPaperPaint(
        item.strokeColor,
        worldMatrix,
        offset,
        localBox,
        () => addWarning('Градиенты упрощены до плоской обводки')
      );

      let stroke: StrokeStyle | null = null;
      if (strokeInfo && item.strokeWidth > 0) {
        let strokeScale = 1;
        if (!meta.nonScalingStroke) {
          const sx = Math.hypot(worldMatrix.a, worldMatrix.b);
          const sy = Math.hypot(worldMatrix.c, worldMatrix.d);
          strokeScale = Math.sqrt(sx * sy) || 1;
        }
        const rawDash = sanitizeDashArray(item.dashArray);
        const dashArray = rawDash
          ? rawDash.map((d) => Math.max(0.25, Number((d * strokeScale).toFixed(2))))
          : undefined;
        const dashOffset =
          dashArray &&
          typeof item.dashOffset === 'number' &&
          Number.isFinite(item.dashOffset) &&
          Math.abs(item.dashOffset) > 1e-4
            ? Number((item.dashOffset * strokeScale).toFixed(2))
            : undefined;
        stroke = {
          color: strokeInfo.paint,
          width: Math.max(0.25, Number((item.strokeWidth * strokeScale).toFixed(2))),
          lineCap: mapLineCap(item.strokeCap),
          lineJoin: mapLineJoin(item.strokeJoin),
          ...(dashArray ? { dashArray } : {}),
          ...(dashOffset !== undefined ? { dashOffset } : {}),
        };
      }

      if (!fillInfo && !stroke) {
        pathCounter -= 1;
        return null;
      }

      const paintAlpha =
        fillInfo && strokeInfo
          ? Math.min(1, (fillInfo.alpha + strokeInfo.alpha) / 2)
          : (fillInfo?.alpha ?? strokeInfo?.alpha ?? 1);

      return {
        id: createLayerId('path'),
        name: meta.svgName || inheritedName || `Контур ${pathCounter}`,
        type: 'path',
        visible: effectiveVisible,
        locked: false,
        x: offset.x,
        y: offset.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: clamp(effectiveOpacity * paintAlpha, 0, 1),
        ...(effectiveBlendMode ? { blendMode: effectiveBlendMode } : {}),
        subpaths,
        fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        fill: fillInfo ? fillInfo.paint : null,
        stroke,
        ...(clipMaskId ? { clipMaskId } : {}),
      };
    };

    const visit = (
      item: paper.Item,
      parentMatrix: paper.Matrix,
      parentOpacity: number,
      parentBlendMode: BlendMode | undefined,
      parentVisible: boolean,
      clipMaskId: string | undefined,
      isRootSvgGroup: boolean,
      targetList: CollectedEntry[],
      parentName?: string
    ): void => {
      const worldMatrix = parentMatrix.appended(item.matrix);
      const effectiveOpacity = clamp(parentOpacity * (item.opacity ?? 1), 0, 1);
      const effectiveVisible = parentVisible && item.visible !== false;
      const itemMeta = (item.data ?? {}) as ImportedItemMeta;
      const effectiveBlendMode = itemMeta.blendMode ?? parentBlendMode;
      const resolvedName = itemMeta.svgName || parentName;

      if (item instanceof scope.Group) {
        const children = item.children ?? [];
        const hasClipMask =
          item.clipped && children.length > 0 && Boolean(children[0].clipMask);

        if (hasClipMask) {
          if (isRootSvgGroup) {
            for (let i = 1; i < children.length; i += 1) {
              visit(
                children[i],
                worldMatrix,
                effectiveOpacity,
                effectiveBlendMode,
                effectiveVisible,
                clipMaskId,
                false,
                targetList
              );
            }
            return;
          }

          const maskLayer = buildPathLayer(
            children[0],
            worldMatrix,
            1,
            undefined,
            effectiveVisible,
            clipMaskId,
            true
          );
          if (maskLayer) {
            const maskedChildren: CollectedEntry[] = [];
            const singleMaskedName = children.length === 2 ? resolvedName : undefined;
            for (let i = 1; i < children.length; i += 1) {
              visit(
                children[i],
                worldMatrix,
                effectiveOpacity,
                effectiveBlendMode,
                effectiveVisible,
                maskLayer.id,
                false,
                maskedChildren,
                singleMaskedName
              );
            }
            if (maskedChildren.length > 0) {
              targetList.push(...maskedChildren, maskLayer);
            }
            return;
          }
        }

        const singleChildName =
          !isRootSvgGroup && children.length === 1 ? resolvedName : undefined;
        for (const child of children) {
          visit(
            child,
            worldMatrix,
            effectiveOpacity,
            effectiveBlendMode,
            effectiveVisible,
            clipMaskId,
            false,
            targetList,
            singleChildName
          );
        }
        return;
      }

      if (
        item instanceof scope.Path ||
        item instanceof scope.CompoundPath ||
        item instanceof scope.Shape
      ) {
        const layer = buildPathLayer(
          item,
          parentMatrix,
          effectiveOpacity,
          effectiveBlendMode,
          effectiveVisible,
          clipMaskId,
          false,
          parentName
        );
        if (layer) {
          targetList.push(layer);
        }
        return;
      }

      if (item instanceof scope.PointText) {
        const content = (item.content ?? '').replace(/\r\n/g, '\n');
        if (!content.trim()) return;

        const meta = (item.data ?? {}) as ImportedItemMeta;
        const rawFontSize = Math.max(4, Number(item.fontSize) || 16);
        const { rotation: rot, scaleX: sx, scaleY: sy } =
          decomposePaperMatrix(worldMatrix);

        let bakedScale = 1;
        let fontSize = rawFontSize;
        let scaleX = sx;
        let scaleY = sy;

        if (sx > 0 && sy > 0 && Math.abs(sx - sy) / Math.max(sx, sy) < 0.02) {
          bakedScale = (sx + sy) / 2;
          fontSize = clamp(Number((rawFontSize * bakedScale).toFixed(2)), 4, 2000);
          scaleX = 1;
          scaleY = 1;
        } else {
          fontSize = clamp(Number(rawFontSize.toFixed(2)), 4, 2000);
        }

        const offsetX = meta.firstTspanOffsetX ?? 0;
        const offsetY = meta.firstTspanOffsetY ?? 0;
        const topPt = worldMatrix.transform(
          new scope.Point(offsetX, offsetY - rawFontSize * 0.85)
        );
        const lineHeight =
          meta.lineDeltaY && meta.lineDeltaY > 0
            ? clamp(Number((meta.lineDeltaY / rawFontSize).toFixed(2)), 0.8, 3)
            : 1.2;
        const fontFamily = resolveFontFamily(item.fontFamily);
        const fontWeight = resolveFontWeight(item.fontWeight);
        const align =
          item.justification === 'center'
            ? 'center'
            : item.justification === 'right'
              ? 'right'
              : 'left';
        const letterSpacing =
          typeof meta.letterSpacing === 'number' && meta.letterSpacing !== 0
            ? Number((meta.letterSpacing * bakedScale).toFixed(2))
            : undefined;

        textCounter += 1;
        const textLayerBase: TextLayer = {
          id: createLayerId('txt'),
          name: meta.svgName || parentName || `Текст ${textCounter}`,
          type: 'text',
          visible: effectiveVisible,
          locked: false,
          x: topPt.x,
          y: topPt.y,
          rotation: Number(rot.toFixed(3)),
          scaleX: Number(scaleX.toFixed(4)),
          scaleY: Number(scaleY.toFixed(4)),
          opacity: effectiveOpacity,
          ...(effectiveBlendMode ? { blendMode: effectiveBlendMode } : {}),
          content,
          fontSize,
          fontFamily,
          fontWeight,
          lineHeight,
          ...(letterSpacing !== undefined ? { letterSpacing } : {}),
          fill: '#1c1b1a',
          align,
          ...(clipMaskId ? { clipMaskId } : {}),
        };
        const textLocalBox = computeLayerLocalBBox(textLayerBase);
        const fillInfo = extractPaperPaint(
          item.fillColor,
          worldMatrix,
          { x: topPt.x, y: topPt.y },
          textLocalBox,
          () => addWarning('Градиенты в тексте упрощены до плоского цвета')
        );
        const textLayer: TextLayer = {
          ...textLayerBase,
          opacity: clamp(effectiveOpacity * (fillInfo?.alpha ?? 1), 0, 1),
          fill: fillInfo?.paint ?? '#1c1b1a',
        };
        targetList.push(textLayer);
        return;
      }

      if (item instanceof scope.Raster) {
        const meta = (item.data ?? {}) as ImportedItemMeta;
        const imgMeta = meta.svgImage;
        if (!imgMeta) return;
        if (!imgMeta.href.startsWith('data:image/')) {
          addWarning('Внешние изображения в SVG пропущены');
          return;
        }
        imageCounter += 1;
        const { rotation, scaleX, scaleY } = decomposePaperMatrix(worldMatrix);
        const idx = pendingImages.length;
        pendingImages.push({
          meta: imgMeta,
          matrix: {
            a: worldMatrix.a,
            b: worldMatrix.b,
            c: worldMatrix.c,
            d: worldMatrix.d,
            tx: worldMatrix.tx,
            ty: worldMatrix.ty,
          },
          rotation,
          scaleX,
          scaleY,
          opacity: effectiveOpacity,
          blendMode: effectiveBlendMode,
          visible: effectiveVisible,
          name: meta.svgName || parentName || `Изображение ${imageCounter}`,
          clipMaskId,
        });
        targetList.push({ __pendingImageIndex: idx });
      }
    };

    if (imported) {
      visit(
        imported,
        new scope.Matrix(),
        1,
        undefined,
        true,
        undefined,
        true,
        collected
      );
    }
  } finally {
    project.remove();
  }

  const resolvedImages = new Map<number, ImageLayer>();
  for (let i = 0; i < pendingImages.length; i += 1) {
    const pending = pendingImages[i];
    const decoded = decodeDataImageUrl(pending.meta.href);
    if (!decoded) {
      addWarning('Не удалось декодировать встроенное изображение в SVG');
      continue;
    }

    const mimeType =
      decoded.mimeType || inferImageMimeType(pending.name, decoded.bytes);
    const asset = await registerAssetFromBytes({
      bytes: decoded.bytes,
      name: pending.name,
      mimeType,
    });

    const w = pending.meta.width > 0 ? pending.meta.width : asset.naturalWidth;
    const h = pending.meta.height > 0 ? pending.meta.height : asset.naturalHeight;
    const center = applyMatrixToPoint(pending.matrix, {
      x: pending.meta.x + w / 2,
      y: pending.meta.y + h / 2,
    });
    const sx = (pending.scaleX * w) / Math.max(1, asset.naturalWidth);
    const sy = (pending.scaleY * h) / Math.max(1, asset.naturalHeight);

    resolvedImages.set(i, {
      id: createLayerId('img'),
      name: pending.name,
      type: 'image',
      visible: pending.visible,
      locked: false,
      x: center.x,
      y: center.y,
      rotation: Number(pending.rotation.toFixed(3)),
      scaleX: Number(sx.toFixed(4)),
      scaleY: Number(sy.toFixed(4)),
      opacity: pending.opacity,
      ...(pending.blendMode ? { blendMode: pending.blendMode } : {}),
      assetId: asset.id,
      width: asset.naturalWidth,
      height: asset.naturalHeight,
      ...(pending.clipMaskId ? { clipMaskId: pending.clipMaskId } : {}),
    });
  }

  const layers: Layer[] = [];
  for (const entry of collected) {
    if (isPendingImageToken(entry)) {
      const imgLayer = resolvedImages.get(entry.__pendingImageIndex);
      if (imgLayer) layers.push(imgLayer);
    } else {
      layers.push(entry);
    }
  }

  if (layers.length === 0) {
    return {
      layers: [],
      sourceWidth,
      sourceHeight,
      warnings: Array.from(warningsSet),
    };
  }

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    const rawBBox = computeCombinedWorldBBox(layers);
    if (sourceWidth <= 0) sourceWidth = Math.max(1, Math.round(rawBBox.width));
    if (sourceHeight <= 0) sourceHeight = Math.max(1, Math.round(rawBBox.height));
  }

  const finalLayers = options.targetArtboard
    ? scaleAndCenterLayers(
        layers,
        options.targetArtboard,
        options.fitToArtboard !== false,
        options.centerInArtboard !== false
      )
    : layers;

  return {
    layers: finalLayers,
    sourceWidth,
    sourceHeight,
    warnings: Array.from(warningsSet),
  };
}
