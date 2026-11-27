import {
  initializeCanvas,
  readPsd,
  writePsdUint8Array,
  type BlendMode as PsdBlendMode,
  type Layer as PsdLayer,
  type Psd,
} from 'ag-psd';
import { extractArtboardScene, getActiveArtboard } from '../core/artboards';
import {
  IDENTITY_MATRIX,
  computeLayerBBoxWithMatrix,
  decomposeMatrix,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import { getEffectsPadding } from '../engine/effects';
import { getPrimaryColor } from '../core/paint';
import type {
  BlendMode,
  GroupLayer,
  Layer,
  Scene,
  TextLayer,
} from '../core/types';
import { parseColorToRgba } from './pathData';
import {
  defaultPaintLayer,
  rasterizeComposite,
  rasterizeLayer,
} from './rasterize';

export interface PsdExportOptions {
  /** Масштаб растра (по умолчанию 1). */
  scale?: number;
  /** ID конкретного артборда (по умолчанию текущий документ целиком). */
  artboardId?: string;
}

function colorToRgb(color: string): { r: number; g: number; b: number } {
  const rgba = parseColorToRgba(color);
  if (!rgba) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(rgba[0]), g: Math.round(rgba[1]), b: Math.round(rgba[2]) };
}

function toPsdBlendMode(mode?: BlendMode): PsdBlendMode | undefined {
  if (!mode || mode === 'normal') return undefined;
  switch (mode) {
    case 'color-dodge':
      return 'color dodge';
    case 'color-burn':
      return 'color burn';
    case 'hard-light':
      return 'hard light';
    case 'soft-light':
      return 'soft light';
    default:
      return mode;
  }
}

function textLayerData(layer: TextLayer, parentMatrix: Matrix2D): PsdLayer['text'] {
  const { r, g, b } = colorToRgb(getPrimaryColor(layer.fill, '#1c1b1a'));
  const world = decomposeMatrix(multiplyMatrices(parentMatrix, getLayerMatrix(layer)));
  return {
    text: layer.content,
    transform: [world.scaleX, 0, 0, world.scaleY, 0, 0],
    style: {
      font: { name: `${layer.fontFamily}-${layer.fontWeight === 700 ? 'Bold' : 'Regular'}` },
      fontSize: layer.fontSize,
      fillColor: { r, g, b },
      tracking: Math.round(((layer.letterSpacing ?? 0) / Math.max(1, layer.fontSize)) * 1000),
    },
  };
}

async function buildPsdLeafLayer(
  layer: Layer,
  scene: Scene,
  scale: number,
  parentMatrix: Matrix2D,
  isMaskLayer = false
): Promise<PsdLayer> {
  const renderLayer: Layer =
    isMaskLayer && layer.type === 'path' && !layer.fill && (!layer.stroke || layer.stroke.width <= 0)
      ? { ...layer, fill: '#000000' }
      : layer;
  const raster = await rasterizeLayer(
    renderLayer,
    scene,
    (l) => {
      const box = computeLayerBBoxWithMatrix(l, parentMatrix);
      const strokePad =
        l.type === 'path' || l.type === 'text' ? (l.stroke?.width ?? 0) : 0;
      const pad = getEffectsPadding(l.effects) + strokePad;
      if (pad <= 0) return box;
      return {
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      };
    },
    scale,
    parentMatrix
  );
  const blendMode = toPsdBlendMode(layer.blendMode);
  const leftPx = raster ? Math.round(raster.left * scale) : 0;
  const topPx = raster ? Math.round(raster.top * scale) : 0;
  const psdLayer: PsdLayer = {
    name: layer.name,
    hidden: !layer.visible,
    opacity: layer.opacity,
    ...(blendMode ? { blendMode } : {}),
    left: leftPx,
    top: topPx,
    right: raster ? leftPx + raster.canvas.width : 0,
    bottom: raster ? topPx + raster.canvas.height : 0,
  };
  if (raster) {
    psdLayer.canvas = raster.canvas;
  }
  if (layer.type === 'text') {
    psdLayer.text = textLayerData(layer, parentMatrix);
  }
  return psdLayer;
}

async function buildPsdGroupLayer(
  group: GroupLayer,
  scene: Scene,
  scale: number,
  parentMatrix: Matrix2D
): Promise<PsdLayer> {
  const blendMode = toPsdBlendMode(group.blendMode);
  const nextMatrix = multiplyMatrices(parentMatrix, getLayerMatrix(group));
  return {
    name: group.name,
    hidden: !group.visible,
    opacity: group.opacity,
    ...(blendMode ? { blendMode } : {}),
    opened: true,
    children: await buildChildren(group.children, scene, scale, nextMatrix),
  };
}

async function buildPsdNode(
  layer: Layer,
  scene: Scene,
  scale: number,
  parentMatrix: Matrix2D,
  isMaskLayer = false
): Promise<PsdLayer> {
  if (layer.type === 'group') {
    return buildPsdGroupLayer(layer, scene, scale, parentMatrix);
  }
  return buildPsdLeafLayer(layer, scene, scale, parentMatrix, isMaskLayer);
}

/**
 * Структура `Psd.children` (сверху вниз).
 *
 * Clipping group в PSD: базовый слой (маска) идёт **ниже**, а каждый обрезаемый
 * слой имеет `clipping: true`. Поэтому при обходе сверху вниз члены группы
 * (`clipping: true`) идут раньше маски.
 */
async function buildChildren(
  layers: Layer[],
  scene: Scene,
  scale: number,
  parentMatrix: Matrix2D = IDENTITY_MATRIX
): Promise<PsdLayer[]> {
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const maskIds = new Set<string>();
  for (const l of layers) {
    if (l.type === 'path' && l.isClipMask) maskIds.add(l.id);
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') maskIds.add(l.clipMaskId);
  }

  // Члены групп клиппинга в порядке списка (снизу вверх).
  const clipMembers = new Map<string, Layer[]>();
  for (const l of layers) {
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') {
      const list = clipMembers.get(l.clipMaskId) ?? [];
      list.push(l);
      clipMembers.set(l.clipMaskId, list);
    }
  }

  const children: PsdLayer[] = [];
  const emittedClipGroups = new Set<string>();
  const emittedLayerIds = new Set<string>();
  const reversed = [...layers].reverse();

  for (const layer of reversed) {
    if (emittedLayerIds.has(layer.id)) continue;
    const mask = layer.clipMaskId ? byId.get(layer.clipMaskId) : undefined;

    if (mask?.type === 'path' && !emittedClipGroups.has(mask.id)) {
      emittedClipGroups.add(mask.id);
      for (const member of [...(clipMembers.get(mask.id) ?? [])].reverse()) {
        if (emittedLayerIds.has(member.id)) continue;
        emittedLayerIds.add(member.id);
        const psdLayer = await buildPsdNode(member, scene, scale, parentMatrix);
        psdLayer.clipping = true;
        children.push(psdLayer);
      }
      if (!emittedLayerIds.has(mask.id)) {
        emittedLayerIds.add(mask.id);
        const maskLayer = await buildPsdNode(mask, scene, scale, parentMatrix, true);
        children.push(maskLayer);
      }
      continue;
    }

    if (maskIds.has(layer.id)) {
      if (emittedClipGroups.has(layer.id)) continue;
      emittedLayerIds.add(layer.id);
      children.push(await buildPsdNode(layer, scene, scale, parentMatrix, true));
      continue;
    }

    emittedLayerIds.add(layer.id);
    children.push(await buildPsdNode(layer, scene, scale, parentMatrix));
  }

  return children;
}

/**
 * Экспорт сцены в `.psd` (ag-psd): послойные растры, папки групп и композитный `canvas`.
 */
export async function sceneToPsd(scene: Scene, options: PsdExportOptions = {}): Promise<Psd> {
  const targetScene = options.artboardId
    ? extractArtboardScene(scene, getActiveArtboard(scene, options.artboardId))
    : scene;
  const scale = options.scale ?? 1;
  const psd: Psd = {
    width: Math.round(targetScene.width * scale),
    height: Math.round(targetScene.height * scale),
    channels: 4,
    bitsPerChannel: 8,
    colorMode: 3,
    children: await buildChildren(targetScene.layers, targetScene, scale, IDENTITY_MATRIX),
  };
  psd.canvas = await rasterizeComposite(targetScene, scale, defaultPaintLayer);
  return psd;
}

function disposePsdCanvases(node: { canvas?: unknown; children?: Array<{ canvas?: unknown; children?: unknown }> }): void {
  if (node.canvas && typeof (node.canvas as HTMLCanvasElement).width === 'number') {
    const c = node.canvas as HTMLCanvasElement;
    c.width = 0;
    c.height = 0;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      disposePsdCanvases(child as typeof node);
    }
  }
}

export async function sceneToPsdBytes(
  scene: Scene,
  options: PsdExportOptions = {}
): Promise<Uint8Array> {
  const psd = await sceneToPsd(scene, options);
  try {
    return writePsdUint8Array(psd, { generateThumbnail: true, invalidateTextLayers: true });
  } finally {
    disposePsdCanvases(psd);
  }
}

export { initializeCanvas, readPsd };
