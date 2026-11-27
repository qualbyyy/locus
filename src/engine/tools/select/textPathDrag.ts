import { getLayerWorldMatrix } from '../../../core/layerTree';
import { applyMatrixToPoint, clamp, invertMatrix, type Matrix2D } from '../../../core/math';
import { useEditorStore } from '../../../core/store';
import type { Layer, PathLayer, Point2D, TextLayer } from '../../../core/types';
import { getTextPathHandleHit } from '../../hitTest';
import type { TextPathHandleId } from '../../overlay/shared';
import {
  computeTextOnPathCaretAndAnchors,
  projectPointToTextPathOffset,
  resolveHostPathLayer,
} from '../../textOnPath';
import type { ToolContext } from '../types';

export interface TextPathHandleDragState {
  layer: TextLayer;
  hostPath: PathLayer;
  handleKind: TextPathHandleId;
  invTextWorldM: Matrix2D;
  grabDelta: number;
  hasMoved: boolean;
}

export interface TextPathDragMode extends TextPathHandleDragState {
  kind: 'text-path-handle';
}

export function beginTextPathHandleDrag(
  sceneLayers: Layer[],
  targetLayer: TextLayer,
  handleKind: TextPathHandleId,
  point: Point2D
): TextPathHandleDragState | null {
  if (!targetLayer.pathId) return null;
  const hostPath = resolveHostPathLayer(sceneLayers, targetLayer.pathId);
  if (!hostPath) return null;

  const worldM = getLayerWorldMatrix(sceneLayers, targetLayer.id);
  const invTextWorldM = invertMatrix(worldM);
  const localPt = applyMatrixToPoint(invTextWorldM, point);
  let grabDelta = 0;

  if (handleKind === 'baseline') {
    const info = computeTextOnPathCaretAndAnchors(
      targetLayer,
      hostPath,
      sceneLayers
    );
    const proj = projectPointToTextPathOffset(
      targetLayer,
      hostPath,
      localPt,
      sceneLayers
    );
    if (info && proj) {
      grabDelta = proj.signedNormalDist - (targetLayer.pathBaselineOffset ?? 0);
    }
  }

  return {
    layer: targetLayer,
    hostPath,
    handleKind,
    invTextWorldM,
    grabDelta,
    hasMoved: false,
  };
}

export function computeTextPathHandlePatch(
  dragState: TextPathHandleDragState,
  point: Point2D,
  sceneLayers: Layer[]
): Partial<TextLayer> | null {
  const localPt = applyMatrixToPoint(dragState.invTextWorldM, point);
  const proj = projectPointToTextPathOffset(
    dragState.layer,
    dragState.hostPath,
    localPt,
    sceneLayers
  );
  if (!proj) return null;

  dragState.hasMoved = true;
  if (dragState.handleKind === 'offset') {
    return {
      pathOffset: proj.pathOffset,
      ...(proj.align !== dragState.layer.align ? { align: proj.align } : {}),
    };
  }
  const nextBaseline = clamp(
    Math.round(proj.signedNormalDist - dragState.grabDelta),
    -200,
    200
  );
  return { pathBaselineOffset: nextBaseline };
}

export function tryStartTextPathHandleDrag(
  ctx: ToolContext,
  sceneLayers: Layer[],
  targetLayer: Layer,
  point: Point2D
): TextPathDragMode | null {
  const textPathHit = getTextPathHandleHit(ctx, point);
  if (!textPathHit || targetLayer.type !== 'text') return null;
  const started = beginTextPathHandleDrag(
    sceneLayers,
    targetLayer,
    textPathHit,
    point
  );
  return started ? { kind: 'text-path-handle', ...started } : null;
}

export function tryStartCurvedTextBodyDrag(
  sceneLayers: Layer[],
  textTarget: TextLayer,
  point: Point2D
): TextPathDragMode | null {
  const started = beginTextPathHandleDrag(sceneLayers, textTarget, 'offset', point);
  return started ? { kind: 'text-path-handle', ...started } : null;
}

export function updateTextPathHandleDrag(
  drag: TextPathDragMode,
  point: Point2D
): Map<string, Partial<Layer>> | null {
  const patch = computeTextPathHandlePatch(
    drag,
    point,
    useEditorStore.getState().scene.layers
  );
  if (!patch) return null;
  return new Map<string, Partial<Layer>>([[drag.layer.id, patch]]);
}
