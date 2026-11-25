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
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  editingGroupId: string | null;
  activeArtboardId: string;
  activeTool: ToolType;
  activeGradientTarget: 'fill' | 'stroke';
  smartShapeOptions: SmartShapeOptions;
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
  setPencilSmoothness: (smoothness: number) => void;
  setDefaultFill: (fill: Paint | null) => void;
  setDefaultStroke: (stroke: StrokeStyle | null) => void;
  setZoomPercent: (zoomPercent: number) => void;
  setDirty: (isDirty: boolean) => void;
}

export const DEFAULT_SMART_SHAPE_OPTIONS: SmartShapeOptions = {
  preset: 'blob',
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
      selectedIds: [],
      selectedNode: null,
      editingGroupId: null,
      activeArtboardId: 'artboard_1',
      activeTool: 'select',
      activeGradientTarget: 'fill',
      smartShapeOptions: { ...DEFAULT_SMART_SHAPE_OPTIONS },
      pencilSmoothness: 2.5,
      defaultFill: '#da7756',
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
  const clamped = Math.min(300, Math.max(20, Math.round(limit)));
  temporalOptions.limit = clamped;
  const past = useEditorStore.temporal.getState().pastStates;
  if (past.length > clamped) {
    useEditorStore.temporal.setState({
      pastStates: past.slice(past.length - clamped),
    });
  }
}

export function useCanUndo(): boolean {
  return useStore(useEditorStore.temporal, (state) => state.pastStates.length > 0);
}

export function useCanRedo(): boolean {
  return useStore(useEditorStore.temporal, (state) => state.futureStates.length > 0);
}
