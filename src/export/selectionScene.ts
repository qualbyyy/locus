import {
  findLayerById,
  findLayerPath,
  getParentWorldMatrix,
} from '../core/layerTree';
import {
  computeLayerBBoxWithMatrix,
  decomposeMatrix,
  getLayerMatrix,
  IDENTITY_MATRIX,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import type { BBox, Layer, LayerEffects, Scene } from '../core/types';

function cloneLayer<T extends Layer>(layer: T): T {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(layer)
    : (JSON.parse(JSON.stringify(layer)) as T);
}

function getEffectsPadding(effects?: LayerEffects): number {
  if (!effects) return 0;
  let pad = 0;
  if (effects.blur && effects.blur > 0) {
    pad = Math.max(pad, Math.ceil(effects.blur * 2));
  }
  if (effects.dropShadow) {
    const ds = effects.dropShadow;
    pad = Math.max(
      pad,
      Math.ceil(ds.blur * 2 + Math.max(Math.abs(ds.offsetX), Math.abs(ds.offsetY)))
    );
  }
  if (effects.outerGlow) {
    pad = Math.max(pad, Math.ceil(effects.outerGlow.blur * 2));
  }
  return pad;
}

function collectLayerIdsInSubtree(layer: Layer, out: Set<string>): void {
  out.add(layer.id);
  if (layer.type === 'group') {
    for (const child of layer.children) {
      collectLayerIdsInSubtree(child, out);
    }
  }
}

function collectMaxEffectsPadding(layer: Layer): number {
  let pad = getEffectsPadding(layer.effects);
  if (layer.type === 'group') {
    for (const child of layer.children) {
      pad = Math.max(pad, collectMaxEffectsPadding(child));
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
  forceVisible?: boolean
): Layer {
  const cloned = cloneLayer(layer);
  const world = multiplyMatrices(parentMatrix, getLayerMatrix(layer));
  const shifted: Matrix2D = {
    ...world,
    tx: world.tx - ox,
    ty: world.ty - oy,
  };
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

  const selectedNodes: Array<{ layer: Layer; parentMatrix: Matrix2D }> = [];
  const collectSelected = (layers: Layer[], parentMatrix: Matrix2D) => {
    for (const layer of layers) {
      if (topSelectedIds.has(layer.id)) {
        selectedNodes.push({ layer, parentMatrix });
        continue;
      }
      if (layer.type === 'group') {
        collectSelected(
          layer.children,
          multiplyMatrices(parentMatrix, getLayerMatrix(layer))
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
    const pad = collectMaxEffectsPadding(layer);
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
  const emitOrdered = (layers: Layer[], parentMatrix: Matrix2D) => {
    for (const layer of layers) {
      if (topSelectedIds.has(layer.id)) {
        rebasedLayers.push(rebaseLayerWithWorldOffset(layer, parentMatrix, ox, oy));
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
            isOnlyHiddenHost ? false : undefined
          )
        );
      }
      if (layer.type === 'group') {
        emitOrdered(
          layer.children,
          multiplyMatrices(parentMatrix, getLayerMatrix(layer))
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
