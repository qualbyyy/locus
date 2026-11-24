import { clamp, computeSubPathsBBox, degToRad, evaluateCubicBezier } from '../../core/math';
import type { AnchorPoint, Effect3D, Point2D, SubPath } from '../../core/types';
import { parseColorToRgba } from '../../export/pathData';

export interface ExtrudeFace {
  subpaths: SubPath[];
  fill: string;
}

interface Projected3D extends Point2D {
  z: number;
}

function projectPoint3D(
  x: number,
  y: number,
  z: number,
  eff: Effect3D,
  cx: number,
  cy: number
): Projected3D {
  const rx = degToRad(eff.rotateX);
  const ry = degToRad(eff.rotateY);
  const rz = degToRad(eff.rotateZ);

  let px = x - cx;
  let py = y - cy;
  let pz = z;

  // Rotate Z
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  [px, py] = [px * cz - py * sz, px * sz + py * cz];

  // Rotate X
  const cxR = Math.cos(rx);
  const sxR = Math.sin(rx);
  [py, pz] = [py * cxR - pz * sxR, py * sxR + pz * cxR];

  // Rotate Y
  const cyR = Math.cos(ry);
  const syR = Math.sin(ry);
  [px, pz] = [px * cyR + pz * syR, -px * syR + pz * cyR];

  const persp = clamp(eff.perspective, 0, 100);
  const focal = persp > 0.5 ? 1250 - persp * 9.5 : 0;
  const k = focal > 0 ? focal / Math.max(45, focal + pz) : 1;

  return {
    x: cx + px * k,
    y: cy + py * k,
    z: pz,
  };
}

function shadeHexColor(hex: string, factor: number): string {
  const rgba = parseColorToRgba(hex) ?? [218, 119, 86, 1];
  const f = clamp(factor, 0.15, 1.3);
  const r = Math.round(clamp(rgba[0] * f, 0, 255));
  const g = Math.round(clamp(rgba[1] * f, 0, 255));
  const b = Math.round(clamp(rgba[2] * f, 0, 255));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function sampleSubPathPoints(sp: SubPath, stepPx = 14): Point2D[] {
  const anchors = sp.anchors;
  if (anchors.length < 2) return anchors.map((a) => ({ x: a.x, y: a.y }));
  const segCount = sp.closed ? anchors.length : anchors.length - 1;
  const pts: Point2D[] = [];

  for (let i = 0; i < segCount; i += 1) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const hasHandles =
      Math.hypot(a.handleOut.x, a.handleOut.y) > 0.5 ||
      Math.hypot(b.handleIn.x, b.handleIn.y) > 0.5;
    const steps = hasHandles ? clamp(Math.ceil(chord / stepPx), 2, 16) : 1;

    const p0 = { x: a.x, y: a.y };
    const p1 = { x: a.x + a.handleOut.x, y: a.y + a.handleOut.y };
    const p2 = { x: b.x + b.handleIn.x, y: b.y + b.handleIn.y };
    const p3 = { x: b.x, y: b.y };

    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      pts.push(evaluateCubicBezier(p0, p1, p2, p3, t));
    }
  }
  if (!sp.closed) {
    const last = anchors[anchors.length - 1];
    pts.push({ x: last.x, y: last.y });
  }
  return pts;
}

function ptsToLinearSubPath(pts: Point2D[], closed: boolean): SubPath {
  return {
    closed,
    anchors: pts.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      smooth: false,
    })),
  };
}

export function apply3DEffect(
  subpaths: SubPath[],
  eff: Effect3D,
  baseFill: string
): { front: SubPath[]; faces: ExtrudeFace[] } {
  const bbox = computeSubPathsBBox(subpaths);
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  const front: SubPath[] = subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a): AnchorPoint => {
      const p = projectPoint3D(a.x, a.y, 0, eff, cx, cy);
      const hi = projectPoint3D(a.x + a.handleIn.x, a.y + a.handleIn.y, 0, eff, cx, cy);
      const ho = projectPoint3D(a.x + a.handleOut.x, a.y + a.handleOut.y, 0, eff, cx, cy);
      return {
        x: p.x,
        y: p.y,
        handleIn: { x: hi.x - p.x, y: hi.y - p.y },
        handleOut: { x: ho.x - p.x, y: ho.y - p.y },
        smooth: a.smooth,
      };
    }),
  }));

  if (eff.kind !== 'extrude' || eff.depth <= 0.5) {
    return { front, faces: [] };
  }

  const shade = clamp(eff.shade, 0, 1);
  const rawFaces: Array<{ subpaths: SubPath[]; fill: string; z: number }> = [];

  for (const sp of subpaths) {
    const pts = sampleSubPathPoints(sp, 14);
    if (pts.length < 2) continue;

    const frontProj = pts.map((p) => projectPoint3D(p.x, p.y, 0, eff, cx, cy));
    const backProj = pts.map((p) => projectPoint3D(p.x, p.y, eff.depth, eff, cx, cy));

    if (sp.closed && backProj.length >= 3) {
      const avgBackZ = backProj.reduce((acc, p) => acc + p.z, 0) / backProj.length;
      rawFaces.push({
        subpaths: [ptsToLinearSubPath(backProj, true)],
        fill: shadeHexColor(baseFill, 1 - shade * 0.6),
        z: avgBackZ - 1,
      });
    }

    const edgeCount = sp.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < edgeCount; i += 1) {
      const j = (i + 1) % pts.length;
      const f0 = frontProj[i];
      const f1 = frontProj[j];
      const b1 = backProj[j];
      const b0 = backProj[i];

      const dx = f1.x - f0.x;
      const dy = f1.y - f0.y;
      const len = Math.max(1e-4, Math.hypot(dx, dy));
      // Light from top-left (-0.7, -0.7)
      const nx = -dy / len;
      const ny = dx / len;
      const light = clamp(0.5 + (nx * -0.6 + ny * -0.8) * 0.5, 0, 1);
      const factor = 1 - shade * (0.2 + (1 - light) * 0.45);
      const avgZ = (f0.z + f1.z + b0.z + b1.z) / 4;

      rawFaces.push({
        subpaths: [ptsToLinearSubPath([f0, f1, b1, b0], true)],
        fill: shadeHexColor(baseFill, factor),
        z: avgZ,
      });
    }
  }

  // Algorithm: painter's sort (largest z is furthest in our right-handed camera where +z goes into screen)
  rawFaces.sort((a, b) => b.z - a.z);

  return {
    front,
    faces: rawFaces.map(({ subpaths: sp, fill }) => ({ subpaths: sp, fill })),
  };
}
