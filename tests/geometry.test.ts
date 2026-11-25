import { describe, expect, it } from 'vitest';
import { computeSubPathsBBox } from '../src/core/math';
import type { SmartShapeOptions, SubPath } from '../src/core/types';
import {
  generateSmartShape,
  randomizeAnchors,
  roundPathCorners,
  smoothSubPaths,
} from '../src/engine/geometry';

const BASE_OPTIONS: SmartShapeOptions = {
  preset: 'blob',
  points: 6,
  wobble: 0.4,
  cornerRadius: 16,
  innerRadiusRatio: 0.5,
};

function assertCenteredAndFinite(subpaths: SubPath[]) {
  expect(subpaths.length).toBeGreaterThan(0);
  for (const sp of subpaths) {
    for (const a of sp.anchors) {
      expect(Number.isFinite(a.x)).toBe(true);
      expect(Number.isFinite(a.y)).toBe(true);
      expect(Number.isFinite(a.handleIn.x)).toBe(true);
      expect(Number.isFinite(a.handleIn.y)).toBe(true);
      expect(Number.isFinite(a.handleOut.x)).toBe(true);
      expect(Number.isFinite(a.handleOut.y)).toBe(true);
    }
  }
  const bbox = computeSubPathsBBox(subpaths);
  expect(bbox.x + bbox.width / 2).toBeCloseTo(0, 4);
  expect(bbox.y + bbox.height / 2).toBeCloseTo(0, 4);
}

describe('engine/geometry', () => {
  it('generates deterministic centered blob shapes', () => {
    const a = generateSmartShape(200, 140, BASE_OPTIONS, 42);
    const b = generateSmartShape(200, 140, BASE_OPTIONS, 42);
    const c = generateSmartShape(200, 140, BASE_OPTIONS, 43);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a[0].closed).toBe(true);
    expect(a[0].anchors).toHaveLength(6);
    expect(a[0].anchors.every((pt) => pt.smooth)).toBe(true);
    assertCenteredAndFinite(a);
  });

  it('generates ellipse, sharp and rounded rect, polygon, and star presets', () => {
    const ellipse = generateSmartShape(180, 120, {
      ...BASE_OPTIONS,
      preset: 'ellipse',
    });
    expect(ellipse[0].anchors).toHaveLength(4);
    expect(computeSubPathsBBox(ellipse).width).toBeCloseTo(180, 3);
    expect(computeSubPathsBBox(ellipse).height).toBeCloseTo(120, 3);
    assertCenteredAndFinite(ellipse);

    const sharpRect = generateSmartShape(160, 90, {
      ...BASE_OPTIONS,
      preset: 'rect',
      cornerRadius: 0,
    });
    expect(sharpRect[0].anchors).toHaveLength(4);
    assertCenteredAndFinite(sharpRect);

    const roundedRect = generateSmartShape(160, 90, {
      ...BASE_OPTIONS,
      preset: 'rect',
      cornerRadius: 20,
    });
    expect(roundedRect[0].anchors).toHaveLength(8);
    assertCenteredAndFinite(roundedRect);

    const polygon = generateSmartShape(150, 150, {
      ...BASE_OPTIONS,
      preset: 'polygon',
      points: 5,
    });
    expect(polygon[0].anchors).toHaveLength(5);
    assertCenteredAndFinite(polygon);

    const star = generateSmartShape(150, 150, {
      ...BASE_OPTIONS,
      preset: 'star',
      points: 5,
      innerRadiusRatio: 0.45,
    });
    expect(star[0].anchors).toHaveLength(10);
    assertCenteredAndFinite(star);
  });

  it('smooths polygons into collinear bezier handles and preserves open endpoints', () => {
    const polygon = generateSmartShape(120, 120, {
      ...BASE_OPTIONS,
      preset: 'polygon',
      points: 4,
    });
    const smoothed = smoothSubPaths(polygon, 1);
    for (const a of smoothed[0].anchors) {
      expect(a.smooth).toBe(true);
      const inLen = Math.hypot(a.handleIn.x, a.handleIn.y);
      const outLen = Math.hypot(a.handleOut.x, a.handleOut.y);
      expect(inLen).toBeGreaterThan(5);
      expect(outLen).toBeGreaterThan(5);

      const dot =
        (a.handleIn.x * a.handleOut.x + a.handleIn.y * a.handleOut.y) /
        (inLen * outLen);
      expect(dot).toBeCloseTo(-1, 5);
    }

    const openPath: SubPath[] = [
      {
        closed: false,
        anchors: [
          {
            x: 0,
            y: 0,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 0 },
            smooth: false,
          },
          {
            x: 50,
            y: 40,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 0 },
            smooth: false,
          },
          {
            x: 100,
            y: 0,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 0 },
            smooth: false,
          },
        ],
      },
    ];
    const smoothedOpen = smoothSubPaths(openPath, 1);
    expect(smoothedOpen[0].anchors[0].handleIn).toEqual({ x: 0, y: 0 });
    expect(smoothedOpen[0].anchors[2].handleOut).toEqual({ x: 0, y: 0 });
    expect(smoothedOpen[0].anchors[1].smooth).toBe(true);
  });

  it('randomizes anchors deterministically and respects zero intensity', () => {    const polygon = generateSmartShape(120, 120, {
      ...BASE_OPTIONS,
      preset: 'polygon',
      points: 6,
    });

    expect(randomizeAnchors(polygon, 0, 7)).toEqual(polygon);

    const wobbledA = randomizeAnchors(polygon, 10, 7);
    const wobbledB = randomizeAnchors(polygon, 10, 7);
    expect(wobbledA).toEqual(wobbledB);
    expect(wobbledA).not.toEqual(polygon);
    assertCenteredAndFinite(wobbledA);
  });

  it('rounds straight corners into bezier fillets and leaves curves untouched', () => {
    const star = generateSmartShape(160, 160, {
      ...BASE_OPTIONS,
      preset: 'star',
      points: 5,
    });
    const rounded = roundPathCorners(star, 8);
    expect(rounded).toHaveLength(star.length);
    expect(rounded[0].closed).toBe(true);
    expect(rounded[0].anchors.length).toBeGreaterThan(star[0].anchors.length);
    for (const anchor of rounded[0].anchors) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.handleOut.x)).toBe(true);
    }

    const smooth = smoothSubPaths(star, 1);
    expect(roundPathCorners(smooth, 8)).toEqual(smooth);
  });

  it('generates capsule preset with full semicircular endcaps', () => {
    const capsule = generateSmartShape(200, 80, {
      ...BASE_OPTIONS,
      preset: 'capsule',
    });
    expect(capsule).toHaveLength(1);
    expect(capsule[0].closed).toBe(true);
    const box = computeSubPathsBBox(capsule);
    expect(box.width).toBeCloseTo(200, 2);
    expect(box.height).toBeCloseTo(80, 2);
    assertCenteredAndFinite(capsule);
  });
});
