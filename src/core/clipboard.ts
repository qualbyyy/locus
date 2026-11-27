import { addLayer, createLayerId, runCommandBatch, updateLayers } from './commands';
import {
  cloneLayersWithRemappedRefs,
  findLayerById,
  flattenLayers,
  getScopeLayers,
} from './layerTree';
import { clonePaint, cloneStroke } from './paint';
import { useEditorStore } from './store';
import { sceneToSvg } from '../export/toSvg';
import type {
  BaseLayer,
  BlendMode,
  Layer,
  LayerEffects,
  Paint,
  PathLayer,
  StrokeStyle,
} from './types';

export interface CopiedLayerStyle {
  fill: Paint | null;
  stroke: StrokeStyle | null;
  opacity: number;
  fillRule?: 'nonzero' | 'evenodd';
  blendMode?: BlendMode;
  effects?: LayerEffects;
}

function cloneEffects(effects: LayerEffects): LayerEffects {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(effects)
    : (JSON.parse(JSON.stringify(effects)) as LayerEffects);
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
  const rawTargets = flattenLayers(state.scene.layers).filter((layer) =>
    idSet.has(layer.id)
  );
  if (rawTargets.length === 0) return 0;

  const descendantIds = new Set<string>();
  for (const t of rawTargets) {
    if (t.type === 'group') {
      for (const sub of flattenLayers(t.children)) {
        descendantIds.add(sub.id);
      }
    }
  }
  const targets = rawTargets.filter((t) => !descendantIds.has(t.id));

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
  const state = useEditorStore.getState();
  const targetParentId = state.editingGroupId;
  const scopePathIds = new Set(
    flattenLayers(state.scene.layers).map((l) => l.id)
  );
  const scopeSiblingIds = new Set(
    getScopeLayers(state.scene.layers, targetParentId).map((l) => l.id)
  );

  const { clones: prepared } = cloneLayersWithRemappedRefs(
    copiedLayers,
    createLayerId,
    {
      nameSuffix: ' копия',
      offsetX: offset,
      offsetY: offset,
      existingLayerIds: scopePathIds,
    }
  );
  // Для clipMaskId разрешаем ссылку только на маску в том же целевом скоупе
  for (const item of prepared) {
    if (item.clipMaskId && !scopeSiblingIds.has(item.clipMaskId) && !prepared.some((p) => p.id === item.clipMaskId)) {
      delete item.clipMaskId;
    }
  }

  const created: Layer[] = [];
  runCommandBatch(() => {
    for (const copy of prepared) {
      created.push(addLayer(copy, { select: false, parentGroupId: targetParentId }));
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

  const layer = findLayerById(state.scene.layers, targetId);
  if (!layer) return null;

  if (layer.type === 'path') {
    copiedStyle = {
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke),
      opacity: layer.opacity,
      fillRule: layer.fillRule,
      blendMode: layer.blendMode,
      effects: layer.effects ? cloneEffects(layer.effects) : undefined,
    };
  } else if (layer.type === 'text') {
    copiedStyle = {
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke ?? null),
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      effects: layer.effects ? cloneEffects(layer.effects) : undefined,
    };
  } else {
    copiedStyle = {
      fill: null,
      stroke: null,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      effects: layer.effects ? cloneEffects(layer.effects) : undefined,
    };
  }

  return {
    ...copiedStyle,
    fill: clonePaint(copiedStyle.fill),
    stroke: cloneStroke(copiedStyle.stroke),
    ...(copiedStyle.effects ? { effects: cloneEffects(copiedStyle.effects) } : {}),
  };
}

export function pasteLayerStyle(layerIds?: string[]): number {
  if (!copiedStyle) return 0;

  const state = useEditorStore.getState();
  const ids = layerIds ?? state.selectedIds;
  if (ids.length === 0) return 0;

  const idSet = new Set(ids);
  const targets = flattenLayers(state.scene.layers).filter(
    (l) => idSet.has(l.id) && !l.locked
  );
  if (targets.length === 0) return 0;

  const style = copiedStyle;
  updateLayers(
    targets.map((t) => t.id),
    (layer) => {
      const common: Pick<BaseLayer, 'opacity' | 'blendMode' | 'effects'> = {
        opacity: style.opacity,
        blendMode: style.blendMode ?? 'normal',
      };
      if (style.effects) {
        common.effects = cloneEffects(style.effects);
      } else {
        common.effects = undefined;
      }

      if (layer.type === 'path') {
        const nextPath: PathLayer = {
          ...layer,
          ...common,
          fill: clonePaint(style.fill),
          stroke: cloneStroke(style.stroke),
          ...(style.fillRule ? { fillRule: style.fillRule } : {}),
        };
        return nextPath;
      }
      if (layer.type === 'text') {
        return {
          ...layer,
          ...common,
          ...(style.fill !== null ? { fill: clonePaint(style.fill) } : {}),
          stroke: cloneStroke(style.stroke),
        };
      }
      return {
        ...layer,
        ...common,
      };
    }
  );

  if (targets.some((t) => t.type === 'path')) {
    useEditorStore.setState({
      defaultFill: clonePaint(style.fill),
      defaultStroke: cloneStroke(style.stroke),
    });
  }

  return targets.length;
}

export async function copySelectionAsSvg(
  layerIds?: string[]
): Promise<string | null> {
  const state = useEditorStore.getState();
  const ids = layerIds ?? state.selectedIds;
  if (ids.length === 0) return null;

  const svg = await sceneToSvg(state.scene, {
    layerIds: ids,
    includeBackground: false,
  });

  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(svg);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied && typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = svg;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }

  return svg;
}
