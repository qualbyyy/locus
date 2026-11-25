import { getSceneArtboards } from '../artboards';
import { flattenLayers, mapLayerTree } from '../layerTree';
import { useEditorStore } from '../store';
import type { Layer, Scene, StrokeStyle, TextLayer } from '../types';

let fallbackCounter = 0;

export function createLayerId(prefix = 'layer'): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackCounter}`;
}

export const DEFAULT_RESTORE_STROKE: StrokeStyle = {
  color: '#1c1b1a',
  width: 1.5,
  lineCap: 'round',
  lineJoin: 'round',
};

export function commitScene(recipe: (scene: Scene) => Scene): Scene {
  const prevScene = useEditorStore.getState().scene;
  const nextScene = recipe(prevScene);
  if (nextScene === prevScene) {
    return prevScene;
  }
  useEditorStore.setState({ scene: nextScene, isDirty: true });
  return nextScene;
}

export function validateSelectionAgainstScene(scene: Scene): void {
  const state = useEditorStore.getState();
  const layerMap = new Map(
    flattenLayers(scene.layers).map((layer) => [layer.id, layer])
  );
  const nextSelectedIds = state.selectedIds.filter((id) => layerMap.has(id));

  let nextSelectedNode = state.selectedNode;
  if (nextSelectedNode) {
    const target = layerMap.get(nextSelectedNode.layerId);
    if (!target || target.type !== 'path') {
      nextSelectedNode = null;
    } else {
      const sp = target.subpaths[nextSelectedNode.subpathIndex];
      if (!sp || nextSelectedNode.anchorIndex >= sp.anchors.length) {
        nextSelectedNode = null;
      }
    }
  }

  let nextEditingGroupId = state.editingGroupId;
  if (nextEditingGroupId) {
    const groupTarget = layerMap.get(nextEditingGroupId);
    if (!groupTarget || groupTarget.type !== 'group') {
      nextEditingGroupId = null;
    }
  }

  const artboards = getSceneArtboards(scene);
  const nextActiveArtboardId = artboards.some(
    (ab) => ab.id === state.activeArtboardId
  )
    ? state.activeArtboardId
    : artboards[0].id;

  if (
    nextSelectedIds.length !== state.selectedIds.length ||
    nextSelectedNode !== state.selectedNode ||
    nextEditingGroupId !== state.editingGroupId ||
    nextActiveArtboardId !== state.activeArtboardId
  ) {
    useEditorStore.setState({
      selectedIds: nextSelectedIds,
      selectedNode: nextSelectedNode,
      editingGroupId: nextEditingGroupId,
      activeArtboardId: nextActiveArtboardId,
    });
  }
}

export function findSharedClipMaskId(
  targets: Layer[],
  consumedIds: Set<string>
): string | undefined {
  const firstMask = targets[0]?.clipMaskId;
  if (
    firstMask &&
    !consumedIds.has(firstMask) &&
    targets.every((t) => t.clipMaskId === firstMask)
  ) {
    return firstMask;
  }
  return undefined;
}

function replaceInSiblingList(
  layers: Layer[],
  targetIds: Set<string>,
  replacementLayers: Layer[]
): { next: Layer[]; replaced: boolean } {
  let highestIdx = -1;
  layers.forEach((layer, idx) => {
    if (targetIds.has(layer.id)) {
      highestIdx = idx;
    }
  });

  if (highestIdx !== -1) {
    const next: Layer[] = [];
    layers.forEach((layer, idx) => {
      if (idx === highestIdx) {
        next.push(...replacementLayers);
      }
      if (!targetIds.has(layer.id)) {
        next.push(layer);
      }
    });
    return { next, replaced: true };
  }

  for (let i = 0; i < layers.length; i += 1) {
    const cur = layers[i];
    if (cur.type !== 'group') continue;
    const sub = replaceInSiblingList(cur.children, targetIds, replacementLayers);
    if (sub.replaced) {
      const next = [...layers];
      next[i] = { ...cur, children: sub.next };
      return { next, replaced: true };
    }
  }

  return { next: layers, replaced: false };
}

export function clearTextPathProps(layer: TextLayer): TextLayer {
  if (
    layer.pathId === undefined &&
    layer.pathOffset === undefined &&
    layer.pathFlip === undefined &&
    layer.pathBaselineOffset === undefined &&
    layer.pathStretch === undefined
  ) {
    return layer;
  }
  const copy = { ...layer };
  delete copy.pathId;
  delete copy.pathOffset;
  delete copy.pathFlip;
  delete copy.pathBaselineOffset;
  delete copy.pathStretch;
  return copy;
}

/** Заменяет набор слоёв на месте самого верхнего из них, очищая ссылки на удалённые маски. */
export function replaceLayersAtHighestIndex(
  targetIds: Set<string>,
  replacementLayers: Layer[]
): void {
  commitScene((scene) => {
    const { next, replaced } = replaceInSiblingList(
      scene.layers,
      targetIds,
      replacementLayers
    );
    if (!replaced) return scene;

    const cleaned = mapLayerTree(next, (layer) => {
      let nextLayer = layer;
      if (nextLayer.clipMaskId && targetIds.has(nextLayer.clipMaskId)) {
        const copy = { ...nextLayer };
        delete copy.clipMaskId;
        nextLayer = copy;
      }
      if (
        nextLayer.type === 'text' &&
        nextLayer.pathId &&
        targetIds.has(nextLayer.pathId)
      ) {
        nextLayer = clearTextPathProps(nextLayer);
      }
      return nextLayer;
    });

    return { ...scene, layers: cleaned };
  });

  useEditorStore.setState({
    selectedIds: replacementLayers.map((l) => l.id),
    selectedNode: null,
  });
}
