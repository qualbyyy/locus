import {
  computeBooleanOperation,
  computeCombineCompoundPath,
  computeDivideOperation,
  computeOffsetPath,
  computeOutlineStroke,
  computeSimplifiedPath,
  computeSplitCompoundPath,
  type BooleanOp,
  type BooleanResult,
} from '../../engine/booleans';
import { randomizeAnchors, roundPathCorners, smoothSubPaths } from '../../engine/geometry';
import {
  rasterizeImageAssetToRgba,
  traceRgbaToVectorPaths,
  type ImageTraceOptions,
} from '../../engine/imageTrace';
import { computeKnifeSlice, computeScissorsCut } from '../../engine/knife';
import {
  hasVectorEffects,
  resolveEffectivePathGeometry,
} from '../../engine/effects';
import {
  findLayerById,
  flattenLayers,
  mapLayerTree,
} from '../layerTree';
import {
  cloneSubPaths,
  normalizePathLayer,
  splitCubicBezier,
} from '../math';
import { clonePaint, cloneStroke } from '../paint';
import { useEditorStore } from '../store';
import type {
  GroupLayer,
  ImageLayer,
  Layer,
  PathLayer,
  Point2D,
  Scene,
  SelectedNodeRef,
  SubPath,
} from '../types';
import {
  commitScene,
  createLayerId,
  findSharedClipMaskId,
  replaceLayersAtHighestIndex,
  validateSelectionAgainstScene,
} from './helpers';
import { deleteLayers, updateLayers } from './layers';

const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  unite: 'Объединение',
  subtract: 'Вычитание',
  intersect: 'Пересечение',
  exclude: 'Исключение',
  divide: 'Разделение',
};

export function updatePathSubpaths(
  layerId: string,
  subpaths: SubPath[]
): PathLayer | null {
  let result: PathLayer | null = null;
  commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== layerId || layer.type !== 'path') return layer;
      changed = true;
      const normalized = normalizePathLayer({
        ...layer,
        subpaths: cloneSubPaths(subpaths),
      });
      result = normalized;
      return normalized;
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
  return result;
}

export function insertAnchorOnSegment(
  layerId: string,
  subpathIndex: number,
  segmentIndex: number,
  t: number
): SelectedNodeRef | null {
  const layer = findLayerById(useEditorStore.getState().scene.layers, layerId);
  if (!layer || layer.type !== 'path') return null;

  const sp = layer.subpaths[subpathIndex];
  if (!sp || sp.anchors.length < 2) return null;

  const maxSeg = sp.closed ? sp.anchors.length - 1 : sp.anchors.length - 2;
  if (segmentIndex < 0 || segmentIndex > maxSeg) return null;

  const nextIndex = (segmentIndex + 1) % sp.anchors.length;
  const split = splitCubicBezier(
    sp.anchors[segmentIndex],
    sp.anchors[nextIndex],
    t
  );

  const nextSubpaths = cloneSubPaths(layer.subpaths);
  const targetSp = nextSubpaths[subpathIndex];
  targetSp.anchors[segmentIndex] = {
    ...targetSp.anchors[segmentIndex],
    handleOut: split.a0HandleOut,
  };
  targetSp.anchors[nextIndex] = {
    ...targetSp.anchors[nextIndex],
    handleIn: split.a1HandleIn,
  };

  const insertAt = segmentIndex + 1;
  targetSp.anchors.splice(insertAt, 0, split.midAnchor);

  updatePathSubpaths(layerId, nextSubpaths);
  const ref: SelectedNodeRef = {
    layerId,
    subpathIndex,
    anchorIndex: insertAt,
  };
  useEditorStore.setState({ selectedNode: ref });
  return ref;
}

export function deleteAnchor(
  layerId: string,
  subpathIndex: number,
  anchorIndex: number
): boolean {
  const layer = findLayerById(useEditorStore.getState().scene.layers, layerId);
  if (!layer || layer.type !== 'path') return false;

  const sp = layer.subpaths[subpathIndex];
  if (!sp || sp.anchors.length <= 2) return false;
  if (anchorIndex < 0 || anchorIndex >= sp.anchors.length) return false;

  const nextSubpaths = cloneSubPaths(layer.subpaths);
  nextSubpaths[subpathIndex].anchors.splice(anchorIndex, 1);

  updatePathSubpaths(layerId, nextSubpaths);

  const remaining = nextSubpaths[subpathIndex].anchors.length;
  const nextAnchorIndex = Math.min(anchorIndex, remaining - 1);
  useEditorStore.setState({
    selectedNode:
      remaining > 0
        ? { layerId, subpathIndex, anchorIndex: nextAnchorIndex }
        : null,
  });
  return true;
}

export function toggleAnchorSmooth(
  layerId: string,
  subpathIndex: number,
  anchorIndex: number
): boolean {
  const layer = findLayerById(useEditorStore.getState().scene.layers, layerId);
  if (!layer || layer.type !== 'path') return false;

  const sp = layer.subpaths[subpathIndex];
  if (!sp || anchorIndex < 0 || anchorIndex >= sp.anchors.length) return false;

  const anchor = sp.anchors[anchorIndex];
  const hasHandles =
    Math.hypot(anchor.handleIn.x, anchor.handleIn.y) > 1e-3 ||
    Math.hypot(anchor.handleOut.x, anchor.handleOut.y) > 1e-3;

  const nextSubpaths = cloneSubPaths(layer.subpaths);
  const targetSp = nextSubpaths[subpathIndex];
  const target = targetSp.anchors[anchorIndex];

  if (target.smooth || hasHandles) {
    target.handleIn = { x: 0, y: 0 };
    target.handleOut = { x: 0, y: 0 };
    target.smooth = false;
  } else {
    const smoothedSp = smoothSubPaths([targetSp], 1)[0];
    targetSp.anchors[anchorIndex] = smoothedSp.anchors[anchorIndex];
  }

  updatePathSubpaths(layerId, nextSubpaths);
  useEditorStore.setState({
    selectedNode: { layerId, subpathIndex, anchorIndex },
  });
  return true;
}

export function smoothLayers(layerIds: string[], factor = 1): Scene {
  return updateLayers(layerIds, (layer) => {
    if (layer.type !== 'path') return layer;
    return {
      ...layer,
      subpaths: smoothSubPaths(layer.subpaths, factor),
    };
  });
}

export function roundCornersLayers(layerIds: string[], radius: number): Scene {
  if (layerIds.length === 0 || radius <= 0) {
    return useEditorStore.getState().scene;
  }
  return updateLayers(layerIds, (layer) => {
    if (layer.type !== 'path') return layer;
    return {
      ...layer,
      subpaths: roundPathCorners(layer.subpaths, radius),
    };
  });
}

export function wobbleLayers(
  layerIds: string[],
  intensity: number,
  seed?: number
): Scene {
  let offsetSeed = seed;
  return updateLayers(layerIds, (layer) => {
    if (layer.type !== 'path') return layer;
    const nextSeed = offsetSeed !== undefined ? offsetSeed++ : undefined;
    return {
      ...layer,
      subpaths: randomizeAnchors(layer.subpaths, intensity, nextSeed),
    };
  });
}

export function divideLayers(layerIds: string[]): PathLayer[] {
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );

  if (targets.length < 2) {
    return [];
  }

  const pieces = computeDivideOperation(targets);
  if (pieces.length === 0) {
    return [];
  }

  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const createdLayers: PathLayer[] = pieces.map((piece, idx) => {
    const src = targets[piece.sourceIndex] ?? targets[0];
    return {
      id: createLayerId('path'),
      name: `Часть ${idx + 1}`,
      type: 'path',
      visible: true,
      locked: false,
      x: piece.x,
      y: piece.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: src.opacity,
      subpaths: piece.subpaths,
      fillRule: piece.fillRule,
      fill: clonePaint(src.fill),
      stroke: cloneStroke(src.stroke),
      ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
    };
  });

  replaceLayersAtHighestIndex(targetSet, createdLayers);
  return createdLayers;
}

export function booleanLayers(
  layerIds: string[],
  operation: BooleanOp
): PathLayer | null {
  if (operation === 'divide') {
    const pieces = divideLayers(layerIds);
    return pieces[0] ?? null;
  }

  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );

  if (targets.length < 2) {
    return null;
  }

  const result = computeBooleanOperation(targets, operation);
  if (!result) {
    return null;
  }

  const topTarget = targets[targets.length - 1];
  const styleSource =
    operation === 'subtract'
      ? targets[0]
      : topTarget.fill !== null || topTarget.stroke !== null
        ? topTarget
        : targets[0];

  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const newLayer: PathLayer = {
    id: createLayerId('path'),
    name: BOOLEAN_LABELS[operation],
    type: 'path',
    visible: true,
    locked: false,
    x: result.x,
    y: result.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: styleSource.opacity,
    subpaths: result.subpaths,
    fillRule: result.fillRule,
    fill: clonePaint(styleSource.fill),
    stroke: cloneStroke(styleSource.stroke),
    ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
  };

  replaceLayersAtHighestIndex(targetSet, [newLayer]);
  return newLayer;
}

function replacePerIdInList(
  layers: Layer[],
  replacements: Map<string, Layer[]>
): Layer[] {
  let changed = false;
  const next: Layer[] = [];
  for (const rawLayer of layers) {
    let layer = rawLayer;
    if (layer.type === 'group') {
      const nextChildren = replacePerIdInList(layer.children, replacements);
      if (nextChildren !== layer.children) {
        layer = { ...layer, children: nextChildren };
        changed = true;
      }
    }
    const items = replacements.get(layer.id);
    if (items) {
      changed = true;
      next.push(...items);
    } else {
      next.push(layer);
    }
  }
  return changed ? next : layers;
}

export function splitCompoundPathLayers(layerIds: string[]): PathLayer[] {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer =>
      idSet.has(l.id) && l.type === 'path' && !l.locked && l.subpaths.length > 1
  );
  if (targets.length === 0) return [];

  const splitMap = new Map<string, Layer[]>();
  const splitSourceIds = new Set<string>();
  const createdAll: PathLayer[] = [];

  for (const layer of targets) {
    const parts = computeSplitCompoundPath(layer);
    if (parts.length < 2) continue;

    splitSourceIds.add(layer.id);
    const createdForLayer = parts.map((part, idx): PathLayer => ({
      id: createLayerId('path'),
      name: `${layer.name} · ${idx + 1}`,
      type: 'path',
      visible: layer.visible,
      locked: false,
      x: part.x,
      y: part.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: layer.opacity,
      subpaths: part.subpaths,
      fillRule: part.fillRule,
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke),
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    }));
    splitMap.set(layer.id, createdForLayer);
    createdAll.push(...createdForLayer);
  }

  if (createdAll.length === 0) return [];

  commitScene((scene) => {
    const replaced = replacePerIdInList(scene.layers, splitMap);
    const cleaned = mapLayerTree(replaced, (layer) => {
      if (layer.clipMaskId && splitSourceIds.has(layer.clipMaskId)) {
        const copy = { ...layer };
        delete copy.clipMaskId;
        return copy;
      }
      return layer;
    });
    return { ...scene, layers: cleaned };
  });

  useEditorStore.setState({
    selectedIds: createdAll.map((l) => l.id),
    selectedNode: null,
  });

  return createdAll;
}

export function combineCompoundPathLayers(layerIds: string[]): PathLayer | null {
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer => idSet.has(l.id) && l.type === 'path' && !l.locked
  );
  if (targets.length < 2) return null;

  const combined = computeCombineCompoundPath(targets);
  if (!combined) return null;

  const topTarget = targets[targets.length - 1];
  const styleSource =
    topTarget.fill !== null || topTarget.stroke !== null ? topTarget : targets[0];
  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const newLayer: PathLayer = {
    id: createLayerId('path'),
    name: 'Составной контур',
    type: 'path',
    visible: true,
    locked: false,
    x: combined.x,
    y: combined.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: styleSource.opacity,
    subpaths: combined.subpaths,
    fillRule: 'evenodd',
    fill: clonePaint(styleSource.fill),
    stroke: cloneStroke(styleSource.stroke),
    ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
  };

  replaceLayersAtHighestIndex(targetSet, [newLayer]);
  return newLayer;
}

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
              ...(layer.effects.dropShadow ? { dropShadow: layer.effects.dropShadow } : {}),
              ...(layer.effects.outerGlow ? { outerGlow: layer.effects.outerGlow } : {}),
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

export function applyShapeBuilderOperation(
  sourceLayerIds: string[],
  pieces: Array<BooleanResult & { sourceIndex: number }>
): PathLayer[] {
  if (sourceLayerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(sourceLayerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );
  if (targets.length === 0) return [];

  const targetSet = new Set(targets.map((t) => t.id));
  if (pieces.length === 0) {
    deleteLayers(Array.from(targetSet));
    return [];
  }

  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);
  const createdLayers: PathLayer[] = pieces.map((piece, idx) => {
    const src = targets[piece.sourceIndex] ?? targets[0];
    return {
      id: createLayerId('path'),
      name: `Фигура ${idx + 1}`,
      type: 'path',
      visible: true,
      locked: false,
      x: piece.x,
      y: piece.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: src.opacity,
      ...(src.blendMode ? { blendMode: src.blendMode } : {}),
      subpaths: piece.subpaths,
      fillRule: piece.fillRule,
      fill: clonePaint(src.fill),
      stroke: cloneStroke(src.stroke),
      ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
    };
  });

  replaceLayersAtHighestIndex(targetSet, createdLayers);
  return createdLayers;
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
        const copy = { ...nextNode };
        delete copy.pathId;
        delete copy.pathOffset;
        delete copy.pathFlip;
        nextNode = copy;
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
        const copy = { ...nextNode };
        delete copy.pathId;
        delete copy.pathOffset;
        delete copy.pathFlip;
        nextNode = copy;
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
