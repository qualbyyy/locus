import { createTextLayer } from '../../core/commands';
import { useEditorStore } from '../../core/store';
import { findTopLayerAtPoint } from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

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

      const created = createTextLayer({
        x: Math.round(event.point.x),
        y: Math.round(event.point.y),
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
