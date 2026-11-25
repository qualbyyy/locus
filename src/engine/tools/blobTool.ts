import { createShapeLayer } from '../../core/commands';
import { getScopeWorldMatrix } from '../../core/layerTree';
import {
  applyMatrixToPoint,
  decomposeMatrix,
  invertMatrix,
} from '../../core/math';
import { clonePaint, cloneStroke } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import { generateSmartShape } from '../geometry';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

interface ShapeBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

function computeDragBox(event: ToolPointerEvent): ShapeBox {
  let dx = event.point.x - event.startPoint.x;
  let dy = event.point.y - event.startPoint.y;

  if (event.shiftKey) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx >= 0 ? 1 : -1) * size;
    dy = (dy >= 0 ? 1 : -1) * size;
  }

  if (event.altKey) {
    return {
      cx: event.startPoint.x,
      cy: event.startPoint.y,
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    };
  }

  return {
    cx: event.startPoint.x + dx / 2,
    cy: event.startPoint.y + dy / 2,
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

export function createBlobTool(): CanvasToolController {
  let isDragging = false;
  let seed = 1;
  let lastBox: ShapeBox | null = null;

  const reset = (ctx?: ToolContext) => {
    isDragging = false;
    lastBox = null;
    if (ctx) {
      ctx.redrawOverlay({ shapeDraft: null });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown() {
      isDragging = true;
      seed = Math.floor(Math.random() * 0xffffffff);
      lastBox = null;
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDragging) return;
      const box = computeDragBox(event);
      lastBox = box;

      if (box.width < 2 || box.height < 2) {
        ctx.redrawOverlay({ shapeDraft: null });
        ctx.scope.view.update();
        return;
      }

      const state = useEditorStore.getState();
      const subpaths = generateSmartShape(
        box.width,
        box.height,
        state.smartShapeOptions,
        seed
      );
      ctx.redrawOverlay({
        shapeDraft: {
          x: box.cx,
          y: box.cy,
          subpaths,
          fill: clonePaint(state.defaultFill),
          stroke: cloneStroke(state.defaultStroke),
        },
      });
      ctx.scope.view.update();
    },

    onMouseMove() {},

    onMouseUp(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDragging) return;
      const box = lastBox;
      const currentSeed = seed;
      reset(ctx);

      const finalBox: ShapeBox =
        box && box.width >= 2 && box.height >= 2
          ? box
          : { cx: event.point.x, cy: event.point.y, width: 120, height: 120 };

      const state = useEditorStore.getState();
      const invScope = invertMatrix(
        getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
      );
      const centerScope = applyMatrixToPoint(invScope, {
        x: finalBox.cx,
        y: finalBox.cy,
      });
      const invDecomp = decomposeMatrix(invScope);
      createShapeLayer({
        x: centerScope.x,
        y: centerScope.y,
        width: finalBox.width * Math.abs(invDecomp.scaleX),
        height: finalBox.height * Math.abs(invDecomp.scaleY),
        options: state.smartShapeOptions,
        seed: currentSeed,
        parentGroupId: state.editingGroupId,
      });
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
    },
  };
}
