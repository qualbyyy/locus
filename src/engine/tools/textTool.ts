import { createTextLayer } from '../../core/commands';
import { getScopeLayers, getScopeWorldMatrix } from '../../core/layerTree';
import { applyMatrixToPoint, invertMatrix } from '../../core/math';
import { useEditorStore } from '../../core/store';
import { findTopLayerAtPoint } from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

function findHitPathLayerOnCurve(
  ctx: ToolContext,
  point: { x: number; y: number }
): string | null {
  const tolerance = 6 / Math.max(0.05, ctx.scope.view.zoom);
  const hit = ctx.sceneLayer.hitTest(new ctx.scope.Point(point.x, point.y), {
    curves: true,
    stroke: true,
    fill: false,
    tolerance,
  });
  if (!hit) return null;

  let cur: paper.Item | null | undefined = hit.item;
  let layerId: string | null = null;
  while (cur && cur !== ctx.sceneLayer) {
    if (typeof cur.data?.layerId === 'string') {
      layerId = cur.data.layerId;
      break;
    }
    cur = cur.parent;
  }
  if (!layerId) return null;

  const state = useEditorStore.getState();
  const scopeLayers = getScopeLayers(state.scene.layers, state.editingGroupId);
  const found = scopeLayers.find(
    (l) => l.id === layerId && l.type === 'path' && l.visible && !l.locked
  );
  return found ? found.id : null;
}

export function createTextTool(): CanvasToolController {
  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const hitText = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text'
      );

      if (hitText && hitText.type === 'text') {
        useEditorStore.getState().setSelectedIds([hitText.id]);
        ctx.startTextEditing(hitText.id, false);
        return;
      }

      const state = useEditorStore.getState();
      const hitPathId = findHitPathLayerOnCurve(ctx, event.point);
      if (hitPathId) {
        const created = createTextLayer({
          x: 0,
          y: 0,
          pathId: hitPathId,
          parentGroupId: state.editingGroupId,
        });
        ctx.startTextEditing(created.id, true);
        return;
      }

      const invScope = invertMatrix(
        getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
      );
      const localPt = applyMatrixToPoint(invScope, event.point);

      const created = createTextLayer({
        x: Math.round(localPt.x),
        y: Math.round(localPt.y),
        parentGroupId: state.editingGroupId,
      });
      ctx.startTextEditing(created.id, true);
    },

    onMouseDrag() {},
    onMouseMove() {},
    onMouseUp() {},

    onDoubleClick(event: ToolPointerEvent, ctx: ToolContext) {
      const hitText = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text'
      );
      if (hitText && hitText.type === 'text') {
        useEditorStore.getState().setSelectedIds([hitText.id]);
        ctx.startTextEditing(hitText.id, true);
      }
    },
  };
}
