import { findLayerById, getScopeLayers } from '../layerTree';
import { paintEquals } from '../paint';
import { useEditorStore } from '../store';

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
    refLayer.type === 'path' || refLayer.type === 'text'
      ? refLayer.stroke?.color ?? null
      : null;

  const matched = getScopeLayers(scene.layers, editingGroupId)
    .filter((l) => {
      if (!l.visible || l.locked) return false;
      if (criterion === 'type') return l.type === refLayer.type;
      if (criterion === 'fill') {
        if (l.type !== 'path' && l.type !== 'text') return false;
        return paintEquals(l.fill ?? null, refFill);
      }
      if (l.type !== 'path' && l.type !== 'text') return false;
      return paintEquals(l.stroke?.color ?? null, refStroke);
    })
    .map((l) => l.id);

  useEditorStore.setState({ selectedIds: matched, selectedNode: null });
  return matched.length;
}
