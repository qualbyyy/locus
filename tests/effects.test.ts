import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
  expandLayerAppearance,
  resetDocument,
  selectSimilarLayers,
  updateLayerEffects,
} from '../src/core/commands';
import { useEditorStore } from '../src/core/store';
import type { PathLayer, SubPath } from '../src/core/types';
import {
  apply3DEffect,
  applyDistortToSubPaths,
  applyWarpToSubPaths,
} from '../src/engine/effects';

const rectSubPaths: SubPath[] = [
  {
    closed: true,
    anchors: [
      { x: -100, y: -50, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
      { x: 100, y: -50, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
      { x: 100, y: 50, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
      { x: -100, y: 50, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
    ],
  },
];

describe('effects engine and commands', () => {
  beforeEach(() => {
    resetDocument({ width: 1080, height: 1080, dpi: 72, background: '#ffffff' });
  });

  it('keeps geometry untouched when warp bend and distortions are 0', () => {
    const out = applyWarpToSubPaths(rectSubPaths, {
      style: 'flag',
      bend: 0,
      distortH: 0,
      distortV: 0,
    });
    expect(out).toBe(rectSubPaths);
  });

  it('subdivides and bends rect for flag, arc, bulge and twist', () => {
    for (const style of ['flag', 'arc', 'bulge', 'twist'] as const) {
      const out = applyWarpToSubPaths(rectSubPaths, {
        style,
        bend: 55,
        distortH: 0,
        distortV: 0,
      });
      expect(out).toHaveLength(1);
      expect(out[0].closed).toBe(true);
      expect(out[0].anchors.length).toBeGreaterThan(rectSubPaths[0].anchors.length);
    }
  });

  it('applies zigzag, roughen and roundCorners distortions', () => {
    const zz = applyDistortToSubPaths(rectSubPaths, {
      kind: 'zigzag',
      size: 10,
      ridges: 4,
      smooth: false,
    });
    expect(zz[0].anchors.length).toBeGreaterThan(8);

    const rg = applyDistortToSubPaths(rectSubPaths, {
      kind: 'roughen',
      size: 8,
      detail: 5,
      seed: 42,
    });
    expect(rg[0].anchors.length).toBeGreaterThan(4);

    const rc = applyDistortToSubPaths(rectSubPaths, {
      kind: 'roundCorners',
      radius: 15,
    });
    expect(rc[0].anchors.length).toBe(8);
  });

  it('projects 3D rotate and builds sorted extrude faces', () => {
    const rot = apply3DEffect(
      rectSubPaths,
      {
        kind: 'rotate',
        rotateX: 25,
        rotateY: -20,
        rotateZ: 0,
        perspective: 50,
        depth: 0,
        shade: 0.7,
      },
      '#da7756'
    );
    expect(rot.faces).toHaveLength(0);
    expect(rot.front[0].anchors).toHaveLength(4);

    const ext = apply3DEffect(
      rectSubPaths,
      {
        kind: 'extrude',
        rotateX: 20,
        rotateY: -25,
        rotateZ: 0,
        perspective: 45,
        depth: 40,
        shade: 0.8,
      },
      '#da7756'
    );
    expect(ext.faces.length).toBeGreaterThan(4);
    expect(ext.faces[0].fill).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('expands vector effects non-destructively into baked paths', () => {
    const shape = createShapeLayer({ preset: 'rect', x: 300, y: 300, width: 160, height: 120 });
    updateLayerEffects([shape.id], {
      warp: { style: 'flag', bend: 50, distortH: 0, distortV: 0 },
      blur: 6,
    });

    const expanded = expandLayerAppearance([shape.id]);
    expect(expanded).toHaveLength(1);
    const updated = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === shape.id) as PathLayer;
    expect(updated.effects?.warp).toBeUndefined();
    expect(updated.effects?.blur).toBe(6);
    expect(updated.subpaths[0].anchors.length).toBeGreaterThan(4);
  });

  it('selects similar layers by fill color', () => {
    const a = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 80, height: 80, fill: '#112233' });
    createShapeLayer({ preset: 'ellipse', x: 300, y: 100, width: 80, height: 80, fill: '#445566' });
    const c = createShapeLayer({ preset: 'star', x: 500, y: 100, width: 80, height: 80, fill: '#112233' });

    useEditorStore.setState({ selectedIds: [a.id] });
    const count = selectSimilarLayers('fill');
    expect(count).toBe(2);
    expect(useEditorStore.getState().selectedIds).toEqual([a.id, c.id]);
  });
});
