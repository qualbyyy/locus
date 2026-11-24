import {
  initializeCanvas,
  readPsd,
  writePsdUint8Array,
  type Layer as PsdLayer,
  type Psd,
} from 'ag-psd';
import { computeLayerWorldBBox } from '../core/math';
import type { Layer, Scene, TextLayer } from '../core/types';
import { parseColorToRgba } from './pathData';
import {
  paintImageLayer,
  paintPathLayer,
  paintTextLayer,
  rasterizeComposite,
  rasterizeLayer,
} from './rasterize';

export interface PsdExportOptions {
  /** Масштаб растра (по умолчанию 1). */
  scale?: number;
}

/** Порядок слоёв PSD — сверху вниз, поэтому `scene.layers` идёт в обратном порядке. */
function reversedLayers(scene: Scene): Layer[] {
  return [...scene.layers].reverse();
}

function colorToRgb(color: string): { r: number; g: number; b: number } {
  const rgba = parseColorToRgba(color);
  if (!rgba) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(rgba[0]), g: Math.round(rgba[1]), b: Math.round(rgba[2]) };
}

function textLayerData(layer: TextLayer): PsdLayer['text'] {
  const { r, g, b } = colorToRgb(layer.fill);
  return {
    text: layer.content,
    transform: [layer.scaleX, 0, 0, layer.scaleY, 0, 0],
    style: {
      font: { name: `${layer.fontFamily}-${layer.fontWeight === 700 ? 'Bold' : 'Regular'}` },
      fontSize: layer.fontSize,
      fillColor: { r, g, b },
      tracking: Math.round(((layer.letterSpacing ?? 0) / Math.max(1, layer.fontSize)) * 1000),
    },
  };
}

async function buildPsdLayer(layer: Layer, scene: Scene, scale: number): Promise<PsdLayer> {
  const raster = await rasterizeLayer(layer, scene, computeLayerWorldBBox, scale);
  const psdLayer: PsdLayer = {
    name: layer.name,
    hidden: !layer.visible,
    opacity: layer.opacity,
    left: raster?.left ?? 0,
    top: raster?.top ?? 0,
    right: raster ? raster.left + raster.width : 0,
    bottom: raster ? raster.top + raster.height : 0,
  };
  if (raster) {
    psdLayer.canvas = raster.canvas;
  }
  if (layer.type === 'text') {
    psdLayer.text = textLayerData(layer);
  }
  return psdLayer;
}

/**
 * Структура `Psd.children` (сверху вниз).
 *
 * Clipping group в PSD: базовый слой (маска) идёт **ниже**, а каждый обрезаемый
 * слой имеет `clipping: true`. Поэтому при обходе сверху вниз члены группы
 * (`clipping: true`) идут раньше маски.
 */
async function buildChildren(scene: Scene, scale: number): Promise<PsdLayer[]> {
  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const maskIds = new Set<string>();
  for (const l of scene.layers) {
    if (l.type === 'path' && l.isClipMask) maskIds.add(l.id);
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') maskIds.add(l.clipMaskId);
  }

  // Члены групп клиппинга в порядке сцены (снизу вверх).
  const clipMembers = new Map<string, Layer[]>();
  for (const l of scene.layers) {
    if (l.clipMaskId && byId.get(l.clipMaskId)?.type === 'path') {
      const list = clipMembers.get(l.clipMaskId) ?? [];
      list.push(l);
      clipMembers.set(l.clipMaskId, list);
    }
  }

  const children: PsdLayer[] = [];
  const emittedClipGroups = new Set<string>();

  for (const layer of reversedLayers(scene)) {
    const mask = layer.clipMaskId ? byId.get(layer.clipMaskId) : undefined;

    if (mask?.type === 'path' && !emittedClipGroups.has(mask.id)) {
      emittedClipGroups.add(mask.id);
      // Сверху вниз: члены группы (обратный порядок) → маска.
      for (const member of [...(clipMembers.get(mask.id) ?? [])].reverse()) {
        const psdLayer = await buildPsdLayer(member, scene, scale);
        psdLayer.clipping = true;
        children.push(psdLayer);
      }
      const maskLayer = await buildPsdLayer(mask, scene, scale);
      children.push(maskLayer);
      continue;
    }

    if (maskIds.has(layer.id)) {
      // already emitted as part of a clip group, or orphan mask → plain layer
      if (emittedClipGroups.has(layer.id)) continue;
      children.push(await buildPsdLayer(layer, scene, scale));
      continue;
    }

    children.push(await buildPsdLayer(layer, scene, scale));
  }

  return children;
}

/**
 * Экспорт сцены в `.psd` (ag-psd): послойные растры + композитный `canvas`.
 * В среде без 2D-canvas (jsdom) композит не строится — слои передаются без растров.
 */
export async function sceneToPsd(scene: Scene, options: PsdExportOptions = {}): Promise<Psd> {
  const scale = options.scale ?? 1;
  const psd: Psd = {
    width: Math.round(scene.width * scale),
    height: Math.round(scene.height * scale),
    channels: 4,
    bitsPerChannel: 8,
    colorMode: 3,
    children: await buildChildren(scene, scale),
  };
  psd.canvas = await rasterizeComposite(scene, scale, async (ctx, layer) => {
    if (layer.type === 'path') paintPathLayer(ctx, layer);
    else if (layer.type === 'text') paintTextLayer(ctx, layer);
    else await paintImageLayer(ctx, layer);
  });
  return psd;
}

export async function sceneToPsdBytes(
  scene: Scene,
  options: PsdExportOptions = {}
): Promise<Uint8Array> {
  const psd = await sceneToPsd(scene, options);
  return writePsdUint8Array(psd, { generateThumbnail: true, invalidateTextLayers: true });
}

export { initializeCanvas, readPsd };
