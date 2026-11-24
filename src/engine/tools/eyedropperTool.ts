import { updateLayers } from '../../core/commands';
import { useEditorStore } from '../../core/store';
import type { PathLayer, Point2D, StrokeStyle } from '../../core/types';
import { findTopLayerAtPoint } from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

function toHexByte(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function sampleCanvasPixelHex(ctx: ToolContext, point: Point2D): string | null {
  const canvas = ctx.scope.view.element as HTMLCanvasElement | null | undefined;
  if (!canvas) return null;

  try {
    const viewPt = ctx.scope.view.projectToView(new ctx.scope.Point(point.x, point.y));
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const px = Math.round(viewPt.x * scaleX);
    const py = Math.round(viewPt.y * scaleY);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
      return null;
    }
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return null;
    const data = ctx2d.getImageData(px, py, 1, 1).data;
    if (data[3] === 0) return null;
    return rgbToHex(data[0], data[1], data[2]);
  } catch {
    return null;
  }
}

export function createEyedropperTool(opts?: {
  onSampled?: (hex: string, target: 'fill' | 'stroke') => void;
}): CanvasToolController {
  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      const hitLayer = findTopLayerAtPoint(ctx, event.point, undefined, {
        includeLocked: true,
      });

      let sampled: string | null = null;
      if (hitLayer) {
        if (hitLayer.type === 'path') {
          sampled = event.altKey
            ? hitLayer.stroke?.color ?? hitLayer.fill
            : hitLayer.fill ?? hitLayer.stroke?.color ?? null;
        } else if (hitLayer.type === 'text') {
          sampled = hitLayer.fill;
        }
      }

      if (!sampled) {
        sampled = sampleCanvasPixelHex(ctx, event.point);
      }

      if (
        !sampled &&
        event.point.x >= 0 &&
        event.point.x <= state.scene.width &&
        event.point.y >= 0 &&
        event.point.y <= state.scene.height
      ) {
        sampled = state.scene.background || '#ffffff';
      }

      if (!sampled) return;

      const selectedSet = new Set(state.selectedIds);
      const unlockedSelected = state.scene.layers.filter(
        (l) => selectedSet.has(l.id) && !l.locked
      );
      const targetMode: 'fill' | 'stroke' = event.altKey ? 'stroke' : 'fill';

      if (targetMode === 'stroke') {
        const pathTargets = unlockedSelected.filter(
          (l): l is PathLayer => l.type === 'path'
        );
        if (pathTargets.length > 0) {
          const ids = pathTargets.map((l) => l.id);
          updateLayers(ids, (layer) => {
            if (layer.type !== 'path') return layer;
            const nextStroke: StrokeStyle = layer.stroke
              ? { ...layer.stroke, color: sampled! }
              : {
                  color: sampled!,
                  width: 2,
                  lineCap: 'round',
                  lineJoin: 'round',
                };
            return { ...layer, stroke: nextStroke };
          });
        }
        const prevStroke = state.defaultStroke;
        state.setDefaultStroke(
          prevStroke
            ? { ...prevStroke, color: sampled }
            : { color: sampled, width: 2, lineCap: 'round', lineJoin: 'round' }
        );
      } else {
        const colorableIds = unlockedSelected
          .filter((l) => l.type === 'path' || l.type === 'text')
          .map((l) => l.id);
        if (colorableIds.length > 0) {
          updateLayers(colorableIds, { fill: sampled });
        } else {
          state.setDefaultFill(sampled);
        }
      }

      opts?.onSampled?.(sampled, targetMode);
    },

    onMouseDrag() {},
    onMouseMove() {},
    onMouseUp() {},
  };
}
