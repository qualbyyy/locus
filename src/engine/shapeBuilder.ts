import { computeSubPathsBBox } from '../core/math';
import type { BBox, PathLayer, Point2D } from '../core/types';
import {
  buildWorldPathItem,
  computeDivideOperation,
  computeSplitCompoundPath,
  extractSubPathsFromItem,
  normalizeResult,
  uniteBooleanResults,
  type BooleanResult,
} from './booleans';
import { withHeadlessProject } from './booleans';

export interface ShapeBuilderRegion extends BooleanResult {
  id: string;
  sourceIndex: number;
  bbox: BBox;
}

function toRegion(
  piece: BooleanResult & { sourceIndex: number },
  index: number
): ShapeBuilderRegion {
  const localBox = computeSubPathsBBox(piece.subpaths);
  return {
    id: `sb_${index}`,
    x: piece.x,
    y: piece.y,
    subpaths: piece.subpaths,
    fillRule: piece.fillRule,
    sourceIndex: piece.sourceIndex,
    bbox: {
      x: localBox.x + piece.x,
      y: localBox.y + piece.y,
      width: localBox.width,
      height: localBox.height,
    },
  };
}

export function computeShapeBuilderRegions(layers: PathLayer[]): ShapeBuilderRegion[] {
  if (layers.length === 0) return [];

  if (layers.length >= 2) {
    return computeDivideOperation(layers).map((piece, idx) => toRegion(piece, idx));
  }

  const single = layers[0];
  if (single.subpaths.length > 1) {
    const parts = computeSplitCompoundPath(single);
    if (parts.length > 0) {
      return parts.map((part, idx) => toRegion({ ...part, sourceIndex: 0 }, idx));
    }
  }

  const norm = withHeadlessProject((scope) => {
    const item = buildWorldPathItem(scope, single, true);
    if (!item) return null;
    return normalizeResult(extractSubPathsFromItem(scope, item), single.fillRule);
  });
  return norm ? [toRegion({ ...norm, sourceIndex: 0 }, 0)] : [];
}

function buildLocalHitItem(
  scope: paper.PaperScope,
  region: ShapeBuilderRegion
): paper.PathItem | null {
  const paths: paper.Path[] = [];
  for (const sp of region.subpaths) {
    if (sp.anchors.length < 2) continue;
    const segments = sp.anchors.map(
      (a) =>
        new scope.Segment(
          new scope.Point(a.x, a.y),
          new scope.Point(a.handleIn.x, a.handleIn.y),
          new scope.Point(a.handleOut.x, a.handleOut.y)
        )
    );
    paths.push(
      new scope.Path({
        segments,
        closed: sp.closed,
        applyMatrix: false,
        insert: false,
      })
    );
  }
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    paths[0].fillRule = region.fillRule;
    return paths[0];
  }
  return new scope.CompoundPath({
    children: paths,
    fillRule: region.fillRule,
    applyMatrix: false,
    insert: false,
  });
}

export function hitTestShapeBuilderRegions(
  scope: paper.PaperScope,
  regions: ShapeBuilderRegion[],
  scopePoint: Point2D
): string | null {
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const region = regions[i];
    const b = region.bbox;
    if (
      scopePoint.x < b.x ||
      scopePoint.x > b.x + b.width ||
      scopePoint.y < b.y ||
      scopePoint.y > b.y + b.height
    ) {
      continue;
    }
    const item = buildLocalHitItem(scope, region);
    if (!item) continue;
    const localPt = new scope.Point(scopePoint.x - region.x, scopePoint.y - region.y);
    const hit = item.contains(localPt);
    item.remove();
    if (hit) return region.id;
  }
  return null;
}

export function applyShapeBuilderRegions(
  regions: ShapeBuilderRegion[],
  targetRegionIds: string[],
  mode: 'merge' | 'erase'
): Array<BooleanResult & { sourceIndex: number }> {
  if (targetRegionIds.length === 0) return regions;
  const targetSet = new Set(targetRegionIds);

  if (mode === 'erase') {
    return regions.filter((r) => !targetSet.has(r.id));
  }

  const selected = regions.filter((r) => targetSet.has(r.id));
  const untouched = regions.filter((r) => !targetSet.has(r.id));
  if (selected.length === 0) return regions;
  if (selected.length === 1) return [...untouched, selected[0]];

  const merged = uniteBooleanResults(selected);
  if (!merged) return regions;

  const firstId = targetRegionIds[0];
  const sourceIndex =
    regions.find((r) => r.id === firstId)?.sourceIndex ?? selected[0].sourceIndex;

  return [...untouched, { ...merged, sourceIndex }];
}
