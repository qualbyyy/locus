import { assetToDataUrl } from '../core/assets';
import { localToWorld, type LayerTransform } from '../core/math';
import type { Layer, PathLayer, Scene, TextLayer } from '../core/types';
import {
  colorWithOpacity,
  hasRasterEffects,
  resolveEffectivePathGeometry,
} from '../engine/effects';
import {
  buildSvgPathData,
  colorToCssRgb,
  escapeXml,
  formatNumber,
  layerMatrixAttr,
  type MappedPoint,
} from './pathData';

export interface SvgExportOptions {
  /** Включать фон артборда (по умолчанию `true`). */
  includeBackground?: boolean;
}

function toWorld(layer: LayerTransform) {
  return (pt: { x: number; y: number }): MappedPoint => {
    const w = localToWorld(layer, pt);
    return { x: w.x, y: w.y, lx: pt.x, ly: pt.y };
  };
}

/** Идентификатор слоя, безопасный для `id`/`url(#...)` в SVG. */
export function safeSvgId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `x${cleaned}`;
}

function textAnchor(align: TextLayer['align']): string {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

/** Единая метрика строк: baselineY(i) = fontSize * 0.85 + i * fontSize * lineHeight. */
export function textBaselineY(layer: TextLayer, lineIndex: number): number {
  return layer.fontSize * 0.85 + lineIndex * layer.fontSize * layer.lineHeight;
}

function buildTextSvg(layer: TextLayer): string {
  const lines = (layer.content || '').split('\n');
  const attrs: string[] = [
    `font-family="${escapeXml(layer.fontFamily)}"`,
    `font-weight="${layer.fontWeight}"`,
    `font-size="${formatNumber(layer.fontSize)}"`,
    `text-anchor="${textAnchor(layer.align)}"`,
    `fill="${colorToCssRgb(layer.fill)}"`,
  ];
  if ((layer.letterSpacing ?? 0) !== 0) {
    attrs.push(`letter-spacing="${formatNumber(layer.letterSpacing ?? 0)}"`);
  }

  if (lines.length === 1) {
    return `<text ${attrs.join(' ')} x="0" y="${formatNumber(textBaselineY(layer, 0))}">${escapeXml(lines[0])}</text>`;
  }

  const spans = lines
    .map(
      (line, i) =>
        `<tspan x="0" y="${formatNumber(textBaselineY(layer, i))}">${escapeXml(line)}</tspan>`
    )
    .join('');
  return `<text ${attrs.join(' ')}>${spans}</text>`;
}

function buildPathSvg(layer: PathLayer): string {
  const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
  const worldMap = toWorld(layer);
  const facePaths = extrudeFaces
    .map((face) => {
      const fd = buildSvgPathData(face.subpaths, worldMap);
      return `<path d="${fd}" fill-rule="nonzero" fill="${colorToCssRgb(face.fill)}" stroke="none"/>`;
    })
    .join('');

  const d = buildSvgPathData(subpaths, worldMap);
  const attrs: string[] = [`d="${d}"`, `fill-rule="${layer.fillRule}"`];
  attrs.push(layer.fill ? `fill="${colorToCssRgb(layer.fill)}"` : `fill="none"`);

  if (layer.stroke && layer.stroke.width > 0) {
    attrs.push(`stroke="${colorToCssRgb(layer.stroke.color)}"`);
    attrs.push(`stroke-width="${formatNumber(layer.stroke.width)}"`);
    attrs.push(`stroke-linecap="${layer.stroke.lineCap ?? 'round'}"`);
    attrs.push(`stroke-linejoin="${layer.stroke.lineJoin ?? 'round'}"`);
  } else {
    attrs.push(`stroke="none"`);
  }
  return `${facePaths}<path ${attrs.join(' ')}/>`;
}

async function buildImageSvg(layer: Layer & { type: 'image' }): Promise<string> {
  const dataUrl = await assetToDataUrl(layer.assetId);
  if (!dataUrl) return '';
  return (
    `<image href="${dataUrl}" x="${formatNumber(-layer.width / 2)}" ` +
    `y="${formatNumber(-layer.height / 2)}" width="${formatNumber(layer.width)}" ` +
    `height="${formatNumber(layer.height)}" preserveAspectRatio="none"/>`
  );
}

function collectMaskLayers(scene: Scene): PathLayer[] {
  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const result: PathLayer[] = [];
  const seen = new Set<string>();
  for (const layer of scene.layers) {
    if (!layer.clipMaskId || seen.has(layer.clipMaskId)) continue;
    const mask = byId.get(layer.clipMaskId);
    if (mask?.type === 'path') {
      result.push(mask);
      seen.add(mask.id);
    }
  }
  return result;
}

function buildMaskDefs(maskLayers: PathLayer[]): string {
  return maskLayers
    .map((mask) => {
      const d = buildSvgPathData(mask.subpaths, toWorld(mask));
      const transform = layerMatrixAttr(mask);
      const tAttr = transform ? ` transform="${transform}"` : '';
      return `<clipPath id="clip-${safeSvgId(mask.id)}"><path d="${d}" clip-rule="${mask.fillRule}"${tAttr}/></clipPath>`;
    })
    .join('');
}

function buildFilterDefs(scene: Scene): string {
  return scene.layers
    .filter((l) => l.visible && hasRasterEffects(l.effects))
    .map((layer) => {
      const eff = layer.effects!;
      const primitives: string[] = [];
      if (eff.blur && eff.blur > 0.1) {
        primitives.push(`<feGaussianBlur stdDeviation="${formatNumber(eff.blur)}"/>`);
      }
      if (eff.outerGlow && eff.outerGlow.blur > 0) {
        primitives.push(
          `<feDropShadow dx="0" dy="0" stdDeviation="${formatNumber(eff.outerGlow.blur / 2)}" flood-color="${colorWithOpacity(eff.outerGlow.color, eff.outerGlow.opacity)}"/>`
        );
      }
      if (eff.dropShadow) {
        primitives.push(
          `<feDropShadow dx="${formatNumber(eff.dropShadow.offsetX)}" dy="${formatNumber(eff.dropShadow.offsetY)}" stdDeviation="${formatNumber(eff.dropShadow.blur / 2)}" flood-color="${colorWithOpacity(eff.dropShadow.color, eff.dropShadow.opacity)}"/>`
        );
      }
      return `<filter id="fx-${safeSvgId(layer.id)}" x="-60%" y="-60%" width="220%" height="220%">${primitives.join('')}</filter>`;
    })
    .join('');
}

async function buildLayerContent(layer: Layer): Promise<string> {
  const transform = layerMatrixAttr(layer);
  const hasFx = hasRasterEffects(layer.effects);
  const wrap = (content: string) => {
    let out = transform ? `<g transform="${transform}">${content}</g>` : content;
    if (hasFx) {
      out = `<g filter="url(#fx-${safeSvgId(layer.id)})">${out}</g>`;
    }
    return out;
  };
  if (layer.type === 'path') return wrap(buildPathSvg(layer));
  if (layer.type === 'text') return wrap(buildTextSvg(layer));
  return wrap(await buildImageSvg(layer));
}

/** Последовательные видимые слои с одинаковым `clipMaskId` → один `<g>`. */
async function buildLayerGroup(group: Layer[], clipId: string | null): Promise<string> {
  const attrs: string[] = [];
  if (clipId) {
    attrs.push(`clip-path="url(#clip-${safeSvgId(clipId)})"`);
  }
  const first = group[0];
  attrs.push(`id="${safeSvgId(first.id)}"`);
  attrs.push(`data-name="${escapeXml(group.length === 1 ? first.name : `Группа (${group.length})`)}"`);
  if (group.length === 1 && first.opacity < 1) {
    attrs.push(`opacity="${formatNumber(first.opacity)}"`);
  }
  const inner = await Promise.all(group.map((layer) => buildLayerContent(layer)));
  return `<g ${attrs.join(' ')}>${inner.join('')}</g>`;
}

function isMaskOrHidden(layer: Layer, maskLayerIds: Set<string>): boolean {
  return maskLayerIds.has(layer.id) || !layer.visible;
}

async function buildSvgBody(scene: Scene, maskLayerIds: Set<string>): Promise<string> {
  const body: string[] = [];
  let i = 0;
  while (i < scene.layers.length) {
    const layer = scene.layers[i];
    if (isMaskOrHidden(layer, maskLayerIds)) {
      i += 1;
      continue;
    }
    const clipId = layer.clipMaskId ?? null;
    let j = i;
    while (
      j + 1 < scene.layers.length &&
      scene.layers[j + 1].clipMaskId === clipId &&
      !isMaskOrHidden(scene.layers[j + 1], maskLayerIds)
    ) {
      j += 1;
    }
    body.push(await buildLayerGroup(scene.layers.slice(i, j + 1), clipId));
    i = j + 1;
  }
  return body.join('');
}

export async function sceneToSvg(
  scene: Scene,
  options: SvgExportOptions = {}
): Promise<string> {
  const maskLayers = collectMaskLayers(scene);
  const maskLayerIds = new Set(maskLayers.map((m) => m.id));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(scene.width)}" height="${formatNumber(scene.height)}" viewBox="0 0 ${formatNumber(scene.width)} ${formatNumber(scene.height)}">`,
  ];
  if (options.includeBackground !== false) {
    parts.push(
      `<rect x="0" y="0" width="${formatNumber(scene.width)}" height="${formatNumber(scene.height)}" fill="${colorToCssRgb(scene.background)}"/>`
    );
  }
  const maskDefs = buildMaskDefs(maskLayers);
  const filterDefs = buildFilterDefs(scene);
  if (maskDefs || filterDefs) {
    parts.push(`<defs>${maskDefs}${filterDefs}</defs>`);
  }
  parts.push(await buildSvgBody(scene, maskLayerIds));
  parts.push('</svg>');
  return parts.join('\n');
}
