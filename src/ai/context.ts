import { computeLayerWorldBBox } from '../core/math';
import type { Layer, Scene } from '../core/types';

export interface SceneContextLayer {
  id: string;
  name: string;
  type: Layer['type'];
  visible: boolean;
  locked: boolean;
  opacity: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  clipMaskId?: string;
  isClipMask?: boolean;
  bbox: { x: number; y: number; width: number; height: number };
  fill?: string | null;
  stroke?: { color: string; width: number } | null;
  fillRule?: 'nonzero' | 'evenodd';
  subpaths?: number;
  anchors?: number;
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface SceneContext {
  artboard: {
    name: string;
    width: number;
    height: number;
    dpi: number;
    background: string;
  };
  selectedIds: string[];
  layers: SceneContextLayer[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundBBox(box: { x: number; y: number; width: number; height: number }) {
  return {
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
  };
}

export function buildSceneContext(
  scene: Scene,
  selectedIds: string[]
): SceneContext {
  const ids = new Set(scene.layers.map((layer) => layer.id));
  return {
    artboard: {
      name: scene.name,
      width: scene.width,
      height: scene.height,
      dpi: scene.dpi,
      background: scene.background,
    },
    selectedIds: selectedIds.filter((id) => ids.has(id)),
    layers: scene.layers.map((layer) => {
      const base: SceneContextLayer = {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        visible: layer.visible,
        locked: layer.locked,
        opacity: round(layer.opacity),
        x: round(layer.x),
        y: round(layer.y),
        rotation: round(layer.rotation),
        scaleX: round(layer.scaleX),
        scaleY: round(layer.scaleY),
        bbox: roundBBox(computeLayerWorldBBox(layer)),
      };

      if (layer.clipMaskId) base.clipMaskId = layer.clipMaskId;

      if (layer.type === 'path') {
        base.isClipMask = layer.isClipMask === true;
        base.fill = layer.fill;
        base.stroke = layer.stroke
          ? { color: layer.stroke.color, width: layer.stroke.width }
          : null;
        base.fillRule = layer.fillRule;
        base.subpaths = layer.subpaths.length;
        base.anchors = layer.subpaths.reduce(
          (total, subpath) => total + subpath.anchors.length,
          0
        );
      } else if (layer.type === 'text') {
        base.content = layer.content;
        base.fontFamily = layer.fontFamily;
        base.fontSize = layer.fontSize;
        base.fontWeight = layer.fontWeight;
        base.align = layer.align;
        base.fill = layer.fill;
      } else {
        base.imageWidth = layer.width;
        base.imageHeight = layer.height;
      }

      return base;
    }),
  };
}

export function sceneContextToText(context: SceneContext): string {
  return [
    'Контекст сцены Locus (JSON):',
    JSON.stringify(context),
    '',
    'Слои перечислены в порядке отрисовки: первый элемент — самый нижний слой.',
  ].join('\n');
}
