import { beforeEach, describe, expect, it } from 'vitest';
import { extractArtboardScene } from '../src/core/artboards';
import { clearAssets, getAllAssets, registerAssetFromBytes } from '../src/core/assets';
import { copySelectedLayers, hasCopiedLayers, pasteLayers } from '../src/core/clipboard';
import {
  addArtboard,
  booleanLayers,
  createShapeLayer,
  createTextOnPathFromShape,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  resetDocument,
  setClipMask,
  smoothLayers,
  updateLayers,
} from '../src/core/commands';
import { findLayerById } from '../src/core/layerTree';
import { clamp, computeLayerWorldBBox, decomposeMatrix } from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { PathLayer, TextLayer } from '../src/core/types';
import { computeDivideOperation } from '../src/engine/booleans';

const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

describe('Phase 2 regressions: tree refs, cross-scope booleans, math, assets', () => {
  beforeEach(() => {
    clearAssets();
    resetDocument({ name: 'Phase2', width: 400, height: 300, dpi: 72 });
  });

  it('reconciles orphan clip masks and TextLayer.pathId on delete, and blocks cross-scope clip masks', () => {
    const mask = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 60,
      height: 60,
      fill: null,
      stroke: null,
      name: 'Mask',
    });
    const target = createShapeLayer({
      preset: 'ellipse',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      fill: '#da7756',
      name: 'Target',
    });
    setClipMask(mask.id, [target.id]);
    expect((findLayerById(useEditorStore.getState().scene.layers, mask.id) as PathLayer).isClipMask).toBe(true);

    // Deleting masked target restores mask out of phantom state
    deleteLayers([target.id]);
    const restoredMask = findLayerById(useEditorStore.getState().scene.layers, mask.id) as PathLayer;
    expect(restoredMask.isClipMask).toBe(false);
    expect(restoredMask.stroke).not.toBeNull();

    // Text-on-path cleared when host deleted
    const host = createShapeLayer({ preset: 'ellipse', x: 200, y: 150, width: 120, height: 120 });
    const textOnPath = createTextOnPathFromShape(host.id, { content: 'Hello' })!;
    expect(textOnPath.pathId).toBe(host.id);
    deleteLayers([host.id]);
    const cleanedText = findLayerById(useEditorStore.getState().scene.layers, textOnPath.id) as TextLayer;
    expect(cleanedText.pathId).toBeUndefined();

    // Cross-scope clip mask blocked
    const inner = createShapeLayer({ preset: 'rect', x: 50, y: 50, width: 30, height: 30 });
    const grp = groupLayers([inner.id])!;
    setClipMask(restoredMask.id, [inner.id]);
    const grpInScene = findLayerById(useEditorStore.getState().scene.layers, grp.id)!;
    expect(grpInScene.type === 'group' && grpInScene.children[0].clipMaskId).toBeUndefined();
  });

  it('remaps clip masks and TextLayer.pathId when duplicating/pasting and clears clipboard on resetDocument', () => {
    const host = createShapeLayer({ preset: 'ellipse', x: 150, y: 150, width: 100, height: 100 });
    const txt = createTextOnPathFromShape(host.id, { content: 'Curved' })!;

    const copies = duplicateLayers([host.id, txt.id], 20, 20);
    expect(copies).toHaveLength(2);
    const copiedHost = copies.find((c) => c.type === 'path') as PathLayer;
    const copiedText = copies.find((c) => c.type === 'text') as TextLayer;
    expect(copiedText.pathId).toBe(copiedHost.id);

    copySelectedLayers([copiedHost.id, copiedText.id]);
    expect(hasCopiedLayers()).toBe(true);
    const pasted = pasteLayers({ inPlace: true });
    expect(pasted).toHaveLength(2);
    const pastedHost = pasted.find((c) => c.type === 'path') as PathLayer;
    const pastedText = pasted.find((c) => c.type === 'text') as TextLayer;
    expect(pastedText.pathId).toBe(pastedHost.id);

    resetDocument();
    expect(hasCopiedLayers()).toBe(false);
  });

  it('removes source layers from all groups in cross-scope boolean operations and converts coordinates to target group', () => {
    const a = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 80, height: 80, fill: '#f00' });
    const g1 = groupLayers([a.id])!;
    updateLayers([g1.id], { x: 150, y: 150 });

    const b = createShapeLayer({ preset: 'rect', x: 160, y: 160, width: 80, height: 80, fill: '#00f' });
    groupLayers([b.id]);

    const united = booleanLayers([a.id, b.id], 'unite');
    expect(united).not.toBeNull();
    const layers = useEditorStore.getState().scene.layers;
    expect(findLayerById(layers, a.id)).toBeNull();
    expect(findLayerById(layers, b.id)).toBeNull();
    expect(findLayerById(layers, united!.id)).not.toBeNull();
  });

  it('handles NaN in clamp, scaleX=0 in decomposeMatrix, small area in divide, and text-on-path bbox on 2nd artboard', () => {
    expect(clamp(Number.NaN, 5, 10)).toBe(5);
    const d = decomposeMatrix({ a: 0, b: 0, c: -1, d: 1, tx: 10, ty: 20 });
    expect(Number.isFinite(d.rotation)).toBe(true);
    expect(d.scaleY).toBeGreaterThan(0.5);

    const tiny1 = createShapeLayer({ preset: 'rect', x: 10, y: 10, width: 0.4, height: 0.4 });
    const tiny2 = createShapeLayer({ preset: 'rect', x: 10.2, y: 10.2, width: 0.4, height: 0.4 });
    expect(computeDivideOperation([tiny1, tiny2]).length).toBeGreaterThan(0);

    // Text-on-path on 2nd artboard included by extractArtboardScene
    const ab2 = addArtboard({ name: 'AB2', x: 1000, y: 0, width: 400, height: 300 });
    const host2 = createShapeLayer({ preset: 'ellipse', x: ab2.x + 200, y: 150, width: 120, height: 120 });
    const text2 = createTextOnPathFromShape(host2.id, { content: 'AB2 Text' })!;
    const scene = useEditorStore.getState().scene;
    const box = computeLayerWorldBBox(text2, scene.layers);
    expect(box.x).toBeGreaterThan(900);
    const extracted = extractArtboardScene(scene, ab2);
    expect(extracted.layers.some((l) => l.id === text2.id)).toBe(true);
  });

  it('prevents locked path deformation and avoids stale asset injection when clearAssets runs concurrently', async () => {
    const p = createShapeLayer({ preset: 'rect', x: 50, y: 50, width: 40, height: 40 });
    const beforeSubpaths = p.subpaths;
    updateLayers([p.id], { locked: true });
    smoothLayers([p.id], 2);
    expect((findLayerById(useEditorStore.getState().scene.layers, p.id) as PathLayer).subpaths).toEqual(beforeSubpaths);

    const pending = registerAssetFromBytes({ bytes: TINY_PNG, name: 'stale.png' });
    clearAssets();
    await pending;
    expect(getAllAssets()).toHaveLength(0);
  });
});
