import {
  findLayerById,
  findLayerPath,
  getParentWorldMatrix,
} from '../core/layerTree';
import {
  applyMatrixToPoint,
  applyMatrixToVector,
  clamp,
  computeLayerBBoxWithMatrix,
  decomposeMatrix,
  getLayerMatrix,
  IDENTITY_MATRIX,
  multiplyMatrices,
  normalizePathLayer,
  type Matrix2D,
} from '../core/math';
import type { BBox, BlendMode, Layer, Scene, SubPath } from '../core/types';
import { getEffectsPadding } from '../engine/effects';

function cloneLayer<T extends Layer>(layer: T): T {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(layer)
    : (JSON.parse(JSON.stringify(layer)) as T);
}

function collectLayerIdsInSubtree(layer: Layer, out: Set<string>): void {
  out.add(layer.id);
  if (layer.type === 'group') {
    for (const child of layer.children) {
      collectLayerIdsInSubtree(child, out);
    }
  }
}

function collectMaxEffectsAndStrokePadding(
  layer: Layer,
  parentScale = 1
): number {
  let pad = getEffectsPadding(layer.effects);
  if (layer.type === 'path' || layer.type === 'text') {
    const sw = layer.stroke?.width ?? 0;
    if (sw > 0) {
      const layerScale = Math.max(Math.abs(layer.scaleX), Math.abs(layer.scaleY), 1);
      pad = Math.max(pad, sw * layerScale * parentScale * 0.6);
    }
  }
  if (layer.type === 'group') {
    const groupScale = Math.max(Math.abs(layer.scaleX), Math.abs(layer.scaleY), 1) * parentScale;
    for (const child of layer.children) {
      pad = Math.max(pad, collectMaxEffectsAndStrokePadding(child, groupScale));
    }
  }
  return pad;
}

function collectDependenciesInSubtree(
  layer: Layer,
  sceneLayers: Layer[],
  includedIds: Set<string>,
  clipMaskDeps: Set<string>,
  hostPathDeps: Set<string>
): void {
  if (layer.clipMaskId && !includedIds.has(layer.clipMaskId)) {
    const mask = findLayerById(sceneLayers, layer.clipMaskId);
    if (mask) {
      clipMaskDeps.add(mask.id);
    }
  }
  if (layer.type === 'text' && layer.pathId && !includedIds.has(layer.pathId)) {
    const host = findLayerById(sceneLayers, layer.pathId);
    if (host && host.type === 'path') {
      hostPathDeps.add(host.id);
    }
  }
  if (layer.type === 'group') {
    for (const child of layer.children) {
      collectDependenciesInSubtree(
        child,
        sceneLayers,
        includedIds,
        clipMaskDeps,
        hostPathDeps
      );
    }
  }
}

function rebaseLayerWithWorldOffset(
  layer: Layer,
  parentMatrix: Matrix2D,
  ox: number,
  oy: number,
  forceVisible?: boolean,
  parentOpacity = 1,
  parentBlendMode?: BlendMode
): Layer {
  const cloned = cloneLayer(layer);
  const world = multiplyMatrices(parentMatrix, getLayerMatrix(layer));
  const shifted: Matrix2D = {
    ...world,
    tx: world.tx - ox,
    ty: world.ty - oy,
  };
  cloned.opacity = clamp(cloned.opacity * parentOpacity, 0, 1);
  if ((!cloned.blendMode || cloned.blendMode === 'normal') && parentBlendMode && parentBlendMode !== 'normal') {
    cloned.blendMode = parentBlendMode;
  }
  const shear = Math.abs(shifted.a * shifted.c + shifted.b * shifted.d);
  if (cloned.type === 'path' && shear > 1e-4) {
    const transformedSubpaths: SubPath[] = cloned.subpaths.map((sp) => ({
      closed: sp.closed,
      anchors: sp.anchors.map((a) => {
        const pt = applyMatrixToPoint(shifted, { x: a.x, y: a.y });
        return {
          x: pt.x,
          y: pt.y,
          handleIn: applyMatrixToVector(shifted, a.handleIn),
          handleOut: applyMatrixToVector(shifted, a.handleOut),
          smooth: a.smooth,
        };
      }),
    }));
    const normalized = normalizePathLayer({
      ...cloned,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      subpaths: transformedSubpaths,
    });
    if (forceVisible !== undefined) normalized.visible = forceVisible;
    return normalized;
  }
  const decomp = decomposeMatrix(shifted);
  cloned.x = decomp.x;
  cloned.y = decomp.y;
  cloned.rotation = decomp.rotation;
  cloned.scaleX = decomp.scaleX;
  cloned.scaleY = decomp.scaleY;
  if (forceVisible !== undefined) {
    cloned.visible = forceVisible;
  }
  return cloned;
}

export function extractSelectionScene(
  scene: Scene,
  selectedIds: string[],
  padding = 0
): Scene | null {
  if (selectedIds.length === 0) return null;

  const requestedSet = new Set(selectedIds);
  const topSelectedIds = new Set<string>();
  for (const id of selectedIds) {
    const path = findLayerPath(scene.layers, id);
    if (!path || path.length === 0) continue;
    const hasSelectedAncestor = path
      .slice(0, -1)
      .some((ancestor) => requestedSet.has(ancestor.id));
    if (!hasSelectedAncestor) {
      topSelectedIds.add(id);
    }
  }
  if (topSelectedIds.size === 0) return null;

  const selectedNodes: Array<{
    layer: Layer;
    parentMatrix: Matrix2D;
    parentOpacity: number;
    parentBlendMode?: BlendMode;
  }> = [];
  const collectSelected = (
    layers: Layer[],
    parentMatrix: Matrix2D,
    parentOpacity = 1,
    parentBlendMode?: BlendMode
  ) => {
    for (const layer of layers) {
      if (topSelectedIds.has(layer.id)) {
        selectedNodes.push({ layer, parentMatrix, parentOpacity, parentBlendMode });
        continue;
      }
      if (layer.type === 'group') {
        collectSelected(
          layer.children,
          multiplyMatrices(parentMatrix, getLayerMatrix(layer)),
          clamp(parentOpacity * layer.opacity, 0, 1),
          layer.blendMode && layer.blendMode !== 'normal' ? layer.blendMode : parentBlendMode
        );
      }
    }
  };
  collectSelected(scene.layers, IDENTITY_MATRIX);
  if (selectedNodes.length === 0) return null;

  const includedIds = new Set<string>();
  for (const { layer } of selectedNodes) {
    collectLayerIdsInSubtree(layer, includedIds);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { layer, parentMatrix } of selectedNodes) {
    const box: BBox = computeLayerBBoxWithMatrix(layer, parentMatrix);
    const parentScale = Math.max(
      Math.hypot(parentMatrix.a, parentMatrix.b),
      Math.hypot(parentMatrix.c, parentMatrix.d),
      1
    );
    const pad = collectMaxEffectsAndStrokePadding(layer, parentScale);
    minX = Math.min(minX, box.x - pad);
    minY = Math.min(minY, box.y - pad);
    maxX = Math.max(maxX, box.x + box.width + pad);
    maxY = Math.max(maxY, box.y + box.height + pad);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  const extraPad = Math.max(0, padding);
  const ox = minX - extraPad;
  const oy = minY - extraPad;
  const width = Math.max(1, Math.ceil(maxX - minX + extraPad * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + extraPad * 2));

  const clipMaskDeps = new Set<string>();
  const hostPathDeps = new Set<string>();
  for (const { layer } of selectedNodes) {
    collectDependenciesInSubtree(
      layer,
      scene.layers,
      includedIds,
      clipMaskDeps,
      hostPathDeps
    );
  }

  const depIds = new Set<string>([...clipMaskDeps, ...hostPathDeps]);
  const rebasedLayers: Layer[] = [];
  const emitOrdered = (
    layers: Layer[],
    parentMatrix: Matrix2D,
    parentOpacity = 1,
    parentBlendMode?: BlendMode
  ) => {
    for (const layer of layers) {
      if (topSelectedIds.has(layer.id)) {
        rebasedLayers.push(
          rebaseLayerWithWorldOffset(
            layer,
            parentMatrix,
            ox,
            oy,
            undefined,
            parentOpacity,
            parentBlendMode
          )
        );
        continue;
      }
      if (depIds.has(layer.id)) {
        const isOnlyHiddenHost =
          hostPathDeps.has(layer.id) && !clipMaskDeps.has(layer.id);
        rebasedLayers.push(
          rebaseLayerWithWorldOffset(
            layer,
            parentMatrix,
            ox,
            oy,
            isOnlyHiddenHost ? false : undefined,
            parentOpacity,
            parentBlendMode
          )
        );
      }
      if (layer.type === 'group') {
        emitOrdered(
          layer.children,
          multiplyMatrices(parentMatrix, getLayerMatrix(layer)),
          clamp(parentOpacity * layer.opacity, 0, 1),
          layer.blendMode && layer.blendMode !== 'normal' ? layer.blendMode : parentBlendMode
        );
      }
    }
  };
  emitOrdered(scene.layers, IDENTITY_MATRIX);

  // Ensure any nested clip mask or host path not emitted (e.g. defensive check)
  const emittedIds = new Set<string>();
  for (const l of rebasedLayers) collectLayerIdsInSubtree(l, emittedIds);
  for (const depId of depIds) {
    if (emittedIds.has(depId)) continue;
    const found = findLayerById(scene.layers, depId);
    if (!found) continue;
    const isOnlyHiddenHost = hostPathDeps.has(depId) && !clipMaskDeps.has(depId);
    const parentMat = getParentWorldMatrix(scene.layers, depId);
    rebasedLayers.unshift(
      rebaseLayerWithWorldOffset(
        found,
        parentMat,
        ox,
        oy,
        isOnlyHiddenHost ? false : undefined
      )
    );
  }

  return {
    version: 1,
    name: `${scene.name} (выделение)`,
    width,
    height,
    dpi: scene.dpi,
    background: 'transparent',
    layers: rebasedLayers,
  };
}
