import { useEditorStore } from '../store';
import type { Layer, Scene, StrokeStyle } from '../types';

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
  const layerMap = new Map(scene.layers.map((layer) => [layer.id, layer]));
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

  if (
    nextSelectedIds.length !== state.selectedIds.length ||
    nextSelectedNode !== state.selectedNode
  ) {
    useEditorStore.setState({
      selectedIds: nextSelectedIds,
      selectedNode: nextSelectedNode,
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

/** Заменяет набор слоёв на месте самого верхнего из них, очищая ссылки на удалённые маски. */
export function replaceLayersAtHighestIndex(
  targetIds: Set<string>,
  replacementLayers: Layer[]
): void {
  commitScene((scene) => {
    let highestIdx = -1;
    scene.layers.forEach((layer, idx) => {
      if (targetIds.has(layer.id)) {
        highestIdx = idx;
      }
    });
    if (highestIdx === -1) return scene;

    const nextLayers: Layer[] = [];
    scene.layers.forEach((layer, idx) => {
      if (idx === highestIdx) {
        nextLayers.push(...replacementLayers);
      }
      if (targetIds.has(layer.id)) {
        return;
      }
      if (layer.clipMaskId && targetIds.has(layer.clipMaskId)) {
        const cleaned = { ...layer };
        delete cleaned.clipMaskId;
        nextLayers.push(cleaned);
      } else {
        nextLayers.push(layer);
      }
    });

    return { ...scene, layers: nextLayers };
  });

  useEditorStore.setState({
    selectedIds: replacementLayers.map((l) => l.id),
    selectedNode: null,
  });
}
