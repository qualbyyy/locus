import { generateSmartShape } from '../../engine/geometry';
import { getActiveArtboard } from '../artboards';
import {
  applyGroupTransformToChild,
  cloneLayerSubtreeWithNewIds,
  filterLayerTree,
  findLayerById,
  flattenLayers,
  getParentGroupId,
  getParentWorldMatrix,
  getScopeLayers,
  mapLayerTree,
  updateGroupChildren,
} from '../layerTree';
import {
  IDENTITY_MATRIX,
  applyMatrixToVector,
  clamp,
  computeCombinedWorldBBox,
  computeLayerBBoxWithMatrix,
  invertMatrix,
  normalizePathLayer,
} from '../math';
import { clonePaint, cloneStroke, paintEquals } from '../paint';
import { useEditorStore } from '../store';
import type {
  AssetEntry,
  GroupLayer,
  ImageLayer,
  Layer,
  LayerEffects,
  Paint,
  PathLayer,
  Scene,
  SmartShapeOptions,
  SmartShapePreset,
  StrokeStyle,
} from '../types';
import {
  DEFAULT_RESTORE_STROKE,
  commitScene,
  createLayerId,
  findSharedClipMaskId,
  validateSelectionAgainstScene,
} from './helpers';

export type AlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute_h'
  | 'distribute_v'
  | 'artboard_center';

const PRESET_LABELS: Record<SmartShapePreset, string> = {
  blob: 'Клякса',
  ellipse: 'Эллипс',
  rect: 'Прямоугольник',
  polygon: 'Многоугольник',
  star: 'Звезда',
};

export function addLayer(
  layer: Layer,
  opts?: { select?: boolean; parentGroupId?: string | null }
): Layer {
  const prepared = layer.type === 'path' ? normalizePathLayer(layer) : layer;
  commitScene((scene) => {
    const requestedParent = opts?.parentGroupId ?? null;
    const parentExists =
      requestedParent !== null &&
      findLayerById(scene.layers, requestedParent)?.type === 'group';
    const targetParent = parentExists ? requestedParent : null;
    const nextLayers = updateGroupChildren(scene.layers, targetParent, (list) => [
      ...list,
      prepared,
    ]);
    return { ...scene, layers: nextLayers };
  });

  if (opts?.select !== false) {
    useEditorStore.setState({
      selectedIds: [prepared.id],
      selectedNode: null,
    });
  }
  return prepared;
}

export function addLayers(
  layers: Layer[],
  opts?: { select?: boolean; parentGroupId?: string | null }
): Layer[] {
  if (layers.length === 0) {
    return [];
  }
  const prepared = layers.map((layer) =>
    layer.type === 'path' ? normalizePathLayer(layer) : layer
  );
  commitScene((scene) => {
    const requestedParent = opts?.parentGroupId ?? null;
    const parentExists =
      requestedParent !== null &&
      findLayerById(scene.layers, requestedParent)?.type === 'group';
    const targetParent = parentExists ? requestedParent : null;
    const nextLayers = updateGroupChildren(scene.layers, targetParent, (list) => [
      ...list,
      ...prepared,
    ]);
    return { ...scene, layers: nextLayers };
  });

  if (opts?.select !== false) {
    useEditorStore.setState({
      selectedIds: prepared.map((layer) => layer.id),
      selectedNode: null,
    });
  }
  return prepared;
}

export function createShapeLayer(params: {
  preset?: SmartShapePreset;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: Partial<SmartShapeOptions>;
  fill?: Paint | null;
  stroke?: StrokeStyle | null;
  name?: string;
  seed?: number;
  select?: boolean;
  parentGroupId?: string | null;
}): PathLayer {
  const state = useEditorStore.getState();
  const mergedOptions: SmartShapeOptions = {
    ...state.smartShapeOptions,
    ...params.options,
    preset: params.preset ?? params.options?.preset ?? state.smartShapeOptions.preset,
  };

  const subpaths = generateSmartShape(
    params.width,
    params.height,
    mergedOptions,
    params.seed
  );

  const fill = params.fill !== undefined ? params.fill : state.defaultFill;
  const stroke = params.stroke !== undefined ? params.stroke : state.defaultStroke;
  const sameTypeCount =
    flattenLayers(state.scene.layers).filter((l) => l.type === 'path').length + 1;

  const layer: PathLayer = {
    id: createLayerId('path'),
    name: params.name?.trim() || `${PRESET_LABELS[mergedOptions.preset]} ${sameTypeCount}`,
    type: 'path',
    visible: true,
    locked: false,
    x: params.x,
    y: params.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    subpaths,
    fillRule: 'nonzero',
    fill: clonePaint(fill),
    stroke: cloneStroke(stroke),
  };

  return addLayer(layer, {
    select: params.select,
    parentGroupId: params.parentGroupId,
  }) as PathLayer;
}

export function createImageLayer(params: {
  assetId: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  name?: string;
  fitToArtboard?: boolean;
  select?: boolean;
  parentGroupId?: string | null;
}): ImageLayer {
  const state = useEditorStore.getState();
  const { scene, activeArtboardId } = state;
  const ab = getActiveArtboard(scene, activeArtboardId);
  const sameTypeCount =
    flattenLayers(scene.layers).filter((l) => l.type === 'image').length + 1;

  const width = Math.max(1, Math.round(params.width));
  const height = Math.max(1, Math.round(params.height));
  let scale = 1;
  if (
    params.fitToArtboard !== false &&
    (width > ab.width * 0.85 || height > ab.height * 0.85)
  ) {
    scale = Number(
      Math.min(1, (ab.width * 0.85) / width, (ab.height * 0.85) / height).toFixed(4)
    );
  }

  const layer: ImageLayer = {
    id: createLayerId('img'),
    name: params.name?.trim() || `Изображение ${sameTypeCount}`,
    type: 'image',
    visible: true,
    locked: false,
    x: params.x ?? ab.x + ab.width / 2,
    y: params.y ?? ab.y + ab.height / 2,
    rotation: 0,
    scaleX: scale,
    scaleY: scale,
    opacity: 1,
    assetId: params.assetId,
    width,
    height,
  };

  return addLayer(layer, {
    select: params.select,
    parentGroupId: params.parentGroupId,
  }) as ImageLayer;
}

export function replaceImageLayerAsset(
  layerId: string,
  asset: Pick<AssetEntry, 'id' | 'name' | 'naturalWidth' | 'naturalHeight'>
): ImageLayer | null {
  let updatedLayer: ImageLayer | null = null;

  commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== layerId || layer.type !== 'image') {
        return layer;
      }
      changed = true;
      const nextW = Math.max(1, Math.round(asset.naturalWidth));
      const nextH = Math.max(1, Math.round(asset.naturalHeight));
      const renderedW = layer.width * Math.abs(layer.scaleX);
      const nextScaleMag = clamp(renderedW / nextW, 0.02, 100);
      const signX = layer.scaleX < 0 ? -1 : 1;
      const signY = layer.scaleY < 0 ? -1 : 1;

      const next: ImageLayer = {
        ...layer,
        assetId: asset.id,
        width: nextW,
        height: nextH,
        scaleX: Number((signX * nextScaleMag).toFixed(4)),
        scaleY: Number((signY * nextScaleMag).toFixed(4)),
      };
      updatedLayer = next;
      return next;
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });

  return updatedLayer;
}

export function updateLayers(
  layerIds: string[],
  patch: Partial<Layer> | ((layer: Layer) => Layer)
): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }

  const targetSet = new Set(layerIds);
  const nextScene = commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!targetSet.has(layer.id)) return layer;

      const updated =
        typeof patch === 'function'
          ? patch(layer)
          : ({ ...layer, ...patch } as Layer);

      if (updated === layer) return layer;
      changed = true;
      return updated.type === 'path' ? normalizePathLayer(updated) : updated;
    });

    return changed ? { ...scene, layers: nextLayers } : scene;
  });

  if (typeof patch !== 'function') {
    const pathPatch = patch as Partial<PathLayer>;
    if ('fill' in pathPatch && pathPatch.fill !== undefined) {
      useEditorStore.setState({ defaultFill: clonePaint(pathPatch.fill) });
    }
    if ('stroke' in pathPatch && pathPatch.stroke !== undefined) {
      useEditorStore.setState({
        defaultStroke: cloneStroke(pathPatch.stroke),
      });
    }
  }

  return nextScene;
}

export function nudgeLayers(
  layerIds: string[],
  dx: number,
  dy: number
): Scene {
  if (layerIds.length === 0 || (dx === 0 && dy === 0)) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: dx, y: dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: dx, y: dy });
      return {
        ...layer,
        x: layer.x + localDelta.x,
        y: layer.y + localDelta.y,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function deleteLayers(layerIds: string[]): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;

  const removeSet = new Set(layerIds);
  const nextScene = commitScene((scene) => {
    const deletedAllIds = new Set<string>();
    for (const node of flattenLayers(scene.layers)) {
      if (removeSet.has(node.id)) {
        for (const sub of flattenLayers([node])) {
          deletedAllIds.add(sub.id);
        }
      }
    }
    if (deletedAllIds.size === 0) return scene;

    const remaining = filterLayerTree(
      scene.layers,
      (layer) => !removeSet.has(layer.id)
    );
    const cleaned = mapLayerTree(remaining, (layer) => {
      let nextLayer = layer;
      if (nextLayer.clipMaskId && deletedAllIds.has(nextLayer.clipMaskId)) {
        const copy = { ...nextLayer };
        delete copy.clipMaskId;
        nextLayer = copy;
      }
      if (
        nextLayer.type === 'text' &&
        nextLayer.pathId &&
        deletedAllIds.has(nextLayer.pathId)
      ) {
        const copy = { ...nextLayer };
        delete copy.pathId;
        delete copy.pathOffset;
        delete copy.pathFlip;
        nextLayer = copy;
      }
      return nextLayer;
    });

    return { ...scene, layers: cleaned };
  });

  validateSelectionAgainstScene(nextScene);
  return nextScene;
}

export function duplicateLayers(
  layerIds: string[],
  offsetX = 16,
  offsetY = 16
): Layer[] {
  if (layerIds.length === 0) return [];
  const sourceSet = new Set(layerIds);
  const created: Layer[] = [];

  commitScene((scene) => {
    const duplicateInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];
      for (const rawLayer of layers) {
        let layer = rawLayer;
        if (layer.type === 'group') {
          const nextChildren = duplicateInList(layer.children);
          if (nextChildren !== layer.children) {
            layer = { ...layer, children: nextChildren };
            changed = true;
          }
        }
        next.push(layer);
        if (sourceSet.has(layer.id)) {
          changed = true;
          const copy = cloneLayerSubtreeWithNewIds(layer, createLayerId, ' копия');
          copy.x += offsetX;
          copy.y += offsetY;
          if (copy.type === 'path' && copy.isClipMask) {
            copy.isClipMask = false;
          }
          created.push(copy);
          next.push(copy);
        }
      }
      return changed ? next : layers;
    };

    const nextLayers = duplicateInList(scene.layers);
    return created.length > 0 ? { ...scene, layers: nextLayers } : scene;
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((item) => item.id),
      selectedNode: null,
    });
  }
  return created;
}

export function reorderLayer(
  layerId: string,
  mode: 'front' | 'back' | 'forward' | 'backward' | 'index',
  targetIndex?: number
): Scene {
  return commitScene((scene) => {
    const parentId = getParentGroupId(scene.layers, layerId);
    const nextLayers = updateGroupChildren(scene.layers, parentId, (siblings) => {
      const currentIndex = siblings.findIndex((l) => l.id === layerId);
      if (currentIndex === -1) return siblings;

      const lastIndex = siblings.length - 1;
      let nextIndex = currentIndex;

      switch (mode) {
        case 'front':
          nextIndex = lastIndex;
          break;
        case 'back':
          nextIndex = 0;
          break;
        case 'forward':
          nextIndex = Math.min(lastIndex, currentIndex + 1);
          break;
        case 'backward':
          nextIndex = Math.max(0, currentIndex - 1);
          break;
        case 'index':
          nextIndex = clamp(
            Math.round(targetIndex ?? currentIndex),
            0,
            lastIndex
          );
          break;
      }

      if (nextIndex === currentIndex) return siblings;

      const copy = [...siblings];
      const [moved] = copy.splice(currentIndex, 1);
      copy.splice(nextIndex, 0, moved);
      return copy;
    });

    return nextLayers === scene.layers ? scene : { ...scene, layers: nextLayers };
  });
}

export function groupLayers(layerIds: string[]): GroupLayer | null {
  if (layerIds.length === 0) return null;
  let createdGroup: GroupLayer | null = null;

  commitScene((scene) => {
    const idSet = new Set(layerIds);
    const all = flattenLayers(scene.layers);
    const firstUnlocked = all.find((l) => idSet.has(l.id) && !l.locked);
    if (!firstUnlocked) return scene;

    const parentId = getParentGroupId(scene.layers, firstUnlocked.id);
    const siblings = getScopeLayers(scene.layers, parentId);
    const targets = siblings.filter((l) => idSet.has(l.id) && !l.locked);
    if (targets.length === 0) return scene;

    const targetIds = new Set(targets.map((l) => l.id));
    const bbox = computeCombinedWorldBBox(targets);
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const sharedMask = findSharedClipMaskId(targets, targetIds);
    const groupCount = all.filter((l) => l.type === 'group').length + 1;

    const children: Layer[] = targets.map((child) => {
      const shifted: Layer = {
        ...child,
        x: child.x - cx,
        y: child.y - cy,
      };
      if (sharedMask && shifted.clipMaskId === sharedMask) {
        delete shifted.clipMaskId;
      }
      return shifted;
    });

    const group: GroupLayer = {
      id: createLayerId('grp'),
      name: `Группа ${groupCount}`,
      type: 'group',
      visible: true,
      locked: false,
      x: cx,
      y: cy,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      ...(sharedMask ? { clipMaskId: sharedMask } : {}),
      children,
    };
    createdGroup = group;

    const nextLayers = updateGroupChildren(scene.layers, parentId, (list) => {
      let highestIdx = -1;
      list.forEach((l, idx) => {
        if (targetIds.has(l.id)) highestIdx = idx;
      });
      const rebuilt: Layer[] = [];
      list.forEach((l, idx) => {
        if (idx === highestIdx) {
          rebuilt.push(group);
        }
        if (!targetIds.has(l.id)) {
          rebuilt.push(l);
        }
      });
      return rebuilt;
    });

    return { ...scene, layers: nextLayers };
  });

  if (createdGroup) {
    useEditorStore.setState({
      selectedIds: [(createdGroup as GroupLayer).id],
      selectedNode: null,
    });
  }
  return createdGroup;
}

export function ungroupLayers(layerIds: string[]): Layer[] {
  if (layerIds.length === 0) return [];
  const idSet = new Set(layerIds);
  const released: Layer[] = [];
  const prevState = useEditorStore.getState();
  const prevEditingId = prevState.editingGroupId;
  let nextEditingId = prevEditingId;

  commitScene((scene) => {
    const ungroupInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];
      for (const layer of layers) {
        if (layer.type !== 'group') {
          next.push(layer);
          continue;
        }
        const nextChildren = ungroupInList(layer.children);
        const workingGroup =
          nextChildren !== layer.children
            ? { ...layer, children: nextChildren }
            : layer;
        if (nextChildren !== layer.children) {
          changed = true;
        }

        if (idSet.has(workingGroup.id) && !workingGroup.locked) {
          changed = true;
          if (workingGroup.id === prevEditingId) {
            nextEditingId = getParentGroupId(scene.layers, workingGroup.id);
          }
          for (const child of workingGroup.children) {
            const expanded = applyGroupTransformToChild(workingGroup, child);
            released.push(expanded);
            next.push(expanded);
          }
        } else {
          next.push(workingGroup);
        }
      }
      return changed ? next : layers;
    };

    const nextLayers = ungroupInList(scene.layers);
    return nextLayers === scene.layers ? scene : { ...scene, layers: nextLayers };
  });

  if (released.length > 0) {
    useEditorStore.setState({
      selectedIds: released.map((l) => l.id),
      selectedNode: null,
      editingGroupId: nextEditingId,
    });
  } else if (nextEditingId !== prevEditingId) {
    useEditorStore.setState({ editingGroupId: nextEditingId });
  }
  return released;
}

function createsMaskCycle(
  layersById: Map<string, Layer>,
  maskLayerId: string,
  targetLayerId: string
): boolean {
  if (maskLayerId === targetLayerId) return true;
  const visited = new Set<string>([targetLayerId]);
  let cursor = layersById.get(maskLayerId)?.clipMaskId;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = layersById.get(cursor)?.clipMaskId;
  }
  return false;
}

export function setClipMask(
  maskLayerId: string | null,
  targetLayerIds: string[]
): Scene {
  if (targetLayerIds.length === 0) {
    return useEditorStore.getState().scene;
  }

  return commitScene((scene) => {
    const layersById = new Map(flattenLayers(scene.layers).map((l) => [l.id, l]));
    if (maskLayerId !== null) {
      const maskLayer = layersById.get(maskLayerId);
      if (!maskLayer || maskLayer.type !== 'path') {
        return scene;
      }
    }

    const targetSet = new Set(targetLayerIds);
    let changed = false;

    const updated = mapLayerTree(scene.layers, (layer) => {
      if (targetSet.has(layer.id)) {
        if (maskLayerId === null) {
          if (layer.clipMaskId !== undefined) {
            changed = true;
            const next = { ...layer };
            delete next.clipMaskId;
            return next;
          }
          return layer;
        }

        if (
          layer.id !== maskLayerId &&
          !createsMaskCycle(layersById, maskLayerId, layer.id) &&
          layer.clipMaskId !== maskLayerId
        ) {
          changed = true;
          return { ...layer, clipMaskId: maskLayerId };
        }
      }
      return layer;
    });

    const referencedMasks = new Set<string>();
    for (const layer of flattenLayers(updated)) {
      if (layer.clipMaskId) {
        referencedMasks.add(layer.clipMaskId);
      }
    }

    const finalized = mapLayerTree(updated, (layer) => {
      if (layer.type !== 'path') return layer;
      if (maskLayerId !== null && layer.id === maskLayerId) {
        if (!layer.isClipMask && referencedMasks.has(layer.id)) {
          changed = true;
          return { ...layer, isClipMask: true };
        }
      } else if (layer.isClipMask && !referencedMasks.has(layer.id)) {
        changed = true;
        return {
          ...layer,
          isClipMask: false,
          stroke:
            layer.fill === null && layer.stroke === null
              ? { ...DEFAULT_RESTORE_STROKE }
              : layer.stroke,
        };
      }
      return layer;
    });

    return changed ? { ...scene, layers: finalized } : scene;
  });
}

export function releaseClipMask(maskLayerId: string): Scene {
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.clipMaskId === maskLayerId) {
        changed = true;
        const next = { ...layer };
        delete next.clipMaskId;
        return next;
      }
      if (layer.id === maskLayerId && layer.type === 'path' && layer.isClipMask) {
        changed = true;
        return {
          ...layer,
          isClipMask: false,
          stroke:
            layer.fill === null && layer.stroke === null
              ? { ...DEFAULT_RESTORE_STROKE }
              : layer.stroke,
        };
      }
      return layer;
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function createClipMaskFromSelection(layerIds: string[]): PathLayer | null {
  const scene = useEditorStore.getState().scene;
  const selectedSet = new Set(layerIds);
  const firstMatch = flattenLayers(scene.layers).find((l) => selectedSet.has(l.id));
  if (!firstMatch) return null;

  const parentId = getParentGroupId(scene.layers, firstMatch.id);
  const siblings = getScopeLayers(scene.layers, parentId);
  const selectedInOrder = siblings.filter((l) => selectedSet.has(l.id));
  if (selectedInOrder.length === 0) {
    return null;
  }

  if (selectedInOrder.length === 1) {
    const candidate = selectedInOrder[0];
    if (candidate.type !== 'path') {
      return null;
    }
    const idx = siblings.findIndex((l) => l.id === candidate.id);
    if (idx <= 0) {
      return null;
    }
    const below = siblings[idx - 1];
    if (below.id === candidate.id) {
      return null;
    }
    setClipMask(candidate.id, [below.id]);
    const updated = findLayerById(useEditorStore.getState().scene.layers, candidate.id);
    return updated?.type === 'path' && updated.isClipMask ? updated : null;
  }

  let maskCandidate: PathLayer | null = null;
  for (let i = selectedInOrder.length - 1; i >= 0; i--) {
    const candidate = selectedInOrder[i];
    if (candidate.type === 'path') {
      maskCandidate = candidate;
      break;
    }
  }
  if (!maskCandidate) {
    return null;
  }

  const targetIds = selectedInOrder
    .filter((l) => l.id !== maskCandidate.id)
    .map((l) => l.id);
  if (targetIds.length === 0) {
    return null;
  }

  setClipMask(maskCandidate.id, targetIds);
  const updated = findLayerById(useEditorStore.getState().scene.layers, maskCandidate.id);
  return updated?.type === 'path' && updated.isClipMask ? updated : null;
}

export function alignLayers(layerIds: string[], mode: AlignMode): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }

  const activeArtboardId = useEditorStore.getState().activeArtboardId;
  return commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const idSet = new Set(layerIds);
    const targets = flattenLayers(scene.layers).filter(
      (l) => idSet.has(l.id) && !l.locked
    );
    if (targets.length === 0) {
      return scene;
    }

    const boxes = new Map(
      targets.map((layer) => [
        layer.id,
        computeLayerBBoxWithMatrix(layer, getParentWorldMatrix(scene.layers, layer.id)),
      ])
    );
    const deltas = new Map<string, { dx: number; dy: number }>();

    if (mode === 'artboard_center') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of boxes.values()) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
      }
      const dx = ab.x + ab.width / 2 - (minX + (maxX - minX) / 2);
      const dy = ab.y + ab.height / 2 - (minY + (maxY - minY) / 2);
      for (const layer of targets) {
        deltas.set(layer.id, { dx, dy });
      }
    } else if (mode === 'distribute_h' || mode === 'distribute_v') {
      if (targets.length < 3) {
        return scene;
      }
      const isHorizontal = mode === 'distribute_h';
      const sorted = [...targets].sort((a, b) => {
        const ba = boxes.get(a.id)!;
        const bb = boxes.get(b.id)!;
        const ca = isHorizontal ? ba.x + ba.width / 2 : ba.y + ba.height / 2;
        const cb = isHorizontal ? bb.x + bb.width / 2 : bb.y + bb.height / 2;
        return ca - cb;
      });

      const first = boxes.get(sorted[0].id)!;
      const last = boxes.get(sorted[sorted.length - 1].id)!;
      const span = isHorizontal
        ? last.x + last.width - first.x
        : last.y + last.height - first.y;
      const sumSizes = sorted.reduce((acc, layer) => {
        const b = boxes.get(layer.id)!;
        return acc + (isHorizontal ? b.width : b.height);
      }, 0);
      const gap = (span - sumSizes) / (sorted.length - 1);

      let cursor = isHorizontal
        ? first.x + first.width + gap
        : first.y + first.height + gap;

      for (let i = 1; i < sorted.length - 1; i++) {
        const layer = sorted[i];
        const b = boxes.get(layer.id)!;
        if (isHorizontal) {
          deltas.set(layer.id, { dx: cursor - b.x, dy: 0 });
          cursor += b.width + gap;
        } else {
          deltas.set(layer.id, { dx: 0, dy: cursor - b.y });
          cursor += b.height + gap;
        }
      }
    } else {
      let refBox = { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
      if (targets.length > 1) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const b of boxes.values()) {
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
        }
        refBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }

      for (const layer of targets) {
        const b = boxes.get(layer.id)!;
        let dx = 0;
        let dy = 0;
        switch (mode) {
          case 'left':
            dx = refBox.x - b.x;
            break;
          case 'center':
            dx = refBox.x + refBox.width / 2 - (b.x + b.width / 2);
            break;
          case 'right':
            dx = refBox.x + refBox.width - (b.x + b.width);
            break;
          case 'top':
            dy = refBox.y - b.y;
            break;
          case 'middle':
            dy = refBox.y + refBox.height / 2 - (b.y + b.height / 2);
            break;
          case 'bottom':
            dy = refBox.y + refBox.height - (b.y + b.height);
            break;
        }
        deltas.set(layer.id, { dx, dy });
      }
    }

    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      const d = deltas.get(layer.id);
      if (!d || (Math.abs(d.dx) <= 1e-6 && Math.abs(d.dy) <= 1e-6)) {
        return layer;
      }
      changed = true;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: d.dx, y: d.dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: d.dx, y: d.dy });
      return {
        ...layer,
        x: layer.x + localDelta.x,
        y: layer.y + localDelta.y,
      };
    });

    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function flipLayers(
  layerIds: string[],
  axis: 'horizontal' | 'vertical'
): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;

  return commitScene((scene) => {
    const idSet = new Set(layerIds);
    const targets = flattenLayers(scene.layers).filter(
      (l) => idSet.has(l.id) && !l.locked
    );
    if (targets.length === 0) return scene;

    const comb = computeCombinedWorldBBox(targets);
    const pivotX = comb.x + comb.width / 2;
    const pivotY = comb.y + comb.height / 2;

    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      if (axis === 'horizontal') {
        return {
          ...layer,
          x: 2 * pivotX - layer.x,
          rotation: -layer.rotation,
          scaleX: -layer.scaleX,
        };
      }
      return {
        ...layer,
        y: 2 * pivotY - layer.y,
        rotation: -layer.rotation,
        scaleY: -layer.scaleY,
      };
    });

    return { ...scene, layers: nextLayers };
  });
}

/** Дублирует слои зеркально относительно центральной оси активного артборда. */
export function mirrorDuplicateLayers(
  layerIds: string[],
  axis: 'horizontal' | 'vertical'
): Layer[] {
  if (layerIds.length === 0) return [];
  const sourceSet = new Set(layerIds);
  const created: Layer[] = [];
  const activeArtboardId = useEditorStore.getState().activeArtboardId;

  commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const mirrorInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];
      for (const rawLayer of layers) {
        let layer = rawLayer;
        if (layer.type === 'group') {
          const nextChildren = mirrorInList(layer.children);
          if (nextChildren !== layer.children) {
            layer = { ...layer, children: nextChildren };
            changed = true;
          }
        }
        next.push(layer);
        if (!sourceSet.has(layer.id) || layer.locked) continue;

        changed = true;
        const copy = cloneLayerSubtreeWithNewIds(layer, createLayerId, ' отражение');
        if (axis === 'horizontal') {
          copy.x = ab.x * 2 + ab.width - layer.x;
          copy.rotation = -layer.rotation;
          copy.scaleX = -layer.scaleX;
        } else {
          copy.y = ab.y * 2 + ab.height - layer.y;
          copy.rotation = -layer.rotation;
          copy.scaleY = -layer.scaleY;
        }
        if (copy.type === 'path' && copy.isClipMask) {
          copy.isClipMask = false;
        }
        created.push(copy);
        next.push(copy);
      }
      return changed ? next : layers;
    };

    const nextLayers = mirrorInList(scene.layers);
    return created.length > 0 ? { ...scene, layers: nextLayers } : scene;
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((item) => item.id),
      selectedNode: null,
    });
  }
  return created;
}

export interface RepeatLayersOptions {
  mode: 'row' | 'column' | 'grid' | 'ring';
  count: number;
  gap?: number;
  columns?: number;
  radius?: number;
  sweep?: number;
}

/** Размножает слои рядом, сеткой или по кольцу вокруг центра активного артборда. */
export function repeatLayers(
  layerIds: string[],
  opts: RepeatLayersOptions
): Layer[] {
  if (layerIds.length === 0) return [];
  const count = clamp(Math.round(opts.count), 2, 40);
  const gap = Math.max(0, opts.gap ?? 20);
  const columns = clamp(Math.round(opts.columns ?? 3), 2, 10);
  const sourceSet = new Set(layerIds);
  const created: Layer[] = [];
  const activeArtboardId = useEditorStore.getState().activeArtboardId;

  commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const artboardCenter = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
    const sweep = clamp(opts.sweep ?? 360, -360, 360);

    const repeatInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];
      for (const rawLayer of layers) {
        let layer = rawLayer;
        if (layer.type === 'group') {
          const nextChildren = repeatInList(layer.children);
          if (nextChildren !== layer.children) {
            layer = { ...layer, children: nextChildren };
            changed = true;
          }
        }
        next.push(layer);
        if (!sourceSet.has(layer.id) || layer.locked) continue;

        changed = true;
        const box = computeLayerBBoxWithMatrix(layer, IDENTITY_MATRIX);
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const stepX = box.width + gap;
        const stepY = box.height + gap;
        const rows = Math.ceil(count / columns);
        const baseRadius =
          opts.radius ??
          Math.max(
            Math.hypot(center.x - artboardCenter.x, center.y - artboardCenter.y),
            Math.max(box.width, box.height) / 2
          );
        const baseAngle = Math.atan2(
          center.y - artboardCenter.y,
          center.x - artboardCenter.x
        );

        for (let index = 1; index < count; index += 1) {
          let targetCenter: { x: number; y: number };

          if (opts.mode === 'row') {
            targetCenter = { x: center.x + stepX * index, y: center.y };
          } else if (opts.mode === 'column') {
            targetCenter = { x: center.x, y: center.y + stepY * index };
          } else if (opts.mode === 'grid') {
            const col = index % columns;
            const row = Math.floor(index / columns);
            if (row >= rows) break;
            targetCenter = {
              x: center.x + stepX * col,
              y: center.y + stepY * row,
            };
          } else {
            const angle = baseAngle + ((Math.PI * 2 * sweep) / 360) * (index / count);
            targetCenter = {
              x: artboardCenter.x + Math.cos(angle) * baseRadius,
              y: artboardCenter.y + Math.sin(angle) * baseRadius,
            };
          }

          const copy = cloneLayerSubtreeWithNewIds(layer, createLayerId, ` ${index + 1}`);
          copy.x += targetCenter.x - center.x;
          copy.y += targetCenter.y - center.y;
          if (copy.type === 'path' && copy.isClipMask) {
            copy.isClipMask = false;
          }
          created.push(copy);
          next.push(copy);
        }
      }
      return changed ? next : layers;
    };

    const nextLayers = repeatInList(scene.layers);
    return created.length > 0 ? { ...scene, layers: nextLayers } : scene;
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((item) => item.id),
      selectedNode: null,
    });
  }
  return created;
}

/** Вписывает слои в заданный прямоугольник с сохранением пропорций. */
export function placeLayersInBounds(
  layerIds: string[],
  box: { x: number; y: number; width: number; height: number },
  mode: 'fit' | 'fill' = 'fit'
): Scene {
  if (layerIds.length === 0 || box.width <= 0 || box.height <= 0) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);

  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const current = computeLayerBBoxWithMatrix(layer, parentM);
      if (current.width <= 1e-6 || current.height <= 1e-6) return layer;

      const scaleX = box.width / current.width;
      const scaleY = box.height / current.height;
      const k = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
      if (!Number.isFinite(k) || k <= 0) return layer;

      const scaled: Layer = {
        ...layer,
        scaleX: layer.scaleX * k,
        scaleY: layer.scaleY * k,
      };
      const next = computeLayerBBoxWithMatrix(scaled, parentM);
      const dx = box.x + box.width / 2 - (next.x + next.width / 2);
      const dy = box.y + box.height / 2 - (next.y + next.height / 2);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: dx, y: dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: dx, y: dy });

      changed = true;
      return {
        ...scaled,
        x: scaled.x + localDelta.x,
        y: scaled.y + localDelta.y,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function rotateLayersBy(layerIds: string[], deltaDeg: number): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      return { ...layer, rotation: layer.rotation + deltaDeg };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function updateLayerEffects(
  layerIds: string[],
  patch: Partial<LayerEffects> | null
): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      if (patch === null) {
        const rest = { ...layer };
        delete rest.effects;
        return rest;
      }
      const nextEffects: LayerEffects = { ...(layer.effects ?? {}), ...patch };
      (Object.keys(nextEffects) as Array<keyof LayerEffects>).forEach((k) => {
        if (nextEffects[k] === undefined) {
          delete nextEffects[k];
        }
      });
      if (Object.keys(nextEffects).length === 0) {
        const rest = { ...layer };
        delete rest.effects;
        return rest;
      }
      return { ...layer, effects: nextEffects };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function selectAllLayers(): void {
  const { scene, editingGroupId } = useEditorStore.getState();
  const ids = getScopeLayers(scene.layers, editingGroupId)
    .filter((l) => l.visible && !l.locked)
    .map((l) => l.id);
  useEditorStore.setState({ selectedIds: ids, selectedNode: null });
}

export function deselectAllLayers(): void {
  useEditorStore.setState({ selectedIds: [], selectedNode: null });
}

export function invertSelection(): void {
  const { scene, selectedIds, editingGroupId } = useEditorStore.getState();
  const current = new Set(selectedIds);
  const next = getScopeLayers(scene.layers, editingGroupId)
    .filter((l) => l.visible && !l.locked && !current.has(l.id))
    .map((l) => l.id);
  useEditorStore.setState({ selectedIds: next, selectedNode: null });
}

export function selectSimilarLayers(criterion: 'fill' | 'stroke' | 'type'): number {
  const { scene, selectedIds, editingGroupId } = useEditorStore.getState();
  if (selectedIds.length === 0) return 0;
  const refLayer = findLayerById(scene.layers, selectedIds[0]);
  if (!refLayer) return 0;

  const refFill =
    refLayer.type === 'path' || refLayer.type === 'text'
      ? refLayer.fill ?? null
      : null;
  const refStroke =
    refLayer.type === 'path' ? refLayer.stroke?.color ?? null : null;

  const matched = getScopeLayers(scene.layers, editingGroupId)
    .filter((l) => {
      if (!l.visible || l.locked) return false;
      if (criterion === 'type') return l.type === refLayer.type;
      if (criterion === 'fill') {
        if (l.type !== 'path' && l.type !== 'text') return false;
        return paintEquals(l.fill ?? null, refFill);
      }
      if (l.type !== 'path') return false;
      return paintEquals(l.stroke?.color ?? null, refStroke);
    })
    .map((l) => l.id);

  useEditorStore.setState({ selectedIds: matched, selectedNode: null });
  return matched.length;
}
