import { getEffectsPadding } from '../engine/effects';
import { flattenLayers } from './layerTree';
import { computeLayerWorldBBox } from './math';
import type { Artboard, BBox, Layer, Point2D, Scene } from './types';

export const PRIMARY_ARTBOARD_ID = 'artboard_1';
export const ARTBOARD_DEFAULT_GAP = 80;

export function getSceneArtboards(scene: Scene): Artboard[] {
  if (scene.artboards && scene.artboards.length > 0) {
    return scene.artboards;
  }
  return [
    {
      id: PRIMARY_ARTBOARD_ID,
      name: 'Артборд 1',
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
      background: scene.background,
    },
  ];
}

export function getActiveArtboard(
  scene: Scene,
  activeArtboardId?: string | null
): Artboard {
  const artboards = getSceneArtboards(scene);
  if (activeArtboardId) {
    const found = artboards.find((ab) => ab.id === activeArtboardId);
    if (found) return found;
  }
  return artboards[0];
}

export function findArtboardAtPoint(
  scene: Scene,
  pt: Point2D
): Artboard | null {
  const artboards = getSceneArtboards(scene);
  for (let i = artboards.length - 1; i >= 0; i -= 1) {
    const ab = artboards[i];
    if (
      pt.x >= ab.x &&
      pt.x <= ab.x + ab.width &&
      pt.y >= ab.y &&
      pt.y <= ab.y + ab.height
    ) {
      return ab;
    }
  }
  return null;
}

export function getArtboardsCombinedBBox(artboards: Artboard[]): BBox {
  if (artboards.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ab of artboards) {
    if (ab.x < minX) minX = ab.x;
    if (ab.y < minY) minY = ab.y;
    if (ab.x + ab.width > maxX) maxX = ab.x + ab.width;
    if (ab.y + ab.height > maxY) maxY = ab.y + ab.height;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getSubtreePadding(layer: Layer): number {
  let maxPad = 0;
  for (const node of flattenLayers([layer])) {
    const fxPad = getEffectsPadding(node.effects);
    const strokePad = node.type === 'path' && node.stroke ? node.stroke.width : 0;
    const total = fxPad + strokePad;
    if (total > maxPad) maxPad = total;
  }
  return maxPad;
}

function boxesIntersect(a: BBox, b: BBox): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function extractArtboardScene(scene: Scene, artboard: Artboard): Scene {
  const artboards = getSceneArtboards(scene);
  if (
    artboards.length === 1 &&
    artboard.x === 0 &&
    artboard.y === 0 &&
    artboard.width === scene.width &&
    artboard.height === scene.height &&
    artboard.background === scene.background
  ) {
    return scene;
  }

  const abBox: BBox = {
    x: artboard.x,
    y: artboard.y,
    width: artboard.width,
    height: artboard.height,
  };
  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const includedIds = new Set<string>();

  for (const layer of scene.layers) {
    const box = computeLayerWorldBBox(layer, scene.layers);
    const pad = getSubtreePadding(layer);
    const paddedBox: BBox = {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + pad * 2,
      height: box.height + pad * 2,
    };
    if (boxesIntersect(paddedBox, abBox)) {
      includedIds.add(layer.id);
      let cursor = layer.clipMaskId;
      while (cursor && !includedIds.has(cursor)) {
        const mask = byId.get(cursor);
        if (!mask) break;
        includedIds.add(mask.id);
        cursor = mask.clipMaskId;
      }
    }
  }

  const shiftedLayers = scene.layers
    .filter((l) => includedIds.has(l.id))
    .map((l) => ({
      ...l,
      x: l.x - artboard.x,
      y: l.y - artboard.y,
    }));

  return {
    version: 1,
    name: scene.name,
    width: artboard.width,
    height: artboard.height,
    dpi: scene.dpi,
    background: artboard.background,
    layers: shiftedLayers,
  };
}
