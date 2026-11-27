import { generateSmartShape } from '../../engine/geometry';
import { getActiveArtboard } from '../artboards';
import {
  cloneLayersWithRemappedRefs,
  filterLayerTree,
  findLayerById,
  flattenLayers,
  getLayerWorldMatrix,
  getParentGroupId,
  mapLayerTree,
  reconcileLayerRefs,
  updateGroupChildren,
} from '../layerTree';
import {
  applyMatrixToPoint,
  clamp,
  invertMatrix,
  normalizePathLayer,
} from '../math';
import { clonePaint, cloneStroke } from '../paint';
import { useEditorStore } from '../store';
import type {
  AssetEntry,
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
  clearTextPathProps,
  commitScene,
  createLayerId,
  validateSelectionAgainstScene,
} from './helpers';

const PRESET_LABELS: Record<SmartShapePreset, string> = {
  ellipse: 'Круг / Эллипс',
  rect: 'Прямоугольник',
  polygon: 'Многоугольник',
  star: 'Звезда',
  capsule: 'Капсула',
  blob: 'Клякса',
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

  const worldCenter = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
  const targetPos =
    params.x !== undefined && params.y !== undefined
      ? { x: params.x, y: params.y }
      : params.parentGroupId
        ? applyMatrixToPoint(
            invertMatrix(getLayerWorldMatrix(scene.layers, params.parentGroupId)),
            worldCenter
          )
        : worldCenter;

  const layer: ImageLayer = {
    id: createLayerId('img'),
    name: params.name?.trim() || `Изображение ${sameTypeCount}`,
    type: 'image',
    visible: true,
    locked: false,
    x: params.x ?? targetPos.x,
    y: params.y ?? targetPos.y,
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
        nextLayer = clearTextPathProps(nextLayer);
      }
      return nextLayer;
    });

    return { ...scene, layers: reconcileLayerRefs(cleaned, true) };
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
    const allSceneIds = new Set(flattenLayers(scene.layers).map((l) => l.id));
    const duplicateInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const walked = layers.map((raw) => {
        if (raw.type === 'group') {
          const nextChildren = duplicateInList(raw.children);
          if (nextChildren !== raw.children) {
            changed = true;
            return { ...raw, children: nextChildren };
          }
        }
        return raw;
      });

      const listTargets = walked.filter((l) => sourceSet.has(l.id));
      if (listTargets.length === 0) {
        return changed ? walked : layers;
      }

      changed = true;
      const { clones, rootIdMap } = cloneLayersWithRemappedRefs(
        listTargets,
        createLayerId,
        {
          nameSuffix: ' копия',
          offsetX,
          offsetY,
          existingLayerIds: allSceneIds,
        }
      );
      const cloneByOrigId = new Map<string, Layer>();
      listTargets.forEach((orig) => {
        const cid = rootIdMap.get(orig.id);
        const clone = clones.find((c) => c.id === cid);
        if (clone) cloneByOrigId.set(orig.id, clone);
      });

      const next: Layer[] = [];
      for (const item of walked) {
        next.push(item);
        const clone = cloneByOrigId.get(item.id);
        if (clone) {
          created.push(clone);
          next.push(clone);
        }
      }
      return next;
    };

    const nextLayers = duplicateInList(scene.layers);
    return created.length > 0
      ? { ...scene, layers: reconcileLayerRefs(nextLayers, true) }
      : scene;
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
