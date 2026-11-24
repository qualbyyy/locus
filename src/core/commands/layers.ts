import { generateSmartShape } from '../../engine/geometry';
import {
  clamp,
  computeCombinedWorldBBox,
  computeLayerWorldBBox,
  normalizePathLayer,
} from '../math';
import { useEditorStore } from '../store';
import type {
  AssetEntry,
  ImageLayer,
  Layer,
  LayerEffects,
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

export function addLayer(layer: Layer, opts?: { select?: boolean }): Layer {
  const prepared = layer.type === 'path' ? normalizePathLayer(layer) : layer;
  commitScene((scene) => ({
    ...scene,
    layers: [...scene.layers, prepared],
  }));

  if (opts?.select !== false) {
    useEditorStore.setState({
      selectedIds: [prepared.id],
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
  fill?: string | null;
  stroke?: StrokeStyle | null;
  name?: string;
  seed?: number;
  select?: boolean;
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
    state.scene.layers.filter((l) => l.type === 'path').length + 1;

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
    fill,
    stroke: stroke ? { ...stroke } : null,
  };

  return addLayer(layer, { select: params.select }) as PathLayer;
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
}): ImageLayer {
  const state = useEditorStore.getState();
  const { scene } = state;
  const sameTypeCount =
    scene.layers.filter((l) => l.type === 'image').length + 1;

  const width = Math.max(1, Math.round(params.width));
  const height = Math.max(1, Math.round(params.height));
  let scale = 1;
  if (
    params.fitToArtboard !== false &&
    (width > scene.width * 0.85 || height > scene.height * 0.85)
  ) {
    scale = Number(
      Math.min(
        1,
        (scene.width * 0.85) / width,
        (scene.height * 0.85) / height
      ).toFixed(4)
    );
  }

  const layer: ImageLayer = {
    id: createLayerId('img'),
    name: params.name?.trim() || `Изображение ${sameTypeCount}`,
    type: 'image',
    visible: true,
    locked: false,
    x: params.x ?? scene.width / 2,
    y: params.y ?? scene.height / 2,
    rotation: 0,
    scaleX: scale,
    scaleY: scale,
    opacity: 1,
    assetId: params.assetId,
    width,
    height,
  };

  return addLayer(layer, { select: params.select }) as ImageLayer;
}

export function replaceImageLayerAsset(
  layerId: string,
  asset: Pick<AssetEntry, 'id' | 'name' | 'naturalWidth' | 'naturalHeight'>
): ImageLayer | null {
  let updatedLayer: ImageLayer | null = null;

  commitScene((scene) => {
    let changed = false;
    const nextLayers = scene.layers.map((layer) => {
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
    const nextLayers = scene.layers.map((layer) => {
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
      useEditorStore.setState({ defaultFill: pathPatch.fill });
    }
    if ('stroke' in pathPatch && pathPatch.stroke !== undefined) {
      useEditorStore.setState({
        defaultStroke: pathPatch.stroke ? { ...pathPatch.stroke } : null,
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
    const nextLayers = scene.layers.map((layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      return {
        ...layer,
        x: layer.x + dx,
        y: layer.y + dy,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function deleteLayers(layerIds: string[]): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;

  const removeSet = new Set(layerIds);
  const nextScene = commitScene((scene) => {
    const remaining = scene.layers.filter((layer) => !removeSet.has(layer.id));
    if (remaining.length === scene.layers.length) {
      return scene;
    }

    const cleaned = remaining.map((layer) => {
      if (layer.clipMaskId && removeSet.has(layer.clipMaskId)) {
        const next = { ...layer };
        delete next.clipMaskId;
        return next;
      }
      return layer;
    });

    return { ...scene, layers: cleaned };
  });

  validateSelectionAgainstScene(nextScene);
  return nextScene;
}

function cloneLayerWithNewId(layer: Layer): Layer {
  const cloned =
    typeof globalThis.structuredClone === 'function'
      ? globalThis.structuredClone(layer)
      : (JSON.parse(JSON.stringify(layer)) as Layer);

  cloned.id = createLayerId(layer.type);
  cloned.name = `${layer.name} копия`;
  return cloned;
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
    const nextLayers: Layer[] = [];
    for (const layer of scene.layers) {
      nextLayers.push(layer);
      if (sourceSet.has(layer.id)) {
        const copy = cloneLayerWithNewId(layer);
        copy.x += offsetX;
        copy.y += offsetY;
        if (copy.type === 'path' && copy.isClipMask) {
          copy.isClipMask = false;
        }
        created.push(copy);
        nextLayers.push(copy);
      }
    }
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
    const currentIndex = scene.layers.findIndex((l) => l.id === layerId);
    if (currentIndex === -1) return scene;

    const lastIndex = scene.layers.length - 1;
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

    if (nextIndex === currentIndex) return scene;

    const nextLayers = [...scene.layers];
    const [moved] = nextLayers.splice(currentIndex, 1);
    nextLayers.splice(nextIndex, 0, moved);
    return { ...scene, layers: nextLayers };
  });
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
    const layersById = new Map(scene.layers.map((l) => [l.id, l]));
    if (maskLayerId !== null) {
      const maskLayer = layersById.get(maskLayerId);
      if (!maskLayer || maskLayer.type !== 'path') {
        return scene;
      }
    }

    const targetSet = new Set(targetLayerIds);
    let changed = false;

    const updated = scene.layers.map((layer) => {
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
    for (const layer of updated) {
      if (layer.clipMaskId) {
        referencedMasks.add(layer.clipMaskId);
      }
    }

    const finalized = updated.map((layer) => {
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
    const nextLayers = scene.layers.map((layer) => {
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
  const selectedInOrder = scene.layers.filter((l) => selectedSet.has(l.id));
  if (selectedInOrder.length === 0) {
    return null;
  }

  if (selectedInOrder.length === 1) {
    const candidate = selectedInOrder[0];
    if (candidate.type !== 'path') {
      return null;
    }
    const idx = scene.layers.findIndex((l) => l.id === candidate.id);
    if (idx <= 0) {
      return null;
    }
    const below = scene.layers[idx - 1];
    if (below.id === candidate.id) {
      return null;
    }
    setClipMask(candidate.id, [below.id]);
    const updated = useEditorStore
      .getState()
      .scene.layers.find((l): l is PathLayer => l.id === candidate.id && l.type === 'path');
    return updated && updated.isClipMask ? updated : null;
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
  const updated = useEditorStore
    .getState()
    .scene.layers.find((l): l is PathLayer => l.id === maskCandidate.id && l.type === 'path');
  return updated && updated.isClipMask ? updated : null;
}

export function alignLayers(layerIds: string[], mode: AlignMode): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }

  return commitScene((scene) => {
    const idSet = new Set(layerIds);
    const targets = scene.layers.filter((l) => idSet.has(l.id) && !l.locked);
    if (targets.length === 0) {
      return scene;
    }

    const boxes = new Map(
      targets.map((layer) => [layer.id, computeLayerWorldBBox(layer)])
    );
    const deltas = new Map<string, { dx: number; dy: number }>();

    if (mode === 'artboard_center') {
      const comb = computeCombinedWorldBBox(targets);
      const dx = scene.width / 2 - (comb.x + comb.width / 2);
      const dy = scene.height / 2 - (comb.y + comb.height / 2);
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
      const refBox =
        targets.length === 1
          ? { x: 0, y: 0, width: scene.width, height: scene.height }
          : computeCombinedWorldBBox(targets);

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
    const nextLayers = scene.layers.map((layer) => {
      const d = deltas.get(layer.id);
      if (!d || (Math.abs(d.dx) <= 1e-6 && Math.abs(d.dy) <= 1e-6)) {
        return layer;
      }
      changed = true;
      return {
        ...layer,
        x: layer.x + d.dx,
        y: layer.y + d.dy,
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
    const targets = scene.layers.filter((l) => idSet.has(l.id) && !l.locked);
    if (targets.length === 0) return scene;

    const comb = computeCombinedWorldBBox(targets);
    const pivotX = comb.x + comb.width / 2;
    const pivotY = comb.y + comb.height / 2;

    const nextLayers = scene.layers.map((layer) => {
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

export function rotateLayersBy(layerIds: string[], deltaDeg: number): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = scene.layers.map((layer) => {
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
    const nextLayers = scene.layers.map((layer) => {
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
  const { scene } = useEditorStore.getState();
  const ids = scene.layers.filter((l) => l.visible && !l.locked).map((l) => l.id);
  useEditorStore.setState({ selectedIds: ids, selectedNode: null });
}

export function deselectAllLayers(): void {
  useEditorStore.setState({ selectedIds: [], selectedNode: null });
}

export function invertSelection(): void {
  const { scene, selectedIds } = useEditorStore.getState();
  const current = new Set(selectedIds);
  const next = scene.layers
    .filter((l) => l.visible && !l.locked && !current.has(l.id))
    .map((l) => l.id);
  useEditorStore.setState({ selectedIds: next, selectedNode: null });
}

export function selectSimilarLayers(criterion: 'fill' | 'stroke' | 'type'): number {
  const { scene, selectedIds } = useEditorStore.getState();
  if (selectedIds.length === 0) return 0;
  const refLayer = scene.layers.find((l) => l.id === selectedIds[0]);
  if (!refLayer) return 0;

  const refFill =
    refLayer.type === 'path' || refLayer.type === 'text'
      ? (refLayer.fill ?? null)?.toLowerCase() ?? null
      : null;
  const refStroke =
    refLayer.type === 'path'
      ? (refLayer.stroke?.color ?? null)?.toLowerCase() ?? null
      : null;

  const matched = scene.layers
    .filter((l) => {
      if (!l.visible || l.locked) return false;
      if (criterion === 'type') return l.type === refLayer.type;
      if (criterion === 'fill') {
        if (l.type !== 'path' && l.type !== 'text') return false;
        const f = (l.fill ?? null)?.toLowerCase() ?? null;
        return f === refFill;
      }
      if (l.type !== 'path') return false;
      const s = (l.stroke?.color ?? null)?.toLowerCase() ?? null;
      return s === refStroke;
    })
    .map((l) => l.id);

  useEditorStore.setState({ selectedIds: matched, selectedNode: null });
  return matched.length;
}
