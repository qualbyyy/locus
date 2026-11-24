import { clearAssets } from '../assets';
import { clamp, normalizePathLayer } from '../math';
import { useEditorStore } from '../store';
import { createDefaultScene, type Scene } from '../types';
import { commitScene, validateSelectionAgainstScene } from './helpers';

export function resetDocument(
  init?: Partial<Pick<Scene, 'name' | 'width' | 'height' | 'dpi' | 'background'>>
): Scene {
  clearAssets();
  const nextScene = createDefaultScene(init);
  useEditorStore.setState({
    scene: nextScene,
    selectedIds: [],
    selectedNode: null,
    isDirty: false,
  });
  useEditorStore.temporal.getState().clear();
  return nextScene;
}

export function loadScene(scene: Scene): Scene {
  const normalizedLayers = scene.layers.map((layer) =>
    layer.type === 'path' ? normalizePathLayer(layer) : layer
  );
  const nextScene: Scene = { ...scene, layers: normalizedLayers };
  useEditorStore.setState({
    scene: nextScene,
    selectedIds: [],
    selectedNode: null,
    isDirty: false,
  });
  useEditorStore.temporal.getState().clear();
  return nextScene;
}

export function updateArtboard(
  patch: Partial<Pick<Scene, 'name' | 'width' | 'height' | 'dpi' | 'background'>>
): Scene {
  return commitScene((scene) => {
    const nextName =
      patch.name !== undefined ? patch.name.trim() || scene.name : scene.name;
    const nextWidth =
      patch.width !== undefined ? clamp(Math.round(patch.width), 64, 16000) : scene.width;
    const nextHeight =
      patch.height !== undefined
        ? clamp(Math.round(patch.height), 64, 16000)
        : scene.height;
    const nextDpi =
      patch.dpi !== undefined ? clamp(Math.round(patch.dpi), 72, 600) : scene.dpi;
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

export function undoCommand(): void {
  const temporal = useEditorStore.temporal.getState();
  if (temporal.pastStates.length === 0) return;
  temporal.undo();
  validateSelectionAgainstScene(useEditorStore.getState().scene);
}

export function redoCommand(): void {
  const temporal = useEditorStore.temporal.getState();
  if (temporal.futureStates.length === 0) return;
  temporal.redo();
  validateSelectionAgainstScene(useEditorStore.getState().scene);
}

export function runCommandBatch(fn: () => void): void {
  const temporal = useEditorStore.temporal.getState();
  const initialScene = useEditorStore.getState().scene;
  const wasTracking = temporal.isTracking;
  if (wasTracking) {
    temporal.pause();
  }

  try {
    fn();
  } finally {
    const finalScene = useEditorStore.getState().scene;
    if (finalScene !== initialScene) {
      useEditorStore.setState({ scene: initialScene });
      if (wasTracking) {
        temporal.resume();
      }
      useEditorStore.setState({ scene: finalScene, isDirty: true });
    } else if (wasTracking) {
      temporal.resume();
    }
  }
}
