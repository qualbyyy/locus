import { getParentWorldMatrix } from '../core/layerTree';
import {
  applyMatrixToPoint,
  computeLayerBBoxWithMatrix,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import type { BBox, Layer } from '../core/types';
import { resolveEffectivePathGeometry } from './effects';
import { computeTextOnPathLocalBBox, resolveHostPathLayer } from './textOnPath';

export function resolveLayerLocalBBox(
  layer: Layer,
  sceneLayers: Layer[],
  opts?: { effectivePath?: boolean }
): BBox {
  if (opts?.effectivePath && layer.type === 'path') {
    return computeSubPathsBBox(resolveEffectivePathGeometry(layer).subpaths);
  }
  if (layer.type === 'text' && layer.pathId) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    if (hostPath) {
      return computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
    }
  }
  return computeLayerLocalBBox(layer);
}

export function resolveLayerWorldBBox(
  layer: Layer,
  parentM: Matrix2D,
  sceneLayers: Layer[]
): BBox {
  if (layer.type === 'text' && layer.pathId) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    if (hostPath) {
      const localBox = computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
      const worldM = multiplyMatrices(parentM, getLayerMatrix(layer));
      const corners = [
        applyMatrixToPoint(worldM, { x: localBox.x, y: localBox.y }),
        applyMatrixToPoint(worldM, { x: localBox.x + localBox.width, y: localBox.y }),
        applyMatrixToPoint(worldM, {
          x: localBox.x + localBox.width,
          y: localBox.y + localBox.height,
        }),
        applyMatrixToPoint(worldM, { x: localBox.x, y: localBox.y + localBox.height }),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      };
    }
  }
  return computeLayerBBoxWithMatrix(layer, parentM);
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function combineLayerWorldBBoxes(sceneLayers: Layer[], layers: Layer[]): BBox {
  if (layers.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    const parentM = getParentWorldMatrix(sceneLayers, layer.id);
    const b = resolveLayerWorldBBox(layer, parentM, sceneLayers);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return minX === Infinity
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
