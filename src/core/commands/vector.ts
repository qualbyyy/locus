import {
  computeBooleanOperation,
  computeCombineCompoundPath,
  computeDivideOperation,
  computeOffsetPath,
  computeOutlineStroke,
  computeSimplifiedPath,
  computeSplitCompoundPath,
  type BooleanOp,
} from '../../engine/booleans';
import { randomizeAnchors, roundPathCorners, smoothSubPaths } from '../../engine/geometry';
import {
  hasVectorEffects,
  resolveEffectivePathGeometry,
} from '../../engine/effects';
import {
  cloneSubPaths,
  normalizePathLayer,
  splitCubicBezier,
} from '../math';
import { useEditorStore } from '../store';
import type {
  Layer,
  PathLayer,
  Scene,
  SelectedNodeRef,
  SubPath,
} from '../types';
import {
  commitScene,
  createLayerId,
  findSharedClipMaskId,
  replaceLayersAtHighestIndex,
} from './helpers';
import { updateLayers } from './layers';

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
    const nextLayers = scene.layers.map((layer) => {
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
  const layer = useEditorStore
    .getState()
    .scene.layers.find((item) => item.id === layerId);
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
  const layer = useEditorStore
    .getState()
    .scene.layers.find((item) => item.id === layerId);
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
  const layer = useEditorStore
    .getState()
    .scene.layers.find((item) => item.id === layerId);
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
  const targets = state.scene.layers.filter(
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
      fill: src.fill,
      stroke: src.stroke ? { ...src.stroke } : null,
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
  const targets = state.scene.layers.filter(
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
    fill: styleSource.fill,
    stroke: styleSource.stroke ? { ...styleSource.stroke } : null,
    ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
  };

  replaceLayersAtHighestIndex(targetSet, [newLayer]);
  return newLayer;
}

export function splitCompoundPathLayers(layerIds: string[]): PathLayer[] {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = state.scene.layers.filter(
    (l): l is PathLayer =>
      idSet.has(l.id) && l.type === 'path' && !l.locked && l.subpaths.length > 1
  );
  if (targets.length === 0) return [];

  const splitMap = new Map<string, PathLayer[]>();
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
      fill: layer.fill,
      stroke: layer.stroke ? { ...layer.stroke } : null,
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    }));
    splitMap.set(layer.id, createdForLayer);
    createdAll.push(...createdForLayer);
  }

  if (createdAll.length === 0) return [];

  commitScene((scene) => {
    const nextLayers: Layer[] = [];
    for (const layer of scene.layers) {
      const parts = splitMap.get(layer.id);
      if (parts) {
        nextLayers.push(...parts);
        continue;
      }
      if (layer.clipMaskId && splitSourceIds.has(layer.clipMaskId)) {
        const cleaned = { ...layer };
        delete cleaned.clipMaskId;
        nextLayers.push(cleaned);
      } else {
        nextLayers.push(layer);
      }
    }
    return { ...scene, layers: nextLayers };
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
  const targets = state.scene.layers.filter(
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
    fill: styleSource.fill,
    stroke: styleSource.stroke ? { ...styleSource.stroke } : null,
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
  const targets = state.scene.layers.filter(
    (l): l is PathLayer => idSet.has(l.id) && l.type === 'path' && !l.locked
  );
  if (targets.length === 0) return [];

  const copyBehind = Boolean(opts?.copyBehind);
  const join = opts?.join ?? 'round';
  const results = new Map<string, PathLayer>();
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
        fill: layer.fill,
        stroke: layer.stroke ? { ...layer.stroke } : null,
        ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
      };
      results.set(layer.id, copyLayer);
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
      results.set(layer.id, updatedLayer);
      created.push(updatedLayer);
    }
  }

  if (created.length === 0) return [];

  commitScene((scene) => {
    const nextLayers: Layer[] = [];
    for (const layer of scene.layers) {
      const mapped = results.get(layer.id);
      if (!mapped) {
        nextLayers.push(layer);
        continue;
      }
      if (copyBehind) {
        nextLayers.push(mapped, layer);
      } else {
        nextLayers.push(mapped);
      }
    }
    return { ...scene, layers: nextLayers };
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
  const targets = state.scene.layers.filter(
    (l): l is PathLayer =>
      idSet.has(l.id) &&
      l.type === 'path' &&
      !l.locked &&
      l.stroke !== null &&
      l.stroke.width > 0
  );
  if (targets.length === 0) return [];

  const replacements = new Map<
    string,
    { updatedBase: PathLayer; extraStrokeLayer?: PathLayer }
  >();
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
        fill: layer.stroke.color,
        stroke: null,
      };
      replacements.set(layer.id, { updatedBase: converted });
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
        fill: layer.stroke.color,
        stroke: null,
        ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
      };
      replacements.set(layer.id, {
        updatedBase: strippedBase,
        extraStrokeLayer: strokeLayer,
      });
      resultSelected.push(strokeLayer);
    }
  }

  if (resultSelected.length === 0) return [];

  commitScene((scene) => {
    const nextLayers: Layer[] = [];
    for (const layer of scene.layers) {
      const entry = replacements.get(layer.id);
      if (!entry) {
        nextLayers.push(layer);
        continue;
      }
      nextLayers.push(entry.updatedBase);
      if (entry.extraStrokeLayer) {
        nextLayers.push(entry.extraStrokeLayer);
      }
    }
    return { ...scene, layers: nextLayers };
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
    const nextLayers = scene.layers.map((layer) => {
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
    let changed = false;
    const nextLayers: Layer[] = [];

    for (const layer of scene.layers) {
      if (
        !idSet.has(layer.id) ||
        layer.type !== 'path' ||
        layer.locked ||
        !hasVectorEffects(layer.effects)
      ) {
        nextLayers.push(layer);
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
        nextLayers.push(faceLayer);
        resultingIds.push(faceLayer.id);
      });

      const updated = normalizePathLayer({
        ...layer,
        subpaths,
        effects: cleanEffects,
      });
      nextLayers.push(updated);
      resultingIds.push(updated.id);
    }

    return changed ? { ...scene, layers: nextLayers } : scene;
  });

  if (resultingIds.length === 0) return [];
  useEditorStore.setState({ selectedIds: resultingIds, selectedNode: null });
  const idOut = new Set(resultingIds);
  return useEditorStore
    .getState()
    .scene.layers.filter((l): l is PathLayer => l.type === 'path' && idOut.has(l.id));
}
