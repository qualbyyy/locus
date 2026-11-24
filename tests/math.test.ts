import { describe, expect, it } from 'vitest';
import {
  computeLayerWorldBBox,
  computeSubPathsBBox,
  evaluateCubicBezier,
  localToWorld,
  localVectorToWorld,
  normalizePathLayer,
  snapVector45,
  splitCubicBezier,
  worldToLocal,
  worldVectorToLocal,
} from '../src/core/math';
import type { AnchorPoint, PathLayer, Point2D, SubPath } from '../src/core/types';

function evalSegmentWorld(
  layer: PathLayer,
  a0: AnchorPoint,
  a1: AnchorPoint,
  t: number
): Point2D {
  const p0 = localToWorld(layer, { x: a0.x, y: a0.y });
  const p1 = localToWorld(layer, {
    x: a0.x + a0.handleOut.x,
    y: a0.y + a0.handleOut.y,
  });
  const p2 = localToWorld(layer, {
    x: a1.x + a1.handleIn.x,
    y: a1.y + a1.handleIn.y,
  });
  const p3 = localToWorld(layer, { x: a1.x, y: a1.y });
  return evaluateCubicBezier(p0, p1, p2, p3, t);
}

describe('core/math', () => {
  it('round-trips localToWorld and worldToLocal across rotation and anisotropic scale', () => {
    const transforms = [
      { x: 240, y: 180, rotation: 37, scaleX: 1.75, scaleY: 0.6 },
      { x: -50, y: 410, rotation: -120, scaleX: -1.25, scaleY: 0.8 },
    ];
    const point: Point2D = { x: 42.5, y: -19.25 };
    const vec: Point2D = { x: -18, y: 27 };

    for (const tr of transforms) {
      const worldPt = localToWorld(tr, point);
      const backPt = worldToLocal(tr, worldPt);
      expect(backPt.x).toBeCloseTo(point.x, 8);
      expect(backPt.y).toBeCloseTo(point.y, 8);

      const worldVec = localVectorToWorld(tr, vec);
      const backVec = worldVectorToLocal(tr, worldVec);
      expect(backVec.x).toBeCloseTo(vec.x, 8);
      expect(backVec.y).toBeCloseTo(vec.y, 8);
    }
  });

  it('snaps vectors to nearest 45-degree angle while preserving length', () => {
    const snapped = snapVector45({ x: 100, y: 12 });
    expect(Math.hypot(snapped.x, snapped.y)).toBeCloseTo(Math.hypot(100, 12), 6);
    expect(snapped.y).toBeCloseTo(0, 6);

    const diag = snapVector45({ x: 50, y: 42 });
    expect(Math.abs(diag.x)).toBeCloseTo(Math.abs(diag.y), 6);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(Math.hypot(50, 42), 6);
  });

  it('computes exact cubic bezier extrema beyond anchor points', () => {
    const subpaths: SubPath[] = [
      {
        closed: false,
        anchors: [
          {
            x: 0,
            y: 0,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 120 },
            smooth: false,
          },
          {
            x: 100,
            y: 0,
            handleIn: { x: 0, y: 120 },
            handleOut: { x: 0, y: 0 },
            smooth: false,
          },
        ],
      },
    ];

    const bbox = computeSubPathsBBox(subpaths);
    expect(bbox.x).toBeCloseTo(0, 6);
    expect(bbox.y).toBeCloseTo(0, 6);
    expect(bbox.width).toBeCloseTo(100, 6);
    expect(bbox.height).toBeCloseTo(90, 6);

    const layer: PathLayer = {
      id: 'p1',
      name: 'Curve',
      type: 'path',
      visible: true,
      locked: false,
      x: 300,
      y: 200,
      rotation: 0,
      scaleX: 2,
      scaleY: 1,
      opacity: 1,
      subpaths,
      fillRule: 'nonzero',
      fill: null,
      stroke: null,
    };

    const worldBox = computeLayerWorldBBox(layer);
    expect(worldBox.x).toBeCloseTo(300, 6);
    expect(worldBox.y).toBeCloseTo(200, 6);
    expect(worldBox.width).toBeCloseTo(200, 6);
    expect(worldBox.height).toBeCloseTo(90, 6);
  });

  it('normalizes a rotated and scaled PathLayer without world-space jump', () => {
    const layer: PathLayer = {
      id: 'path-rot',
      name: 'Rotated',
      type: 'path',
      visible: true,
      locked: false,
      x: 320,
      y: 210,
      rotation: 37,
      scaleX: 1.4,
      scaleY: 0.85,
      opacity: 1,
      fillRule: 'nonzero',
      fill: '#da7756',
      stroke: null,
      subpaths: [
        {
          closed: true,
          anchors: [
            {
              x: -30,
              y: -25,
              handleIn: { x: -12, y: 6 },
              handleOut: { x: 18, y: -10 },
              smooth: true,
            },
            {
              x: 95,
              y: -15,
              handleIn: { x: -10, y: -14 },
              handleOut: { x: 12, y: 18 },
              smooth: true,
            },
            {
              x: 60,
              y: 80,
              handleIn: { x: 20, y: 10 },
              handleOut: { x: -22, y: -8 },
              smooth: true,
            },
            {
              x: -10,
              y: 45,
              handleIn: { x: -8, y: 16 },
              handleOut: { x: -14, y: -16 },
              smooth: true,
            },
          ],
        },
      ],
    };

    const ts = [0.25, 0.5, 0.75];
    const beforeAnchors = layer.subpaths[0].anchors.map((a) =>
      localToWorld(layer, { x: a.x, y: a.y })
    );
    const beforeSamples: Point2D[] = [];
    const anchorsBefore = layer.subpaths[0].anchors;
    for (let i = 0; i < anchorsBefore.length; i++) {
      const a0 = anchorsBefore[i];
      const a1 = anchorsBefore[(i + 1) % anchorsBefore.length];
      for (const t of ts) {
        beforeSamples.push(evalSegmentWorld(layer, a0, a1, t));
      }
    }

    const normalized = normalizePathLayer(layer);
    const localBox = computeSubPathsBBox(normalized.subpaths);
    expect(localBox.x + localBox.width / 2).toBeCloseTo(0, 6);
    expect(localBox.y + localBox.height / 2).toBeCloseTo(0, 6);

    const afterAnchors = normalized.subpaths[0].anchors.map((a) =>
      localToWorld(normalized, { x: a.x, y: a.y })
    );
    afterAnchors.forEach((pt, idx) => {
      expect(pt.x).toBeCloseTo(beforeAnchors[idx].x, 6);
      expect(pt.y).toBeCloseTo(beforeAnchors[idx].y, 6);
    });

    const afterSamples: Point2D[] = [];
    const anchorsAfter = normalized.subpaths[0].anchors;
    for (let i = 0; i < anchorsAfter.length; i++) {
      const a0 = anchorsAfter[i];
      const a1 = anchorsAfter[(i + 1) % anchorsAfter.length];
      for (const t of ts) {
        afterSamples.push(evalSegmentWorld(normalized, a0, a1, t));
      }
    }

    afterSamples.forEach((pt, idx) => {
      expect(pt.x).toBeCloseTo(beforeSamples[idx].x, 6);
      expect(pt.y).toBeCloseTo(beforeSamples[idx].y, 6);
    });

    expect(normalizePathLayer(normalized)).toBe(normalized);
  });

  it('splits cubic bezier curves without altering curve geometry', () => {
    const a0: AnchorPoint = {
      x: 10,
      y: 20,
      handleIn: { x: -10, y: 0 },
      handleOut: { x: 30, y: -50 },
      smooth: true,
    };
    const a1: AnchorPoint = {
      x: 140,
      y: 60,
      handleIn: { x: -20, y: 70 },
      handleOut: { x: 15, y: 0 },
      smooth: true,
    };

    const tSplit = 0.35;
    const split = splitCubicBezier(a0, a1, tSplit);
    const leftA0: AnchorPoint = { ...a0, handleOut: split.a0HandleOut };
    const rightA1: AnchorPoint = { ...a1, handleIn: split.a1HandleIn };

    const p0 = { x: a0.x, y: a0.y };
    const p1 = { x: a0.x + a0.handleOut.x, y: a0.y + a0.handleOut.y };
    const p2 = { x: a1.x + a1.handleIn.x, y: a1.y + a1.handleIn.y };
    const p3 = { x: a1.x, y: a1.y };

    for (const u of [0.2, 0.5, 0.8]) {
      const origLeft = evaluateCubicBezier(p0, p1, p2, p3, u * tSplit);
      const splitLeft = evaluateCubicBezier(
        { x: leftA0.x, y: leftA0.y },
        {
          x: leftA0.x + leftA0.handleOut.x,
          y: leftA0.y + leftA0.handleOut.y,
        },
        {
          x: split.midAnchor.x + split.midAnchor.handleIn.x,
          y: split.midAnchor.y + split.midAnchor.handleIn.y,
        },
        { x: split.midAnchor.x, y: split.midAnchor.y },
        u
      );
      expect(splitLeft.x).toBeCloseTo(origLeft.x, 6);
      expect(splitLeft.y).toBeCloseTo(origLeft.y, 6);

      const origRight = evaluateCubicBezier(
        p0,
        p1,
        p2,
        p3,
        tSplit + u * (1 - tSplit)
      );
      const splitRight = evaluateCubicBezier(
        { x: split.midAnchor.x, y: split.midAnchor.y },
        {
          x: split.midAnchor.x + split.midAnchor.handleOut.x,
          y: split.midAnchor.y + split.midAnchor.handleOut.y,
        },
        {
          x: rightA1.x + rightA1.handleIn.x,
          y: rightA1.y + rightA1.handleIn.y,
        },
        { x: rightA1.x, y: rightA1.y },
        u
      );
      expect(splitRight.x).toBeCloseTo(origRight.x, 6);
      expect(splitRight.y).toBeCloseTo(origRight.y, 6);
    }
  });
});
