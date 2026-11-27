import { getSceneArtboards } from '../artboards';
import {
  flattenLayers,
  getParentGroupId,
  getScopeLayers,
  reconcileLayerRefs,
} from '../layerTree';
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

  let nextEditingGroupId = state.editingGroupId;
  if (nextEditingGroupId) {
    const groupTarget = layerMap.get(nextEditingGroupId);
    if (!groupTarget || groupTarget.type !== 'group') {
      nextEditingGroupId = null;
    }
  }

  const scopeIds = new Set(
    getScopeLayers(scene.layers, nextEditingGroupId).map((layer) => layer.id)
  );
  const nextSelectedIds = state.selectedIds.filter((id) => scopeIds.has(id));

  let nextSelectedNode = state.selectedNode;
  if (nextSelectedNode) {
    const target = layerMap.get(nextSelectedNode.layerId);
    if (!target || target.type !== 'path' || !scopeIds.has(target.id)) {
      nextSelectedNode = null;
    } else {
      const sp = target.subpaths[nextSelectedNode.subpathIndex];
      if (!sp || nextSelectedNode.anchorIndex >= sp.anchors.length) {
        nextSelectedNode = null;
      }
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

function removeTargetsEverywhere(
  layers: Layer[],
  targetIds: Set<string>,
  anchorId: string,
  replacementLayers: Layer[]
): { next: Layer[]; inserted: boolean } {
  let changed = false;
  let inserted = false;
  const next: Layer[] = [];
  for (const raw of layers) {
    let cur = raw;
    if (cur.type === 'group') {
      const sub = removeTargetsEverywhere(cur.children, targetIds, anchorId, replacementLayers);
      if (sub.inserted) inserted = true;
      if (sub.next !== cur.children) {
        cur = { ...cur, children: sub.next };
        changed = true;
      }
    }
    if (cur.id === anchorId) {
      next.push(...replacementLayers);
      inserted = true;
      changed = true;
      continue;
    }
    if (targetIds.has(cur.id)) {
      changed = true;
      continue;
    }
    next.push(cur);
  }
  return { next: changed ? next : layers, inserted };
}

/** Заменяет набор слоёв (даже из разных групп) в точке верхнего/последнего якоря и очищает висячие ссылки. */
export function replaceLayersAtHighestIndex(
  targetIds: Set<string>,
  replacementLayers: Layer[],
  anchorLayerId?: string
): void {
  commitScene((scene) => {
    const flat = flattenLayers(scene.layers);
    let anchor = anchorLayerId && targetIds.has(anchorLayerId) ? anchorLayerId : '';
    if (!anchor) {
      for (let i = flat.length - 1; i >= 0; i -= 1) {
        if (targetIds.has(flat[i].id)) {
          anchor = flat[i].id;
          break;
        }
      }
    }
    if (!anchor) return scene;

    // Если среди удаляемых есть предок другого удаляемого, якорем не может быть удалённый потомок внутри не-удалённой? Нет, проверяем родителя:
    const anchorParent = getParentGroupId(scene.layers, anchor);
    const parentInDeleted = anchorParent !== null && targetIds.has(anchorParent);
    if (parentInDeleted) {
      const fallback = flat.find((l) => targetIds.has(l.id));
      if (fallback) anchor = fallback.id;
    }

    const { next, inserted } = removeTargetsEverywhere(
      scene.layers,
      targetIds,
      anchor,
      replacementLayers
    );
    if (!inserted) return scene;

    const reconciled = reconcileLayerRefs(next, true);
    return { ...scene, layers: reconciled };
  });

  useEditorStore.setState({
    selectedIds: replacementLayers.map((l) => l.id),
    selectedNode: null,
  });
}

export function replacePerIdInList(
  layers: Layer[],
  replacements: Map<string, Layer[]>
): Layer[] {
  let changed = false;
  const next: Layer[] = [];
  for (const rawLayer of layers) {
    let layer = rawLayer;
    if (layer.type === 'group') {
      const nextChildren = replacePerIdInList(layer.children, replacements);
      if (nextChildren !== layer.children) {
        layer = { ...layer, children: nextChildren };
        changed = true;
      }
    }
    const items = replacements.get(layer.id);
    if (items) {
      changed = true;
      next.push(...items);
    } else {
      next.push(layer);
    }
  }
  return changed ? next : layers;
}
