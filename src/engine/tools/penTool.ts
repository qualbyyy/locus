import { addLayer, createLayerId } from '../../core/commands';
import { flattenLayers, getScopeWorldMatrix } from '../../core/layerTree';
import {
  applyMatrixToPoint,
  applyMatrixToVector,
  centerSubPathsAtOrigin,
  invertMatrix,
  snapVector45,
} from '../../core/math';
import { clonePaint, cloneStroke } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type { AnchorPoint, PathLayer, Point2D, StrokeStyle } from '../../core/types';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

const DEFAULT_PEN_STROKE: StrokeStyle = {
  color: '#1c1b1a',
  width: 2,
  lineCap: 'round',
  lineJoin: 'round',
};

export function createPenTool(): CanvasToolController {
  let anchors: AnchorPoint[] = [];
  let hoverPoint: Point2D | null = null;
  let isDraggingHandle = false;
  let isClosingOnDrag = false;
  let isClosingHover = false;

  const syncOverlay = (ctx: ToolContext) => {
    ctx.redrawOverlay({
      penDraft:
        anchors.length > 0
          ? {
              anchors,
              hoverPoint,
              isClosingHover,
            }
          : null,
    });
    ctx.scope.view.update();
  };

  const reset = (ctx?: ToolContext) => {
    anchors = [];
    hoverPoint = null;
    isDraggingHandle = false;
    isClosingOnDrag = false;
    isClosingHover = false;
    if (ctx) {
      ctx.redrawOverlay({ penDraft: null });
      ctx.scope.view.update();
    }
  };

  const commitPath = (ctx: ToolContext, closed: boolean): boolean => {
    if (anchors.length < 2) {
      reset(ctx);
      return false;
    }

    const state = useEditorStore.getState();
    const invScope = invertMatrix(
      getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
    );
    const scopedAnchors = anchors.map((a) => {
      const pt = applyMatrixToPoint(invScope, { x: a.x, y: a.y });
      return {
        x: pt.x,
        y: pt.y,
        handleIn: applyMatrixToVector(invScope, a.handleIn),
        handleOut: applyMatrixToVector(invScope, a.handleOut),
        smooth: a.smooth,
      };
    });
    const { subpaths, offset } = centerSubPathsAtOrigin([
      { closed, anchors: scopedAnchors },
    ]);
    const pathCount =
      flattenLayers(state.scene.layers).filter((l) => l.type === 'path').length + 1;

    const stroke =
      cloneStroke(state.defaultStroke) ?? (closed ? null : { ...DEFAULT_PEN_STROKE });
    const fill = closed ? clonePaint(state.defaultFill) : null;

    const layer: PathLayer = {
      id: createLayerId('path'),
      name: `Контур ${pathCount}`,
      type: 'path',
      visible: true,
      locked: false,
      x: offset.x,
      y: offset.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      subpaths,
      fillRule: 'nonzero',
      fill,
      stroke,
    };

    reset(ctx);
    addLayer(layer, { parentGroupId: state.editingGroupId });
    return true;
  };

  const isNearFirstAnchor = (point: Point2D, ctx: ToolContext): boolean => {
    if (anchors.length < 2) return false;
    const tolerance = 8 / Math.max(0.05, ctx.scope.view.zoom);
    return Math.hypot(point.x - anchors[0].x, point.y - anchors[0].y) <= tolerance;
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      if (isNearFirstAnchor(event.point, ctx)) {
        isClosingOnDrag = true;
        isDraggingHandle = true;
        isClosingHover = true;
        syncOverlay(ctx);
        return;
      }

      let pt = event.point;
      if (event.shiftKey && anchors.length > 0) {
        const last = anchors[anchors.length - 1];
        const snapped = snapVector45({ x: pt.x - last.x, y: pt.y - last.y });
        pt = { x: last.x + snapped.x, y: last.y + snapped.y };
      }

      anchors = [
        ...anchors,
        {
          x: pt.x,
          y: pt.y,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
          smooth: false,
        },
      ];
      isDraggingHandle = true;
      isClosingOnDrag = false;
      hoverPoint = pt;
      syncOverlay(ctx);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDraggingHandle || anchors.length === 0) return;

      const target = isClosingOnDrag
        ? anchors[0]
        : anchors[anchors.length - 1];
      let vec: Point2D = {
        x: event.point.x - target.x,
        y: event.point.y - target.y,
      };
      if (event.shiftKey) {
        vec = snapVector45(vec);
      }

      const dragThreshold = 2 / Math.max(0.05, ctx.scope.view.zoom);
      if (Math.hypot(vec.x, vec.y) <= dragThreshold) {
        return;
      }

      target.handleOut = { x: vec.x, y: vec.y };
      target.handleIn = { x: -vec.x, y: -vec.y };
      target.smooth = true;
      hoverPoint = { x: target.x + vec.x, y: target.y + vec.y };
      syncOverlay(ctx);
    },

    onMouseMove(event: ToolPointerEvent, ctx: ToolContext) {
      if (anchors.length === 0) return;
      const closing = isNearFirstAnchor(event.point, ctx);
      isClosingHover = closing;

      let pt = event.point;
      if (!closing && event.shiftKey) {
        const last = anchors[anchors.length - 1];
        const snapped = snapVector45({ x: pt.x - last.x, y: pt.y - last.y });
        pt = { x: last.x + snapped.x, y: last.y + snapped.y };
      }
      hoverPoint = pt;
      syncOverlay(ctx);
    },

    onMouseUp(_event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDraggingHandle) return;
      isDraggingHandle = false;
      if (isClosingOnDrag) {
        commitPath(ctx, true);
      }
    },

    finish(ctx: ToolContext): boolean {
      if (anchors.length === 0) return false;
      if (anchors.length === 1) {
        reset(ctx);
        return true;
      }
      return commitPath(ctx, false);
    },

    cancel(ctx: ToolContext) {
      if (anchors.length >= 2) {
        commitPath(ctx, false);
        return;
      }
      reset(ctx);
    },
  };
}
