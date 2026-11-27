import {
  computeOffsetPath,
  computeOutlineStroke,
  computeSimplifiedPath,
} from '../../engine/booleans';
import { hasVectorEffects, resolveEffectivePathGeometry } from '../../engine/effects';
import {
  rasterizeImageAssetToRgba,
  traceRgbaToVectorPaths,
  type ImageTraceOptions,
} from '../../engine/imageTrace';
import { computeKnifeSlice, computeScissorsCut } from '../../engine/knife';
import { findLayerById, flattenLayers, mapLayerTree } from '../layerTree';
import { normalizePathLayer } from '../math';
import { clonePaint, cloneStroke } from '../paint';
import { useEditorStore } from '../store';
import type { GroupLayer, ImageLayer, Layer, PathLayer, Point2D, Scene } from '../types';
import {
  clearTextPathProps,
  commitScene,
  createLayerId,
  replacePerIdInList,
  validateSelectionAgainstScene,
} from './helpers';

export function offsetPathLayers(
  layerIds: string[],
  distance: number,
  opts?: { copyBehind?: boolean; join?: 'round' | 'miter' | 'bevel' }
): PathLayer[] {
  if (layerIds.length === 0 || Math.abs(distance) < 1e-4) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer => idSet.has(l.id) && l.type === 'path' && !l.locked
  );
  if (targets.length === 0) return [];

  const copyBehind = Boolean(opts?.copyBehind);
  const join = opts?.join ?? 'round';
  const replacements = new Map<string, Layer[]>();
  const created: PathLayer[] = [];

  for (const layer of targets) {
    const res = computeOffsetPath(layer, distance, join);
    if (!res) continue;

    if (copyBehind) {
      const copyLayer: PathLayer = {
        id: createLayerId('path'),
        name: `${layer.name} (контур)`,
        type: 'path',
        visible: layer.visible,
        locked: false,
        x: res.x,
        y: res.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: layer.opacity,
        subpaths: res.subpaths,
        fillRule: res.fillRule,
        fill: clonePaint(layer.fill),
        stroke: cloneStroke(layer.stroke),
        ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
      };
      replacements.set(layer.id, [copyLayer, layer]);
      created.push(copyLayer);
    } else {
      const updatedLayer: PathLayer = {
        ...layer,
        x: res.x,
        y: res.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        subpaths: res.subpaths,
        fillRule: res.fillRule,
      };
      replacements.set(layer.id, [updatedLayer]);
      created.push(updatedLayer);
    }
  }

  if (created.length === 0) return [];

  commitScene((scene) => {
    const nextLayers = replacePerIdInList(scene.layers, replacements);
    return nextLayers === scene.layers ? scene : { ...scene, layers: nextLayers };
  });

  if (copyBehind) {
    useEditorStore.setState({
      selectedIds: created.map((l) => l.id),
      selectedNode: null,
    });
  }

  return created;
}

export function outlineStrokeLayers(layerIds: string[]): PathLayer[] {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer =>
      idSet.has(l.id) &&
      l.type === 'path' &&
      !l.locked &&
      l.stroke !== null &&
      l.stroke.width > 0
  );
  if (targets.length === 0) return [];

  const replacements = new Map<string, Layer[]>();
  const resultSelected: PathLayer[] = [];

  for (const layer of targets) {
    const outlined = computeOutlineStroke(layer);
    if (!outlined || !layer.stroke) continue;

    if (layer.fill === null) {
      const converted: PathLayer = {
        ...layer,
        x: outlined.x,
        y: outlined.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        subpaths: outlined.subpaths,
        fillRule: outlined.fillRule,
        fill: clonePaint(layer.stroke.color),
        stroke: null,
      };
      replacements.set(layer.id, [converted]);
      resultSelected.push(converted);
    } else {
      const strippedBase: PathLayer = {
        ...layer,
        stroke: null,
      };
      const strokeLayer: PathLayer = {
        id: createLayerId('path'),
        name: `${layer.name} (обводка)`,
        type: 'path',
        visible: layer.visible,
        locked: false,
        x: outlined.x,
        y: outlined.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: layer.opacity,
        subpaths: outlined.subpaths,
        fillRule: outlined.fillRule,
        fill: clonePaint(layer.stroke.color),
        stroke: null,
        ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
      };
      replacements.set(layer.id, [strippedBase, strokeLayer]);
      resultSelected.push(strokeLayer);
    }
  }

  if (resultSelected.length === 0) return [];

  commitScene((scene) => {
    const nextLayers = replacePerIdInList(scene.layers, replacements);
    return nextLayers === scene.layers ? scene : { ...scene, layers: nextLayers };
  });

  useEditorStore.setState({
    selectedIds: resultSelected.map((l) => l.id),
    selectedNode: null,
  });

  return resultSelected;
}

export function simplifyPathLayers(layerIds: string[], tolerance = 2.5): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.type !== 'path' || layer.locked) {
        return layer;
      }
      const res = computeSimplifiedPath(layer, tolerance);
      if (!res) return layer;
      changed = true;
      return {
        ...layer,
        x: res.x,
        y: res.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        subpaths: res.subpaths,
        fillRule: res.fillRule,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

/** Запекает недеструктивные векторные эффекты (Warp / Distort / 3D) в обычные кривые. */
export function expandLayerAppearance(layerIds: string[]): PathLayer[] {
  if (layerIds.length === 0) return [];
  const idSet = new Set(layerIds);
  const resultingIds: string[] = [];

  commitScene((scene) => {
    const expandInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];

      for (const layer of layers) {
        if (layer.type === 'group') {
          const nextChildren = expandInList(layer.children);
          if (nextChildren !== layer.children) {
            changed = true;
            next.push({ ...layer, children: nextChildren });
          } else {
            next.push(layer);
          }
          continue;
        }
        if (
          !idSet.has(layer.id) ||
          layer.type !== 'path' ||
          layer.locked ||
          !hasVectorEffects(layer.effects)
        ) {
          next.push(layer);
          continue;
        }

        changed = true;
        const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
        const remainingEffects = layer.effects
          ? {
              ...(layer.effects.blur !== undefined ? { blur: layer.effects.blur } : {}),
              ...(layer.effects.motionBlur ? { motionBlur: layer.effects.motionBlur } : {}),
              ...(layer.effects.dropShadow ? { dropShadow: layer.effects.dropShadow } : {}),
              ...(layer.effects.innerShadow ? { innerShadow: layer.effects.innerShadow } : {}),
              ...(layer.effects.outerGlow ? { outerGlow: layer.effects.outerGlow } : {}),
              ...(layer.effects.colorAdjust ? { colorAdjust: layer.effects.colorAdjust } : {}),
            }
          : undefined;
        const cleanEffects =
          remainingEffects && Object.keys(remainingEffects).length > 0
            ? remainingEffects
            : undefined;

        extrudeFaces.forEach((face, idx) => {
          const faceLayer = normalizePathLayer({
            id: createLayerId('face'),
            name: `${layer.name} грань ${idx + 1}`,
            type: 'path',
            visible: layer.visible,
            locked: false,
            x: layer.x,
            y: layer.y,
            rotation: layer.rotation,
            scaleX: layer.scaleX,
            scaleY: layer.scaleY,
            opacity: layer.opacity,
            clipMaskId: layer.clipMaskId,
            subpaths: face.subpaths,
            fillRule: 'nonzero',
            fill: face.fill,
            stroke: null,
          });
          next.push(faceLayer);
          resultingIds.push(faceLayer.id);
        });

        const updated = normalizePathLayer({
          ...layer,
          subpaths,
          effects: cleanEffects,
        });
        next.push(updated);
        resultingIds.push(updated.id);
      }
      return changed ? next : layers;
    };

    const nextLayers = expandInList(scene.layers);
    return nextLayers === scene.layers ? scene : { ...scene, layers: nextLayers };
  });

  if (resultingIds.length === 0) return [];
  useEditorStore.setState({ selectedIds: resultingIds, selectedNode: null });
  const idOut = new Set(resultingIds);
  return flattenLayers(useEditorStore.getState().scene.layers).filter(
    (l): l is PathLayer => l.type === 'path' && idOut.has(l.id)
  );
}

export function cutPathAtPoint(
  layerId: string,
  scopePoint: Point2D,
  tolerance = 8
): PathLayer[] {
  const state = useEditorStore.getState();
  const layer = findLayerById(state.scene.layers, layerId);
  if (!layer || layer.type !== 'path' || layer.locked) return [];

  const parts = computeScissorsCut(layer, scopePoint, tolerance);
  if (!parts || parts.length === 0) return [];

  const hasOpen = parts.some((p) => p.subpaths.some((sp) => !sp.closed));
  const fallbackStroke =
    hasOpen && layer.fill === null && layer.stroke === null
      ? { color: '#1c1b1a', width: 2, lineCap: 'round' as const, lineJoin: 'round' as const }
      : null;

  const created: PathLayer[] = parts.map((part, idx) => ({
    id: createLayerId('path'),
    name: parts.length > 1 ? `${layer.name} · ${idx + 1}` : layer.name,
    type: 'path',
    visible: layer.visible,
    locked: false,
    x: part.x,
    y: part.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: layer.opacity,
    ...(layer.blendMode ? { blendMode: layer.blendMode } : {}),
    subpaths: part.subpaths,
    fillRule: part.fillRule,
    fill: clonePaint(layer.fill),
    stroke: cloneStroke(layer.stroke) ?? fallbackStroke,
    ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
  }));

  const replacedIds = new Set([layer.id]);
  const map = new Map<string, Layer[]>([[layer.id, created]]);

  commitScene((scene) => {
    const replaced = replacePerIdInList(scene.layers, map);
    const cleaned = mapLayerTree(replaced, (node) => {
      let nextNode = node;
      if (nextNode.clipMaskId && replacedIds.has(nextNode.clipMaskId)) {
        const copy = { ...nextNode };
        delete copy.clipMaskId;
        nextNode = copy;
      }
      if (nextNode.type === 'text' && nextNode.pathId && replacedIds.has(nextNode.pathId)) {
        nextNode = clearTextPathProps(nextNode);
      }
      return nextNode;
    });
    return { ...scene, layers: cleaned };
  });

  useEditorStore.setState({
    selectedIds: created.map((l) => l.id),
    selectedNode: null,
  });
  return created;
}

export function slicePathLayers(
  layerIds: string[],
  cutScopePoints: Point2D[]
): PathLayer[] {
  if (layerIds.length === 0 || cutScopePoints.length < 2) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer => idSet.has(l.id) && l.type === 'path' && !l.locked
  );
  if (targets.length === 0) return [];

  const replacements = new Map<string, Layer[]>();
  const slicedIds = new Set<string>();
  const createdAll: PathLayer[] = [];

  for (const layer of targets) {
    const pieces = computeKnifeSlice(layer, cutScopePoints);
    if (!pieces || pieces.length < 2) continue;

    slicedIds.add(layer.id);
    const createdForLayer: PathLayer[] = pieces.map((piece, idx) => ({
      id: createLayerId('path'),
      name: `${layer.name} · ${idx + 1}`,
      type: 'path',
      visible: layer.visible,
      locked: false,
      x: piece.x,
      y: piece.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: layer.opacity,
      ...(layer.blendMode ? { blendMode: layer.blendMode } : {}),
      subpaths: piece.subpaths,
      fillRule: piece.fillRule,
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke),
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    }));
    replacements.set(layer.id, createdForLayer);
    createdAll.push(...createdForLayer);
  }

  if (createdAll.length === 0) return [];

  commitScene((scene) => {
    const replaced = replacePerIdInList(scene.layers, replacements);
    const cleaned = mapLayerTree(replaced, (node) => {
      let nextNode = node;
      if (nextNode.clipMaskId && slicedIds.has(nextNode.clipMaskId)) {
        const copy = { ...nextNode };
        delete copy.clipMaskId;
        nextNode = copy;
      }
      if (nextNode.type === 'text' && nextNode.pathId && slicedIds.has(nextNode.pathId)) {
        nextNode = clearTextPathProps(nextNode);
      }
      return nextNode;
    });
    return { ...scene, layers: cleaned };
  });

  useEditorStore.setState({
    selectedIds: createdAll.map((l) => l.id),
    selectedNode: null,
  });
  return createdAll;
}

export function traceImageLayer(
  layerId: string,
  options?: Partial<ImageTraceOptions>,
  precomputedRgba?: { data: Uint8ClampedArray; width: number; height: number }
): Layer | null {
  const state = useEditorStore.getState();
  const found = findLayerById(state.scene.layers, layerId);
  if (!found || found.type !== 'image' || found.locked) return null;
  const imgLayer: ImageLayer = found;

  const pixels = precomputedRgba ?? rasterizeImageAssetToRgba(imgLayer.assetId);
  if (!pixels) return null;

  const traced = traceRgbaToVectorPaths(
    pixels.data,
    pixels.width,
    pixels.height,
    imgLayer.width,
    imgLayer.height,
    options
  );
  if (traced.length === 0) return null;

  let replacement: Layer;
  if (traced.length === 1) {
    replacement = normalizePathLayer({
      id: createLayerId('path'),
      name: `${imgLayer.name} (вектор)`,
      type: 'path',
      visible: imgLayer.visible,
      locked: false,
      x: imgLayer.x,
      y: imgLayer.y,
      rotation: imgLayer.rotation,
      scaleX: imgLayer.scaleX,
      scaleY: imgLayer.scaleY,
      opacity: imgLayer.opacity,
      ...(imgLayer.blendMode ? { blendMode: imgLayer.blendMode } : {}),
      ...(imgLayer.clipMaskId ? { clipMaskId: imgLayer.clipMaskId } : {}),
      subpaths: traced[0].subpaths,
      fillRule: traced[0].fillRule,
      fill: traced[0].fill,
      stroke: null,
    });
  } else {
    const children: PathLayer[] = traced.map((item, idx) =>
      normalizePathLayer({
        id: createLayerId('path'),
        name: `${imgLayer.name} · ${idx + 1}`,
        type: 'path',
        visible: true,
        locked: false,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        subpaths: item.subpaths,
        fillRule: item.fillRule,
        fill: item.fill,
        stroke: null,
      })
    );
    const group: GroupLayer = {
      id: createLayerId('group'),
      name: `${imgLayer.name} (вектор)`,
      type: 'group',
      visible: imgLayer.visible,
      locked: false,
      x: imgLayer.x,
      y: imgLayer.y,
      rotation: imgLayer.rotation,
      scaleX: imgLayer.scaleX,
      scaleY: imgLayer.scaleY,
      opacity: imgLayer.opacity,
      ...(imgLayer.blendMode ? { blendMode: imgLayer.blendMode } : {}),
      ...(imgLayer.clipMaskId ? { clipMaskId: imgLayer.clipMaskId } : {}),
      children,
    };
    replacement = group;
  }

  const nextScene = commitScene((scene) => ({
    ...scene,
    layers: mapLayerTree(scene.layers, (layer) =>
      layer.id === imgLayer.id ? replacement : layer
    ),
  }));

  useEditorStore.setState({
    selectedIds: [replacement.id],
    selectedNode: null,
  });
  validateSelectionAgainstScene(nextScene);
  return replacement;
}
