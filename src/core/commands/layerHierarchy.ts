import {
  applyGroupTransformToChild,
  findLayerById,
  flattenLayers,
  getParentGroupId,
  getScopeLayers,
  mapLayerTree,
  reconcileLayerRefs,
  updateGroupChildren,
} from '../layerTree';
import { computeCombinedWorldBBox } from '../math';
import { useEditorStore } from '../store';
import type { GroupLayer, Layer, PathLayer, Scene } from '../types';
import {
  DEFAULT_RESTORE_STROKE,
  commitScene,
  createLayerId,
  findSharedClipMaskId,
} from './helpers';

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
    const bbox = computeCombinedWorldBBox(targets, scene.layers);
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

    return { ...scene, layers: reconcileLayerRefs(nextLayers, true) };
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
  let released: Layer[] = [];
  const prevState = useEditorStore.getState();
  const prevEditingId = prevState.editingGroupId;
  let nextEditingId = prevEditingId;

  commitScene((scene) => {
    const candidateReleasedIds: string[] = [];
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
            candidateReleasedIds.push(expanded.id);
            next.push(expanded);
          }
        } else {
          next.push(workingGroup);
        }
      }
      return changed ? next : layers;
    };

    const nextLayers = ungroupInList(scene.layers);
    if (nextLayers === scene.layers) return scene;
    const reconciled = reconcileLayerRefs(nextLayers, true);
    const aliveIds = new Set(flattenLayers(reconciled).map((l) => l.id));
    const uniqueIds = Array.from(new Set(candidateReleasedIds)).filter((id) =>
      aliveIds.has(id)
    );
    const byId = new Map(flattenLayers(reconciled).map((l) => [l.id, l]));
    released = uniqueIds.map((id) => byId.get(id)!).filter(Boolean);
    return { ...scene, layers: reconciled };
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
    let maskParentId: string | null = null;
    if (maskLayerId !== null) {
      const maskLayer = layersById.get(maskLayerId);
      if (!maskLayer || maskLayer.type !== 'path') {
        return scene;
      }
      maskParentId = getParentGroupId(scene.layers, maskLayerId);
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

        const layerParentId = getParentGroupId(scene.layers, layer.id);
        if (
          layerParentId === maskParentId &&
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

    if (!changed) return scene;
    return { ...scene, layers: reconcileLayerRefs(updated, true) };
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
