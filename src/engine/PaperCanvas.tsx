import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ChevronRight, FolderOpen, X } from 'lucide-react';
import paper from 'paper/dist/paper-core';
import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import { subscribeAssets } from '../core/assets';
import { addGuide, deleteLayers, updateLayers } from '../core/commands';
import { subscribeFonts } from '../core/fonts';
import {
  findLayerById,
  findLayerPath,
  flattenLayers,
  getLayerWorldMatrix,
  getParentGroupId,
} from '../core/layerTree';
import { applyMatrixToPoint, decomposeMatrix } from '../core/math';
import { getPrimaryColor } from '../core/paint';
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
import { computeTextOnPathLocalBBox, resolveHostPathLayer } from './textOnPath';
import { CanvasRulers } from '../ui/CanvasRulers';
import { getWheelZoomFactor, isCanvasZoomWheel } from './zoom';
import { createBlobTool } from './tools/blobTool';
import { createEyedropperTool } from './tools/eyedropperTool';
import { createKnifeTool } from './tools/knifeTool';
import { createNodeTool } from './tools/nodeTool';
import { createPenTool } from './tools/penTool';
import { createPencilTool } from './tools/pencilTool';
import { createSelectTool, findTopLayerAtPoint } from './tools/selectTool';
import { createShapeBuilderTool } from './tools/shapeBuilderTool';
import { createTextTool } from './tools/textTool';
import type {
  CanvasToolController,
  OverlayExtras,
  ToolContext,
  ToolPointerEvent,
} from './tools/types';

export interface PaperCanvasHandle {
  fitArtboard: () => void;
  focusArtboard: (artboardId: string) => void;
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
  artboardRects: paper.Path.Rectangle[];
  artboardLabels: paper.PointText[];
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
    const showRulers = useSettingsStore((s) => s.settings.showRulers);
    const showGuides = useSettingsStore((s) => s.settings.showGuides);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const accentColor = useSettingsStore((s) => s.settings.accentColor);
    const showPerfStats = useSettingsStore((s) => s.settings.showPerfStats);
    const canvasBackdrop = useCanvasBackdropStore((s) => s.meta?.url ?? null);
    const activeGradientTarget = useEditorStore((s) => s.activeGradientTarget);
    const editingGroupId = useEditorStore((s) => s.editingGroupId);
    const activeArtboardId = useEditorStore((s) => s.activeArtboardId);
    const setEditingGroupId = useEditorStore((s) => s.setEditingGroupId);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rigRef = useRef<PaperRig | null>(null);

    const sceneRef = useRef(scene);
    const selectedIdsRef = useRef(selectedIds);
    const selectedNodeRef = useRef(selectedNode);
    const activeToolRef = useRef(activeTool);
    const activeGradientTargetRef = useRef(activeGradientTarget);
    const editingGroupIdRef = useRef(editingGroupId);
    const activeArtboardIdRef = useRef(activeArtboardId);
    const outlineModeRef = useRef(outlineMode);
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
    const [cursorProjectPos, setCursorProjectPos] = useState<Point2D | null>(null);

    const editingTextRef = useRef<EditingTextState | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const committingTextRef = useRef(false);

    sceneRef.current = scene;
    selectedIdsRef.current = selectedIds;
    selectedNodeRef.current = selectedNode;
    activeToolRef.current = activeTool;
    activeGradientTargetRef.current = activeGradientTarget;
    editingGroupIdRef.current = editingGroupId;
    activeArtboardIdRef.current = activeArtboardId;
    outlineModeRef.current = outlineMode;
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
        shapeBuilder: createShapeBuilderTool(),
        pencil: createPencilTool(),
        knife: createKnifeTool(),
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
        const found = findLayerById(
          useEditorStore.getState().scene.layers,
          current.layerId
        );
        const layer = found?.type === 'text' ? found : null;
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
        const found = findLayerById(
          useEditorStore.getState().scene.layers,
          layerId
        );
        const layer = found?.type === 'text' ? found : null;
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
          editingGroupId: editingGroupIdRef.current,
          activeArtboardId: activeArtboardIdRef.current,
          activeTool: activeToolRef.current,
          activeGradientTarget: activeGradientTargetRef.current,
          draftOverrides: overlayExtrasRef.current.draftOverrides,
          marquee: overlayExtrasRef.current.marquee,
          penDraft: overlayExtrasRef.current.penDraft,
          shapeDraft: overlayExtrasRef.current.shapeDraft,
          shapeBuilder: overlayExtrasRef.current.shapeBuilder,
          freehandDraft: overlayExtrasRef.current.freehandDraft,
          hoveredMaskId: overlayExtrasRef.current.hoveredMaskId,
          accentColor: settings.accentColor,
          grid: {
            show: settings.showGrid,
            size: settings.gridSize,
            opacity: settings.gridOpacity,
          },
          guides: overlayExtrasRef.current.guides,
          showGuides: settings.showGuides,
          draggingGuide: overlayExtrasRef.current.draggingGuide,
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
      const zoom = Math.max(0.05, rig.scope.view.zoom);
      for (const rect of rig.artboardRects) {
        rect.strokeWidth = (rect.data?.isActiveArtboard ? 1.5 : 1) / zoom;
      }
      for (const label of rig.artboardLabels) {
        label.fontSize = 11 / zoom;
        if (typeof label.data?.artboardY === 'number') {
          label.point = new rig.scope.Point(
            label.point.x,
            label.data.artboardY - 6 / zoom
          );
        }
      }
    }, []);

    const focusArtboard = useCallback(
      (artboardId: string) => {
        const rig = rigRef.current;
        if (!rig) return;

        const { scope } = rig;
        const vw = scope.view.viewSize.width;
        const vh = scope.view.viewSize.height;
        if (vw <= 0 || vh <= 0) return;

        const ab = getActiveArtboard(sceneRef.current, artboardId);
        const padding = 48;
        const availW = Math.max(40, vw - padding * 2);
        const availH = Math.max(40, vh - padding * 2);
        const zoom = clamp(
          Math.min(availW / ab.width, availH / ab.height),
          MIN_ZOOM,
          4
        );

        scope.view.zoom = zoom;
        scope.view.center = new scope.Point(
          ab.x + ab.width / 2,
          ab.y + ab.height / 2
        );
        updateArtboardBorderWidth(rig);
        redrawOverlayFromRefs(rig);
        scope.view.update();
        onZoomChangeRef.current(Math.round(zoom * 100));
        if (editingTextRef.current) {
          setViewTick((t) => t + 1);
        }
      },
      [redrawOverlayFromRefs, updateArtboardBorderWidth]
    );

    const fitArtboard = useCallback(() => {
      focusArtboard(activeArtboardIdRef.current);
    }, [focusArtboard]);

    const resetZoom100 = useCallback(() => {
      const rig = rigRef.current;
      if (!rig) return;

      const { scope } = rig;
      const ab = getActiveArtboard(sceneRef.current, activeArtboardIdRef.current);
      scope.view.zoom = 1;
      scope.view.center = new scope.Point(
        ab.x + ab.width / 2,
        ab.y + ab.height / 2
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
        focusArtboard,
        resetZoom100,
        zoomIn,
        zoomOut,
        finishActiveTool,
        startTextEditing,
      }),
      [
        finishActiveTool,
        fitArtboard,
        focusArtboard,
        resetZoom100,
        startTextEditing,
        zoomIn,
        zoomOut,
      ]
    );

    const drawArtboard = useCallback(
      (rig: PaperRig, targetScene: Scene, activeAbId: string) => {
        const { scope, artboardLayer, sceneLayer } = rig;
        scope.activate();
        artboardLayer.activate();
        artboardLayer.removeChildren();

        const zoom = Math.max(0.05, scope.view.zoom);
        const accentHex = useSettingsStore.getState().settings.accentColor || '#da7756';
        const artboards = getSceneArtboards(targetScene);
        const rects: paper.Path.Rectangle[] = [];
        const labels: paper.PointText[] = [];

        for (const ab of artboards) {
          const isActive = ab.id === activeAbId;
          const highlightActive = artboards.length > 1 && isActive;
          const rect = new scope.Path.Rectangle(
            new scope.Rectangle(ab.x, ab.y, ab.width, ab.height)
          );
          rect.applyMatrix = false;
          rect.fillColor = new scope.Color(ab.background || '#ffffff');
          rect.strokeColor = new scope.Color(highlightActive ? accentHex : '#c8c0b2');
          rect.strokeWidth = (highlightActive ? 1.5 : 1) / zoom;
          rect.data = { isActiveArtboard: highlightActive };
          rect.locked = true;
          rects.push(rect);

          if (artboards.length > 1) {
            const label = new scope.PointText({
              point: new scope.Point(ab.x, ab.y - 6 / zoom),
              content: `${ab.name} · ${ab.width}×${ab.height}`,
              fontFamily: 'Inter',
              fontWeight: isActive ? 'bold' : 'normal',
              fontSize: 11 / zoom,
              fillColor: new scope.Color(isActive ? accentHex : '#7b746a'),
              applyMatrix: false,
            });
            label.data = { artboardY: ab.y };
            label.locked = true;
            labels.push(label);
          }
        }

        rig.artboardRects = rects;
        rig.artboardLabels = labels;

        sceneLayer.activate();
        scope.view.update();
      },
      []
    );

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
        artboardRects: [],
        artboardLabels: [],
        itemMap: new Map(),
      };
      rigRef.current = rig;
      drawArtboard(rig, sceneRef.current, activeArtboardIdRef.current);
      rig.itemMap = syncSceneToPaper(scope, sceneLayer, sceneRef.current, {
        editingTextLayerId: editingTextRef.current?.layerId ?? null,
        outlineMode: outlineModeRef.current,
        editingGroupId: editingGroupIdRef.current,
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
      const resync = () => {
        const rig = rigRef.current;
        if (!rig) return;
        rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, sceneRef.current, {
          editingTextLayerId: editingTextRef.current?.layerId ?? null,
          outlineMode: outlineModeRef.current,
          editingGroupId: editingGroupIdRef.current,
        });
        redrawOverlayFromRefs(rig);
        rig.scope.view.update();
      };
      const unsubAssets = subscribeAssets(resync);
      const unsubFonts = subscribeFonts(resync);
      return () => {
        unsubAssets();
        unsubFonts();
      };
    }, [redrawOverlayFromRefs]);

    useEffect(() => {
      if (!editingText) return;
      const found = findLayerById(scene.layers, editingText.layerId);
      if (!found || found.type !== 'text' || found.locked) {
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
      drawArtboard(rig, scene, activeArtboardIdRef.current);
      rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, scene, {
        editingTextLayerId: editingText?.layerId ?? null,
        outlineMode,
        editingGroupId,
      });
      overlayExtrasRef.current.draftOverrides = undefined;
      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    }, [
      drawArtboard,
      editingGroupId,
      editingText?.layerId,
      outlineMode,
      redrawOverlayFromRefs,
      scene,
    ]);

    useEffect(() => {
      const rig = rigRef.current;
      if (!rig) return;
      drawArtboard(rig, sceneRef.current, activeArtboardId);
      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    }, [accentColor, activeArtboardId, drawArtboard, redrawOverlayFromRefs]);

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
        overlayExtrasRef.current.shapeBuilder = null;
        overlayExtrasRef.current.freehandDraft = null;
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
    }, [
      accentColor,
      activeGradientTarget,
      gridOpacity,
      gridSize,
      redrawOverlayFromRefs,
      showGrid,
      showGuides,
    ]);

    const rulerViewToProject = useCallback((vx: number, vy: number): Point2D | null => {
      const rig = rigRef.current;
      if (!rig) return null;
      const pt = rig.scope.view.viewToProject(new rig.scope.Point(vx, vy));
      return { x: pt.x, y: pt.y };
    }, []);

    const rulerProjectToView = useCallback((px: number, py: number): Point2D | null => {
      const rig = rigRef.current;
      if (!rig) return null;
      const pt = rig.scope.view.projectToView(new rig.scope.Point(px, py));
      return { x: pt.x, y: pt.y };
    }, []);

    const handlePreviewGuide = useCallback(
      (preview: { orientation: 'horizontal' | 'vertical'; position: number } | null) => {
        const rig = rigRef.current;
        if (!rig) return;
        redrawOverlayFromRefs(rig, { draggingGuide: preview });
        rig.scope.view.update();
      },
      [redrawOverlayFromRefs]
    );

    const handleCreateGuide = useCallback(
      (orientation: 'horizontal' | 'vertical', position: number) => {
        addGuide(orientation, position);
      },
      []
    );

    const cursorClass = isDraggingPan
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

    void viewTick;
    const foundEditing = editingText
      ? findLayerById(scene.layers, editingText.layerId)
      : null;
    const editingLayer = foundEditing?.type === 'text' ? foundEditing : null;

    let textEditorOverlay: React.ReactNode = null;
    if (editingText && editingLayer && rigRef.current) {
      const rig = rigRef.current;
      const zoom = Math.max(0.05, rig.scope.view.zoom);
      const worldM = getLayerWorldMatrix(scene.layers, editingLayer.id);
      const worldTransform = decomposeMatrix(worldM);
      const hostPath = resolveHostPathLayer(scene.layers, editingLayer.pathId);
      const pathBox = hostPath
        ? computeTextOnPathLocalBBox(editingLayer, hostPath, scene.layers)
        : null;
      const lines = (editingText.draft || '').split('\n');
      const worldWidth = measureTextDraftWorldWidth(
        editingLayer,
        editingText.draft
      );
      const boxWidthPx = Math.max(80, worldWidth * zoom);
      const lineStepPx = editingLayer.fontSize * editingLayer.lineHeight * zoom;
      const boxHeightPx = Math.max(lineStepPx, lines.length * lineStepPx + 4);
      const anchorWorld = pathBox
        ? applyMatrixToPoint(worldM, {
            x: pathBox.x + pathBox.width / 2,
            y: pathBox.y + pathBox.height / 2 - lineStepPx / (2 * zoom),
          })
        : { x: worldTransform.x, y: worldTransform.y };
      const viewPt = rig.scope.view.projectToView(
        new rig.scope.Point(anchorWorld.x, anchorWorld.y)
      );
      const offsetX =
        pathBox || editingLayer.align === 'center'
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
            color: getPrimaryColor(editingLayer.fill, '#1c1b1a'),
            transformOrigin: `${originX}px 0px`,
            transform: `rotate(${worldTransform.rotation}deg) scale(${worldTransform.scaleX}, ${worldTransform.scaleY})`,
            outline: '1px dashed var(--color-paper-accent)',
            outlineOffset: '2px',
          }}
          className="absolute z-20 m-0 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0"
        />
      );
    }

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
        ref={containerRef}
        data-tour="canvas.root"
        onPointerMove={(e) => {
          if (!showRulers || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const pt = rulerViewToProject(e.clientX - rect.left, e.clientY - rect.top);
          if (pt) setCursorProjectPos(pt);
        }}
        onPointerLeave={() => {
          if (cursorProjectPos) setCursorProjectPos(null);
        }}
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
        {showRulers && (
          <CanvasRulers
            viewToProject={rulerViewToProject}
            projectToView={rulerProjectToView}
            viewTick={viewTick}
            cursorProjectPos={cursorProjectPos}
            showGuides={showGuides}
            onToggleGuides={() => updateSettings({ showGuides: !showGuides })}
            onPreviewGuide={handlePreviewGuide}
            onCreateGuide={handleCreateGuide}
          />
        )}
        {textEditorOverlay}

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
