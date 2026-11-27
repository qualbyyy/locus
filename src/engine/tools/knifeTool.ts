import { cutPathAtPoint, slicePathLayers } from '../../core/commands';
import { getScopeLayers, getScopeWorldMatrix } from '../../core/layerTree';
import { applyMatrixToPoint, decomposeMatrix, invertMatrix } from '../../core/math';
import { useEditorStore } from '../../core/store';
import type { PathLayer, Point2D } from '../../core/types';
import { findTopLayerAtPoint } from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

export function createKnifeTool(): CanvasToolController {
  let points: Point2D[] = [];
  let isCutting = false;

  const syncOverlay = (ctx: ToolContext) => {
    ctx.redrawOverlay({
      freehandDraft:
        isCutting && points.length >= 2
          ? { points, mode: 'knife' }
          : null,
    });
    ctx.scope.view.update();
  };

  const reset = (ctx?: ToolContext) => {
    points = [];
    isCutting = false;
    if (ctx) {
      ctx.redrawOverlay({ freehandDraft: null });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      isCutting = true;
      points = [event.point];
      syncOverlay(ctx);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isCutting) return;
      if (useEditorStore.getState().knifeToolMode === 'scissors') return;
      if (event.shiftKey) {
        points = [event.startPoint, event.point];
      } else {
        const last = points[points.length - 1];
        const minStep = 2 / Math.max(0.05, ctx.scope.view.zoom);
        if (Math.hypot(event.point.x - last.x, event.point.y - last.y) >= minStep) {
          points = [...points, event.point];
        }
      }
      syncOverlay(ctx);
    },

    onMouseMove() {},

    onMouseUp(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isCutting) return;
      const rawPoints = [...points];
      reset(ctx);

      const zoom = Math.max(0.05, ctx.scope.view.zoom);
      let dragLength = 0;
      for (let i = 1; i < rawPoints.length; i += 1) {
        dragLength += Math.hypot(
          rawPoints[i].x - rawPoints[i - 1].x,
          rawPoints[i].y - rawPoints[i - 1].y
        );
      }

      const state = useEditorStore.getState();
      const isScissorsMode = state.knifeToolMode === 'scissors';
      const scopeLayers = getScopeLayers(state.scene.layers, state.editingGroupId);
      const invScope = invertMatrix(
        getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
      );

      if (isScissorsMode || dragLength < 4 / zoom) {
        // Scissors click: cut or open nearest contour at point
        const scopePt = applyMatrixToPoint(invScope, event.point);
        const invDecomp = decomposeMatrix(invScope);
        const scopeScale = Math.max(0.05, (Math.abs(invDecomp.scaleX) + Math.abs(invDecomp.scaleY)) / 2);
        const tol = ((isScissorsMode ? 14 : 10) / zoom) * scopeScale;
        const hitLayer = findTopLayerAtPoint(
          ctx,
          event.point,
          (l) => l.type === 'path'
        );
        if (hitLayer && hitLayer.type === 'path') {
          if (cutPathAtPoint(hitLayer.id, scopePt, tol).length > 0) {
            return;
          }
          // Clicking deep inside a filled top shape should not punch through to shapes behind it.
          if (hitLayer.fill !== null) {
            return;
          }
        }
        const scopePaths = scopeLayers.filter(
          (l): l is PathLayer => l.type === 'path' && l.visible && !l.locked
        );
        for (let i = scopePaths.length - 1; i >= 0; i -= 1) {
          if (cutPathAtPoint(scopePaths[i].id, scopePt, tol).length > 0) {
            return;
          }
        }
        return;
      }

      const cutScopePoints = rawPoints.map((p) => applyMatrixToPoint(invScope, p));
      const scopePaths = scopeLayers.filter(
        (l): l is PathLayer => l.type === 'path' && l.visible && !l.locked
      );
      if (scopePaths.length === 0) return;

      const selectedSet = new Set(state.selectedIds);
      const selectedScopePaths = scopePaths.filter((l) => selectedSet.has(l.id));
      const targets = selectedScopePaths.length > 0 ? selectedScopePaths : scopePaths;
      slicePathLayers(
        targets.map((l) => l.id),
        cutScopePoints
      );
    },

    finish(ctx: ToolContext): boolean {
      const had = isCutting;
      reset(ctx);
      return had;
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
    },
  };
}
