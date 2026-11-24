import { addLayer, createLayerId, runCommandBatch, updateLayers } from './commands';
import { useEditorStore } from './store';
import type { Layer, PathLayer, StrokeStyle } from './types';

export interface CopiedLayerStyle {
  fill: string | null;
  stroke: StrokeStyle | null;
  opacity: number;
  fillRule?: 'nonzero' | 'evenodd';
}

let copiedLayers: Layer[] = [];
let pasteStreak = 0;
let copiedStyle: CopiedLayerStyle | null = null;

function cloneLayer(layer: Layer): Layer {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(layer)
    : (JSON.parse(JSON.stringify(layer)) as Layer);
}

export function clearClipboard(): void {
  copiedLayers = [];
  pasteStreak = 0;
  copiedStyle = null;
}

export function hasCopiedLayers(): boolean {
  return copiedLayers.length > 0;
}

export function hasCopiedStyle(): boolean {
  return copiedStyle !== null;
}

export function copySelectedLayers(layerIds?: string[]): number {
  const state = useEditorStore.getState();
  const ids = layerIds ?? state.selectedIds;
  if (ids.length === 0) return 0;

  const idSet = new Set(ids);
  const targets = state.scene.layers.filter((layer) => idSet.has(layer.id));
  if (targets.length === 0) return 0;

  copiedLayers = targets.map(cloneLayer);
  pasteStreak = 0;

  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      void clipboard
        .writeText(
          JSON.stringify({
            kind: 'locus/layers',
            version: 1,
            layers: copiedLayers,
          })
        )
        .catch(() => {});
    }
  } catch {
    // Игнорируем ограничения системного буфера вне пользовательского жеста
  }

  return copiedLayers.length;
}

export function pasteLayers(opts?: {
  inPlace?: boolean;
  offsetStep?: number;
}): Layer[] {
  if (copiedLayers.length === 0) return [];

  const inPlace = Boolean(opts?.inPlace);
  const offset = inPlace ? 0 : (pasteStreak + 1) * (opts?.offsetStep ?? 16);
  const existingIds = new Set(useEditorStore.getState().scene.layers.map((l) => l.id));

  const idMap = new Map<string, string>();
  for (const src of copiedLayers) {
    idMap.set(src.id, createLayerId(src.type));
  }

  const referencedMaskNewIds = new Set<string>();
  const prepared: Layer[] = copiedLayers.map((src) => {
    const copy = cloneLayer(src);
    copy.id = idMap.get(src.id)!;
    copy.name = `${src.name} копия`;
    copy.x += offset;
    copy.y += offset;

    if (copy.clipMaskId) {
      const remappedMask = idMap.get(copy.clipMaskId);
      if (remappedMask) {
        copy.clipMaskId = remappedMask;
        referencedMaskNewIds.add(remappedMask);
      } else if (!existingIds.has(copy.clipMaskId)) {
        delete copy.clipMaskId;
      }
    }
    return copy;
  });

  for (const item of prepared) {
    if (item.type === 'path' && item.isClipMask && !referencedMaskNewIds.has(item.id)) {
      item.isClipMask = false;
    }
  }

  const created: Layer[] = [];
  runCommandBatch(() => {
    for (const copy of prepared) {
      created.push(addLayer(copy, { select: false }));
    }
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((l) => l.id),
      selectedNode: null,
    });
    if (!inPlace) {
      pasteStreak += 1;
    }
  }

  return created;
}

export function copyLayerStyle(layerId?: string): CopiedLayerStyle | null {
  const state = useEditorStore.getState();
  const targetId = layerId ?? state.selectedIds[0];
  if (!targetId) return null;

  const layer = state.scene.layers.find((l) => l.id === targetId);
  if (!layer) return null;

  if (layer.type === 'path') {
    copiedStyle = {
      fill: layer.fill,
      stroke: layer.stroke ? { ...layer.stroke } : null,
      opacity: layer.opacity,
      fillRule: layer.fillRule,
    };
  } else if (layer.type === 'text') {
    copiedStyle = {
      fill: layer.fill,
      stroke: null,
      opacity: layer.opacity,
    };
  } else {
    copiedStyle = {
      fill: null,
      stroke: null,
      opacity: layer.opacity,
    };
  }

  return {
    ...copiedStyle,
    stroke: copiedStyle.stroke ? { ...copiedStyle.stroke } : null,
  };
}

export function pasteLayerStyle(layerIds?: string[]): number {
  if (!copiedStyle) return 0;

  const state = useEditorStore.getState();
  const ids = layerIds ?? state.selectedIds;
  if (ids.length === 0) return 0;

  const idSet = new Set(ids);
  const targets = state.scene.layers.filter((l) => idSet.has(l.id) && !l.locked);
  if (targets.length === 0) return 0;

  const style = copiedStyle;
  updateLayers(
    targets.map((t) => t.id),
    (layer) => {
      if (layer.type === 'path') {
        const nextPath: PathLayer = {
          ...layer,
          fill: style.fill,
          stroke: style.stroke ? { ...style.stroke } : null,
          opacity: style.opacity,
          ...(style.fillRule ? { fillRule: style.fillRule } : {}),
        };
        return nextPath;
      }
      if (layer.type === 'text') {
        return {
          ...layer,
          opacity: style.opacity,
          ...(style.fill !== null ? { fill: style.fill } : {}),
        };
      }
      return {
        ...layer,
        opacity: style.opacity,
      };
    }
  );

  if (targets.some((t) => t.type === 'path')) {
    useEditorStore.setState({
      defaultFill: style.fill,
      defaultStroke: style.stroke ? { ...style.stroke } : null,
    });
  }

  return targets.length;
}
