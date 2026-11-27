import { clamp, computeCombinedWorldBBox } from '../core/math';
import type { Layer } from '../core/types';
import { normalizeElementColors } from './svg/colorNormalize';
import { inlineSvgStyles } from './svg/cssInline';
import { resolvePendingImages } from './svg/dataImage';
import { isPendingImageToken, walkSvgWithPaper } from './svg/domWalk';

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

  const warningsSet = new Set<string>();
  const addWarning = (msg: string) => warningsSet.add(msg);

  for (const unsafeEl of Array.from(svgEl.querySelectorAll('script, foreignObject'))) {
    unsafeEl.remove();
  }
  for (const el of Array.from(svgEl.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const imgEl of Array.from(svgEl.querySelectorAll('image'))) {
    const href = (
      imgEl.getAttribute('href') ??
      imgEl.getAttribute('xlink:href') ??
      ''
    ).trim();
    const isSafeDataImage =
      href.startsWith('data:image/') && !href.toLowerCase().startsWith('data:image/svg+xml');
    if (!isSafeDataImage) {
      if (href) {
        addWarning('Внешние изображения в SVG пропущены');
      }
      imgEl.remove();
    }
  }
  inlineSvgStyles(svgEl);
  normalizeElementColors(svgEl, '#000000');

  const { collected, pendingImages } = walkSvgWithPaper(svgEl, addWarning);
  const resolvedImages = await resolvePendingImages(pendingImages, addWarning);

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
