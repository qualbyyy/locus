import { randomizeAnchors, roundPathCorners, smoothSubPaths } from '../../engine/geometry';
import { findLayerById, mapLayerTree } from '../layerTree';
import { cloneSubPaths, normalizePathLayer, splitCubicBezier } from '../math';
import { useEditorStore } from '../store';
import type { PathLayer, Scene, SelectedNodeRef, SubPath } from '../types';
import { commitScene } from './helpers';
import { updateLayers } from './layerCrud';

export function updatePathSubpaths(
  layerId: string,
  subpaths: SubPath[]
): PathLayer | null {
  let result: PathLayer | null = null;
  commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== layerId || layer.type !== 'path' || layer.locked) return layer;
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
  if (!layer || layer.type !== 'path' || layer.locked) return null;

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
  if (!layer || layer.type !== 'path' || layer.locked) return false;

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
  if (!layer || layer.type !== 'path' || layer.locked) return false;

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
    if (layer.type !== 'path' || layer.locked) return layer;
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
    if (layer.type !== 'path' || layer.locked) return layer;
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
    if (layer.type !== 'path' || layer.locked) return layer;
    const nextSeed = offsetSeed !== undefined ? offsetSeed++ : undefined;
    return {
      ...layer,
      subpaths: randomizeAnchors(layer.subpaths, intensity, nextSeed),
    };
  });
}
