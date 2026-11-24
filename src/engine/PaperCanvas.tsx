import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import paper from 'paper/dist/paper-core';
import { subscribeAssets } from '../core/assets';
import { deleteLayers, updateLayers } from '../core/commands';
import { useSettingsStore } from '../core/settings';
import { useCanvasBackdropStore } from '../core/canvasBackdrop';
import { useEditorStore } from '../core/store';
import type {
  Point2D,
  Scene,
  SelectedNodeRef,
  TextLayer,
  ToolType,
} from '../core/types';
import { renderOverlay } from './overlay';
import { syncSceneToPaper } from './sync';
import { getWheelZoomFactor, isCanvasZoomWheel } from './zoom';
import { createBlobTool } from './tools/blobTool';
import { createEyedropperTool } from './tools/eyedropperTool';
import { createNodeTool } from './tools/nodeTool';
import { createPenTool } from './tools/penTool';
import { createSelectTool, findTopLayerAtPoint } from './tools/selectTool';
import { createTextTool } from './tools/textTool';
import type {
  CanvasToolController,
  OverlayExtras,
  ToolContext,
  ToolPointerEvent,
} from './tools/types';

export interface PaperCanvasHandle {
  fitArtboard: () => void;
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

interface PaperRig {
  scope: paper.PaperScope;
  artboardLayer: paper.Layer;
  sceneLayer: paper.Layer;
  overlayLayer: paper.Layer;
  artboardRect: paper.Path.Rectangle | null;
  itemMap: Map<string, paper.Item>;
}

interface EditingTextState {
  layerId: string;
  draft: string;
  selectAll: boolean;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;

let textMeasureCtx: CanvasRenderingContext2D | null | undefined;

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (textMeasureCtx !== undefined) return textMeasureCtx;
  if (typeof document === 'undefined') {
    textMeasureCtx = null;
    return null;
  }
  try {
    textMeasureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    textMeasureCtx = null;
  }
  return textMeasureCtx;
}

function measureTextDraftWorldWidth(layer: TextLayer, draft: string): number {
  const lines = (draft || '').split('\n');
  const ctx = getTextMeasureContext();
  const tracking = layer.letterSpacing ?? 0;
  let maxW = layer.fontSize * 2.5;
  if (ctx) {
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const w = ctx.measureText(line).width + trackingExtra;
      if (w > maxW) maxW = w;
    }
  } else {
    for (const line of lines) {
      const trackingExtra = Math.max(0, line.length - 1) * tracking;
      const w = line.length * layer.fontSize * 0.6 + trackingExtra;
      if (w > maxW) maxW = w;
    }
  }
  return maxW + layer.fontSize * 0.8;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    const showGrid = useSettingsStore((s) => s.settings.showGrid);
    const gridSize = useSettingsStore((s) => s.settings.gridSize);
    const gridOpacity = useSettingsStore((s) => s.settings.gridOpacity);
    const accentColor = useSettingsStore((s) => s.settings.accentColor);
    const showPerfStats = useSettingsStore((s) => s.settings.showPerfStats);
    const canvasBackdrop = useCanvasBackdropStore((s) => s.meta?.dataUrl ?? null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rigRef = useRef<PaperRig | null>(null);

    const sceneRef = useRef(scene);
    const selectedIdsRef = useRef(selectedIds);
    const selectedNodeRef = useRef(selectedNode);
    const activeToolRef = useRef(activeTool);
    const prevToolRef = useRef(activeTool);
    const isSpacePanningRef = useRef(isSpacePanning);
    const onZoomChangeRef = useRef(onZoomChange);
    const onColorSampledRef = useRef(onColorSampled);
    const onOpenContextMenuRef = useRef(onOpenContextMenu);
    const overlayExtrasRef = useRef<OverlayExtras>({});

    const controllersRef = useRef<Partial<Record<ToolType, CanvasToolController>> | null>(
      null
    );

    const [isDraggingPan, setIsDraggingPan] = useState(false);
    const [editingText, setEditingText] = useState<EditingTextState | null>(null);
    const [viewTick, setViewTick] = useState(0);

    const editingTextRef = useRef<EditingTextState | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const committingTextRef = useRef(false);

    sceneRef.current = scene;
    selectedIdsRef.current = selectedIds;
    selectedNodeRef.current = selectedNode;
    activeToolRef.current = activeTool;
    isSpacePanningRef.current = isSpacePanning;
    onZoomChangeRef.current = onZoomChange;
    onColorSampledRef.current = onColorSampled;
    onOpenContextMenuRef.current = onOpenContextMenu;
    editingTextRef.current = editingText;

    if (!controllersRef.current) {
      controllersRef.current = {
        select: createSelectTool(),
        node: createNodeTool(),
        pen: createPenTool(),
        blob: createBlobTool(),
        text: createTextTool(),
        eyedropper: createEyedropperTool({
          onSampled: (hex, target) => onColorSampledRef.current?.(hex, target),
        }),
      };
    }

    const commitTextEditing = useCallback(() => {
      if (committingTextRef.current) return;
      const current = editingTextRef.current;
      if (!current) return;
      committingTextRef.current = true;
      try {
        editingTextRef.current = null;
        setEditingText(null);
        const layer = useEditorStore
          .getState()
          .scene.layers.find(
            (l): l is TextLayer => l.id === current.layerId && l.type === 'text'
          );
        if (!layer) return;
        if (current.draft.trim().length === 0) {
          deleteLayers([layer.id]);
        } else if (current.draft !== layer.content) {
          updateLayers([layer.id], { content: current.draft });
        }
      } finally {
        committingTextRef.current = false;
      }
    }, []);

    const startTextEditing = useCallback(
      (layerId: string, selectAll = false) => {
        if (
          editingTextRef.current &&
          editingTextRef.current.layerId !== layerId
        ) {
          commitTextEditing();
        }
        const layer = useEditorStore
          .getState()
          .scene.layers.find(
            (l): l is TextLayer => l.id === layerId && l.type === 'text'
          );
        if (!layer || layer.locked) return;
        const nextState: EditingTextState = {
          layerId: layer.id,
          draft: layer.content,
          selectAll,
        };
        editingTextRef.current = nextState;
        setEditingText(nextState);
      },
      [commitTextEditing]
    );

    const redrawOverlayFromRefs = useCallback(
      (rig: PaperRig, extras?: OverlayExtras) => {
        if (extras) {
          overlayExtrasRef.current = {
            ...overlayExtrasRef.current,
            ...extras,
          };
        }

        const settings = useSettingsStore.getState().settings;
        renderOverlay(rig.scope, rig.overlayLayer, {
          scene: sceneRef.current,
          selectedIds: selectedIdsRef.current,
          selectedNode: selectedNodeRef.current,
          activeTool: activeToolRef.current,
          draftOverrides: overlayExtrasRef.current.draftOverrides,
          marquee: overlayExtrasRef.current.marquee,
          penDraft: overlayExtrasRef.current.penDraft,
          shapeDraft: overlayExtrasRef.current.shapeDraft,
          hoveredMaskId: overlayExtrasRef.current.hoveredMaskId,
          accentColor: settings.accentColor,
          grid: {
            show: settings.showGrid,
            size: settings.gridSize,
            opacity: settings.gridOpacity,
          },
          guides: overlayExtrasRef.current.guides,
        });
      },
      []
    );

    const buildToolContext = useCallback(
      (rig: PaperRig): ToolContext => ({
        scope: rig.scope,
        sceneLayer: rig.sceneLayer,
        overlayLayer: rig.overlayLayer,
        getItemMap: () => rig.itemMap,
        redrawOverlay: (extras) => redrawOverlayFromRefs(rig, extras),
        startTextEditing,
      }),
      [redrawOverlayFromRefs, startTextEditing]
    );

    const updateArtboardBorderWidth = useCallback((rig: PaperRig) => {
      if (rig.artboardRect) {
        rig.artboardRect.strokeWidth = 1 / rig.scope.view.zoom;
      }
    }, []);

    const fitArtboard = useCallback(() => {
      const rig = rigRef.current;
      if (!rig) return;

      const { scope } = rig;
      const vw = scope.view.viewSize.width;
      const vh = scope.view.viewSize.height;
      if (vw <= 0 || vh <= 0) return;

      const currentScene = sceneRef.current;
      const padding = 48;
      const availW = Math.max(40, vw - padding * 2);
      const availH = Math.max(40, vh - padding * 2);
      const zoom = clamp(
        Math.min(availW / currentScene.width, availH / currentScene.height),
        MIN_ZOOM,
        4
      );

      scope.view.zoom = zoom;
      scope.view.center = new scope.Point(
        currentScene.width / 2,
        currentScene.height / 2
      );
      updateArtboardBorderWidth(rig);
      redrawOverlayFromRefs(rig);
      scope.view.update();
      onZoomChangeRef.current(Math.round(zoom * 100));
      if (editingTextRef.current) {
        setViewTick((t) => t + 1);
      }
    }, [redrawOverlayFromRefs, updateArtboardBorderWidth]);

    const resetZoom100 = useCallback(() => {
      const rig = rigRef.current;
      if (!rig) return;

      const { scope } = rig;
      const currentScene = sceneRef.current;
      scope.view.zoom = 1;
      scope.view.center = new scope.Point(
        currentScene.width / 2,
        currentScene.height / 2
      );
      updateArtboardBorderWidth(rig);
      redrawOverlayFromRefs(rig);
      scope.view.update();
      onZoomChangeRef.current(100);
      if (editingTextRef.current) {
        setViewTick((t) => t + 1);
      }
    }, [redrawOverlayFromRefs, updateArtboardBorderWidth]);

    const stepZoom = useCallback(
      (factor: number) => {
        const rig = rigRef.current;
        if (!rig) return;
        const { scope } = rig;
        const nextZoom = clamp(scope.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        scope.view.zoom = nextZoom;
        updateArtboardBorderWidth(rig);
        redrawOverlayFromRefs(rig);
        scope.view.update();
        onZoomChangeRef.current(Math.round(nextZoom * 100));
        if (editingTextRef.current) {
          setViewTick((t) => t + 1);
        }
      },
      [redrawOverlayFromRefs, updateArtboardBorderWidth]
    );

    const zoomIn = useCallback(() => stepZoom(1.25), [stepZoom]);
    const zoomOut = useCallback(() => stepZoom(1 / 1.25), [stepZoom]);

    const finishActiveTool = useCallback((): boolean => {
      if (editingTextRef.current) {
        commitTextEditing();
        return true;
      }
      const rig = rigRef.current;
      if (!rig || !controllersRef.current) return false;
      const controller = controllersRef.current[activeToolRef.current];
      if (!controller) return false;
      const ctx = buildToolContext(rig);
      if (controller.finish) {
        return controller.finish(ctx);
      }
      controller.cancel?.(ctx);
      return false;
    }, [buildToolContext, commitTextEditing]);

    useImperativeHandle(
      ref,
      () => ({
        fitArtboard,
        resetZoom100,
        zoomIn,
        zoomOut,
        finishActiveTool,
        startTextEditing,
      }),
      [
        finishActiveTool,
        fitArtboard,
        resetZoom100,
        startTextEditing,
        zoomIn,
        zoomOut,
      ]
    );

    const drawArtboard = useCallback((rig: PaperRig, targetScene: Scene) => {
      const { scope, artboardLayer, sceneLayer } = rig;
      scope.activate();
      artboardLayer.activate();
      artboardLayer.removeChildren();

      const rect = new scope.Path.Rectangle(
        new scope.Rectangle(0, 0, targetScene.width, targetScene.height)
      );
      rect.applyMatrix = false;
      rect.fillColor = new scope.Color(targetScene.background || '#ffffff');
      rect.strokeColor = new scope.Color('#c8c0b2');
      rect.strokeWidth = 1 / scope.view.zoom;
      rect.locked = true;
      rig.artboardRect = rect;

      sceneLayer.activate();
      scope.view.update();
    }, []);

    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const scope = new paper.PaperScope();
      scope.settings.applyMatrix = false;
      scope.setup(canvas);
      scope.project.clear();

      const artboardLayer = new scope.Layer({ name: 'artboardLayer' });
      artboardLayer.applyMatrix = false;
      const sceneLayer = new scope.Layer({ name: 'sceneLayer' });
      sceneLayer.applyMatrix = false;
      const overlayLayer = new scope.Layer({ name: 'overlayLayer' });
      overlayLayer.applyMatrix = false;

      sceneLayer.activate();

      const rig: PaperRig = {
        scope,
        artboardLayer,
        sceneLayer,
        overlayLayer,
        artboardRect: null,
        itemMap: new Map(),
      };
      rigRef.current = rig;
      drawArtboard(rig, sceneRef.current);
      rig.itemMap = syncSceneToPaper(scope, sceneLayer, sceneRef.current, {
        editingTextLayerId: editingTextRef.current?.layerId ?? null,
        outlineMode,
      });
      redrawOverlayFromRefs(rig);
      scope.view.update();

      let hasFitted = false;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;

        scope.view.viewSize = new scope.Size(width, height);
        if (!hasFitted) {
          hasFitted = true;
          fitArtboard();
        } else {
          redrawOverlayFromRefs(rig);
          scope.view.update();
          if (editingTextRef.current) {
            setViewTick((t) => t + 1);
          }
        }
      });
      observer.observe(container);

      const toWorldPoint = (event: MouseEvent): Point2D => {
        const rect = canvas.getBoundingClientRect();
        const viewPoint = new scope.Point(
          event.clientX - rect.left,
          event.clientY - rect.top
        );
        const proj = scope.view.viewToProject(viewPoint);
        return { x: proj.x, y: proj.y };
      };

      const toPointerEvent = (
        event: MouseEvent,
        point: Point2D,
        startPoint: Point2D
      ): ToolPointerEvent => ({
        point,
        startPoint,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        detail: event.detail,
      });

      const handleWheel = (event: WheelEvent) => {
        if (!isCanvasZoomWheel(event)) return;
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const viewPoint = new scope.Point(
          event.clientX - rect.left,
          event.clientY - rect.top
        );
        const before = scope.view.viewToProject(viewPoint);
        const wheelSpeed = useSettingsStore.getState().settings.wheelZoomSpeed;
        const nextZoom = clamp(
          scope.view.zoom * getWheelZoomFactor(event.deltaY, wheelSpeed),
          MIN_ZOOM,
          MAX_ZOOM
        );

        scope.view.zoom = nextZoom;
        const after = scope.view.viewToProject(viewPoint);
        scope.view.center = scope.view.center.add(before.subtract(after));
        updateArtboardBorderWidth(rig);
        redrawOverlayFromRefs(rig);
        scope.view.update();
        onZoomChangeRef.current(Math.round(nextZoom * 100));
        if (editingTextRef.current) {
          setViewTick((t) => t + 1);
        }
      };

      let panning = false;
      let lastX = 0;
      let lastY = 0;
      let isToolPointerDown = false;
      let toolStartPoint: Point2D = { x: 0, y: 0 };

      const handleMouseDown = (event: MouseEvent) => {
        const shouldPan =
          event.button === 1 || (event.button === 0 && isSpacePanningRef.current);
        if (shouldPan) {
          event.preventDefault();
          panning = true;
          lastX = event.clientX;
          lastY = event.clientY;
          setIsDraggingPan(true);
          return;
        }

        if (event.button !== 0) return;
        if (editingTextRef.current !== null) {
          commitTextEditing();
          return;
        }
        const controller = controllersRef.current?.[activeToolRef.current];
        if (!controller) return;

        const worldPt = toWorldPoint(event);
        isToolPointerDown = true;
        toolStartPoint = worldPt;
        controller.onMouseDown(
          toPointerEvent(event, worldPt, toolStartPoint),
          buildToolContext(rig)
        );
      };

      const handleMouseMove = (event: MouseEvent) => {
        if (panning) {
          const dx = event.clientX - lastX;
          const dy = event.clientY - lastY;
          lastX = event.clientX;
          lastY = event.clientY;

          scope.view.center = scope.view.center.subtract(
            new scope.Point(dx / scope.view.zoom, dy / scope.view.zoom)
          );
          scope.view.update();
          if (editingTextRef.current) {
            setViewTick((t) => t + 1);
          }
          return;
        }

        const controller = controllersRef.current?.[activeToolRef.current];
        if (!controller) return;

        const worldPt = toWorldPoint(event);
        if (isToolPointerDown) {
          controller.onMouseDrag(
            toPointerEvent(event, worldPt, toolStartPoint),
            buildToolContext(rig)
          );
        } else if (!isSpacePanningRef.current) {
          controller.onMouseMove(
            toPointerEvent(event, worldPt, worldPt),
            buildToolContext(rig)
          );
        }
      };

      const handleMouseUp = (event: MouseEvent) => {
        if (panning) {
          panning = false;
          setIsDraggingPan(false);
        }

        if (!isToolPointerDown) return;
        isToolPointerDown = false;
        const controller = controllersRef.current?.[activeToolRef.current];
        if (!controller) return;
        const worldPt = toWorldPoint(event);
        controller.onMouseUp(
          toPointerEvent(event, worldPt, toolStartPoint),
          buildToolContext(rig)
        );
      };

      const handleDoubleClick = (event: MouseEvent) => {
        if (isSpacePanningRef.current || event.button !== 0) return;
        const controller = controllersRef.current?.[activeToolRef.current];
        if (!controller?.onDoubleClick) return;
        const worldPt = toWorldPoint(event);
        controller.onDoubleClick(
          toPointerEvent(event, worldPt, worldPt),
          buildToolContext(rig)
        );
      };

      const handleWindowBlur = () => {
        if (panning) {
          panning = false;
          setIsDraggingPan(false);
        }
        if (isToolPointerDown) {
          isToolPointerDown = false;
          controllersRef.current?.[activeToolRef.current]?.cancel?.(
            buildToolContext(rig)
          );
        }
      };

      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const hit = findTopLayerAtPoint(
          buildToolContext(rig),
          toWorldPoint(event),
          undefined,
          { includeLocked: true }
        );
        onOpenContextMenuRef.current?.({
          x: event.clientX,
          y: event.clientY,
          layerId: hit ? hit.id : null,
        });
      };

      canvas.addEventListener('wheel', handleWheel, { passive: false });
      canvas.addEventListener('contextmenu', handleContextMenu);
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('dblclick', handleDoubleClick);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleWindowBlur);

      return () => {
        observer.disconnect();
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('contextmenu', handleContextMenu);
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('dblclick', handleDoubleClick);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleWindowBlur);
        rigRef.current = null;
        scope.project?.remove();
      };
    }, [
      buildToolContext,
      commitTextEditing,
      drawArtboard,
      fitArtboard,
      redrawOverlayFromRefs,
      updateArtboardBorderWidth,
    ]);

    useEffect(() => {
      return subscribeAssets(() => {
        const rig = rigRef.current;
        if (!rig) return;
        rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, sceneRef.current, {
          editingTextLayerId: editingTextRef.current?.layerId ?? null,
        });
        redrawOverlayFromRefs(rig);
        rig.scope.view.update();
      });
    }, [redrawOverlayFromRefs]);

    useEffect(() => {
      if (!editingText) return;
      const exists = scene.layers.some(
        (l) => l.id === editingText.layerId && l.type === 'text' && !l.locked
      );
      if (!exists) {
        editingTextRef.current = null;
        setEditingText(null);
      }
    }, [editingText, scene]);

    useEffect(() => {
      if (!editingText) return;
      const raf = requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        if (editingText.selectAll) {
          el.select();
        } else {
          const end = el.value.length;
          el.setSelectionRange(end, end);
        }
      });
      return () => cancelAnimationFrame(raf);
    }, [editingText?.layerId, editingText?.selectAll]);

    useEffect(() => {
      const rig = rigRef.current;
      if (!rig) return;
      drawArtboard(rig, scene);
      rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, scene, {
        editingTextLayerId: editingText?.layerId ?? null,
        outlineMode,
      });
      overlayExtrasRef.current.draftOverrides = undefined;
      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    }, [drawArtboard, editingText?.layerId, outlineMode, redrawOverlayFromRefs, scene]);

    useEffect(() => {
      const rig = rigRef.current;
      if (!rig) return;
      const prevTool = prevToolRef.current;
      if (prevTool !== activeTool && controllersRef.current) {
        commitTextEditing();
        const prevController = controllersRef.current[prevTool];
        const ctx = buildToolContext(rig);
        if (prevController?.finish) {
          prevController.finish(ctx);
        } else {
          prevController?.cancel?.(ctx);
        }
        prevToolRef.current = activeTool;
      }

      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    }, [
      activeTool,
      buildToolContext,
      commitTextEditing,
      redrawOverlayFromRefs,
      selectedIds,
      selectedNode,
    ]);

    useEffect(() => {
      const rig = rigRef.current;
      if (!rig) return;
      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    }, [accentColor, gridOpacity, gridSize, redrawOverlayFromRefs, showGrid]);

    const cursorClass = isDraggingPan
      ? 'cursor-grabbing'
      : isSpacePanning
        ? 'cursor-grab'
        : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'pen' || activeTool === 'blob' || activeTool === 'eyedropper'
            ? 'cursor-crosshair'
            : 'cursor-default';

    void viewTick;
    const editingLayer = editingText
      ? scene.layers.find(
          (l): l is TextLayer => l.id === editingText.layerId && l.type === 'text'
        ) ?? null
      : null;

    let textEditorOverlay: React.ReactNode = null;
    if (editingText && editingLayer && rigRef.current) {
      const rig = rigRef.current;
      const zoom = Math.max(0.05, rig.scope.view.zoom);
      const viewPt = rig.scope.view.projectToView(
        new rig.scope.Point(editingLayer.x, editingLayer.y)
      );
      const lines = (editingText.draft || '').split('\n');
      const worldWidth = measureTextDraftWorldWidth(
        editingLayer,
        editingText.draft
      );
      const boxWidthPx = Math.max(80, worldWidth * zoom);
      const lineStepPx = editingLayer.fontSize * editingLayer.lineHeight * zoom;
      const boxHeightPx = Math.max(lineStepPx, lines.length * lineStepPx + 4);
      const offsetX =
        editingLayer.align === 'center'
          ? -boxWidthPx / 2
          : editingLayer.align === 'right'
            ? -boxWidthPx
            : 0;
      const originX = -offsetX;

      textEditorOverlay = (
        <textarea
          ref={textareaRef}
          value={editingText.draft}
          onChange={(e) => {
            const nextDraft = e.target.value;
            setEditingText((prev) =>
              prev ? { ...prev, draft: nextDraft, selectAll: false } : prev
            );
          }}
          onBlur={commitTextEditing}
          onKeyDown={(e) => {
            if (
              e.key === 'Escape' ||
              (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
            ) {
              e.preventDefault();
              e.stopPropagation();
              commitTextEditing();
            }
          }}
          spellCheck={false}
          style={{
            left: `${viewPt.x + offsetX}px`,
            top: `${viewPt.y}px`,
            width: `${boxWidthPx}px`,
            height: `${boxHeightPx}px`,
            fontFamily: `"${editingLayer.fontFamily}", sans-serif`,
            fontWeight: editingLayer.fontWeight,
            fontSize: `${editingLayer.fontSize * zoom}px`,
            lineHeight: String(editingLayer.lineHeight),
            letterSpacing: `${(editingLayer.letterSpacing ?? 0) * zoom}px`,
            textAlign: editingLayer.align,
            color: editingLayer.fill,
            transformOrigin: `${originX}px 0px`,
            transform: `rotate(${editingLayer.rotation}deg) scale(${editingLayer.scaleX}, ${editingLayer.scaleY})`,
            outline: '1px dashed var(--color-paper-accent)',
            outlineOffset: '2px',
          }}
          className="absolute z-20 m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0"
        />
      );
    }

    const totalAnchors = showPerfStats
      ? scene.layers.reduce(
          (sum, layer) =>
            sum +
            (layer.type === 'path'
              ? layer.subpaths.reduce((s, sp) => s + sp.anchors.length, 0)
              : 0),
          0
        )
      : 0;

    return (
      <div
        ref={containerRef}
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
        <canvas ref={canvasRef} className="block h-full w-full outline-none" />
        {textEditorOverlay}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded border border-paper-border bg-paper-panel px-2.5 py-1 text-[11px] text-paper-muted font-display">
          <span>
            {scene.width} × {scene.height} px
          </span>
          <span className="text-paper-border">•</span>
          <span>{scene.dpi} DPI</span>
          {showPerfStats && (
            <>
              <span className="text-paper-border">•</span>
              <span>{scene.layers.length} сл.</span>
              <span className="text-paper-border">•</span>
              <span>{totalAnchors} узл.</span>
            </>
          )}
        </div>
      </div>
    );
  }
);
