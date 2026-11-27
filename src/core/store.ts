import { create, useStore } from 'zustand';
import { temporal, type ZundoOptions } from 'zundo';
import {
  createDefaultScene,
  type Paint,
  type Scene,
  type SelectedNodeRef,
  type SmartShapeOptions,
  type StrokeStyle,
  type ToolType,
} from './types';

export interface EditorState {
  scene: Scene;
  documentSessionId: number;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  editingGroupId: string | null;
  activeArtboardId: string;
  activeTool: ToolType;
  activeGradientTarget: 'fill' | 'stroke';
  smartShapeOptions: SmartShapeOptions;
  textToolMode: 'point' | 'path';
  knifeToolMode: 'knife' | 'scissors';
  pencilSmoothness: number;
  defaultFill: Paint | null;
  defaultStroke: StrokeStyle | null;
  zoomPercent: number;
  isDirty: boolean;

  setSelectedIds: (ids: string[]) => void;
  setSelectedNode: (node: SelectedNodeRef | null) => void;
  setEditingGroupId: (id: string | null) => void;
  setActiveArtboardId: (id: string) => void;
  setActiveTool: (tool: ToolType) => void;
  setActiveGradientTarget: (target: 'fill' | 'stroke') => void;
  setSmartShapeOptions: (patch: Partial<SmartShapeOptions>) => void;
  setTextToolMode: (mode: 'point' | 'path') => void;
  setKnifeToolMode: (mode: 'knife' | 'scissors') => void;
  setPencilSmoothness: (smoothness: number) => void;
  setDefaultFill: (fill: Paint | null) => void;
  setDefaultStroke: (stroke: StrokeStyle | null) => void;
  setZoomPercent: (zoomPercent: number) => void;
  setDirty: (isDirty: boolean) => void;
}

export const DEFAULT_SMART_SHAPE_OPTIONS: SmartShapeOptions = {
  preset: 'ellipse',
  points: 6,
  wobble: 0.35,
  cornerRadius: 24,
  innerRadiusRatio: 0.5,
};

const temporalOptions: ZundoOptions<EditorState, Pick<EditorState, 'scene'>> = {
  limit: 100,
  partialize: (state) => ({ scene: state.scene }),
  equality: (past, current) => past.scene === current.scene,
};

export const useEditorStore = create<EditorState>()(
  temporal(
    (set) => ({
      scene: createDefaultScene(),
      documentSessionId: 1,
      selectedIds: [],
      selectedNode: null,
      editingGroupId: null,
      activeArtboardId: 'artboard_1',
      activeTool: 'select',
      activeGradientTarget: 'fill',
      smartShapeOptions: { ...DEFAULT_SMART_SHAPE_OPTIONS },
      textToolMode: 'point',
      knifeToolMode: 'knife',
      pencilSmoothness: 2.5,
      defaultFill: '#1c1b1a',
      defaultStroke: null,
      zoomPercent: 100,
      isDirty: false,

      setSelectedIds: (ids) =>
        set((state) => ({
          selectedIds: ids,
          selectedNode:
            state.selectedNode && ids.includes(state.selectedNode.layerId)
              ? state.selectedNode
              : null,
        })),

      setSelectedNode: (node) => set({ selectedNode: node }),

      setEditingGroupId: (editingGroupId) => set({ editingGroupId }),

      setActiveArtboardId: (activeArtboardId) => set({ activeArtboardId }),

      setActiveTool: (tool) =>
        set((state) => ({
          activeTool: tool,
          selectedNode: tool === 'node' ? state.selectedNode : null,
        })),

      setActiveGradientTarget: (target) => set({ activeGradientTarget: target }),

      setSmartShapeOptions: (patch) =>
        set((state) => ({
          smartShapeOptions: { ...state.smartShapeOptions, ...patch },
        })),

      setTextToolMode: (textToolMode) => set({ textToolMode }),

      setKnifeToolMode: (knifeToolMode) => set({ knifeToolMode }),

      setPencilSmoothness: (smoothness) =>
        set({
          pencilSmoothness: Math.min(12, Math.max(0.5, Number.isFinite(smoothness) ? smoothness : 2.5)),
        }),

      setDefaultFill: (fill) => set({ defaultFill: fill }),

      setDefaultStroke: (stroke) => set({ defaultStroke: stroke }),

      setZoomPercent: (zoomPercent) => set({ zoomPercent }),

      setDirty: (isDirty) => set({ isDirty }),
    }),
    temporalOptions
  )
);

export function getUndoLimit(): number {
  return temporalOptions.limit ?? 100;
}

export function setUndoLimit(limit: number): void {
  const safeLimit = Number.isFinite(limit) ? Math.round(limit) : 100;
  const clamped = Math.min(300, Math.max(20, safeLimit));
  temporalOptions.limit = clamped;
  const temporalState = useEditorStore.temporal.getState();
  const past = temporalState.pastStates;
  const future = temporalState.futureStates;
  const patch: Partial<{ pastStates: typeof past; futureStates: typeof future }> = {};
  if (past.length > clamped) {
    patch.pastStates = past.slice(past.length - clamped);
  }
  if (future.length > clamped) {
    patch.futureStates = future.slice(0, clamped);
  }
  if (patch.pastStates || patch.futureStates) {
    useEditorStore.temporal.setState(patch);
  }
}

let historyPauseDepth = 0;

/**
 * Приостанавливает запись Undo-истории с подсчётом вложенности.
 * Возвращает true, если именно этот вызов перевёл историю из активного состояния в паузу.
 */
export function pauseHistory(): boolean {
  const temporalState = useEditorStore.temporal.getState();
  const wasTracking = historyPauseDepth === 0 && temporalState.isTracking;
  historyPauseDepth += 1;
  if (temporalState.isTracking) {
    temporalState.pause();
  }
  return wasTracking;
}

/** Возобновляет запись Undo-истории, когда все вложенные паузы сняты. */
export function resumeHistory(): void {
  if (historyPauseDepth > 0) {
    historyPauseDepth -= 1;
  }
  if (historyPauseDepth === 0) {
    useEditorStore.temporal.getState().resume();
  }
}

/** Принудительно сбрасывает стек пауз (при смене или сбросе документа). */
export function resetHistoryPause(): void {
  historyPauseDepth = 0;
  useEditorStore.temporal.getState().resume();
}

export function withHistoryPaused<T>(fn: () => T): T {
  pauseHistory();
  try {
    return fn();
  } finally {
    resumeHistory();
  }
}

export function useCanUndo(): boolean {
  return useStore(useEditorStore.temporal, (state) => state.pastStates.length > 0);
}

export function useCanRedo(): boolean {
  return useStore(useEditorStore.temporal, (state) => state.futureStates.length > 0);
}
