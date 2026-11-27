import { addLayer, createLayerId } from '../../core/commands';
import { flattenLayers, getScopeWorldMatrix } from '../../core/layerTree';
import {
  applyMatrixToPoint,
  centerSubPathsAtOrigin,
  decomposeMatrix,
  invertMatrix,
} from '../../core/math';
import { clonePaint, cloneStroke } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type { PathLayer, Point2D, StrokeStyle } from '../../core/types';
import { fitFreehandSubPath } from '../freehand';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

const DEFAULT_PENCIL_STROKE: StrokeStyle = {
  color: '#1c1b1a',
  width: 2.5,
  lineCap: 'round',
  lineJoin: 'round',
};

export function createPencilTool(): CanvasToolController {
  let points: Point2D[] = [];
  let isDrawing = false;
  let closedHover = false;

  const isNearStart = (pt: Point2D, ctx: ToolContext): boolean => {
    if (points.length < 6) return false;
    const tol = 12 / Math.max(0.05, ctx.scope.view.zoom);
    return Math.hypot(pt.x - points[0].x, pt.y - points[0].y) <= tol;
  };

  const syncOverlay = (ctx: ToolContext) => {
    ctx.redrawOverlay({
      freehandDraft:
        isDrawing && points.length >= 2
          ? { points, closedHover, mode: 'pencil' }
          : null,
    });
    ctx.scope.view.update();
  };

  const reset = (ctx?: ToolContext) => {
    points = [];
    isDrawing = false;
    closedHover = false;
    if (ctx) {
      ctx.redrawOverlay({ freehandDraft: null });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      isDrawing = true;
      closedHover = false;
      points = [event.point];
      syncOverlay(ctx);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDrawing) return;
      const last = points[points.length - 1];
      const minStep = 2 / Math.max(0.05, ctx.scope.view.zoom);
      if (Math.hypot(event.point.x - last.x, event.point.y - last.y) >= minStep) {
        points = [...points, event.point];
      }
      closedHover = isNearStart(event.point, ctx);
      syncOverlay(ctx);
    },

    onMouseMove() {},

    onMouseUp(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDrawing) return;
      const closed = isNearStart(event.point, ctx) || closedHover;
      const rawPoints = [...points];
      reset(ctx);

      if (rawPoints.length < 2) return;

      const state = useEditorStore.getState();
      const invScope = invertMatrix(
        getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
      );
      const scopedPoints = rawPoints.map((p) => applyMatrixToPoint(invScope, p));
      const invDecomp = decomposeMatrix(invScope);
      const scopeScale = Math.max(0.05, (Math.abs(invDecomp.scaleX) + Math.abs(invDecomp.scaleY)) / 2);

      const fitted = fitFreehandSubPath(scopedPoints, {
        tolerance: state.pencilSmoothness * scopeScale,
        closed,
      });
      if (!fitted) return;

      const { subpaths, offset } = centerSubPathsAtOrigin([fitted]);
      const pathCount =
        flattenLayers(state.scene.layers).filter((l) => l.type === 'path').length + 1;

      const stroke =
        cloneStroke(state.defaultStroke) ?? (closed ? null : { ...DEFAULT_PENCIL_STROKE });
      const fill = closed ? clonePaint(state.defaultFill) : null;

      const layer: PathLayer = {
        id: createLayerId('path'),
        name: `Рисунок ${pathCount}`,
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

      addLayer(layer, { parentGroupId: state.editingGroupId });
    },

    finish(ctx: ToolContext): boolean {
      const had = isDrawing;
      reset(ctx);
      return had;
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
    },
  };
}
