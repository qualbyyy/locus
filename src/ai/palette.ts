import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import {
  runCommandBatch,
  updateArtboardById,
  updateLayers,
} from '../core/commands';
import { flattenLayers, getParentWorldMatrix } from '../core/layerTree';
import { computeLayerBBoxWithMatrix } from '../core/math';
import { isGradientPaint } from '../core/paint';
import { useEditorStore } from '../core/store';
import type { Paint, PathLayer, TextLayer } from '../core/types';
import { quantizeRgbaPixels } from '../engine/imageTrace';

export interface ExtractedPaletteColor {
  hex: string;
  rgb: [number, number, number];
  ratio: number;
  luminance: number;
}

export function normalizeHexColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return null;
}

export function parseHexRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  const r = Number.parseInt(norm.slice(1, 3), 16);
  const g = Number.parseInt(norm.slice(3, 5), 16);
  const b = Number.parseInt(norm.slice(5, 7), 16);
  return [r, g, b];
}

function srgbToLinear(channel8: number): number {
  const c = channel8 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;
  return (
    0.2126 * srgbToLinear(rgb[0]) +
    0.7152 * srgbToLinear(rgb[1]) +
    0.0722 * srgbToLinear(rgb[2])
  );
}

export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function extractPaletteFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  count = 5
): ExtractedPaletteColor[] {
  const { swatches } = quantizeRgbaPixels(rgba, width, height, count);
  const byHex = new Map<string, ExtractedPaletteColor>();

  for (const sw of swatches) {
    const hex = normalizeHexColor(sw.hex);
    if (!hex) continue;
    const prev = byHex.get(hex);
    if (prev) {
      prev.ratio += sw.weight;
      continue;
    }
    byHex.set(hex, {
      hex,
      rgb: [Math.round(sw.r), Math.round(sw.g), Math.round(sw.b)],
      ratio: sw.weight,
      luminance: relativeLuminance(hex),
    });
  }

  return Array.from(byHex.values()).sort((a, b) => b.ratio - a.ratio);
}

export async function extractPaletteFromDataUrl(
  dataUrl: string,
  count = 5
): Promise<ExtractedPaletteColor[]> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return [];
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.max(1, img.naturalWidth || img.width || 1);
        const h = Math.max(1, img.naturalHeight || img.height || 1);
        const maxSide = 128;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve([]);
          return;
        }
        ctx.drawImage(img, 0, 0, cw, ch);
        const imageData = ctx.getImageData(0, 0, cw, ch);
        resolve(extractPaletteFromRgba(imageData.data, cw, ch, count));
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

function collectPaintHexes(paint: Paint | null | undefined, out: string[]): void {
  if (!paint) return;
  if (typeof paint === 'string') {
    const h = normalizeHexColor(paint);
    if (h) out.push(h);
    return;
  }
  if (isGradientPaint(paint)) {
    for (const stop of paint.stops) {
      const h = normalizeHexColor(stop.color);
      if (h) out.push(h);
    }
  }
}

function mapPaintWithTable(
  paint: Paint | null | undefined,
  colorMap: Map<string, string>
): Paint | null {
  if (!paint) return null;
  if (typeof paint === 'string') {
    const norm = normalizeHexColor(paint);
    return norm ? (colorMap.get(norm) ?? norm) : paint;
  }
  if (isGradientPaint(paint)) {
    return {
      ...paint,
      stops: paint.stops.map((stop) => {
        const norm = normalizeHexColor(stop.color);
        return {
          ...stop,
          color: norm ? (colorMap.get(norm) ?? norm) : stop.color,
        };
      }),
    };
  }
  return paint;
}

function pickBestForeground(
  candidates: string[],
  bgHex: string,
  preserveContrast: boolean
): string {
  let best = candidates[0] ?? '#111827';
  let bestContrast = contrastRatio(best, bgHex);
  for (const hex of candidates) {
    const c = contrastRatio(hex, bgHex);
    if (c > bestContrast) {
      best = hex;
      bestContrast = c;
    }
  }
  if (preserveContrast && bestContrast < 4.5) {
    const dark = '#111827';
    const light = '#ffffff';
    return contrastRatio(dark, bgHex) >= contrastRatio(light, bgHex) ? dark : light;
  }
  return best;
}

export function recolorSceneWithPalette(
  paletteHexes: string[],
  options: {
    layerIds?: string[];
    includeBackground?: boolean;
    preserveContrast?: boolean;
  } = {}
): {
  updatedLayers: number;
  updatedBackground: boolean;
  backgroundColor?: string;
  palette: string[];
} {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of paletteHexes) {
    const hex = normalizeHexColor(raw);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      normalized.push(hex);
    }
  }
  if (normalized.length === 0) {
    throw new Error('Нужен хотя бы один корректный hex-цвет палитры');
  }

  const workingPalette = [...normalized];
  if (workingPalette.length === 1) {
    workingPalette.push(
      relativeLuminance(workingPalette[0]) > 0.35 ? '#111827' : '#f8fafc'
    );
  }

  const state = useEditorStore.getState();
  const scene = state.scene;
  const activeAb = getActiveArtboard(scene, state.activeArtboardId);
  const allFlat = flattenLayers(scene.layers);
  const subsetSet =
    options.layerIds && options.layerIds.length > 0
      ? new Set(options.layerIds)
      : null;

  const targetLayers = allFlat.filter(
    (l) =>
      !l.locked &&
      (l.type === 'path' || l.type === 'text') &&
      (!subsetSet || subsetSet.has(l.id))
  );

  const includeBackground =
    options.includeBackground !== undefined
      ? options.includeBackground
      : !subsetSet;
  const preserveContrast = options.preserveContrast !== false;

  // Choose artboard background (lightest if bright palette available, else darkest)
  const byLum = [...workingPalette].sort(
    (a, b) => relativeLuminance(b) - relativeLuminance(a)
  );
  const chosenBg =
    relativeLuminance(byLum[0]) >= 0.45
      ? byLum[0]
      : byLum[byLum.length - 1];
  const effectiveAbBg = includeBackground
    ? chosenBg
    : normalizeHexColor(activeAb.background) ?? '#ffffff';

  const fgPalette =
    workingPalette.length > 1
      ? workingPalette.filter((c) => c !== chosenBg)
      : workingPalette;

  // Map distinct source hexes deterministically across non-text paints
  const sourceHexes: string[] = [];
  const sourceSeen = new Set<string>();
  for (const l of targetLayers) {
    if (l.type === 'path') {
      const found: string[] = [];
      collectPaintHexes(l.fill, found);
      collectPaintHexes(l.stroke?.color, found);
      for (const h of found) {
        if (!sourceSeen.has(h)) {
          sourceSeen.add(h);
          sourceHexes.push(h);
        }
      }
    }
  }
  const colorMap = new Map<string, string>();
  sourceHexes.forEach((srcHex, idx) => {
    colorMap.set(srcHex, fgPalette[idx % fgPalette.length]);
  });

  // Track recolored path fills + bboxes in z-order so text contrast checks underlying fills
  const pathFillsById = new Map<string, { box: ReturnType<typeof computeLayerBBoxWithMatrix>; fillHex: string }>();
  for (const layer of allFlat) {
    if (!layer.visible || layer.type !== 'path' || !layer.fill) continue;
    const rawHex = typeof layer.fill === 'string'
      ? normalizeHexColor(layer.fill)
      : isGradientPaint(layer.fill) && layer.fill.stops.length > 0
        ? normalizeHexColor(layer.fill.stops[0].color)
        : null;
    if (!rawHex) continue;
    const mappedHex =
      !layer.locked && (!subsetSet || subsetSet.has(layer.id))
        ? (colorMap.get(rawHex) ?? fgPalette[0])
        : rawHex;
    const box = computeLayerBBoxWithMatrix(
      layer,
      getParentWorldMatrix(scene.layers, layer.id)
    );
    pathFillsById.set(layer.id, { box, fillHex: mappedHex });
  }

  let updatedLayers = 0;
  let updatedBackground = false;
  const artboards = getSceneArtboards(scene);

  runCommandBatch(() => {
    if (includeBackground) {
      updateArtboardById(activeAb.id, { background: chosenBg });
      updatedBackground = true;
    }

    const pathTargets = targetLayers.filter((l): l is PathLayer => l.type === 'path');
    if (pathTargets.length > 0) {
      updateLayers(
        pathTargets.map((l) => l.id),
        (layer) => {
          if (layer.type !== 'path') return layer;
          const nextFill = layer.fill ? mapPaintWithTable(layer.fill, colorMap) : null;
          const nextStroke = layer.stroke
            ? {
                ...layer.stroke,
                color: mapPaintWithTable(layer.stroke.color, colorMap) ?? layer.stroke.color,
              }
            : null;
          updatedLayers += 1;
          return {
            ...layer,
            fill: nextFill,
            stroke: nextStroke,
          };
        }
      );
    }

    const textTargets = targetLayers.filter((l): l is TextLayer => l.type === 'text');
    if (textTargets.length > 0) {
      for (const txt of textTargets) {
        const tBox = computeLayerBBoxWithMatrix(
          txt,
          getParentWorldMatrix(scene.layers, txt.id)
        );
        const cx = tBox.x + tBox.width / 2;
        const cy = tBox.y + tBox.height / 2;

        const matchingAb =
          artboards.find(
            (ab) => cx >= ab.x && cx <= ab.x + ab.width && cy >= ab.y && cy <= ab.y + ab.height
          ) ?? activeAb;
        let bgUnderText =
          includeBackground && matchingAb.id === activeAb.id
            ? chosenBg
            : normalizeHexColor(matchingAb.background) ?? effectiveAbBg;

        const txtOrderIdx = allFlat.findIndex((l) => l.id === txt.id);
        for (let i = txtOrderIdx - 1; i >= 0; i -= 1) {
          const under = allFlat[i];
          const info = pathFillsById.get(under.id);
          if (!info) continue;
          const b = info.box;
          if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) {
            bgUnderText = info.fillHex;
            break;
          }
        }

        const nextTextFill = pickBestForeground(
          fgPalette,
          bgUnderText,
          preserveContrast
        );
        updateLayers([txt.id], { fill: nextTextFill });
        updatedLayers += 1;
      }
    }
  });

  return {
    updatedLayers,
    updatedBackground,
    ...(includeBackground ? { backgroundColor: chosenBg } : {}),
    palette: workingPalette,
  };
}
