import type { PathLayer, Point2D, SubPath } from '../core/types';
import {
  buildWorldPathItem,
  buildWorldSubPath,
  extractSubPath,
  extractSubPathsFromItem,
  normalizeResult,
  toPieceItems,
  withHeadlessProject,
  type BooleanResult,
} from './booleans';

export function computeScissorsCut(
  layer: PathLayer,
  scopePoint: Point2D,
  tolerance: number
): BooleanResult[] | null {
  return withHeadlessProject((scope) => {
    const built: Array<{ index: number; path: paper.Path; wasClosed: boolean }> = [];
    layer.subpaths.forEach((sp, index) => {
      const path = buildWorldSubPath(scope, layer, sp, false);
      if (path) {
        built.push({ index, path, wasClosed: sp.closed });
      }
    });
    if (built.length === 0) return null;

    const pt = new scope.Point(scopePoint.x, scopePoint.y);
    let best: {
      item: (typeof built)[number];
      loc: paper.CurveLocation;
      dist: number;
    } | null = null;

    for (const item of built) {
      const loc = item.path.getNearestLocation(pt);
      if (!loc) continue;
      if (loc.distance <= tolerance && (!best || loc.distance < best.dist)) {
        best = { item, loc, dist: loc.distance };
      }
    }

    if (!best) return null;

    const { item, loc } = best;
    const len = item.path.length;
    if (len <= 1e-4) return null;

    if (item.wasClosed) {
      item.path.splitAt(loc);
      const nextWorldSubpaths = built
        .map((b) => extractSubPath(b.path))
        .filter((sp): sp is SubPath => sp !== null);
      const norm = normalizeResult(nextWorldSubpaths, layer.fillRule);
      return norm ? [norm] : null;
    }

    if (loc.offset <= 1e-3 || loc.offset >= len - 1e-3) {
      return null;
    }

    const second = item.path.splitAt(loc);
    if (!second || second === item.path) {
      return null;
    }

    if (built.length === 1) {
      const spA = extractSubPath(item.path);
      const spB = extractSubPath(second);
      const results: BooleanResult[] = [];
      if (spA) {
        const nA = normalizeResult([spA], 'nonzero');
        if (nA) results.push(nA);
      }
      if (spB) {
        const nB = normalizeResult([spB], 'nonzero');
        if (nB) results.push(nB);
      }
      return results.length >= 2 ? results : null;
    }

    const combined: SubPath[] = [];
    for (const b of built) {
      const sp1 = extractSubPath(b.path);
      if (sp1) combined.push(sp1);
      if (b.index === item.index) {
        const sp2 = extractSubPath(second);
        if (sp2) combined.push(sp2);
      }
    }
    const norm = normalizeResult(combined, layer.fillRule);
    return norm ? [norm] : null;
  });
}

function normalizeVec(dx: number, dy: number): Point2D {
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

export function computeKnifeSlice(
  layer: PathLayer,
  cutScopePoints: Point2D[]
): BooleanResult[] | null {
  if (cutScopePoints.length < 2) return null;

  let totalLen = 0;
  for (let i = 1; i < cutScopePoints.length; i += 1) {
    totalLen += Math.hypot(
      cutScopePoints[i].x - cutScopePoints[i - 1].x,
      cutScopePoints[i].y - cutScopePoints[i - 1].y
    );
  }
  if (totalLen <= 2) return null;

  return withHeadlessProject((scope) => {
    const cutPath = new scope.Path({
      segments: cutScopePoints.map((p) => new scope.Point(p.x, p.y)),
      closed: false,
      applyMatrix: false,
      insert: false,
    });
    if (cutPath.segments.length > 2) {
      cutPath.simplify(1.2);
    }

    const allOpen =
      layer.subpaths.length > 0 && layer.subpaths.every((sp) => !sp.closed);

    if (allOpen) {
      const openPaths = layer.subpaths
        .map((sp) => buildWorldSubPath(scope, layer, sp, false))
        .filter((p): p is paper.Path => p !== null);
      if (openPaths.length === 0) return null;

      let totalSplits = 0;
      const piecePaths: paper.Path[] = [];

      for (const target of openPaths) {
        const crossings = cutPath.getIntersections(target);
        const offsets = crossings
          .map((ix) => ix.intersection?.offset ?? target.getNearestLocation(ix.point)?.offset ?? -1)
          .filter((off) => off > 1e-3 && off < target.length - 1e-3)
          .sort((a, b) => b - a);

        if (offsets.length === 0) {
          piecePaths.push(target);
          continue;
        }

        const deduped: number[] = [];
        for (const off of offsets) {
          if (deduped.length === 0 || Math.abs(off - deduped[deduped.length - 1]) > 0.5) {
            deduped.push(off);
          }
        }

        const halves: paper.Path[] = [];
        for (const off of deduped) {
          const loc = target.getLocationAt(off);
          if (!loc) continue;
          const tail = target.splitAt(loc);
          if (tail && tail !== target) {
            halves.push(tail);
            totalSplits += 1;
          }
        }
        piecePaths.push(target, ...halves.reverse());
      }

      if (totalSplits === 0) return null;
      const results: BooleanResult[] = [];
      for (const p of piecePaths) {
        const sp = extractSubPath(p);
        if (!sp) continue;
        const norm = normalizeResult([sp], 'nonzero');
        if (norm) results.push(norm);
      }
      return results.length >= 2 ? results : null;
    }

    const targetItem = buildWorldPathItem(scope, layer, true);
    if (!targetItem) return null;

    if (cutPath.getIntersections(targetItem).length === 0) {
      return null;
    }

    const M =
      Math.max(
        targetItem.bounds.width,
        targetItem.bounds.height,
        cutPath.bounds.width,
        cutPath.bounds.height
      ) *
        3 +
      1000;

    const firstPt = cutPath.firstSegment.point;
    const lastPt = cutPath.lastSegment.point;
    const u = normalizeVec(lastPt.x - firstPt.x, lastPt.y - firstPt.y);
    const n = { x: -u.y, y: u.x };

    const extStart = new scope.Point(firstPt.x - u.x * M, firstPt.y - u.y * M);
    const extEnd = new scope.Point(lastPt.x + u.x * M, lastPt.y + u.y * M);
    const backEnd = new scope.Point(extEnd.x + n.x * M, extEnd.y + n.y * M);
    const backStart = new scope.Point(extStart.x + n.x * M, extStart.y + n.y * M);

    const cutSegments = cutPath.segments.map((s) => s.clone());
    const maskPath = new scope.Path({
      segments: [
        new scope.Segment(extStart),
        ...cutSegments,
        new scope.Segment(extEnd),
        new scope.Segment(backEnd),
        new scope.Segment(backStart),
      ],
      closed: true,
      applyMatrix: false,
      insert: false,
    });

    let pieceItems: paper.PathItem[];
    if (maskPath.getIntersections(maskPath).length === 0) {
      const partA = targetItem.intersect(maskPath, { insert: false });
      const partB = targetItem.subtract(maskPath, { insert: false });
      pieceItems = [...toPieceItems(scope, partA), ...toPieceItems(scope, partB)];
    } else {
      const ribbon = cutPath.outline({
        width: 0.25,
        cap: 'butt',
        join: 'round',
        insert: false,
      });
      const subtracted = targetItem.subtract(ribbon, { insert: false });
      pieceItems = toPieceItems(scope, subtracted);
    }

    const results: BooleanResult[] = [];
    for (const piece of pieceItems) {
      const worldSubpaths = extractSubPathsFromItem(scope, piece);
      const norm = normalizeResult(worldSubpaths);
      if (norm) results.push(norm);
    }
    return results.length >= 2 ? results : null;
  });
}
