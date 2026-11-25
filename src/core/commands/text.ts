import { resolveHostPathLayer, computeTextOnPathLocalBBox } from '../../engine/textOnPath';
import { convertTextLayerToOutlines } from '../../engine/textOutlines';
import { findLayerById, flattenLayers, mapLayerTree } from '../layerTree';
import { clamp } from '../math';
import { clonePaint } from '../paint';
import { useEditorStore } from '../store';
import type {
  FontFamily,
  Paint,
  PathLayer,
  Scene,
  TextLayer,
} from '../types';
import { commitScene, createLayerId } from './helpers';
import { addLayer } from './layers';

export type TextCaseMode = 'upper' | 'lower' | 'title';

export function createTextLayer(params: {
  x: number;
  y: number;
  content?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
  fontWeight?: 400 | 700;
  lineHeight?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  fill?: Paint;
  name?: string;
  select?: boolean;
  parentGroupId?: string | null;
  pathId?: string;
  pathOffset?: number;
  pathFlip?: boolean;
}): TextLayer {
  const state = useEditorStore.getState();
  const sameTypeCount =
    flattenLayers(state.scene.layers).filter((l) => l.type === 'text').length + 1;

  const layer: TextLayer = {
    id: createLayerId('text'),
    name: params.name?.trim() || `Текст ${sameTypeCount}`,
    type: 'text',
    visible: true,
    locked: false,
    x: params.x,
    y: params.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    content: params.content ?? 'Новый текст',
    fontSize: clamp(params.fontSize ?? 48, 6, 1000),
    fontFamily: params.fontFamily ?? 'Inter',
    fontWeight: params.fontWeight ?? 400,
    lineHeight: clamp(params.lineHeight ?? 1.2, 0.6, 4),
    ...(params.letterSpacing !== undefined
      ? { letterSpacing: clamp(params.letterSpacing, -20, 200) }
      : {}),
    fill: clonePaint(params.fill ?? '#1c1b1a'),
    align: params.align ?? 'left',
    ...(params.pathId ? { pathId: params.pathId } : {}),
    ...(params.pathOffset !== undefined
      ? { pathOffset: clamp(params.pathOffset, 0, 100) }
      : {}),
    ...(params.pathFlip ? { pathFlip: true } : {}),
  };

  return addLayer(layer, {
    select: params.select,
    parentGroupId: params.parentGroupId,
  }) as TextLayer;
}

export function attachTextToPath(
  textLayerId: string,
  pathLayerId: string
): TextLayer | null {
  let updated: TextLayer | null = null;
  commitScene((scene) => {
    const textLayer = findLayerById(scene.layers, textLayerId);
    const pathLayer = resolveHostPathLayer(scene.layers, pathLayerId);
    if (!textLayer || textLayer.type !== 'text' || textLayer.locked || !pathLayer) {
      return scene;
    }
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== textLayerId || layer.type !== 'text') return layer;
      const next: TextLayer = {
        ...layer,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pathId: pathLayer.id,
        pathOffset: layer.pathOffset ?? 0,
        pathFlip: Boolean(layer.pathFlip),
      };
      updated = next;
      return next;
    });
    return updated ? { ...scene, layers: nextLayers } : scene;
  });
  return updated;
}

export function detachTextFromPath(textLayerId: string): TextLayer | null {
  let updated: TextLayer | null = null;
  commitScene((scene) => {
    const textLayer = findLayerById(scene.layers, textLayerId);
    if (!textLayer || textLayer.type !== 'text' || textLayer.locked || !textLayer.pathId) {
      return scene;
    }
    const hostPath = resolveHostPathLayer(scene.layers, textLayer.pathId);
    const box = hostPath
      ? computeTextOnPathLocalBBox(textLayer, hostPath, scene.layers)
      : null;

    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== textLayerId || layer.type !== 'text') return layer;
      const copy: TextLayer = {
        ...layer,
        ...(box ? { x: Math.round(box.x), y: Math.round(box.y) } : {}),
      };
      delete copy.pathId;
      delete copy.pathOffset;
      delete copy.pathFlip;
      updated = copy;
      return copy;
    });
    return updated ? { ...scene, layers: nextLayers } : scene;
  });
  return updated;
}

export function transformTextCase(layerIds: string[], mode: TextCaseMode): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.type !== 'text' || layer.locked) {
        return layer;
      }
      let nextContent = layer.content;
      if (mode === 'upper') {
        nextContent = layer.content.toLocaleUpperCase('ru-RU');
      } else if (mode === 'lower') {
        nextContent = layer.content.toLocaleLowerCase('ru-RU');
      } else {
        nextContent = layer.content
          .toLocaleLowerCase('ru-RU')
          .replace(
            /(^|[\s\-—/("«])(\p{L})/gu,
            (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru-RU')
          );
      }
      if (nextContent === layer.content) return layer;
      changed = true;
      return { ...layer, content: nextContent };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export async function convertTextLayersToOutlines(
  layerIds: string[]
): Promise<PathLayer[]> {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is TextLayer => idSet.has(l.id) && l.type === 'text' && !l.locked
  );
  if (targets.length === 0) return [];

  const converted = await Promise.all(
    targets.map(async (layer) => {
      const hostPath = resolveHostPathLayer(state.scene.layers, layer.pathId);
      return {
        layer,
        outline: await convertTextLayerToOutlines(layer, hostPath, state.scene.layers),
      };
    })
  );

  const replacements = new Map<string, PathLayer>();
  const created: PathLayer[] = [];

  for (const { layer, outline } of converted) {
    if (!outline) continue;
    const pathLayer: PathLayer = {
      id: createLayerId('path'),
      name: `${layer.name} (кривые)`,
      type: 'path',
      visible: layer.visible,
      locked: false,
      x: outline.x,
      y: outline.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: layer.opacity,
      ...(layer.blendMode ? { blendMode: layer.blendMode } : {}),
      subpaths: outline.subpaths,
      fillRule: outline.fillRule,
      fill: clonePaint(layer.fill),
      stroke: null,
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    };
    replacements.set(layer.id, pathLayer);
    created.push(pathLayer);
  }

  if (created.length === 0) return [];

  commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      const replacement = replacements.get(layer.id);
      if (!replacement) return layer;
      changed = true;
      return replacement;
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });

  useEditorStore.setState({
    selectedIds: created.map((l) => l.id),
    selectedNode: null,
  });

  return created;
}
