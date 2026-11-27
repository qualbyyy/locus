import { getScopeWorldMatrix } from '../../../core/layerTree';
import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  degToRad,
  invertMatrix,
  localToWorld,
  localVectorToWorld,
  radToDeg,
  type Matrix2D,
} from '../../../core/math';
import type { BBox, Layer, Point2D, Scene } from '../../../core/types';
import { resolveLayerLocalBBox, resolveLayerWorldBBox } from '../../geometryBounds';
import type { SelectHandleId } from '../../overlay/shared';
import type { ToolPointerEvent } from '../types';

const MIN_SCALE = 0.02;

export interface RotateDragMode {
  kind: 'rotate';
  pivotScope: Point2D;
  startAngle: number;
  invScopeM: Matrix2D;
  initialLayers: Map<string, Layer>;
  hasMoved: boolean;
}

export interface ResizeSingleDragMode {
  kind: 'resize-single';
  handle: SelectHandleId;
  layer: Layer;
  localBox: BBox;
  anchorLocal: Point2D;
  anchorScope: Point2D;
  spanLocal: Point2D;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  invScopeM: Matrix2D;
  hasMoved: boolean;
}

export interface ResizeMultiDragMode {
  kind: 'resize-multi';
  handle: SelectHandleId;
  anchorScope: Point2D;
  spanScope: Point2D;
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  invScopeM: Matrix2D;
  initialLayers: Map<string, Layer>;
  hasMoved: boolean;
}

export type TransformDragMode =
  | RotateDragMode
  | ResizeSingleDragMode
  | ResizeMultiDragMode;

function getHandleDirection(handle: SelectHandleId): {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
} {
  const moveX: -1 | 0 | 1 =
    handle === 'nw' || handle === 'w' || handle === 'sw'
      ? -1
      : handle === 'ne' || handle === 'e' || handle === 'se'
        ? 1
        : 0;
  const moveY: -1 | 0 | 1 =
    handle === 'nw' || handle === 'n' || handle === 'ne'
      ? -1
      : handle === 'sw' || handle === 's' || handle === 'se'
        ? 1
        : 0;
  return { moveX, moveY };
}

function clampScaleKeepSign(value: number): number {
  if (Math.abs(value) >= MIN_SCALE) return value;
  return value < 0 ? -MIN_SCALE : MIN_SCALE;
}

export function startTransformDrag(
  hitHandle: SelectHandleId,
  point: Point2D,
  scene: Scene,
  editingGroupId: string | null,
  selectedLayers: Layer[],
  unlockedSelected: Layer[]
): TransformDragMode {
  const scopeM = getScopeWorldMatrix(scene.layers, editingGroupId);
  const invScopeM = invertMatrix(scopeM);
  const ptScope = applyMatrixToPoint(invScopeM, point);

  if (hitHandle === 'rotate') {
    const pivotScope =
      selectedLayers.length === 1
        ? (() => {
            const only = selectedLayers[0];
            if (only.type === 'text' && only.pathId) {
              const b = resolveLayerLocalBBox(only, scene.layers);
              return localToWorld(only, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
            }
            return { x: only.x, y: only.y };
          })()
        : (() => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const layer of selectedLayers) {
              // Групповая рамка и поворот считаются в локальных координатах текущего скоупа.
              const b = resolveLayerWorldBBox(layer, IDENTITY_MATRIX, scene.layers);
              minX = Math.min(minX, b.x);
              minY = Math.min(minY, b.y);
              maxX = Math.max(maxX, b.x + b.width);
              maxY = Math.max(maxY, b.y + b.height);
            }
            return {
              x: (minX + maxX) / 2,
              y: (minY + maxY) / 2,
            };
          })();
    const initialLayers = new Map(unlockedSelected.map((l) => [l.id, l]));
    return {
      kind: 'rotate',
      pivotScope,
      startAngle: Math.atan2(
        ptScope.y - pivotScope.y,
        ptScope.x - pivotScope.x
      ),
      invScopeM,
      initialLayers,
      hasMoved: false,
    };
  }

  const { moveX, moveY } = getHandleDirection(hitHandle);
  if (unlockedSelected.length === 1 && selectedLayers.length === 1) {
    const layer = unlockedSelected[0];
    const localBox = resolveLayerLocalBBox(layer, scene.layers);
    const x0 = localBox.x;
    const x1 = localBox.x + localBox.width;
    const y0 = localBox.y;
    const y1 = localBox.y + localBox.height;

    const anchorLocal: Point2D = {
      x: moveX === -1 ? x1 : moveX === 1 ? x0 : (x0 + x1) / 2,
      y: moveY === -1 ? y1 : moveY === 1 ? y0 : (y0 + y1) / 2,
    };
    const handleLocal: Point2D = {
      x: moveX === -1 ? x0 : moveX === 1 ? x1 : (x0 + x1) / 2,
      y: moveY === -1 ? y0 : moveY === 1 ? y1 : (y0 + y1) / 2,
    };

    return {
      kind: 'resize-single',
      handle: hitHandle,
      layer,
      localBox,
      anchorLocal,
      anchorScope: localToWorld(layer, anchorLocal),
      spanLocal: {
        x: handleLocal.x - anchorLocal.x,
        y: handleLocal.y - anchorLocal.y,
      },
      moveX,
      moveY,
      invScopeM,
      hasMoved: false,
    };
  }

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const layer of selectedLayers) {
    const b = resolveLayerWorldBBox(layer, IDENTITY_MATRIX, scene.layers);
    bx0 = Math.min(bx0, b.x);
    by0 = Math.min(by0, b.y);
    bx1 = Math.max(bx1, b.x + b.width);
    by1 = Math.max(by1, b.y + b.height);
  }

  const anchorScope: Point2D = {
    x: moveX === -1 ? bx1 : moveX === 1 ? bx0 : (bx0 + bx1) / 2,
    y: moveY === -1 ? by1 : moveY === 1 ? by0 : (by0 + by1) / 2,
  };
  const handleScope: Point2D = {
    x: moveX === -1 ? bx0 : moveX === 1 ? bx1 : (bx0 + bx1) / 2,
    y: moveY === -1 ? by0 : moveY === 1 ? by1 : (by0 + by1) / 2,
  };

  return {
    kind: 'resize-multi',
    handle: hitHandle,
    anchorScope,
    spanScope: {
      x: handleScope.x - anchorScope.x,
      y: handleScope.y - anchorScope.y,
    },
    moveX,
    moveY,
    invScopeM,
    initialLayers: new Map(unlockedSelected.map((l) => [l.id, l])),
    hasMoved: false,
  };
}

export function updateRotateDrag(
  drag: RotateDragMode,
  event: ToolPointerEvent
): Map<string, Partial<Layer>> {
  const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
  const curAngle = Math.atan2(
    ptScope.y - drag.pivotScope.y,
    ptScope.x - drag.pivotScope.x
  );
  let deltaDeg = radToDeg(curAngle - drag.startAngle);

  if (event.shiftKey) {
    if (drag.initialLayers.size === 1) {
      const only = Array.from(drag.initialLayers.values())[0];
      const snappedTotal = Math.round((only.rotation + deltaDeg) / 15) * 15;
      deltaDeg = snappedTotal - only.rotation;
    } else {
      deltaDeg = Math.round(deltaDeg / 15) * 15;
    }
  }

  if (Math.abs(deltaDeg) > 0.1) {
    drag.hasMoved = true;
  }

  const rad = degToRad(deltaDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const nextOverrides = new Map<string, Partial<Layer>>();

  for (const [id, initial] of drag.initialLayers.entries()) {
    if (
      initial.type === 'text' &&
      initial.pathId &&
      drag.initialLayers.has(initial.pathId)
    ) {
      continue;
    }
    const rx = initial.x - drag.pivotScope.x;
    const ry = initial.y - drag.pivotScope.y;
    nextOverrides.set(id, {
      x: drag.pivotScope.x + rx * cos - ry * sin,
      y: drag.pivotScope.y + rx * sin + ry * cos,
      rotation: initial.rotation + deltaDeg,
    });
  }
  return nextOverrides;
}

export function updateResizeSingleDrag(
  drag: ResizeSingleDragMode,
  event: ToolPointerEvent
): Map<string, Partial<Layer>> {
  const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
  const dx = ptScope.x - drag.anchorScope.x;
  const dy = ptScope.y - drag.anchorScope.y;
  const rad = degToRad(drag.layer.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotDx = dx * cos + dy * sin;
  const rotDy = -dx * sin + dy * cos;

  let nextScaleX =
    drag.moveX !== 0 && Math.abs(drag.spanLocal.x) > 1e-6
      ? rotDx / drag.spanLocal.x
      : drag.layer.scaleX;
  let nextScaleY =
    drag.moveY !== 0 && Math.abs(drag.spanLocal.y) > 1e-6
      ? rotDy / drag.spanLocal.y
      : drag.layer.scaleY;

  nextScaleX = clampScaleKeepSign(nextScaleX);
  nextScaleY = clampScaleKeepSign(nextScaleY);

  if (event.shiftKey) {
    const safeLayerSx =
      Math.abs(drag.layer.scaleX) > 1e-4
        ? drag.layer.scaleX
        : drag.layer.scaleX < 0
          ? -1e-4
          : 1e-4;
    const safeLayerSy =
      Math.abs(drag.layer.scaleY) > 1e-4
        ? drag.layer.scaleY
        : drag.layer.scaleY < 0
          ? -1e-4
          : 1e-4;
    const kx = nextScaleX / safeLayerSx;
    const ky = nextScaleY / safeLayerSy;
    let factor = 1;
    if (drag.moveX !== 0 && drag.moveY !== 0) {
      factor = Math.abs(kx) >= Math.abs(ky) ? kx : ky;
    } else if (drag.moveX !== 0) {
      factor = kx;
    } else if (drag.moveY !== 0) {
      factor = ky;
    }
    nextScaleX = clampScaleKeepSign(safeLayerSx * factor);
    nextScaleY = clampScaleKeepSign(safeLayerSy * factor);
  }

  const anchorOffset = localVectorToWorld(
    {
      rotation: drag.layer.rotation,
      scaleX: nextScaleX,
      scaleY: nextScaleY,
    },
    drag.anchorLocal
  );

  drag.hasMoved = true;
  return new Map<string, Partial<Layer>>([
    [
      drag.layer.id,
      {
        scaleX: nextScaleX,
        scaleY: nextScaleY,
        x: drag.anchorScope.x - anchorOffset.x,
        y: drag.anchorScope.y - anchorOffset.y,
      },
    ],
  ]);
}

export function updateResizeMultiDrag(
  drag: ResizeMultiDragMode,
  event: ToolPointerEvent
): Map<string, Partial<Layer>> {
  const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
  let kx =
    drag.moveX !== 0 && Math.abs(drag.spanScope.x) > 1e-6
      ? (ptScope.x - drag.anchorScope.x) / drag.spanScope.x
      : 1;
  let ky =
    drag.moveY !== 0 && Math.abs(drag.spanScope.y) > 1e-6
      ? (ptScope.y - drag.anchorScope.y) / drag.spanScope.y
      : 1;

  if (Math.abs(kx) < MIN_SCALE) kx = kx < 0 ? -MIN_SCALE : MIN_SCALE;
  if (Math.abs(ky) < MIN_SCALE) ky = ky < 0 ? -MIN_SCALE : MIN_SCALE;

  if (event.shiftKey) {
    const factor =
      drag.moveX !== 0 && drag.moveY !== 0
        ? Math.abs(kx) >= Math.abs(ky)
          ? kx
          : ky
        : drag.moveX !== 0
          ? kx
          : ky;
    kx = factor;
    ky = factor;
  }

  drag.hasMoved = true;
  const nextOverrides = new Map<string, Partial<Layer>>();
  for (const [id, initial] of drag.initialLayers.entries()) {
    if (
      initial.type === 'text' &&
      initial.pathId &&
      drag.initialLayers.has(initial.pathId)
    ) {
      continue;
    }
    nextOverrides.set(id, {
      x: drag.anchorScope.x + (initial.x - drag.anchorScope.x) * kx,
      y: drag.anchorScope.y + (initial.y - drag.anchorScope.y) * ky,
      scaleX: clampScaleKeepSign(initial.scaleX * kx),
      scaleY: clampScaleKeepSign(initial.scaleY * ky),
    });
  }
  return nextOverrides;
}
