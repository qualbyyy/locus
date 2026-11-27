import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point2D, Scene, SelectedNodeRef, ToolType } from '../../core/types';
import { findTopLayerAtPoint } from '../hitTest';
import { syncSceneToPaper } from '../sync';
import { createBlobTool } from '../tools/blobTool';
import { createEyedropperTool } from '../tools/eyedropperTool';
import { createKnifeTool } from '../tools/knifeTool';
import { createNodeTool } from '../tools/nodeTool';
import { createPenTool } from '../tools/penTool';
import { createPencilTool } from '../tools/pencilTool';
import { createSelectTool } from '../tools/selectTool';
import { createShapeBuilderTool } from '../tools/shapeBuilderTool';
import { createTextTool } from '../tools/textTool';
import type {
  CanvasToolController,
  OverlayExtras,
  ToolContext,
  ToolPointerEvent,
} from '../tools/types';
import { isCanvasZoomWheel } from '../zoom';
import type { EditingTextState } from './InlineTextEditor';
import type { PaperRig } from './usePaperRig';

interface UseCanvasPointerRouterParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  rigRef: React.MutableRefObject<PaperRig | null>;
  overlayExtrasRef: React.MutableRefObject<OverlayExtras>;
  sceneRef: React.MutableRefObject<Scene>;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  activeTool: ToolType;
  activeToolRef: React.MutableRefObject<ToolType>;
  editingGroupIdRef: React.MutableRefObject<string | null>;
  outlineModeRef: React.MutableRefObject<boolean>;
  isSpacePanningRef: React.MutableRefObject<boolean>;
  onColorSampledRef: React.MutableRefObject<
    ((hex: string, target: 'fill' | 'stroke') => void) | undefined
  >;
  onOpenContextMenuRef: React.MutableRefObject<
    ((payload: { x: number; y: number; layerId: string | null }) => void) | undefined
  >;
  editingTextRef: React.MutableRefObject<EditingTextState | null>;
  commitTextEditing: () => void;
  startTextEditing: (layerId: string, selectAll?: boolean) => void;
  redrawOverlayFromRefs: (rig: PaperRig, extras?: OverlayExtras) => void;
  showRulers: boolean;
  rulerViewToProject: (vx: number, vy: number) => Point2D | null;
  zoomAtViewPoint: (clientX: number, clientY: number, deltaY: number) => void;
  panByViewDelta: (dx: number, dy: number) => void;
  onBeforeDestroyRef: React.MutableRefObject<((rig: PaperRig) => void) | null>;
}

export function useCanvasPointerRouter({
  containerRef,
  canvasRef,
  rigRef,
  overlayExtrasRef,
  sceneRef,
  selectedIds,
  selectedNode,
  activeTool,
  activeToolRef,
  editingGroupIdRef,
  outlineModeRef,
  isSpacePanningRef,
  onColorSampledRef,
  onOpenContextMenuRef,
  editingTextRef,
  commitTextEditing,
  startTextEditing,
  redrawOverlayFromRefs,
  showRulers,
  rulerViewToProject,
  zoomAtViewPoint,
  panByViewDelta,
  onBeforeDestroyRef,
}: UseCanvasPointerRouterParams) {
  const controllersRef = useRef<Partial<Record<ToolType, CanvasToolController>> | null>(
    null
  );
  const prevToolRef = useRef(activeTool);
  const isToolPointerDownRef = useRef(false);
  const cursorRafRef = useRef<number | null>(null);
  const pendingCursorPosRef = useRef<Point2D | null>(null);

  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [cursorProjectPos, setCursorProjectPos] = useState<Point2D | null>(null);

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

  onBeforeDestroyRef.current = (rig) => {
    isToolPointerDownRef.current = false;
    commitTextEditing();
    controllersRef.current?.[activeToolRef.current]?.cancel?.(buildToolContext(rig));
  };

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
  }, [activeToolRef, buildToolContext, commitTextEditing, editingTextRef, rigRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const rig = rigRef.current;
    if (!canvas || !rig) return;

    const toWorldPoint = (event: MouseEvent): Point2D => {
      const rect = canvas.getBoundingClientRect();
      const viewPoint = new rig.scope.Point(
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      const proj = rig.scope.view.viewToProject(viewPoint);
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
      zoomAtViewPoint(event.clientX, event.clientY, event.deltaY);
    };

    let panning = false;
    let lastX = 0;
    let lastY = 0;
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
      isToolPointerDownRef.current = true;
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
        panByViewDelta(dx, dy);
        return;
      }

      const controller = controllersRef.current?.[activeToolRef.current];
      if (!controller) return;

      const worldPt = toWorldPoint(event);
      if (isToolPointerDownRef.current) {
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

      if (!isToolPointerDownRef.current) return;
      isToolPointerDownRef.current = false;
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
      if (isToolPointerDownRef.current && rigRef.current) {
        isToolPointerDownRef.current = false;
        controllersRef.current?.[activeToolRef.current]?.cancel?.(
          buildToolContext(rigRef.current)
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
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      isToolPointerDownRef.current = false;
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    activeToolRef,
    buildToolContext,
    canvasRef,
    commitTextEditing,
    editingTextRef,
    isSpacePanningRef,
    onOpenContextMenuRef,
    panByViewDelta,
    rigRef,
    zoomAtViewPoint,
  ]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    const prevTool = prevToolRef.current;
    if (prevTool !== activeTool && controllersRef.current) {
      isToolPointerDownRef.current = false;
      commitTextEditing();
      const prevController = controllersRef.current[prevTool];
      const ctx = buildToolContext(rig);
      let finished = false;
      if (prevController?.finish) {
        finished = prevController.finish(ctx);
      } else {
        prevController?.cancel?.(ctx);
      }
      prevToolRef.current = activeTool;
      overlayExtrasRef.current.shapeBuilder = null;
      overlayExtrasRef.current.freehandDraft = null;
      if (!finished) {
        rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, sceneRef.current, {
          editingTextLayerId: editingTextRef.current?.layerId ?? null,
          outlineMode: outlineModeRef.current,
          editingGroupId: editingGroupIdRef.current,
        });
      }
    }

    redrawOverlayFromRefs(rig);
    rig.scope.view.update();
  }, [
    activeTool,
    buildToolContext,
    commitTextEditing,
    editingGroupIdRef,
    editingTextRef,
    outlineModeRef,
    overlayExtrasRef,
    redrawOverlayFromRefs,
    rigRef,
    sceneRef,
    selectedIds,
    selectedNode,
  ]);

  const handleContainerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!showRulers || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pt = rulerViewToProject(e.clientX - rect.left, e.clientY - rect.top);
      if (!pt) return;
      pendingCursorPosRef.current = pt;
      if (cursorRafRef.current === null) {
        cursorRafRef.current = requestAnimationFrame(() => {
          cursorRafRef.current = null;
          setCursorProjectPos(pendingCursorPosRef.current);
        });
      }
    },
    [containerRef, rulerViewToProject, showRulers]
  );

  const handleContainerPointerLeave = useCallback(() => {
    pendingCursorPosRef.current = null;
    if (cursorRafRef.current !== null) {
      cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = null;
    }
    setCursorProjectPos((prev) => (prev ? null : prev));
  }, []);

  return {
    isDraggingPan,
    cursorProjectPos,
    finishActiveTool,
    handleContainerPointerMove,
    handleContainerPointerLeave,
  };
}
