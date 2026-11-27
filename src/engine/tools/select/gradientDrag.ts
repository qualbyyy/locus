import { getLayerWorldMatrix } from '../../../core/layerTree';
import {
  applyMatrixToPoint,
  clamp,
  invertMatrix,
  snapVector45,
  type Matrix2D,
} from '../../../core/math';
import {
  clonePaint,
  isGradientPaint,
  localPointToNormalized,
  normalizeGradientStops,
  resolveGradientEndpoints,
} from '../../../core/paint';
import type { BBox, GradientPaint, Layer, Point2D } from '../../../core/types';
import { resolveLayerLocalBBox } from '../../geometryBounds';
import { getGradientHandleHit } from '../../hitTest';
import { resolveEditableGradient } from '../../overlay/gradientOverlay';
import type { ToolContext, ToolPointerEvent } from '../types';

export interface GradientHandleDragMode {
  kind: 'gradient-handle';
  layer: Layer;
  invWorldM: Matrix2D;
  target: 'fill' | 'stroke';
  handleKind: 'start' | 'end' | 'stop';
  stopIndex?: number;
  initialGradient: GradientPaint;
  localBox: BBox;
  hasMoved: boolean;
}

export function tryStartGradientHandleDrag(
  ctx: ToolContext,
  sceneLayers: Layer[],
  targetLayer: Layer,
  point: Point2D
): GradientHandleDragMode | null {
  const gradHit = getGradientHandleHit(ctx, point);
  if (!gradHit) return null;
  const resolved = resolveEditableGradient(targetLayer, gradHit.target);
  if (!resolved || resolved.target !== gradHit.target) return null;

  const localBox = resolveLayerLocalBBox(targetLayer, sceneLayers, {
    effectivePath: true,
  });
  const worldM = getLayerWorldMatrix(sceneLayers, targetLayer.id);
  return {
    kind: 'gradient-handle',
    layer: targetLayer,
    invWorldM: invertMatrix(worldM),
    target: gradHit.target,
    handleKind: gradHit.kind,
    stopIndex: gradHit.stopIndex,
    initialGradient: clonePaint(resolved.gradient),
    localBox,
    hasMoved: false,
  };
}

export function updateGradientHandleDrag(
  drag: GradientHandleDragMode,
  event: ToolPointerEvent
): Map<string, Partial<Layer>> {
  const localPt = applyMatrixToPoint(drag.invWorldM, event.point);
  const nextGrad = clonePaint(drag.initialGradient);
  const { origin, destination } = resolveGradientEndpoints(
    drag.initialGradient,
    drag.localBox
  );

  if (drag.handleKind === 'start' || drag.handleKind === 'end') {
    let targetLocal = localPt;
    if (event.shiftKey) {
      const anchorLocal = drag.handleKind === 'start' ? destination : origin;
      const snapped = snapVector45({
        x: localPt.x - anchorLocal.x,
        y: localPt.y - anchorLocal.y,
      });
      targetLocal = {
        x: anchorLocal.x + snapped.x,
        y: anchorLocal.y + snapped.y,
      };
    }
    const norm = localPointToNormalized(targetLocal, drag.localBox);
    if (drag.handleKind === 'start') {
      nextGrad.start = norm;
    } else {
      nextGrad.end = norm;
    }
  } else if (drag.stopIndex !== undefined) {
    const vx = destination.x - origin.x;
    const vy = destination.y - origin.y;
    const lenSq = vx * vx + vy * vy;
    const rawT =
      lenSq > 1e-6
        ? ((localPt.x - origin.x) * vx + (localPt.y - origin.y) * vy) / lenSq
        : 0.5;
    const stop = nextGrad.stops[drag.stopIndex];
    if (stop) {
      stop.offset = clamp(rawT, 0, 1);
    }
  }

  drag.hasMoved = true;
  const nextOverrides = new Map<string, Partial<Layer>>();
  if (
    drag.target === 'stroke' &&
    (drag.layer.type === 'path' || drag.layer.type === 'text') &&
    drag.layer.stroke
  ) {
    nextOverrides.set(drag.layer.id, {
      stroke: {
        ...drag.layer.stroke,
        color: nextGrad,
      },
    });
  } else {
    nextOverrides.set(drag.layer.id, {
      fill: nextGrad,
    });
  }
  return nextOverrides;
}

export function normalizeCommittedGradientStops(
  layer: Layer,
  sortStopsTarget: 'fill' | 'stroke' | null
): Layer {
  if (sortStopsTarget === 'fill' && 'fill' in layer && isGradientPaint(layer.fill)) {
    return {
      ...layer,
      fill: {
        ...layer.fill,
        stops: normalizeGradientStops(layer.fill.stops),
      },
    } as Layer;
  }
  if (
    sortStopsTarget === 'stroke' &&
    (layer.type === 'path' || layer.type === 'text') &&
    layer.stroke &&
    isGradientPaint(layer.stroke.color)
  ) {
    return {
      ...layer,
      stroke: {
        ...layer.stroke,
        color: {
          ...layer.stroke.color,
          stops: normalizeGradientStops(layer.stroke.color.stops),
        },
      },
    };
  }
  return layer;
}
