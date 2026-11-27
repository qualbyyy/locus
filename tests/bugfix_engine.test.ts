import paper from 'paper/dist/paper-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
  createTextOnPathFromShape,
  groupLayers,
  resetDocument,
  updateLayers,
} from '../src/core/commands';
import {
  computeSubPathsBBox,
  getLayerMatrix,
  multiplyMatrices,
} from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { PathLayer, TextLayer } from '../src/core/types';
import { apply3DEffect } from '../src/engine/effects/effects3d';
import { applyWarpToSubPaths } from '../src/engine/effects/warp';
import { syncSceneToPaper } from '../src/engine/sync';
import { resolvePathMatrixRelativeToText } from '../src/engine/textOnPath';

describe('Phase 3 regressions: warp, 3D extrude, textOnPath, sync group effects', () => {
  beforeEach(() => {
    resetDocument({ name: 'Phase3', width: 500, height: 400, dpi: 72 });
  });

  it('preserves width on small-bend arc warp', () => {
    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 200,
      height: 80,
      options: { cornerRadius: 0 },
    });
    const origBox = computeSubPathsBBox(rect.subpaths);
    const warped = applyWarpToSubPaths(rect.subpaths, {
      style: 'arc',
      bend: 1,
      distortH: 0,
      distortV: 0,
    });
    const warpedBox = computeSubPathsBBox(warped);
    expect(warpedBox.width).toBeGreaterThan(origBox.width * 0.9);
  });

  it('keeps compound holes in 3D extrude back-cap and places back-cap furthest in painter sort', () => {
    const outer = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 100, height: 100, options: { cornerRadius: 0 } });
    const hole = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 40, height: 40, options: { cornerRadius: 0 } });
    const res = apply3DEffect(
      [outer.subpaths[0], hole.subpaths[0]],
      { kind: 'extrude', rotateX: 20, rotateY: 20, rotateZ: 0, perspective: 20, depth: 30, shade: 0.5 },
      '#da7756'
    );
    // Back-cap face should appear early in painter order (furthest z) and contain both outer + hole subpaths
    const multiSubpathFace = res.faces.find((f) => f.subpaths.length === 2);
    expect(multiSubpathFace).toBeDefined();
    expect(res.faces.indexOf(multiSubpathFace!)).toBeLessThan(res.faces.length - 1);
  });

  it('compensates non-identity TextLayer transform in resolvePathMatrixRelativeToText', () => {
    const host = createShapeLayer({ preset: 'ellipse', x: 200, y: 200, width: 140, height: 140 });
    const txt = createTextOnPathFromShape(host.id, { content: 'Curved' })!;
    updateLayers([txt.id], { x: 40, y: 25, rotation: 20, scaleX: 1.5, scaleY: 1.5 });
    const scene = useEditorStore.getState().scene;
    const updatedTxt = scene.layers.find((l) => l.id === txt.id) as TextLayer;
    const updatedHost = scene.layers.find((l) => l.id === host.id) as PathLayer;

    const rel = resolvePathMatrixRelativeToText(updatedHost, updatedTxt, scene.layers);
    const combined = multiplyMatrices(getLayerMatrix(updatedTxt), rel);
    const hostM = getLayerMatrix(updatedHost);
    expect(combined.tx).toBeCloseTo(hostM.tx, 3);
    expect(combined.ty).toBeCloseTo(hostM.ty, 3);
    expect(combined.a).toBeCloseTo(hostM.a, 3);
  });

  it('keeps child items intact when syncing group with raster blur and preserves isolation dimming', () => {
    const child = createShapeLayer({ preset: 'rect', x: 150, y: 150, width: 80, height: 60, fill: '#da7756' });
    const grp = groupLayers([child.id])!;
    updateLayers([grp.id], { effects: { blur: 4 } });
    const other = createShapeLayer({ preset: 'ellipse', x: 300, y: 150, width: 50, height: 50, fill: '#2563eb' });

    const scope = new paper.PaperScope();
    scope.settings.applyMatrix = false;
    scope.setup(new paper.Size(500, 400));
    try {
      const sceneLayer = new scope.Layer();
      const scene = useEditorStore.getState().scene;
      const itemMap = syncSceneToPaper(scope, sceneLayer, scene, { editingGroupId: other.id });
      const childItem = itemMap.get(child.id);
      const grpItem = itemMap.get(grp.id);
      expect(childItem).toBeDefined();
      expect(grpItem).toBeDefined();
      expect(grpItem!.opacity).toBeCloseTo(0.35, 2);
      expect(childItem!.parent).not.toBeNull();
    } finally {
      scope.project?.remove();
      scope.remove();
    }
  });
});
