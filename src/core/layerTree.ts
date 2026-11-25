import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  applyMatrixToVector,
  clamp,
  decomposeMatrix,
  getLayerMatrix,
  multiplyMatrices,
  normalizePathLayer,
  type Matrix2D,
} from './math';
import type { GroupLayer, Layer, SubPath } from './types';

export function isGroupLayer(layer: Layer): layer is GroupLayer {
  return layer.type === 'group';
}

export function flattenLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];
  const visit = (items: Layer[]) => {
    for (const layer of items) {
      result.push(layer);
      if (layer.type === 'group') {
        visit(layer.children);
      }
    }
  };
  visit(layers);
  return result;
}

export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.type === 'group') {
      const found = findLayerById(layer.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findLayerPath(layers: Layer[], id: string): Layer[] | null {
  for (const layer of layers) {
    if (layer.id === id) return [layer];
    if (layer.type === 'group') {
      const childPath = findLayerPath(layer.children, id);
      if (childPath) return [layer, ...childPath];
    }
  }
  return null;
}

export function getParentGroupId(layers: Layer[], id: string): string | null {
  const path = findLayerPath(layers, id);
  if (!path || path.length < 2) return null;
  return path[path.length - 2].id;
}

export function getParentWorldMatrix(layers: Layer[], id: string): Matrix2D {
  const path = findLayerPath(layers, id);
  if (!path || path.length < 2) return IDENTITY_MATRIX;
  let acc = IDENTITY_MATRIX;
  for (let i = 0; i < path.length - 1; i += 1) {
    acc = multiplyMatrices(acc, getLayerMatrix(path[i]));
  }
  return acc;
}

export function getLayerWorldMatrix(layers: Layer[], id: string): Matrix2D {
  const path = findLayerPath(layers, id);
  if (!path || path.length === 0) return IDENTITY_MATRIX;
  let acc = IDENTITY_MATRIX;
  for (const item of path) {
    acc = multiplyMatrices(acc, getLayerMatrix(item));
  }
  return acc;
}

export function getScopeLayers(
  layers: Layer[],
  editingGroupId: string | null
): Layer[] {
  if (!editingGroupId) return layers;
  const target = findLayerById(layers, editingGroupId);
  return target && target.type === 'group' ? target.children : layers;
}

export function getScopeWorldMatrix(
  layers: Layer[],
  editingGroupId: string | null
): Matrix2D {
  if (!editingGroupId) return IDENTITY_MATRIX;
  const path = findLayerPath(layers, editingGroupId);
  if (!path || path.length === 0) return IDENTITY_MATRIX;
  let acc = IDENTITY_MATRIX;
  for (const item of path) {
    acc = multiplyMatrices(acc, getLayerMatrix(item));
  }
  return acc;
}

export function mapLayerTree(
  layers: Layer[],
  fn: (layer: Layer) => Layer
): Layer[] {
  let changed = false;
  const mapped = layers.map((layer) => {
    let cur = layer;
    if (cur.type === 'group') {
      const nextChildren = mapLayerTree(cur.children, fn);
      if (nextChildren !== cur.children) {
        cur = { ...cur, children: nextChildren };
      }
    }
    const next = fn(cur);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? mapped : layers;
}

export function filterLayerTree(
  layers: Layer[],
  keep: (layer: Layer) => boolean
): Layer[] {
  let changed = false;
  const next: Layer[] = [];
  for (const layer of layers) {
    if (!keep(layer)) {
      changed = true;
      continue;
    }
    if (layer.type === 'group') {
      const nextChildren = filterLayerTree(layer.children, keep);
      if (nextChildren !== layer.children) {
        changed = true;
        next.push({ ...layer, children: nextChildren });
        continue;
      }
    }
    next.push(layer);
  }
  return changed ? next : layers;
}

export function updateGroupChildren(
  layers: Layer[],
  groupId: string | null,
  fn: (children: Layer[]) => Layer[]
): Layer[] {
  if (groupId === null) {
    return fn(layers);
  }
  let changed = false;
  const next = layers.map((layer) => {
    if (layer.type !== 'group') return layer;
    if (layer.id === groupId) {
      const nextChildren = fn(layer.children);
      if (nextChildren !== layer.children) {
        changed = true;
        return { ...layer, children: nextChildren };
      }
      return layer;
    }
    const nested = updateGroupChildren(layer.children, groupId, fn);
    if (nested !== layer.children) {
      changed = true;
      return { ...layer, children: nested };
    }
    return layer;
  });
  return changed ? next : layers;
}

function rawCloneLayer(layer: Layer): Layer {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(layer)
    : (JSON.parse(JSON.stringify(layer)) as Layer);
}

export function cloneLayerSubtreeWithNewIds(
  layer: Layer,
  createId: (prefix: string) => string,
  nameSuffix = ''
): Layer {
  const copy = rawCloneLayer(layer);
  const idMap = new Map<string, string>();

  const collectIds = (node: Layer) => {
    idMap.set(node.id, createId(node.type));
    if (node.type === 'group') {
      node.children.forEach(collectIds);
    }
  };
  collectIds(copy);

  const referencedNewMasks = new Set<string>();
  const applyIds = (node: Layer, isRoot: boolean) => {
    node.id = idMap.get(node.id)!;
    if (isRoot && nameSuffix) {
      node.name = `${node.name}${nameSuffix}`;
    }
    if (node.clipMaskId) {
      const remapped = idMap.get(node.clipMaskId);
      if (remapped) {
        node.clipMaskId = remapped;
        referencedNewMasks.add(remapped);
      } else {
        delete node.clipMaskId;
      }
    }
    if (node.type === 'group') {
      node.children.forEach((c) => applyIds(c, false));
    }
  };
  applyIds(copy, true);

  const clearOrphanMasks = (node: Layer) => {
    if (node.type === 'path' && node.isClipMask && !referencedNewMasks.has(node.id)) {
      node.isClipMask = false;
    }
    if (node.type === 'group') {
      node.children.forEach(clearOrphanMasks);
    }
  };
  clearOrphanMasks(copy);

  return copy;
}

export function applyGroupTransformToChild(
  group: GroupLayer,
  child: Layer
): Layer {
  const m = multiplyMatrices(getLayerMatrix(group), getLayerMatrix(child));
  const combinedOpacity = clamp(child.opacity * group.opacity, 0, 1);
  const resolvedBlendMode =
    child.blendMode && child.blendMode !== 'normal'
      ? child.blendMode
      : group.blendMode;
  const resolvedClipMaskId = child.clipMaskId ?? group.clipMaskId;

  const basePatch = {
    opacity: combinedOpacity,
    ...(resolvedBlendMode ? { blendMode: resolvedBlendMode } : {}),
    ...(resolvedClipMaskId ? { clipMaskId: resolvedClipMaskId } : {}),
  };

  const shear = Math.abs(m.a * m.c + m.b * m.d);
  if (child.type === 'path' && shear > 1e-4) {
    const transformedSubpaths: SubPath[] = child.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => {
        const pt = applyMatrixToPoint(m, { x: a.x, y: a.y });
        return {
          x: pt.x,
          y: pt.y,
          handleIn: applyMatrixToVector(m, a.handleIn),
          handleOut: applyMatrixToVector(m, a.handleOut),
          smooth: a.smooth,
        };
      }),
    }));
    return normalizePathLayer({
      ...child,
      ...basePatch,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      subpaths: transformedSubpaths,
    });
  }

  const tr = decomposeMatrix(m);
  return {
    ...child,
    ...basePatch,
    x: tr.x,
    y: tr.y,
    rotation: tr.rotation,
    scaleX: tr.scaleX,
    scaleY: tr.scaleY,
  };
}
