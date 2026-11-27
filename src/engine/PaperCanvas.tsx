import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import { ChevronRight, FolderOpen, X } from 'lucide-react';
import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import { useCanvasBackdropStore } from '../core/canvasBackdrop';
import { addGuide } from '../core/commands';
import {
  findLayerPath,
  flattenLayers,
  getParentGroupId,
} from '../core/layerTree';
import { useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';
import type { Scene, SelectedNodeRef, ToolType } from '../core/types';
import { CanvasRulers } from '../ui/CanvasRulers';
import { InlineTextEditor, useInlineTextEditing } from './canvas/InlineTextEditor';
import { useCanvasPointerRouter } from './canvas/useCanvasPointerRouter';
import { useCanvasViewport } from './canvas/useCanvasViewport';
import { type PaperRig, usePaperRig } from './canvas/usePaperRig';

export interface PaperCanvasHandle {
  fitArtboard: () => void;
  focusArtboard: (artboardId: string) => void;
  zoomToSelection: () => void;
  resetZoom100: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  finishActiveTool: () => boolean;
  startTextEditing: (layerId: string, selectAll?: boolean) => void;
}

interface PaperCanvasProps {
  scene: Scene;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  activeTool: ToolType;
  isSpacePanning: boolean;
  outlineMode?: boolean;
  onZoomChange: (zoomPercent: number) => void;
  onColorSampled?: (hex: string, target: 'fill' | 'stroke') => void;
  onOpenContextMenu?: (payload: {
    x: number;
    y: number;
    layerId: string | null;
  }) => void;
}

export const PaperCanvas = forwardRef<PaperCanvasHandle, PaperCanvasProps>(
  function PaperCanvas(
    {
      scene,
      selectedIds,
      selectedNode,
      activeTool,
      isSpacePanning,
      outlineMode = false,
      onZoomChange,
      onColorSampled,
      onOpenContextMenu,
    },
    ref
  ) {
    const showRulers = useSettingsStore((s) => s.settings.showRulers);
    const showGuides = useSettingsStore((s) => s.settings.showGuides);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const showPerfStats = useSettingsStore((s) => s.settings.showPerfStats);
    const canvasBackdrop = useCanvasBackdropStore((s) => s.meta?.url ?? null);
    const activeGradientTarget = useEditorStore((s) => s.activeGradientTarget);
    const editingGroupId = useEditorStore((s) => s.editingGroupId);
    const activeArtboardId = useEditorStore((s) => s.activeArtboardId);
    const setEditingGroupId = useEditorStore((s) => s.setEditingGroupId);

    const onBeforeDestroyRef = useRef<((rig: PaperRig) => void) | null>(null);
    const inlineText = useInlineTextEditing(scene);

    const rigState = usePaperRig({
      scene,
      selectedIds,
      selectedNode,
      activeTool,
      activeGradientTarget,
      editingGroupId,
      activeArtboardId,
      outlineMode,
      isSpacePanning,
      editingText: inlineText.editingText,
      editingTextRef: inlineText.editingTextRef,
      onZoomChange,
      onColorSampled,
      onOpenContextMenu,
      onBeforeDestroyRef,
    });

    const viewport = useCanvasViewport({
      containerRef: rigState.containerRef,
      canvasRef: rigState.canvasRef,
      rigRef: rigState.rigRef,
      sceneRef: rigState.sceneRef,
      selectedIdsRef: rigState.selectedIdsRef,
      activeArtboardIdRef: rigState.activeArtboardIdRef,
      onZoomChangeRef: rigState.onZoomChangeRef,
      redrawOverlayFromRefs: rigState.redrawOverlayFromRefs,
      updateArtboardBorderWidth: rigState.updateArtboardBorderWidth,
    });

    const pointer = useCanvasPointerRouter({
      containerRef: rigState.containerRef,
      canvasRef: rigState.canvasRef,
      rigRef: rigState.rigRef,
      overlayExtrasRef: rigState.overlayExtrasRef,
      sceneRef: rigState.sceneRef,
      selectedIds,
      selectedNode,
      activeTool,
      activeToolRef: rigState.activeToolRef,
      editingGroupIdRef: rigState.editingGroupIdRef,
      outlineModeRef: rigState.outlineModeRef,
      isSpacePanningRef: rigState.isSpacePanningRef,
      onColorSampledRef: rigState.onColorSampledRef,
      onOpenContextMenuRef: rigState.onOpenContextMenuRef,
      editingTextRef: inlineText.editingTextRef,
      commitTextEditing: inlineText.commitTextEditing,
      startTextEditing: inlineText.startTextEditing,
      redrawOverlayFromRefs: rigState.redrawOverlayFromRefs,
      showRulers,
      rulerViewToProject: viewport.rulerViewToProject,
      zoomAtViewPoint: viewport.zoomAtViewPoint,
      panByViewDelta: viewport.panByViewDelta,
      onBeforeDestroyRef,
    });

    useImperativeHandle(
      ref,
      () => ({
        fitArtboard: viewport.fitArtboard,
        focusArtboard: viewport.focusArtboard,
        zoomToSelection: viewport.zoomToSelection,
        resetZoom100: viewport.resetZoom100,
        zoomIn: viewport.zoomIn,
        zoomOut: viewport.zoomOut,
        finishActiveTool: pointer.finishActiveTool,
        startTextEditing: inlineText.startTextEditing,
      }),
      [
        inlineText.startTextEditing,
        pointer.finishActiveTool,
        viewport.fitArtboard,
        viewport.focusArtboard,
        viewport.resetZoom100,
        viewport.zoomIn,
        viewport.zoomOut,
        viewport.zoomToSelection,
      ]
    );

    const handleCreateGuide = useCallback(
      (orientation: 'horizontal' | 'vertical', position: number) => {
        addGuide(orientation, position);
      },
      []
    );

    const cursorClass = pointer.isDraggingPan
      ? 'cursor-grabbing'
      : isSpacePanning
        ? 'cursor-grab'
        : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'pen' ||
              activeTool === 'blob' ||
              activeTool === 'eyedropper' ||
              activeTool === 'shapeBuilder' ||
              activeTool === 'pencil' ||
              activeTool === 'knife'
            ? 'cursor-crosshair'
            : 'cursor-default';

    const allSceneLayers = flattenLayers(scene.layers);
    const totalAnchors = showPerfStats
      ? allSceneLayers.reduce(
          (sum, layer) =>
            sum +
            (layer.type === 'path'
              ? layer.subpaths.reduce((s, sp) => s + sp.anchors.length, 0)
              : 0),
          0
        )
      : 0;

    const artboards = getSceneArtboards(scene);
    const activeAb = getActiveArtboard(scene, activeArtboardId);
    const groupTrail = editingGroupId
      ? (findLayerPath(scene.layers, editingGroupId)?.filter(
          (l) => l.type === 'group'
        ) ?? [])
      : [];

    return (
      <div
        ref={rigState.containerRef}
        data-tour="canvas.root"
        onPointerMove={pointer.handleContainerPointerMove}
        onPointerLeave={pointer.handleContainerPointerLeave}
        className={`relative flex-1 overflow-hidden bg-paper-canvas ${cursorClass}`}
        style={
          canvasBackdrop
            ? {
                backgroundImage: `url(${canvasBackdrop})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        <canvas ref={rigState.canvasRef} className="block h-full w-full outline-none" />
        {showRulers && (
          <CanvasRulers
            viewToProject={viewport.rulerViewToProject}
            projectToView={viewport.rulerProjectToView}
            viewTick={viewport.viewTick}
            cursorProjectPos={pointer.cursorProjectPos}
            showGuides={showGuides}
            onToggleGuides={() => updateSettings({ showGuides: !showGuides })}
            onPreviewGuide={rigState.handlePreviewGuide}
            onCreateGuide={handleCreateGuide}
          />
        )}
        <InlineTextEditor
          scope={rigState.rigRef.current?.scope ?? null}
          scene={scene}
          editingText={inlineText.editingText}
          setEditingText={inlineText.setEditingText}
          textareaRef={inlineText.textareaRef}
          viewTick={viewport.viewTick}
          commitTextEditing={inlineText.commitTextEditing}
        />

        {groupTrail.length > 0 && editingGroupId && (
          <div
            className={`animate-rise absolute z-20 flex items-center gap-1 rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink shadow ${
              showRulers
                ? 'left-7 top-7 max-w-[calc(100%-40px)]'
                : 'left-3 top-3 max-w-[calc(100%-24px)]'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={1.75} />
            <button
              type="button"
              onClick={() => {
                setEditingGroupId(null);
                useEditorStore.getState().setSelectedIds([]);
              }}
              className="rounded px-1 text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              Сцена
            </button>
            {groupTrail.map((grp, idx) => {
              const isCurrent = idx === groupTrail.length - 1;
              return (
                <span key={grp.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-paper-muted" strokeWidth={1.75} />
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      setEditingGroupId(grp.id);
                      useEditorStore.getState().setSelectedIds([]);
                    }}
                    className={`max-w-32 truncate rounded px-1 ${
                      isCurrent
                        ? 'font-medium text-paper-ink'
                        : 'text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                    }`}
                  >
                    {grp.name}
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              title="Выйти из группы (Esc)"
              onClick={() => {
                const parentId = getParentGroupId(scene.layers, editingGroupId);
                setEditingGroupId(parentId);
                useEditorStore.getState().setSelectedIds([]);
              }}
              className="ml-1 flex h-5 w-5 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded border border-paper-border bg-paper-panel px-2.5 py-1 text-[11px] text-paper-muted font-display">
          {artboards.length > 1 && (
            <>
              <span className="max-w-36 truncate font-medium text-paper-ink">
                {activeAb.name}
              </span>
              <span className="text-paper-border">•</span>
            </>
          )}
          <span>
            {activeAb.width} × {activeAb.height} px
          </span>
          <span className="text-paper-border">•</span>
          <span>{scene.dpi} DPI</span>
          {showPerfStats && (
            <>
              <span className="text-paper-border">•</span>
              <span>{allSceneLayers.length} сл.</span>
              <span className="text-paper-border">•</span>
              <span>{totalAnchors} узл.</span>
            </>
          )}
        </div>
      </div>
    );
  }
);
