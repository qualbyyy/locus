import {
  findLayerPath,
  flattenLayers,
  getLayerWorldMatrix,
  getScopeLayers,
} from '../core/layerTree';
import { applyMatrixToPoint, invertMatrix } from '../core/math';
import { useEditorStore } from '../core/store';
import type { Layer, Point2D } from '../core/types';
import { resolveLayerLocalBBox } from './geometryBounds';
import type {
  GradientHandleData,
  SelectHandleId,
  TextPathHandleId,
} from './overlay/shared';
import type { ToolContext } from './tools/types';

export function getGradientHandleHit(
  ctx: ToolContext,
  point: Point2D
): GradientHandleData | null {
  const tolerance = 10 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.gradientHandle as GradientHandleData | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

export function getSelectHandleHit(
  ctx: ToolContext,
  point: Point2D
): SelectHandleId | null {
  const tolerance = 8 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.selectHandle as SelectHandleId | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

export function getTextPathHandleHit(
  ctx: ToolContext,
  point: Point2D
): TextPathHandleId | null {
  const tolerance = 10 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.textPathHandle as TextPathHandleId | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

function extractLayerIdFromHit(
  item: paper.Item | null | undefined,
  sceneLayer: paper.Layer
): string | null {
  let cur: paper.Item | null | undefined = item;
  while (cur && cur !== sceneLayer) {
    if (typeof cur.data?.layerId === 'string') {
      return cur.data.layerId;
    }
    cur = cur.parent;
  }
  return null;
}

function resolveScopedHitLayer(
  layers: Layer[],
  rawId: string,
  editingGroupId: string | null,
  predicate?: (layer: Layer) => boolean,
  opts?: { includeLocked?: boolean; deep?: boolean }
): Layer | null {
  const includeLocked = Boolean(opts?.includeLocked);
  const path = findLayerPath(layers, rawId);
  if (!path || path.length === 0) return null;
  if (path.some((l) => !l.visible)) return null;

  if (opts?.deep) {
    if (!includeLocked && path.some((l) => l.locked)) return null;
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const candidate = path[i];
      if (!predicate || predicate(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  let target: Layer | null = null;
  if (!editingGroupId) {
    target = path[0];
  } else {
    const idx = path.findIndex((l) => l.id === editingGroupId);
    if (idx === -1 || idx + 1 >= path.length) return null;
    target = path[idx + 1];
  }

  if (
    target &&
    target.visible &&
    (includeLocked || !target.locked) &&
    (!predicate || predicate(target))
  ) {
    return target;
  }
  return null;
}

export function findTopLayerAtPoint(
  ctx: ToolContext,
  point: Point2D,
  predicate?: (layer: Layer) => boolean,
  opts?: { includeLocked?: boolean; deep?: boolean }
): Layer | null {
  const includeLocked = Boolean(opts?.includeLocked);
  const state = useEditorStore.getState();
  const tolerance = 6 / Math.max(0.05, ctx.scope.view.zoom);

  const hit = ctx.sceneLayer.hitTest(new ctx.scope.Point(point.x, point.y), {
    fill: true,
    stroke: true,
    curves: true,
    tolerance,
  });

  if (hit) {
    const id = extractLayerIdFromHit(hit.item, ctx.sceneLayer);
    if (id) {
      const scoped = resolveScopedHitLayer(
        state.scene.layers,
        id,
        state.editingGroupId,
        predicate,
        opts
      );
      if (scoped) {
        return scoped;
      }
    }
  }

  const fallbackPool = opts?.deep
    ? flattenLayers(state.scene.layers)
    : getScopeLayers(state.scene.layers, state.editingGroupId);

  for (let i = fallbackPool.length - 1; i >= 0; i--) {
    const layer = fallbackPool[i];
    if (!layer.visible || (!includeLocked && layer.locked)) continue;
    if (predicate && !predicate(layer)) continue;
    if (layer.type === 'path' || layer.type === 'group') continue;

    const worldM = getLayerWorldMatrix(state.scene.layers, layer.id);
    const localPt = applyMatrixToPoint(invertMatrix(worldM), point);
    const box = resolveLayerLocalBBox(layer, state.scene.layers);
    if (
      localPt.x >= box.x &&
      localPt.x <= box.x + box.width &&
      localPt.y >= box.y &&
      localPt.y <= box.y + box.height
    ) {
      return layer;
    }
  }

  return null;
}
