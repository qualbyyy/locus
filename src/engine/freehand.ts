import { clamp } from '../core/math';
import type { Point2D, SubPath } from '../core/types';
import { extractSubPath, withHeadlessProject } from './booleans';

export function fitFreehandSubPath(
  points: Point2D[],
  opts?: { tolerance?: number; closed?: boolean }
): SubPath | null {
  if (points.length < 2) return null;

  const filtered: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = filtered[filtered.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) >= 1.5) {
      filtered.push(cur);
    }
  }
  if (filtered.length < 2) {
    const last = points[points.length - 1];
    if (Math.hypot(last.x - filtered[0].x, last.y - filtered[0].y) > 0.5) {
      filtered.push(last);
    } else {
      return null;
    }
  }

  const tolerance = clamp(opts?.tolerance ?? 2.5, 0.2, 20);
  const closed = Boolean(opts?.closed);

  return withHeadlessProject((scope) => {
    const path = new scope.Path({
      segments: filtered.map((p) => new scope.Point(p.x, p.y)),
      closed,
      applyMatrix: false,
      insert: false,
    });
    if (path.segments.length > 2) {
      path.simplify(tolerance);
    }
    return extractSubPath(path);
  });
}
