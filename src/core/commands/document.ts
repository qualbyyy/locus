import {
  ARTBOARD_DEFAULT_GAP,
  PRIMARY_ARTBOARD_ID,
  getActiveArtboard,
  getSceneArtboards,
} from '../artboards';
import { clearAssets } from '../assets';
import { clearClipboard } from '../clipboard';
import { clearProjectFonts } from '../fonts';
import { cloneLayersWithRemappedRefs, mapLayerTree } from '../layerTree';
import { clamp, computeLayerWorldBBox, normalizePathLayer } from '../math';
import {
  pauseHistory,
  resetHistoryPause,
  resumeHistory,
  useEditorStore,
} from '../store';
import {
  createDefaultScene,
  type Artboard,
  type Guide,
  type Scene,
} from '../types';
import { commitScene, createLayerId, validateSelectionAgainstScene } from './helpers';

export function resetDocument(
  init?: Partial<Pick<Scene, 'name' | 'width' | 'height' | 'dpi' | 'background'>>
): Scene {
  clearAssets();
  clearProjectFonts();
  clearClipboard();
  const nextScene = createDefaultScene(init);
  useEditorStore.setState((state) => ({
    scene: nextScene,
    documentSessionId: state.documentSessionId + 1,
    selectedIds: [],
    selectedNode: null,
    editingGroupId: null,
    activeArtboardId: PRIMARY_ARTBOARD_ID,
    isDirty: false,
  }));
  resetHistoryPause();
  useEditorStore.temporal.getState().clear();
  return nextScene;
}

export function loadScene(scene: Scene): Scene {
  clearClipboard();
  const normalizedLayers = mapLayerTree(scene.layers, (layer) =>
    layer.type === 'path' ? normalizePathLayer(layer) : layer
  );
  const nextScene: Scene = { ...scene, layers: normalizedLayers };
  const firstArtboardId = getSceneArtboards(nextScene)[0].id;
  useEditorStore.setState((state) => ({
    scene: nextScene,
    documentSessionId: state.documentSessionId + 1,
    selectedIds: [],
    selectedNode: null,
    editingGroupId: null,
    activeArtboardId: firstArtboardId,
    isDirty: false,
  }));
  resetHistoryPause();
  useEditorStore.temporal.getState().clear();
  return nextScene;
}

export function updateArtboard(
  patch: Partial<Pick<Scene, 'name' | 'width' | 'height' | 'dpi' | 'background'>>
): Scene {
  const activeId = useEditorStore.getState().activeArtboardId;
  return commitScene((scene) => {
    const nextName =
      patch.name !== undefined ? patch.name.trim() || scene.name : scene.name;
    const nextDpi =
      patch.dpi !== undefined ? clamp(Math.round(patch.dpi), 72, 600) : scene.dpi;

    if (scene.artboards && scene.artboards.length > 0) {
      let artboardsChanged = false;
      const targetId = scene.artboards.some((a) => a.id === activeId)
        ? activeId
        : scene.artboards[0].id;

      const nextArtboards = scene.artboards.map((ab) => {
        if (ab.id !== targetId) return ab;
        const w =
          patch.width !== undefined
            ? clamp(Math.round(patch.width), 64, 16000)
            : ab.width;
        const h =
          patch.height !== undefined
            ? clamp(Math.round(patch.height), 64, 16000)
            : ab.height;
        const bg = patch.background ?? ab.background;
        if (w === ab.width && h === ab.height && bg === ab.background) {
          return ab;
        }
        artboardsChanged = true;
        return { ...ab, width: w, height: h, background: bg };
      });

      if (!artboardsChanged && nextName === scene.name && nextDpi === scene.dpi) {
        return scene;
      }

      const first = nextArtboards[0];
      return {
        ...scene,
        name: nextName,
        dpi: nextDpi,
        width: first.width,
        height: first.height,
        background: first.background,
        artboards: nextArtboards,
      };
    }

    const nextWidth =
      patch.width !== undefined ? clamp(Math.round(patch.width), 64, 16000) : scene.width;
    const nextHeight =
      patch.height !== undefined
        ? clamp(Math.round(patch.height), 64, 16000)
        : scene.height;
    const nextBg = patch.background ?? scene.background;

    if (
      nextName === scene.name &&
      nextWidth === scene.width &&
      nextHeight === scene.height &&
      nextDpi === scene.dpi &&
      nextBg === scene.background
    ) {
      return scene;
    }

    return {
      ...scene,
      name: nextName,
      width: nextWidth,
      height: nextHeight,
      dpi: nextDpi,
      background: nextBg,
    };
  });
}

export function addArtboard(
  init?: Partial<Omit<Artboard, 'id'>>
): Artboard {
  const activeId = useEditorStore.getState().activeArtboardId;
  let created!: Artboard;

  commitScene((scene) => {
    const base = getSceneArtboards(scene);
    const active = getActiveArtboard(scene, activeId);
    const maxRight = Math.max(...base.map((a) => a.x + a.width));

    created = {
      id: createLayerId('ab'),
      name: init?.name?.trim() || `Артборд ${base.length + 1}`,
      x: init?.x !== undefined ? Math.round(init.x) : maxRight + ARTBOARD_DEFAULT_GAP,
      y: init?.y !== undefined ? Math.round(init.y) : active.y,
      width: clamp(Math.round(init?.width ?? active.width), 64, 16000),
      height: clamp(Math.round(init?.height ?? active.height), 64, 16000),
      background: init?.background ?? active.background,
    };

    const nextArtboards = [...base, created];
    return {
      ...scene,
      width: nextArtboards[0].width,
      height: nextArtboards[0].height,
      background: nextArtboards[0].background,
      artboards: nextArtboards,
    };
  });

  useEditorStore.setState({ activeArtboardId: created.id });
  return created;
}

export function duplicateArtboard(
  artboardId: string,
  includeLayers = true
): Artboard | null {
  let created: Artboard | null = null;

  commitScene((scene) => {
    const base = getSceneArtboards(scene);
    const source = base.find((a) => a.id === artboardId);
    if (!source) return scene;

    const maxRight = Math.max(...base.map((a) => a.x + a.width));
    const dx = maxRight + ARTBOARD_DEFAULT_GAP - source.x;
    const dy = 0;

    created = {
      id: createLayerId('ab'),
      name: `${source.name} копия`,
      x: source.x + dx,
      y: source.y + dy,
      width: source.width,
      height: source.height,
      background: source.background,
    };

    let nextLayers = scene.layers;
    if (includeLayers) {
      const topToClone = scene.layers.filter((layer) => {
        const b = computeLayerWorldBBox(layer, scene.layers);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        return (
          cx >= source.x &&
          cx <= source.x + source.width &&
          cy >= source.y &&
          cy <= source.y + source.height
        );
      });
      if (topToClone.length > 0) {
        const { clones: finalized } = cloneLayersWithRemappedRefs(
          topToClone,
          createLayerId,
          { offsetX: dx, offsetY: dy }
        );
        nextLayers = [...scene.layers, ...finalized];
      }
    }

    const nextArtboards = [...base, created];
    return {
      ...scene,
      width: nextArtboards[0].width,
      height: nextArtboards[0].height,
      background: nextArtboards[0].background,
      artboards: nextArtboards,
      layers: nextLayers,
    };
  });

  if (created) {
    useEditorStore.setState({ activeArtboardId: (created as Artboard).id });
  }
  return created;
}

export function updateArtboardById(
  artboardId: string,
  patch: Partial<
    Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>
  >
): Scene {
  return commitScene((scene) => {
    const base = getSceneArtboards(scene);
    const idx = base.findIndex((a) => a.id === artboardId);
    if (idx === -1) return scene;

    const target = base[idx];
    const nextAb: Artboard = {
      ...target,
      name: patch.name !== undefined ? patch.name.trim() || target.name : target.name,
      x: patch.x !== undefined ? Math.round(patch.x) : target.x,
      y: patch.y !== undefined ? Math.round(patch.y) : target.y,
      width:
        patch.width !== undefined
          ? clamp(Math.round(patch.width), 64, 16000)
          : target.width,
      height:
        patch.height !== undefined
          ? clamp(Math.round(patch.height), 64, 16000)
          : target.height,
      background: patch.background ?? target.background,
    };

    if (
      nextAb.name === target.name &&
      nextAb.x === target.x &&
      nextAb.y === target.y &&
      nextAb.width === target.width &&
      nextAb.height === target.height &&
      nextAb.background === target.background
    ) {
      return scene;
    }

    const nextArtboards = base.map((ab, i) => (i === idx ? nextAb : ab));
    const first = nextArtboards[0];
    const shouldStoreArray =
      Boolean(scene.artboards) ||
      nextArtboards.length > 1 ||
      first.x !== 0 ||
      first.y !== 0 ||
      first.name !== 'Артборд 1';

    return {
      ...scene,
      width: first.width,
      height: first.height,
      background: first.background,
      ...(shouldStoreArray ? { artboards: nextArtboards } : {}),
    };
  });
}

export function deleteArtboard(artboardId: string): boolean {
  let deleted = false;
  let fallbackId = PRIMARY_ARTBOARD_ID;

  commitScene((scene) => {
    const base = getSceneArtboards(scene);
    if (base.length <= 1) return scene;
    const next = base.filter((a) => a.id !== artboardId);
    if (next.length === base.length) return scene;

    deleted = true;
    const first = next[0];
    fallbackId = first.id;
    const keepArray =
      next.length > 1 || first.x !== 0 || first.y !== 0 || first.name !== 'Артборд 1';

    const result: Scene = {
      version: 1,
      name: scene.name,
      width: first.width,
      height: first.height,
      dpi: scene.dpi,
      background: first.background,
      layers: scene.layers,
      ...(keepArray ? { artboards: next } : {}),
      ...(scene.guides && scene.guides.length > 0 ? { guides: scene.guides } : {}),
    };
    return result;
  });

  if (deleted) {
    const state = useEditorStore.getState();
    const stillExists = getSceneArtboards(state.scene).some(
      (a) => a.id === state.activeArtboardId
    );
    if (!stillExists || state.activeArtboardId === artboardId) {
      useEditorStore.setState({ activeArtboardId: fallbackId });
    }
  }
  return deleted;
}

export function addGuide(orientation: 'horizontal' | 'vertical', position: number): Guide {
  const guide: Guide = {
    id: createLayerId('guide'),
    orientation,
    position: Number.isFinite(position) ? position : 0,
  };
  commitScene((scene) => ({
    ...scene,
    guides: [...(scene.guides ?? []), guide],
  }));
  return guide;
}

export function updateGuide(id: string, position: number): boolean {
  let updated = false;
  commitScene((scene) => {
    const existing = scene.guides;
    if (!existing || existing.length === 0) return scene;
    let changed = false;
    const next = existing.map((g) => {
      if (g.id !== id) return g;
      changed = true;
      return { ...g, position: Number.isFinite(position) ? position : g.position };
    });
    if (!changed) return scene;
    updated = true;
    return { ...scene, guides: next };
  });
  return updated;
}

export function deleteGuide(id: string): boolean {
  let deleted = false;
  commitScene((scene) => {
    const existing = scene.guides;
    if (!existing || existing.length === 0) return scene;
    const next = existing.filter((g) => g.id !== id);
    if (next.length === existing.length) return scene;
    deleted = true;
    if (next.length === 0) {
      const copy = { ...scene };
      delete copy.guides;
      return copy;
    }
    return { ...scene, guides: next };
  });
  return deleted;
}

export function clearGuides(): void {
  commitScene((scene) => {
    if (!scene.guides || scene.guides.length === 0) return scene;
    const copy = { ...scene };
    delete copy.guides;
    return copy;
  });
}

export function undoCommand(): void {
  const temporal = useEditorStore.temporal.getState();
  if (temporal.pastStates.length === 0) return;
  const prevScene = useEditorStore.getState().scene;
  temporal.undo();
  const curScene = useEditorStore.getState().scene;
  if (curScene !== prevScene) {
    useEditorStore.setState({ isDirty: true });
  }
  validateSelectionAgainstScene(curScene);
}

export function redoCommand(): void {
  const temporal = useEditorStore.temporal.getState();
  if (temporal.futureStates.length === 0) return;
  const prevScene = useEditorStore.getState().scene;
  temporal.redo();
  const curScene = useEditorStore.getState().scene;
  if (curScene !== prevScene) {
    useEditorStore.setState({ isDirty: true });
  }
  validateSelectionAgainstScene(curScene);
}

export function runCommandBatch(fn: () => void): void {
  const startState = useEditorStore.getState();
  const initialScene = startState.scene;
  const startSessionId = startState.documentSessionId;
  const wasIdle = pauseHistory();

  try {
    fn();
  } catch (err) {
    if (useEditorStore.getState().documentSessionId === startSessionId) {
      useEditorStore.setState({
        scene: initialScene,
        selectedIds: startState.selectedIds,
        selectedNode: startState.selectedNode,
        editingGroupId: startState.editingGroupId,
        activeArtboardId: startState.activeArtboardId,
        isDirty: startState.isDirty,
      });
    }
    resumeHistory();
    throw err;
  }

  const curState = useEditorStore.getState();
  const finalScene = curState.scene;
  if (
    wasIdle &&
    curState.documentSessionId === startSessionId &&
    finalScene !== initialScene
  ) {
    useEditorStore.setState({ scene: initialScene });
    resumeHistory();
    useEditorStore.setState({ scene: finalScene, isDirty: true });
  } else {
    resumeHistory();
  }
}
